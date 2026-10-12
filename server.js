const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const crypto = require('crypto');
const { createToolbox } = require('./toolbox');

const PORT = process.env.PORT || 3210;

// 版本号给反馈弹窗带上，用户报问题时最缺的就是这条
const PKG = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')); } catch { return {}; }
})();

// 数据根目录：只放 index.json（登记记录），文件本身永远留在原路径
const ROOT = process.env.DOCS_ROOT || __dirname;
const INDEX_FILE = path.join(ROOT, 'index.json');

fs.mkdirSync(ROOT, { recursive: true });

const DEFAULT_CATEGORIES = [
  { name: 'PDF', exts: ['pdf'] },
  { name: 'Word', exts: ['doc', 'docx', 'rtf'] },
  { name: 'TXT', exts: ['txt', 'log', 'csv'] },
  { name: 'Markdown', exts: ['md', 'markdown'] },
  { name: 'PPT', exts: ['ppt', 'pptx'] },
  { name: '其他', exts: [] },
];

const EXT_TO_CATEGORY = {};
for (const c of DEFAULT_CATEGORIES) for (const e of c.exts) EXT_TO_CATEGORY[e] = c.name;

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (e) {
    // 解析失败先留个现场副本：紧接着的 saveIndex 会用空索引把这个唯一的记录文件覆盖掉
    try {
      if (fs.existsSync(INDEX_FILE)) fs.copyFileSync(INDEX_FILE, `${INDEX_FILE}.broken-${Date.now()}`);
    } catch { /* 副本没写成也别挡着启动 */ }
    return { categories: DEFAULT_CATEGORIES.map(c => ({ name: c.name, subs: ['默认'] })), files: [] };
  }
}

function saveIndex(idx) {
  // 先写临时文件再改名替换：万一写一半断电/被杀，index.json 本体还是完整可读的
  const tmp = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2), 'utf8');
  try { if (fs.existsSync(INDEX_FILE)) fs.copyFileSync(INDEX_FILE, `${INDEX_FILE}.bak`); } catch { /* 备份失败不影响保存 */ }
  fs.renameSync(tmp, INDEX_FILE);
}

let index = loadIndex();
// 老索引里「其他」可能被新建分类挤到中间，启动时统一挪回最后
{
  const i = index.categories.findIndex(c => c.name === '其他');
  if (i >= 0 && i !== index.categories.length - 1) index.categories.push(index.categories.splice(i, 1)[0]);
}
saveIndex(index); // 确保首次落盘

function validName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 60 && !/[\\/:*?"<>|]/.test(name);
}

function findFile(id) {
  return index.files.find(f => f.id === id);
}

// 把磁盘上的文件登记进索引（只记路径，不复制）。已登记/非文件/读不到 → 返回 null
function registerFile(rawAbs, { category, sub } = {}) {
  const abs = path.resolve(rawAbs);
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile()) return null;
  if (index.files.some(f => f.absPath.toLowerCase() === abs.toLowerCase())) return null;
  const ext = path.extname(abs).toLowerCase().replace('.', '') || 'unknown';
  let cat = category || EXT_TO_CATEGORY[ext] || '其他';
  if (!index.categories.some(c => c.name === cat)) cat = '其他';
  let catObj = index.categories.find(c => c.name === cat);
  let subName = sub || '默认';
  if (sub && !catObj.subs.includes(subName)) subName = '默认';
  if (!catObj.subs.includes(subName)) catObj.subs.push(subName);
  const rec = {
    id: crypto.createHash('sha1').update(abs.toLowerCase()).digest('hex').slice(0, 16),
    name: path.basename(abs),
    absPath: abs,
    ext,
    size: st.size,
    category: cat,
    sub: subName,
    uploadedAt: st.mtimeMs,
  };
  index.files.push(rec);
  return rec;
}

const app = express();
app.disable('x-powered-by'); // 本机服务也不需要告诉别人它是 Express

