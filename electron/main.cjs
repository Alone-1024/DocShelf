// Electron 入口（后期打包 exe 用）：内嵌 Express 服务 + 单窗口应用
// 开发运行：npm i -D electron && npm run app
// 打包（electron-builder）见 package.json build 段
const { app: electronApp, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

function canWrite(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

// 打包后 asar 内不可写，index.json 要落在 asar 外面：
// · 免安装版：portable 启动器会给出 exe 真实所在目录（PORTABLE_EXECUTABLE_DIR），数据跟着 exe 走；
// · 安装版：一律放 %APPDATA%\DocShelf。覆盖安装和卸载都会清空安装目录，
//   以前把数据放在那里，1.1.1 就有人一次覆盖安装把登记记录全丢了。
// 老安装版的记录还在安装目录里：首次启动复制一份到数据目录，原件留着不动。
if (electronApp.isPackaged) {
  const appData = path.join(electronApp.getPath('appData'), 'DocShelf');
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  if (process.env.PORTABLE_EXECUTABLE_DIR && canWrite(exeDir)) {
    process.env.DOCS_ROOT = exeDir;
  } else {
    fs.mkdirSync(appData, { recursive: true });
    const old = path.join(exeDir, 'index.json');
    if (!fs.existsSync(path.join(appData, 'index.json')) && fs.existsSync(old)) {
      try { fs.copyFileSync(old, path.join(appData, 'index.json')); } catch { /* 复制失败也别拦住启动 */ }
    }
    process.env.DOCS_ROOT = appData;
  }
}

const expressApp = require('../server.js');

function listen() {
  return new Promise(resolve => {
    const srv = expressApp.listen(3210, '127.0.0.1', () => resolve(srv));
    srv.on('error', () => {
      const srv2 = expressApp.listen(0, '127.0.0.1', () => resolve(srv2));
    });
  });
}

electronApp.whenReady().then(async () => {
  const server = await listen();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'DocShelf',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      // 页面脚本和 preload 彻底隔开；preload 只用 contextBridge/webUtils，沙箱下也够用
      sandbox: true,
      // 页面靠它问出文件的真实路径，缺了这个就只能反查常用目录，C 盘/其他目录会登不上
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  win.loadURL(url);

  // 只放行网页链接和写信链接：file: 之类的交给系统等于让页面随便开本地程序
  const isSafeExternal = t => /^https?:\/\//i.test(t) || /^mailto:/i.test(t);

  // 主窗口一旦被导航到外站，preload 照样会注入那个页面，它就能读到任意文件的真实路径
  win.webContents.on('will-navigate', (e, target) => {
    if (target.startsWith(url)) return; // 站内跳转（含重新加载）不动
    e.preventDefault();
    if (isSafeExternal(target)) shell.openExternal(target);
  });

  // 预览用 window.open 在新窗口打开；外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) {
      if (isSafeExternal(target)) shell.openExternal(target);
      return { action: 'deny' };
    }
    // 收款页要两张码并排看清，用主窗口那套尺寸和「无菜单栏」，别用 800x600 默认值
    if (target.includes('/tip.html')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1080, height: 960, autoHideMenuBar: true,
          icon: path.join(__dirname, '..', 'build', 'icon.ico'),
        },
      };
    }
    return { action: 'allow' };
  });

  electronApp.on('window-all-closed', () => {
    server.close(() => electronApp.quit());
  });
});
