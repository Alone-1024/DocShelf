// 工具箱：PDF 整理与图片→PDF（pdf-lib，纯 JS，不依赖本机办公软件）
// 输出写到用户选的目录，写完按原路径登记进索引（登记≠复制）
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { PDFDocument, degrees } = require('pdf-lib');

const IMG_EXT = ['png', 'jpg', 'jpeg'];
const DOC_EXT = ['doc', 'docx', 'rtf'];
const OUT_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.docx'];

// "1,3-5" → [1,3,4,5]；留空 = 全部页。allowDup 用于提取/重排（同一页可出现两次）
function parsePages(spec, total, { allowDup = false } = {}) {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  if (spec === undefined || spec === null || String(spec).trim() === '') return all;
  const out = [];
  for (const part of String(spec).split(/[,，;；\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
    if (range) {
      let a = +range[1], b = +range[2];
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) out.push(i);
    } else if (/^\d+$/.test(part)) {
      out.push(+part);
    } else {
      throw Object.assign(new Error(`页码写法不认识：${part}（例：1,3-5）`), { status: 400 });
    }
  }
  if (!out.length) throw Object.assign(new Error('没有有效页码'), { status: 400 });
  for (const p of out) {
    if (p < 1 || p > total) throw Object.assign(new Error(`页码 ${p} 超出范围（共 ${total} 页）`), { status: 400 });
  }
  return allowDup ? out : [...new Set(out)];
}

function bad(msg) { throw Object.assign(new Error(msg), { status: 400 }); }

function readPdf(abs) {
  if (!fs.existsSync(abs)) bad(`文件已丢失：${abs}`);
  return PDFDocument.load(fs.readFileSync(abs), { ignoreEncryption: true });
}

// 目标文件已存在时自动加 (2)(3)…，不覆盖用户的东西
function uniquePath(dir, base, ext) {
  let name = `${base}${ext}`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base} (${i})${ext}`;
  return path.join(dir, name);
}

function checkDir(outDir) {
  if (!outDir || !fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    bad('输出目录不存在，请换一个或先在资源管理器里建好');
  }
  return outDir;
}

function writePdf(doc, ctx, { outDir, outName, suffix = '', reg }) {
  checkDir(outDir);
  const abs = uniquePath(outDir, ctx.safeName(outName) + suffix, '.pdf');
  return doc.save({ useObjectStreams: true }).then(bytes => {
    fs.writeFileSync(abs, bytes);
    ctx.registerOutput(abs, reg);
    return abs;
  });
}

async function loadInputs(files, { need = 1, exts = ['pdf'] } = {}) {
  if (!Array.isArray(files) || files.length < need) bad(`请先勾选至少 ${need} 个文件`);
  return files.map(p => {
    const abs = path.resolve(p);
    const ext = path.extname(abs).toLowerCase().slice(1);
    if (!exts.includes(ext)) bad(`这个工具只处理 ${exts.join('/').toUpperCase()}：${path.basename(abs)}`);
    return { abs, ext };
  });
}

// Word ↔ PDF 借本机 Microsoft Word 的自动化接口（这台机器上没有 LibreOffice，也不想为转换拉一个 Chromium 依赖）。
// 脚本结果写进 UTF-8 文件回传：PowerShell 的 stdout 是 GBK，中文路径会成乱码。
const WORD_PS = [
  "$ErrorActionPreference = 'Stop'",
  '$rep = $env:DOCREP',
  'function Report($s) { [IO.File]::WriteAllText($rep, $s, (New-Object Text.UTF8Encoding $false)) }',
  '$word = $null',
  'try { $word = New-Object -ComObject Word.Application } catch { Report "ERR|本机没有可用的 Microsoft Word，这个转换需要装了 Word 的电脑。"; exit 0 }',
  'try {',
  '  $word.Visible = $false',
  '  $word.DisplayAlerts = 0',
  // 转的可能是别人给的文件，ForceDisable 让文档里的宏根本不给执行机会（要在 Open 之前设）
  '  try { $word.AutomationSecurity = 3 } catch {}',
  '  $ver = $word.Version.Split(".")[0]',
  // Word 导入 PDF 会弹一个 DisplayAlerts 压不住的确认框，只能靠这个开关关掉（HKCU，无需管理员）
  '  try { $k = "HKCU:\\Software\\Microsoft\\Office\\$ver.0\\Word\\Options"; if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }; Set-ItemProperty -Path $k -Name DisableConvertPdfWarning -Value 1 -Type DWord } catch {}',
  // 上一次 Word 被强杀会留下崩溃记录，之后每次打开同一个文件都弹「上次出现严重错误」，无人应答就卡死
  '  try { Remove-Item -Path "HKCU:\\Software\\Microsoft\\Office\\$ver.0\\Word\\Resiliency" -Recurse -Force -ErrorAction SilentlyContinue } catch {}',
  // Word 导入 PDF 时要可写地重建文档，只读打开会让它直接报「严重错误」；导出 PDF 才用只读
  '  $ro = if ($env:DOCMODE -eq "pdf") { $true } else { $false }',
  '  $doc = $word.Documents.Open($env:DOCIN, $false, $ro)',
  '  if ($env:DOCMODE -eq "pdf") { $doc.ExportAsFixedFormat($env:DOCOUT, 17) } else { $doc.SaveAs2($env:DOCOUT, 16) }',
  '  $doc.Close($false)',
  '  Report ("OK|" + $env:DOCOUT)',
  '} catch { Report ("ERR|" + $_.Exception.Message) } finally {',
  '  try { $word.Quit() } catch {}',
  '  if ($word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }',
  '}',
].join('\n');

function convertWithWord(absIn, absOut, mode) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ ok: false, error: '这个转换需要 Windows 上的 Microsoft Word' });
    const repFile = path.join(os.tmpdir(), `docshelf-word-${crypto.randomBytes(6).toString('hex')}.txt`);
    const encoded = Buffer.from(WORD_PS, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 180000, env: { ...process.env, DOCIN: absIn, DOCOUT: absOut, DOCMODE: mode, DOCREP: repFile } },
      err => {
        let rep = '';
        try { rep = fs.readFileSync(repFile, 'utf8').trim(); } catch {}
        fs.rm(repFile, { force: true }, () => {});
        if (rep.startsWith('OK|') && fs.existsSync(rep.slice(3))) return resolve({ ok: true, path: rep.slice(3) });
        if (rep.startsWith('ERR|')) return resolve({ ok: false, error: rep.slice(4) });
        resolve({ ok: false, error: err ? `Word 转换失败：${err.message}` : 'Word 没有交出结果，请先关掉已经打开的 Word 窗口再试' });
      });
  });
}

// Word 自动化一次只能老实排队，多个转换并发会互相抢实例
let wordChain = Promise.resolve();
// 收的是任务而不是参数：输出文件名要等排到队才定，否则两个并发转换会算出同一个名字互相覆盖
function queueWord(job) {
  const run = wordChain.then(job);
  wordChain = run.then(() => {}, () => {});
  return run;
}

// 用 Word 转一个文件
async function wordConvert(files, { outDir, outName, reg, ctx }, ext, mode) {
  const inputs = await loadInputs(files, { exts: ext });
  checkDir(outDir);
  const r = await queueWord(() => {
    const abs = uniquePath(outDir, ctx.safeName(outName), '.' + mode);
    return convertWithWord(inputs[0].abs, abs, mode);
  });
  if (!r.ok) bad(r.error);
  ctx.registerOutput(r.path, reg);
  return [r.path];
}

const OPS = {
  // 合并：按勾选顺序把多个 PDF 拼成一个
  async merge({ files, outDir, outName, reg, ctx }) {
    const inputs = await loadInputs(files, { need: 2 });
    const target = await PDFDocument.create();
    for (const { abs } of inputs) {
      const src = await readPdf(abs);
      const pages = await target.copyPages(src, src.getPageIndices());
      pages.forEach(p => target.addPage(p));
    }
    return [await writePdf(target, ctx, { outDir, outName, reg })];
  },

  // 分割：每页一个文件，或按「1-3,4-6」拆成几份
  async split({ files, outDir, outName, opts, reg, ctx }) {
    const inputs = await loadInputs(files);
    const src = await readPdf(inputs[0].abs);
    const total = src.getPageCount();
    let groups;
    if (opts?.mode === 'ranges') {
      groups = String(opts.ranges || '').split(/[,，;；]+/).filter(Boolean).map(r => parsePages(r, total));
      if (!groups.length) bad('请填写要拆出的页码范围，例：1-3,4-8');
    } else {
      groups = Array.from({ length: total }, (_, i) => [i + 1]);
    }
    const outputs = [];
    for (let i = 0; i < groups.length; i++) {
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, groups[i].map(p => p - 1));
      pages.forEach(p => doc.addPage(p));
      outputs.push(await writePdf(doc, ctx, { outDir, outName, reg, suffix: `_${String(i + 1).padStart(2, '0')}` }));
    }
    return outputs;
  },

  // 旋转：90/180/270，可只转指定页
  async rotate({ files, outDir, outName, opts, reg, ctx }) {
    const inputs = await loadInputs(files);
    const doc = await readPdf(inputs[0].abs);
    const step = Number(opts?.degrees);
    if (![90, 180, 270].includes(step)) bad('旋转角度只能是 90/180/270');
    for (const p of parsePages(opts?.pages, doc.getPageCount())) {
      const page = doc.getPage(p - 1);
      page.setRotation(degrees((page.getRotation().angle + step) % 360));
    }
    return [await writePdf(doc, ctx, { outDir, outName, reg })];
  },

  // 提取页面：只留下指定页（可重复、可换序）
  async extract({ files, outDir, outName, opts, reg, ctx }) {
    const inputs = await loadInputs(files);
    const src = await readPdf(inputs[0].abs);
    const pages = parsePages(opts?.pages, src.getPageCount(), { allowDup: true });
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, pages.map(p => p - 1))).forEach(p => doc.addPage(p));
    return [await writePdf(doc, ctx, { outDir, outName, reg })];
  },

  // 删除页面：去掉指定页，保留其余
  async remove({ files, outDir, outName, opts, reg, ctx }) {
    const inputs = await loadInputs(files);
    const src = await readPdf(inputs[0].abs);
    const total = src.getPageCount();
    const drop = new Set(parsePages(opts?.pages, total));
    if (drop.size >= total) bad('删完就没有页面了，PDF 不能为空');
    const keep = Array.from({ length: total }, (_, i) => i + 1).filter(p => !drop.has(p));
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, keep.map(p => p - 1))).forEach(p => doc.addPage(p));
    return [await writePdf(doc, ctx, { outDir, outName, reg })];
  },

  // 整理/重排：必须给出全部页的新顺序，例：原 5 页输入 5,4,3,2,1
  async reorder({ files, outDir, outName, opts, reg, ctx }) {
    const inputs = await loadInputs(files);
    const src = await readPdf(inputs[0].abs);
    const total = src.getPageCount();
    const order = parsePages(opts?.pages, total, { allowDup: true });
    if (new Set(order).size !== total) bad(`重排要写满 ${total} 页的新顺序（每页恰好一次），当前只给了 ${new Set(order).size} 个不同页`);
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, order.map(p => p - 1))).forEach(p => doc.addPage(p));
    return [await writePdf(doc, ctx, { outDir, outName, reg })];
  },

  // 图片转 PDF：每张一页；页面按图片尺寸（可加边距）或固定 A4
  async images2pdf({ files, outDir, outName, opts, reg, ctx }) {
    const inputs = await loadInputs(files, { exts: IMG_EXT });
    const doc = await PDFDocument.create();
    const margin = Math.max(0, Number(opts?.margin) || 0);
    const a4 = opts?.pageSize === 'a4';
    for (const { abs, ext } of inputs) {
      const bytes = fs.readFileSync(abs);
      const img = ext === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const page = a4 ? doc.addPage([595.28, 841.89]) : doc.addPage([img.width + margin * 2, img.height + margin * 2]);
      const box = { x: margin, y: margin, width: page.getWidth() - margin * 2, height: page.getHeight() - margin * 2 };
      const scale = Math.min(box.width / img.width, box.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h });
    }
    return [await writePdf(doc, ctx, { outDir, outName, reg })];
  },

  // Word → PDF：本机 Word 导出（原文件不动，只读打开）
  word2pdf(args) {
    return wordConvert(args.files, args, DOC_EXT, 'pdf');
  },

  // PDF → Word：本机 Word 导入 PDF 并另存为 docx（扫描件/纯图片版式转不出文字）
  pdf2word(args) {
    return wordConvert(args.files, args, ['pdf'], 'docx');
  },
};

// 前端 pdf.js 渲染出的图片、图片格式转换结果，用这个接口落盘
function saveBinary(req, res, ctx) {
  const outDir = req.query.dir;
  const name = ctx.safeName(req.query.name || 'image.png');
  const reg = { register: req.query.register !== '0', category: req.query.cat || undefined, sub: req.query.sub || undefined };
  const ext = path.extname(name).toLowerCase();
  if (!OUT_EXT.includes(ext)) return res.status(400).json({ error: '只接受 png/jpg/webp/pdf 输出' });
  try {
    checkDir(outDir);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
  const chunks = [];
  let size = 0;
  req.on('data', c => {
    chunks.push(c);
    size += c.length;
    if (size > 400 * 1024 * 1024) {
      req.removeAllListeners('end');
      req.destroy();
      res.status(413).json({ error: '单文件超过 400MB' });
    }
  });
  req.on('end', () => {
    let abs;
    try {
      abs = uniquePath(outDir, name.slice(0, -ext.length), ext);
      fs.writeFileSync(abs, Buffer.concat(chunks));
    } catch (e) {
      // 目录只读、权限不够、磁盘满都会在这里炸；不接住就是整个进程退出，界面全死
      return res.status(e.code === 'EPERM' || e.code === 'EACCES' ? 403 : 500)
        .json({ error: `写入失败：${e.code || ''} ${e.message}（换一个你有权限写的目录）` });
    }
    try {
      ctx.registerOutput(abs, reg);
    } catch { /* 文件已经落盘，登记失败不该把这个结果报成失败 */ }
    res.json({ ok: true, path: abs });
  });
  req.on('error', err => res.status(500).json({ error: err.message }));
}

function createToolbox(ctx) {
  const router = express.Router();
  router.use(express.json({ limit: '8mb' }));

  router.post('/tool', (req, res, next) => {
    const { op } = req.body || {};
    const fn = OPS[op];
    if (!fn) return res.status(400).json({ error: `不认识的操作：${op}` });
    Promise.resolve(fn({ ...req.body, ctx })).then(outputs => res.json({ ok: true, op, outputs })).catch(next);
  });

  // 页码参数前的预查询：这个 PDF 一共几页
  router.post('/tool/pages', async (req, res, next) => {
    try {
      const inputs = await loadInputs(req.body?.files);
      const doc = await readPdf(inputs[0].abs);
      res.json({ ok: true, pages: doc.getPageCount(), name: path.basename(inputs[0].abs) });
    } catch (e) { next(e); }
  });

  router.post('/tool/save', (req, res) => {
    try { saveBinary(req, res, ctx); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // 未登记进索引的文件也要能转（PDF 转图片 / 图片互转在前端渲染），所以按绝对路径回读字节。
  // 只允许这几类格式，服务本身只绑 127.0.0.1。
  const RAW_EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  router.get('/tool/raw', (req, res) => {
    const p = String(req.query.path || '');
    const type = RAW_EXT[path.extname(p).toLowerCase().replace('.', '')];
    if (!type) return res.status(400).json({ error: '只支持读取 pdf/png/jpg/jpeg/webp' });
    let st;
    try { st = fs.statSync(p); } catch { return res.status(404).json({ error: '文件不存在' }); }
    if (!st.isFile()) return res.status(400).json({ error: '这不是文件' });
    res.type(type);
    fs.createReadStream(p).pipe(res);
  });
  return router;
}

module.exports = { createToolbox, parsePages };