// 工具箱：自己解析请求体（8mb 上限），必须挂在全局 json 解析之前
const toolboxCtx = {
  safeName(name) {
    // 去掉路径分隔符与非法字符，只留文件名；防止 ../ 之类跑到别的目录
    const clean = String(name || '').replace(/[\\/:*?"<>|]/g, '').replace(/^[.]+/, '').replace(/[. ]+$/, '').trim().slice(0, 80);
    if (!clean || /^\.+$/.test(clean)) throw Object.assign(new Error('文件名不合法'), { status: 400 });
    return clean;
  },
  registerOutput(abs, reg) {
    if (reg && reg.register === false) return;
    if (registerFile(abs, { category: reg?.category, sub: reg?.sub })) saveIndex(index);
  },
};
// 只许本机调用。这几个接口能写盘、能弹系统对话框，而其中一部分（/api/tool/save、/api/pick-dir）
// 参数走 query、体是二进制，属于「简单请求」，浏览器不发预检——不设防的话任何网页都能借用户的浏览器使唤这些接口。
// 局域网机器不带 Origin，按「只绑 127.0.0.1」的设计本来也进不来。
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
app.use('/api', (req, res, next) => {
  const host = String(req.headers.host || '').split(':')[0];
  if (!LOCAL_HOSTS.has(host)) return res.status(403).json({ error: '只能从本机访问' });
  const origin = req.headers.origin;
  if (origin) {
    let oh = '';
    try { oh = new URL(origin).hostname; } catch { /* null、file:// 之类，一律不放行 */ }
    if (!LOCAL_HOSTS.has(oh)) return res.status(403).json({ error: '禁止从其他网站调用本接口' });
  }
  next();
});
app.use('/api', createToolbox(toolboxCtx));

// pdf.js 给前端渲染 PDF→图片用，整个包暴露出来（cmaps/standard_fonts 要能按相对路径取到）
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist'), {
  maxAge: '1h',
  setHeaders: res => res.setHeader('Cache-Control', 'no-store'),
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store'),
}));

// ---------- 状态 ----------
app.get('/api/state', (req, res) => {
  const cats = index.categories.map(c => ({
    name: c.name,
    subs: c.subs.map(s => ({
      name: s,
      files: index.files.filter(f => f.category === c.name && f.sub === s)
        .sort((a, b) => b.uploadedAt - a.uploadedAt),
    })),
    count: index.files.filter(f => f.category === c.name).length,
  }));
  res.json({
    root: ROOT,
    categories: cats,
    meta: {
      version: PKG.version || '未知',
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.versions.node,
      electron: process.versions.electron || '-',
      packaged: !!process.env.DOCS_ROOT,
      root: ROOT,
      files: index.files.length,
    },
  });
});

// ---------- 分类管理 ----------
app.post('/api/category', (req, res) => {
  const { name } = req.body;
  if (!validName(name)) return res.status(400).json({ error: '分类名不合法' });
  if (index.categories.some(c => c.name === name)) return res.status(409).json({ error: '分类已存在' });
  // 新建的排在「其他」上面——「其他」是兜底分类，永远垫底
  const other = index.categories.findIndex(c => c.name === '其他');
  const cat = { name, subs: ['默认'] };
  if (other < 0) index.categories.push(cat);
  else index.categories.splice(other, 0, cat);
  saveIndex(index);
  res.json({ ok: true });
});

app.delete('/api/category', (req, res) => {
  const { name } = req.body;
  if (index.files.some(f => f.category === name)) return res.status(409).json({ error: '该分类下还有文件，请先移动或删除' });
  index.categories = index.categories.filter(c => c.name !== name);
  saveIndex(index);
  res.json({ ok: true });
});

app.post('/api/sub', (req, res) => {
  const { category, name } = req.body;
  if (!validName(name)) return res.status(400).json({ error: '子分类名不合法' });
  const cat = index.categories.find(c => c.name === category);
  if (!cat) return res.status(404).json({ error: '大分类不存在' });
  if (cat.subs.includes(name)) return res.status(409).json({ error: '子分类已存在' });
  cat.subs.push(name);
  saveIndex(index);
  res.json({ ok: true });
});

app.delete('/api/sub', (req, res) => {
  const { category, name } = req.body;
  if (name === '默认') return res.status(400).json({ error: '默认子分类不可删除' });
  if (index.files.some(f => f.category === category && f.sub === name))
    return res.status(409).json({ error: '该子分类下还有文件' });
  const cat = index.categories.find(c => c.name === category);
  if (cat) cat.subs = cat.subs.filter(s => s !== name);
  saveIndex(index);
  res.json({ ok: true });
});

// ---------- 登记本地文件（原路径索引，不复制） ----------
app.post('/api/register', (req, res) => {
  const { paths, category, sub } = req.body;
  if (!Array.isArray(paths)) return res.status(400).json({ error: '参数非法' });
  let fixedCat = null, fixedSub = '默认';
  if (category) {
    fixedCat = index.categories.find(c => c.name === category);
    if (!fixedCat) return res.status(400).json({ error: '目标分类不存在' });
    if (sub) {
      if (!fixedCat.subs.includes(sub)) return res.status(400).json({ error: '目标子分类不存在' });
      fixedSub = sub;
    }
  }
  let added = 0, skipped = 0;
  for (const p of paths) {
    if (registerFile(path.resolve(p), { category: fixedCat?.name, sub: fixedSub })) added++;
    else skipped++;
  }
  saveIndex(index);
  res.json({ ok: true, added, skipped });
});

// 拖拽时浏览器拿不到 file:/// URI 的兜底：按 名称+大小+修改时间 在常用目录反查源文件
// 中文系统里这些文件夹的显示名是本地化的，两种写法都列上；不存在的目录 readdir 会抛错并被忽略
const LOCATE_DIRS = [
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), '桌面'),
  path.join(os.homedir(), '下载'),
  path.join(os.homedir(), '文档'),
];
const LOCATE_SKIP = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'AppData', 'SystemVolumeInformation']);

function findFileIn(dir, q, depth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === q.name.toLowerCase()) {
      try {
        const st = fs.statSync(p);
        if (st.size === q.size && Math.abs(st.mtimeMs - q.lastModified) < 2000) return p;
      } catch { /* 忽略 */ }
    }
    if (entry.isDirectory() && depth > 0 && !LOCATE_SKIP.has(entry.name)) {
      const hit = findFileIn(p, q, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

app.post('/api/locate', (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files)) return res.status(400).json({ error: '参数非法' });
  const results = files.map(q => {
    for (const dir of LOCATE_DIRS) {
      if (!fs.existsSync(dir)) continue;
      const hit = findFileIn(dir, q, 3);
      if (hit) return { name: q.name, path: hit };
    }
    return { name: q.name, path: null };
  });
  res.json({ results });
});

// ---------- 文件操作 ----------
// 移动单个文件；成功返回 null，失败返回错误信息。只改索引归属，不动磁盘
function applyMove(f, category, sub) {
  const cat = index.categories.find(c => c.name === category);
  if (!cat) return '目标分类不存在';
  if (!validName(sub) || !cat.subs.includes(sub)) return '目标子分类不存在';
  f.category = category;
  f.sub = sub;
  return null;
}

function applyDelete(f) {
  // 只移除索引，磁盘原文件不动
  index.files = index.files.filter(x => x.id !== f.id);
}

app.put('/api/file/:id', (req, res) => {
  const f = findFile(req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  const err = applyMove(f, req.body.category, req.body.sub);
  if (err) return res.status(400).json({ error: err });
  saveIndex(index);
  res.json({ ok: true });
});

app.delete('/api/file/:id', (req, res) => {
  const f = findFile(req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  applyDelete(f);
  saveIndex(index);
  res.json({ ok: true });
});

// ---------- 批量操作 ----------
app.put('/api/files/bulk-move', (req, res) => {
  const { ids, category, sub } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '未选择文件' });
  const errors = [];
  let moved = 0;
  for (const id of ids) {
    const f = findFile(id);
    if (!f) { errors.push(`文件不存在: ${id}`); continue; }
    const err = applyMove(f, category, sub);
    if (err) errors.push(`${f.name}: ${err}`); else moved++;
  }
  saveIndex(index);
  res.json({ ok: true, moved, errors });
});

app.post('/api/files/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '未选择文件' });
  let deleted = 0;
  for (const id of ids) {
    const f = findFile(id);
    if (f) { applyDelete(f); deleted++; }
  }
  saveIndex(index);
  res.json({ ok: true, deleted });
});

// ---------- 预览与打开 ----------
const MIME = {
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
  markdown: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  json: 'application/json', html: 'text/html; charset=utf-8', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

app.get('/api/raw/:id', (req, res) => {
  const f = findFile(req.params.id);
  if (!f) return res.status(404).send('文件不存在');
  const p = f.absPath;
  if (!p || !fs.existsSync(p)) return res.status(404).send('文件已丢失');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 登记的 .html 也从这里出，同源的网页一旦能跑脚本就带着本站接口的权限，直接掐掉
  if (MIME[f.ext] === 'text/html; charset=utf-8') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  }
  res.type(MIME[f.ext] || 'application/octet-stream');
  if (MIME[f.ext] && MIME[f.ext].startsWith('text/')) {
    res.send(fs.readFileSync(p)); // 文本类直接返回内容，前端负责渲染
  } else {
    fs.createReadStream(p).pipe(res);
  }
});

// 系统文件夹选择框：让工具箱的「输出目录」能真的浏览，而不是手打路径
const PICK_DIR_PS = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.Description = "选择转换结果的保存目录"',
  '$d.ShowNewFolderButton = $true',
  'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
  // 控制台输出走 GBK，中文路径会成乱码，所以结果写进 UTF-8 文件由 Node 读回
  '  [IO.File]::WriteAllText($env:DOCSEL, $d.SelectedPath, (New-Object Text.UTF8Encoding $false))',
  '}',
].join('\n');

app.post('/api/pick-dir', (req, res) => {
  if (process.platform !== 'win32') return res.status(400).json({ error: '该目录选择器仅支持 Windows，请直接填写路径' });
  const encoded = Buffer.from(PICK_DIR_PS, 'utf16le').toString('base64');
  const outFile = path.join(os.tmpdir(), `docshelf-pickdir-${crypto.randomBytes(6).toString('hex')}.txt`);
  execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: 120000, env: { ...process.env, DOCSEL: outFile } }, (err, stdout) => {
      let picked = null;
      try { picked = fs.readFileSync(outFile, 'utf8').trim() || null; } catch {}
      fs.rm(outFile, { force: true }, () => {});
      if (err) console.error('目录选择框失败:', err.message);
      res.json({ ok: true, path: picked });
    });
});

// 工具箱的输入文件选择框：未登记进索引的文件也能直接选来转换
const PICK_FILES_PS = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$o = New-Object System.Windows.Forms.OpenFileDialog',
  '$o.Title = "选择要转换的文件（未登记的也可以）"',
  '$o.Multiselect = $true',
  '$o.Filter = $env:DOCFILTER',
  'if ($o.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
  '  [IO.File]::WriteAllText($env:DOCSEL, ($o.FileNames -join "`n"), (New-Object Text.UTF8Encoding $false))',
  '}',
].join('\n');
const PICK_FILES_FILTER = '支持的文件 (*.pdf;*.png;*.jpg;*.jpeg;*.webp;*.doc;*.docx;*.rtf)|*.pdf;*.png;*.jpg;*.jpeg;*.webp;*.doc;*.docx;*.rtf|所有文件 (*.*)|*.*';

app.post('/api/pick-files', (req, res) => {
  if (process.platform !== 'win32') return res.status(400).json({ error: '该系统选择框仅支持 Windows，请把文件拖进来登记后再勾选' });
  const encoded = Buffer.from(PICK_FILES_PS, 'utf16le').toString('base64');
  const outFile = path.join(os.tmpdir(), `docshelf-pickfiles-${crypto.randomBytes(6).toString('hex')}.txt`);
  execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: 120000, env: { ...process.env, DOCSEL: outFile, DOCFILTER: PICK_FILES_FILTER } }, (err) => {
      let paths = [];
      try { paths = fs.readFileSync(outFile, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
      fs.rm(outFile, { force: true }, () => {});
      if (err) console.error('文件选择框失败:', err.message);
      const files = paths.map(p => {
        try { return { name: path.basename(p), absPath: p, ext: path.extname(p).toLowerCase().replace('.', '') }; } catch { return null; }
      }).filter(Boolean);
      res.json({ ok: true, files });
    });
});

// 用系统默认程序打开（Word/PPT 等 Office 走这里）
app.post('/api/open/:id', (req, res) => {
  const f = findFile(req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  const p = f.absPath;
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: '文件已丢失' });
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', p], () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [p], () => {});
  } else {
    execFile('xdg-open', [p], () => {});
  }
  res.json({ ok: true });
});

// 在资源管理器中定位：已有同文件夹窗口时直接激活它，不新开窗口
function psReveal(absPath) {
  const q = absPath.replace(/'/g, "''");
  const script = [
    "$path = '" + q + "'",
    '$parent = Split-Path -Parent $path',
    '$shell = New-Object -ComObject Shell.Application',
    'Add-Type -Namespace Win32 -Name Act -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);\'',
    'foreach ($w in $shell.Windows()) {',
    '  try {',
    '    if ($w.Document.Folder.Self.Path -eq $parent) {',
    '      $h = [IntPtr]$w.HWND',
    '      if ([Win32.Act]::IsIconic($h)) { [Win32.Act]::ShowWindow($h, 9) | Out-Null }',
    '      [Win32.Act]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)',
    '      [Win32.Act]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
    '      [Win32.Act]::SetForegroundWindow($h) | Out-Null',
    // Document.SelectItem 语义：第二参 1=选中 0=取消选中；先清掉旧选中再选目标
    '      try {',
    '        foreach ($s in @($w.Document.SelectedItems())) {',
    '          if ($s.Path -ne $path) { $w.Document.SelectItem($s.Path, 0) }',
    '        }',
    '        $w.Document.SelectItem($path, 1)',
    '      } catch {}',
    '      exit 0',
    '    }',
    '  } catch {}',
    '}',
    "Start-Process explorer.exe -ArgumentList ('/select,\"' + $path + '\"')",
  ].join('\n');
  return script;
}

function revealInExplorer(p) {
  if (process.platform === 'win32') {
    const encoded = Buffer.from(psReveal(p), 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 15000 }, () => {});
  } else {
    execFile('xdg-open', [path.dirname(p)], () => {});
  }
}

app.post('/api/reveal/:id', (req, res) => {
  const f = findFile(req.params.id);
  if (!f) return res.status(404).json({ error: '文件不存在' });
  const p = f.absPath;
  if (!p) return res.status(400).json({ error: '路径非法' });
  revealInExplorer(p);
  res.json({ ok: true });
});

// 操作手册里的「打开所在文件夹」：路径由程序自己知道，用户不用会输路径
app.post('/api/reveal-root', (req, res) => {
  revealInExplorer(path.join(ROOT, 'index.json'));
  res.json({ ok: true });
});

// ---------- 检查更新：只有用户自己点按钮才会走到这里，程序平时不联网 ----------
// 版本信息就是仓库根目录里的 version.json，按 package.json 的 updateSources 顺序挨个试
// （Gitee 在前、GitHub 兜底：这台机器上 GitHub 时通时不通）。
async function readVersionFrom(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'DocShelf', Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  if (r.status === 404) return { miss: true };
  if (!r.ok) return { err: 'http ' + r.status };
  const j = await r.json();
  const version = String(j.version || '').trim();
  const url2 = String(j.url || '').trim();
  if (!/^\d+(\.\d+){0,3}$/.test(version)) return { err: 'bad version' };
  if (!/^https?:\/\//i.test(url2)) return { err: 'bad url' };
  return { data: { version, notes: String(j.notes || '').slice(0, 600), url: url2, date: String(j.date || '').slice(0, 10) } };
}

app.post('/api/check-update', async (req, res) => {
  const sources = (PKG.updateSources || []).filter(u => /^https?:\/\//i.test(u));
  if (!sources.length) return res.json({ ok: false, reason: 'none' });
  let missed = 0, netErr = 0, lastErr = '';
  for (const src of sources) {
    try {
      const r = await readVersionFrom(src);
      if (r.data) return res.json({ ok: true, ...r.data, source: src });
      if (r.miss) missed++; else { netErr++; lastErr = r.err; }
    } catch (e) { netErr++; lastErr = String((e && e.message) || e); }
  }
  res.json({ ok: false, reason: missed ? 'notfound' : 'net', error: lastErr });
});

// 未捕获的异常默认渲染成 HTML 堆栈页（会泄漏临时路径），前端只认 { error }
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || '请求失败' });
});

if (require.main === module) {
  // 只绑本机：工具箱会往磁盘写文件，不能暴露给局域网
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`DocShelf 服务已启动: http://127.0.0.1:${PORT}`);
    console.log(`索引文件位置: ${INDEX_FILE}`);
  });
}

// 供 Electron 主进程内嵌启动：main.cjs 先设 DOCS_ROOT 再 require 本文件
module.exports = app;
