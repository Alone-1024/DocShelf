const $ = sel => document.querySelector(sel);

const state = {
  categories: [],
  meta: null, // 版本/系统/数据目录，反馈弹窗用
  selection: null, // {category, sub} 或 {category} 或 null=全部
  currentFile: null,
  search: '',
  page: 1,
  open: new Set(), // 展开的大分类
  selectedIds: new Set(),
  view: localStorage.getItem('fileView') || 'detail',
  sort: localStorage.getItem('fileSort') || 'name:asc',
};

function extLabel(ext) {
  if (ext === 'doc' || ext === 'docx' || ext === 'rtf') return 'W';
  if (ext === 'ppt' || ext === 'pptx') return 'PPT';
  if (ext === 'xls' || ext === 'xlsx') return 'XLS';
  if (ext === 'md' || ext === 'markdown') return 'MD';
  return (ext || '?').slice(0, 4).toUpperCase();
}
function iconClass(ext) {
  if (ext === 'pdf') return 'ext-pdf';
  if (['doc', 'docx', 'rtf'].includes(ext)) return 'ext-doc';
  if (['ppt', 'pptx'].includes(ext)) return 'ext-ppt';
  if (['xls', 'xlsx'].includes(ext)) return 'ext-xls';
  if (['txt', 'log', 'csv'].includes(ext)) return 'ext-txt';
  if (['md', 'markdown'].includes(ext)) return 'ext-md';
  return 'ext-other';
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

/* ---------- 弹窗 ---------- */
function openModal(title, bodyHtml, onOk, okText = '确定') {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalOk').textContent = okText;
  $('#modalOk').className = 'primary';
  // 工具箱跑转换时会把它置灰，中途关掉弹窗再开别的（比如主题）会继承那个灰态，点「完成」没反应
  $('#modalOk').disabled = false;
  $('#modal').classList.remove('hidden');
  $('#modalOk').onclick = async () => {
    if (onOk) {
      const ok = await onOk();
      if (!ok) return;
    }
    closeModal();
  };
  const firstInput = $('#modalBody input');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
  if (firstInput) firstInput.onkeydown = e => { if (e.key === 'Enter') $('#modalOk').click(); };
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalCancel').onclick = closeModal;
$('#modal').onclick = e => { if (e.target === $('#modal')) closeModal(); };

/* 自定义确认框（替代 window.confirm，打包 exe 后行为一致） */
function confirmBox(title, message, okText = '删除') {
  return new Promise(resolve => {
    const done = v => { resolve(v); closeModal(); };
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = `<div class="modal-hint" style="white-space:pre-wrap">${escapeHtml(message)}</div>`;
    $('#modalOk').textContent = okText;
    $('#modalOk').className = 'danger';
    $('#modalOk').disabled = false;
    $('#modal').classList.remove('hidden');
    $('#modalOk').onclick = () => { $('#modalOk').className = 'primary'; done(true); };
    $('#modalCancel').onclick = () => done(false);
    $('#modal').onclick = e => { if (e.target === $('#modal')) done(false); };
    setTimeout(() => $('#modalOk').focus(), 50);
  });
}

/* ---------- 数据加载 ---------- */
async function load() {
  const data = await api('/api/state');
  state.categories = data.categories;
  state.meta = data.meta || null;
  const aliveIds = new Set(data.categories.flatMap(c => c.subs.flatMap(s => s.files.map(f => f.id))));
  state.selectedIds = new Set([...state.selectedIds].filter(id => aliveIds.has(id)));
  updateBulkBar();
  renderSidebar();
  renderFiles();
  if (state.currentFile) {
    const still = data.categories.some(c => c.name === state.currentFile.category);
    if (!still) closePreview();
  }
}

/* ---------- 批量选择 ---------- */
function updateBulkBar() {
  const n = state.selectedIds.size;
  $('#bulkBar').classList.toggle('hidden', n === 0);
  $('#bulkCount').textContent = n;
}

// 全选跨页生效：命中当前筛选/分类的文件全部勾上
function visibleFileIds() {
  return filteredFiles().map(x => x.f.id);
}

$('#btnSelectAll').onclick = () => {
  for (const id of visibleFileIds()) state.selectedIds.add(id);
  renderFiles(); updateBulkBar();
};
$('#btnBulkCancel').onclick = () => { state.selectedIds.clear(); renderFiles(); updateBulkBar(); };

$('#btnBulkMove').onclick = () => {
  const catOpts = state.categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  openModal(`批量移动 ${state.selectedIds.size} 个文件`,
    `<label style="font-size:13px">目标大分类</label>
     <select id="mBulkCat">${catOpts}</select>
     <label style="font-size:13px">目标子分类</label>
     <select id="mBulkSub"></select>`,
    async () => {
      try {
        const r = await api('/api/files/bulk-move', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [...state.selectedIds], category: $('#mBulkCat').value, sub: $('#mBulkSub').value }),
        });
        toast(r.errors.length ? `已移动 ${r.moved} 个，${r.errors.length} 个失败：${r.errors[0]}` : `已移动 ${r.moved} 个文件`);
        state.selectedIds.clear();
        load(); updateBulkBar();
        return true;
      } catch (err) { toast(err.message); return false; }
    }, '移动');
  const refreshSubs = () => {
    const cat = state.categories.find(c => c.name === $('#mBulkCat').value);
    $('#mBulkSub').innerHTML = (cat?.subs || []).map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
  };
  $('#mBulkCat').onchange = refreshSubs;
  refreshSubs();
};

$('#btnBulkDelete').onclick = async () => {
  const n = state.selectedIds.size;
  const ok = await confirmBox('批量删除', `删除选中的 ${n} 个文件？\n（仅从索引移除，磁盘上的原文件不会被删）`);
  if (!ok) return;
  try {
    const r = await api('/api/files/bulk-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...state.selectedIds] }),
    });
    toast(`已删除 ${r.deleted} 个`);
    state.selectedIds.clear();
    load(); updateBulkBar();
  } catch (err) { toast(err.message); }
};

/* ---------- 侧栏 ---------- */
function selectView(sel) {
  state.selection = sel;
  state.page = 1;
  renderSidebar();
  renderFiles();
}

function renderSidebar() {
  const tree = $('#catTree');
  tree.innerHTML = '';

  const all = document.createElement('div');
  all.className = 'cat-head' + (state.selection === null ? ' active' : '');
  all.innerHTML = `<span>🗂</span> 全部文件 <span class="count">${state.categories.reduce((s, c) => s + c.count, 0)}</span>`;
  all.onclick = () => selectView(null);
  tree.appendChild(all);

  for (const cat of state.categories) {
    const group = document.createElement('div');
    const selCat = state.selection && state.selection.category === cat.name;
    group.className = 'cat-group' + (state.open.has(cat.name) ? ' open' : '');
    const subsTotal = cat.subs.length;
    group.innerHTML = `
      <div class="cat-head ${selCat && !state.selection.sub ? 'active' : ''}">
        <span class="caret">▶</span> ${escapeHtml(cat.name)}
        <span class="count">${cat.count}</span>
        <button class="cat-del" title="删除分类">✕</button>
      </div>
      <div class="sub-list"></div>`;
    const head = group.querySelector('.cat-head');
    head.onclick = e => {
      if (e.target.classList.contains('cat-del')) return;
      if (state.open.has(cat.name)) state.open.delete(cat.name); else state.open.add(cat.name);
      selectView({ category: cat.name });
    };
    group.querySelector('.cat-del').onclick = async e => {
      e.stopPropagation();
      if (!await confirmBox('删除大分类', `删除大分类「${cat.name}」？\n（分类下不能有空文件残留）`, '删除')) return;
      try {
        await api('/api/category', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: cat.name }) });
        if (selCat) state.selection = null;
        state.open.delete(cat.name);
        toast('已删除分类');
        load();
      } catch (err) { toast(err.message); }
    };

    const subList = group.querySelector('.sub-list');
    for (const sub of cat.subs) {
      const item = document.createElement('div');
      const fileCount = sub.files.length;
      item.className = 'sub-item' + (selCat && state.selection.sub === sub.name ? ' active' : '');
      item.innerHTML = `<span>📁</span> ${escapeHtml(sub.name)} <span class="count">${fileCount}</span>
        ${sub.name !== '默认' ? '<button class="sub-del" title="删除子分类">✕</button>' : ''}`;
      item.onclick = e => {
        if (e.target.classList.contains('sub-del')) return;
        selectView({ category: cat.name, sub: sub.name });
      };
      const del = item.querySelector('.sub-del');
      if (del) del.onclick = async e => {
        e.stopPropagation();
        try {
          await api('/api/sub', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: cat.name, name: sub.name }) });
          if (selCat && state.selection.sub === sub.name) state.selection = { category: cat.name };
          toast('已删除子分类');
          load();
        } catch (err) { toast(err.message); }
      };
      subList.appendChild(item);
    }
    const addSub = document.createElement('div');
    addSub.className = 'add-sub';
    addSub.textContent = '＋ 新建子分类';
    addSub.onclick = () => promptAddSub(cat.name);
    subList.appendChild(addSub);

    tree.appendChild(group);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function promptAddCat() {
  openModal('新建大分类',
    `<input id="mCatName" placeholder="分类名称，如：Excel、图片、压缩包">
     <div class="modal-hint">登记时若扩展名不属于任何分类，会归入「其他」。大分类只是索引里的分组，不会在磁盘上新建文件夹。</div>`,
    async () => {
      const name = $('#mCatName').value.trim();
      if (!name) { toast('请输入名称'); return false; }
      try {
        await api('/api/category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        toast('已创建分类');
        load();
        return true;
      } catch (err) { toast(err.message); return false; }
    }, '创建');
}

function promptAddSub(catName) {
  openModal(`在「${catName}」下新建子分类`,
    `<input id="mSubName" placeholder="子分类名称，如：工作笔记、学习资料">`,
    async () => {
      const name = $('#mSubName').value.trim();
      if (!name) { toast('请输入名称'); return false; }
      try {
        await api('/api/sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: catName, name }) });
        toast('已创建子分类');
        load();
        return true;
      } catch (err) { toast(err.message); return false; }
    }, '创建');
}

/* ---------- 文件列表 ---------- */
function visibleGroups() {
  if (!state.selection) {
    return state.categories.map(c => ({ cat: c.name, subs: c.subs }));
  }
  const cat = state.categories.find(c => c.name === state.selection.category);
  if (!cat) return [];
  if (!state.selection.sub) return [{ cat: cat.name, subs: cat.subs }];
  return [{ cat: cat.name, subs: cat.subs.filter(s => s.name === state.selection.sub) }];
}

// 列表视图固定 10 个一页；详情与卡片视图按页面实际占用空间算（用隐藏探针量真实行列）
function fitPageSize() {
  if (state.view === 'list') return 10;
  const area = $('#fileArea');
  const listEl = $('#fileList');
  const gap = 12;
  const probe = document.createElement('div');
  probe.className = 'file-grid';
  probe.innerHTML = `<div class="file-card"><div class="file-icon ext-pdf">PDF</div><div class="file-info">
    <div class="file-name">${'文件名占位'.repeat(8)}</div><div class="file-meta">1.0 MB · 2026/01/01 00:00:00</div></div></div>`;
  listEl.appendChild(probe);
  const cols = getComputedStyle(probe).gridTemplateColumns.split(' ').length;
  const h = probe.firstElementChild.offsetHeight;
  probe.remove();
  // 选中单个子分类时只有一组，不再重复显示分组标题
  const showGroups = !state.selection?.sub;
  const chrome = $('.file-toolbar').offsetHeight + 44 + 28 + (showGroups ? 26 : 0);
  const rows = Math.max(1, Math.floor((area.clientHeight - chrome + gap) / (h + gap)));
  return Math.min(80, Math.max(1, cols) * rows);
}

function filteredFiles() {
  const kw = state.search.toLowerCase();
  const out = [];
  for (const g of visibleGroups()) {
    for (const sub of g.subs) {
      const rows = sub.files
        .filter(f => !kw || f.name.toLowerCase().includes(kw))
        .map(f => ({ f, group: `${g.cat} / ${sub.name}` }));
      sortRows(rows); // 排序在每个分组内部进行，分组标题顺序仍按分类树
      out.push(...rows);
    }
  }
  return out;
}

const byName = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
function sortRows(rows) {
  const [key, dir] = state.sort.split(':');
  const mul = dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => mul * (key === 'name'
    ? byName.compare(a.f.name, b.f.name)
    : (a.f.uploadedAt || 0) - (b.f.uploadedAt || 0)));
}

function fileCard(f) {
  const card = document.createElement('div');
  const checked = state.selectedIds.has(f.id);
  card.className = 'file-card' + (state.currentFile?.id === f.id ? ' selected' : '') + (checked ? ' checked' : '');
  card.innerHTML = `
    <label class="file-check">
      <input type="checkbox" data-id="${f.id}" ${checked ? 'checked' : ''}>
    </label>
    <div class="file-icon ${iconClass(f.ext)}">${extLabel(f.ext)}</div>
    <div class="file-info">
      <div class="file-name" title="${escapeHtml(f.absPath)}">${escapeHtml(f.name)}</div>
      <div class="file-meta">${fmtSize(f.size)} · ${fmtTime(f.uploadedAt)}</div>
    </div>`;
  card.onclick = () => showPreview(f);
  card.querySelector('.file-check').onclick = e => e.stopPropagation();
  card.querySelector('input[type=checkbox]').onchange = e => {
    if (e.target.checked) state.selectedIds.add(f.id); else state.selectedIds.delete(f.id);
    card.classList.toggle('checked', e.target.checked);
    updateBulkBar();
  };
  return card;
}

function pageWindow(cur, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [...new Set([1, pages, cur - 1, cur, cur + 1])]
    .filter(p => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  keep.forEach((p, i) => { if (i && p - keep[i - 1] > 1) out.push(0); out.push(p); });
  return out;
}

function pager(total, size, pages) {
  const el = document.createElement('div');
  el.className = 'pager';
  const btn = (label, page, active = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = page < 1 || page > pages;
    if (active) b.classList.add('active');
    b.onclick = () => {
      state.page = page;
      renderFiles();
      $('#fileArea').scrollTop = 0;
    };
    return b;
  };
  el.appendChild(btn('‹', state.page - 1));
  for (const p of pageWindow(state.page, pages))
    el.appendChild(p ? btn(String(p), p, p === state.page) : Object.assign(document.createElement('span'), { className: 'pager-gap', textContent: '…' }));
  el.appendChild(btn('›', state.page + 1));
  const info = document.createElement('span');
  info.className = 'pager-info';
  info.textContent = `第 ${state.page} / ${pages} 页 · 共 ${total} 个 · 每页 ${size}`;
  el.appendChild(info);
  return el;
}

function renderFiles() {
  const listEl = $('#fileList');
  listEl.className = 'file-list view-' + state.view;
  listEl.innerHTML = '';

  const all = filteredFiles();
  const size = fitPageSize();
  const pages = Math.max(1, Math.ceil(all.length / size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * size;
  const showGroups = !state.selection?.sub;

  let grid = null, lastGroup = null;
  for (const { f, group } of all.slice(start, start + size)) {
    if (group !== lastGroup) {
      if (showGroups) {
        const title = document.createElement('div');
        title.className = 'sub-group-title';
        title.textContent = `📁 ${group}`;
        listEl.appendChild(title);
      }
      grid = document.createElement('div');
      grid.className = 'file-grid';
      listEl.appendChild(grid);
      lastGroup = group;
    }
    grid.appendChild(fileCard(f));
  }
  if (all.length > size) listEl.appendChild(pager(all.length, size, pages));

  const eh = $('#emptyHint');
  eh.classList.toggle('hidden', all.length > 0);
  if (!all.length) {
    // 搜不到东西时以前是一片空白，用户以为程序坏了
    const [title, tip] = eh.querySelectorAll('p');
    title.textContent = state.search ? `没有名字带「${state.search}」的文件` : '还没有文件';
    tip.textContent = state.search ? '换个词试试，或清空搜索框看全部文件'
      : '把文件拖到页面任意位置就能记上，程序会按文件类型自动归类';
  }
  const sel = state.selection;
  $('#areaTitle').textContent = sel ? (sel.sub ? `${sel.category} / ${sel.sub}` : sel.category) : '全部文件';
}

/* ---------- 详情面板（预览默认关闭，手动点按钮在新标签页打开） ---------- */
const PREVIEWABLE = ['pdf', 'txt', 'log', 'csv', 'json', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'gif', 'webp'];

function showPreview(f) {
  state.currentFile = f;
  $('#previewPane').classList.remove('hidden');
  $('#paneResizer').classList.remove('hidden');
  renderFiles();

  const body = $('#previewBody');
  const canPreview = PREVIEWABLE.includes(f.ext);
  body.innerHTML = `
    <div class="detail-card">
      <div class="file-icon big ${iconClass(f.ext)}">${extLabel(f.ext)}</div>
      <h4>${escapeHtml(f.name)}</h4>
      <p>${escapeHtml(f.category)} / ${escapeHtml(f.sub)} · ${fmtSize(f.size)}</p>
      <p class="detail-path" title="${escapeHtml(f.absPath)}">${escapeHtml(f.absPath)}</p>
      ${canPreview
        ? '<button class="primary" id="btnOpenTab">👁 新页面预览</button>'
        : '<p class="detail-hint">浏览器无法渲染此类型，请用「💻 电脑打开」查看</p>'}
    </div>`;
  const btn = $('#btnOpenTab');
  if (btn) btn.onclick = () => window.open(`/api/raw/${f.id}`, '_blank');
}

function closePreview() {
  state.currentFile = null;
  $('#previewPane').classList.add('hidden');
  $('#paneResizer').classList.add('hidden');
  renderFiles();
}

/* 拖拽分隔条调整预览面板宽度（记忆到 localStorage，双击复位） */
{
  const pane = $('#previewPane');
  const resizer = $('#paneResizer');
  const saved = parseInt(localStorage.getItem('previewWidth'), 10);
  if (saved) pane.style.flexBasis = saved + 'px';
  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    const onMove = ev => {
      const w = Math.min(Math.max(startW + (startX - ev.clientX), 300), Math.floor(window.innerWidth * 0.85));
      pane.style.flexBasis = w + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('previewWidth', String(Math.round(pane.getBoundingClientRect().width)));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  resizer.addEventListener('dblclick', () => {
    pane.style.flexBasis = '';
    localStorage.removeItem('previewWidth');
  });
}

/* ---------- 拖拽登记（只用源文件路径，不复制） ---------- */
let dragDepth = 0;

// Electron 起不复制文件、只登记原路径，所以要拿到文件的绝对路径。
// 浏览器给的 File 对象本身不带路径，程序里靠 preload 桥接的 native.getPathForFile 问出来；
// 用浏览器直接开 http://127.0.0.1:3210 时问不到，这时才退到「按常用目录反查」。
function nativeFilePath(file) {
  try { return window.DocShelfNative?.getPathForFile?.(file) || null; } catch { return null; }
}

// 全都能问到路径时返回数组，只要有一个问不到就返回 null，交给调用方走兜底
function nativePaths(files) {
  const paths = files.map(nativeFilePath);
  return paths.every(Boolean) ? paths : null;
}

async function registerPaths(paths) {
  if (!paths.length) return;
  const target = state.selection?.sub
    ? { category: state.selection.category, sub: state.selection.sub }
    : {};
  try {
    const r = await api('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, ...target }),
    });
    toast(`已按源路径登记 ${r.added} 个文件${r.skipped ? `（跳过 ${r.skipped} 个重复）` : ''}`);
    load();
  } catch (err) { toast(err.message); }
}
window.addEventListener('dragenter', e => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  updateDropOverlay();
});
window.addEventListener('dragover', e => {
  if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  updateDropOverlay();
});
window.addEventListener('drop', async e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  updateDropOverlay();
  const files = [...e.dataTransfer.files];
  // 第一级：程序里直接问出绝对路径（任何盘、任何层级都行）
  let paths = nativePaths(files);
  // 第二级：从 file:/// URI 还原（浏览器里从资源管理器拖入通常可用）
  if (!paths) paths = extractLocalPaths(e);
  // 第三级：按 名称+大小+修改时间 在常用目录反查
  if (!paths) {
    toast('正在反查源文件路径…');
    try {
      const r = await api('/api/locate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: files.map(f => ({ name: f.name, size: f.size, lastModified: f.lastModified })) }),
      });
      paths = r.results.map(x => x.path).filter(Boolean);
      const missed = r.results.filter(x => !x.path).map(x => x.name);
      if (missed.length) toast(`「${missed.join('、')}」不在常用目录，无法定位源路径，请用「＋ 登记文件」按钮`);
    } catch (err) {
      toast(err.message);
      return;
    }
  }
  await registerPaths(paths);
});

function fileUrlToPath(u) {
  try {
    let p = decodeURIComponent(u.trim()).replace(/^file:\/\/\/?/i, '').replace(/\//g, '\\');
    return /^[A-Za-z]:\\.+/.test(p) ? p : null;
  } catch { return null; }
}
function extractLocalPaths(e) {
  const raw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('DownloadURL');
  if (!raw) return null;
  const paths = raw.split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(fileUrlToPath);
  return paths.every(Boolean) ? paths : null;
}

function updateDropOverlay() {
  const show = dragDepth > 0;
  $('#dropOverlay').classList.toggle('hidden', !show);
  if (show) {
    $('#dropTarget').textContent = state.selection?.sub
      ? `${state.selection.category} / ${state.selection.sub}`
      : state.selection?.category || '自动分类';
  }
}

/* ---------- 文件操作按钮 ---------- */
$('#btnClosePreview').onclick = closePreview;
$('#btnOpen').onclick = () => action('/api/open/');
$('#btnReveal').onclick = () => action('/api/reveal/');
$('#btnDelete').onclick = async () => {
  if (!state.currentFile) return;
  if (!await confirmBox('删除文件', `删除「${state.currentFile.name}」？\n（仅从索引移除，磁盘上的原文件不会被删）`)) return;
  try {
    await api(`/api/file/${state.currentFile.id}`, { method: 'DELETE' });
    toast('已移除索引，原文件未改动');
    closePreview();
    load();
  } catch (err) { toast(err.message); }
};

/* 选择框拿到文件 → 问出源路径 → 登记（浏览器里问不到，才反查常用目录） */
async function registerFromFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const paths = nativePaths(files);
  if (paths) return registerPaths(paths);
  toast('正在定位源文件…');
  try {
    const r = await api('/api/locate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: files.map(f => ({ name: f.name, size: f.size, lastModified: f.lastModified })) }),
    });
    const found = r.results.map(x => x.path).filter(Boolean);
    const missed = r.results.filter(x => !x.path).map(x => x.name);
    if (missed.length) toast(`「${missed.join('、')}」不在常用目录（桌面/下载/文档），无法定位源路径`);
    await registerPaths(found);
  } catch (err) { toast(err.message); }
}

const filePicker = $('#filePicker');
$('#btnDropUpload').onclick = () => filePicker.click();
filePicker.onchange = () => { registerFromFiles(filePicker.files); filePicker.value = ''; };

async function action(prefix) {
  if (!state.currentFile) return;
  try { await api(prefix + state.currentFile.id, { method: 'POST' }); toast('已调起系统操作'); }
  catch (err) { toast(err.message); }
}

$('#btnMove').onclick = () => {
  if (!state.currentFile) return;
  const f = state.currentFile;
  const catOpts = state.categories.map(c =>
    `<option value="${escapeHtml(c.name)}" ${c.name === f.category ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  openModal('移动文件',
    `<label style="font-size:13px">大分类</label>
     <select id="mMoveCat">${catOpts}</select>
     <label style="font-size:13px">子分类</label>
     <select id="mMoveSub"></select>`,
    async () => {
      const cat = $('#mMoveCat').value, sub = $('#mMoveSub').value;
      try {
        await api(`/api/file/${f.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: cat, sub }) });
        toast('已移动');
        load();
        closePreview();
        return true;
      } catch (err) { toast(err.message); return false; }
    }, '移动');
  const refreshSubs = () => {
    const cat = state.categories.find(c => c.name === $('#mMoveCat').value);
    $('#mMoveSub').innerHTML = (cat?.subs || []).map(s =>
      `<option value="${escapeHtml(s.name)}" ${s.name === f.sub && cat.name === f.category ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  };
  $('#mMoveCat').onchange = refreshSubs;
  refreshSubs();
};

/* ---------- 顶栏 ---------- */
$('#btnAddCat').onclick = promptAddCat;
$('#btnToolbox').onclick = openToolbox;
$('#btnTheme').onclick = openThemePicker;
$('#btnTip').onclick = openTipModal;
$('#btnFeedback').onclick = openFeedbackModal;
$('#btnManual').onclick = openManual;
$('#btnAbout').onclick = openAbout;
function openThemePicker() {
  const { themes, apply } = window.DocShelfTheme;
  const cur = apply(localStorage.getItem('theme') || 'default', false).id;
  const html = `<div class="theme-grid">${themes.map(t => `
    <button type="button" class="theme-opt${t.id === cur ? ' active' : ''}" data-theme="${t.id}">
      <span class="theme-strip">${['--bg', '--panel', '--text', '--muted', '--accent', '--danger']
        .map(k => `<i style="background:${t.vars[k]}"></i>`).join('')}</span>
      <span class="theme-name">${escapeHtml(t.name)}<em>${t.tag}</em></span>
    </button>`).join('')}</div>
    <div class="modal-hint">点一下立刻换肤，只改界面配色，不动任何文件。</div>`;
  openModal('🎨 选择主题', html, () => true, '完成');
  for (const btn of $('#modalBody').querySelectorAll('.theme-opt')) {
    btn.onclick = () => {
      apply(btn.dataset.theme, true);
      for (const b of $('#modalBody').querySelectorAll('.theme-opt')) b.classList.toggle('active', b === btn);
    };
  }
}
const TIP_PAGE = '/tip.html';
function openTipModal() {
  const link = location.origin + TIP_PAGE;
  openModal('💰 请作者喝杯咖啡', `
    <div class="tip-body">
      <p>DocShelf 平时不联网、无广告、不收费，文件始终留在你自己的电脑上。
      如果它帮你省下了整理文档的时间，可以随意表示一下心意。</p>
      <div class="tip-row">
        <button type="button" class="tip-copy">🔗 复制链接</button>
        <code class="tip-url">${escapeHtml(link)}</code>
      </div>
    </div>`,
    () => { window.open(TIP_PAGE, 'DocShelfTip', 'width=1080,height=960,menubar=no,toolbar=no,location=no,status=no'); return false; }, '💚 打开收款页');
  $('.tip-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('收款页链接已复制'); }
    catch { toast('复制失败，请手动选中链接'); }
  };
}
/* ---------- 反馈：只走邮箱，程序信息自动带上 ---------- */
const FEEDBACK_MAIL = '1350483764@qq.com';

function feedbackBody() {
  const m = state.meta || {};
  const said = ($('#fbText')?.value || '').trim();
  return [
    said || '【在这里写你遇到的问题：什么文件、点了哪个按钮、期望怎样、实际怎样】',
    '',
    '——— 以下程序信息不用改，方便作者定位 ———',
    `版本：${m.version || '未知'}`,
    `系统：${m.platform || navigator.platform}`,
    `运行：${m.packaged ? '打包 exe' : '源码运行'}（Electron ${m.electron || '-'}，Node ${m.node || '-'}）`,
    `数据目录：${m.root || '未知'}`,
    `登记文件：${m.files ?? 0} 个`,
  ].join('\n');
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast('复制没成功，请手动选中文字');
  }
}

function openFeedbackModal() {
  const m = state.meta || {};
  openModal('✉️ 反馈问题 / 提建议', `
    <div class="tip-body">
      <p>只用邮箱收反馈，不收集任何数据。下面这段会自动连同程序信息一起带过去。</p>
      <textarea id="fbText" class="fb-text" rows="5" spellcheck="false"
        placeholder="例：3 张 PNG 合并转 PDF 点了没反应，前面两张都提示成功。"></textarea>
      <div class="tip-row">
        <button type="button" class="fb-copy-mail">📋 复制邮箱</button>
        <code class="tip-url">${escapeHtml(FEEDBACK_MAIL)}</code>
      </div>
      <div class="tip-row">
        <button type="button" class="fb-copy-body">📋 复制反馈内容</button>
        <span class="fb-note">不想开邮件客户端，就把内容贴到任何聊天窗口给作者也行。</span>
      </div>
    </div>`,
    () => {
      const subject = `DocShelf v${m.version || '?'} 反馈`;
      location.href = `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(feedbackBody())}`;
      toast('正在打开你的邮件客户端');
      return false;
    }, '✉️ 写邮件');
  $('.fb-copy-mail').onclick = () => copyText(FEEDBACK_MAIL, '作者邮箱已复制');
  $('.fb-copy-body').onclick = () => copyText(feedbackBody(), '反馈内容已复制（含程序信息）');
}

/* ---------- 侧栏右下角「?」：程序信息小弹窗 ---------- */
function aboutRows() {
  const m = state.meta || {};
  const nt = /^Windows_NT \d+\.\d+\.(\d+) (\S+)$/.exec(m.platform || '');
  const sys = nt
    ? `Windows ${+nt[1] >= 22000 ? '11' : '10'}（内部版本 ${nt[1]}，${nt[2] === 'x64' ? '64' : '32'} 位）`
    : (m.platform || '未知');
  return [
    ['程序版本', m.version || '未知'],
    ['你的系统', sys],
    ['程序放在', m.root || '未知'],
    ['记了多少文件', `${m.files ?? 0} 个`],
    ['分了几个大类', `${state.categories.length} 个`],
    ['怎么运行的', m.packaged ? '双击程序文件打开' : '开发调试（源码运行）'],
  ];
}

// 1.2.3 这种写法比大小，缺的位当 0 算
function verCmp(a, b) {
  const p = s => String(s).split('.').map(n => +n || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function openAbout() {
  openModal('ℹ️ 程序信息',
    `<div class="about-list">${aboutRows().map(([k, v]) =>
      `<div class="about-row"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`).join('')}</div>
     <div class="about-btns">
       <button type="button" class="about-check">🔍 检查更新</button>
       <button type="button" class="about-copy">📋 复制这些信息</button>
       <button type="button" class="about-fb">✉️ 发给作者</button>
     </div>
     <p class="about-up"></p>
     <p class="about-license">DocShelf 是开源软件，遵循 Apache License 2.0 条款，不收费、无广告。<a href="https://github.com/Alone-1024/DocShelf" target="_blank" rel="noopener">看看它的来历和条款</a></p>
     <div class="modal-hint">找作者问问题时带上这几行——他看不到你的电脑，全靠这些判断问题出在哪。</div>`,
    () => true, '关闭');
  $('.about-copy').onclick = () => copyText(aboutRows().map(([k, v]) => `${k}：${v}`).join('\n'), '程序信息已复制');
  $('.about-fb').onclick = () => { closeModal(); openFeedbackModal(); };
  const btn = $('.about-check');
  const up = $('.about-up');
  btn.onclick = async () => {
    btn.disabled = true;
    up.textContent = '正在问有没有新版…';
    try {
      const r = await api('/api/check-update', { method: 'POST' });
      const cur = state.meta?.version || '0';
      if (!r.ok) up.textContent = r.reason === 'none' ? '作者还没开放下载的地方'
        : r.reason === 'notfound' ? '作者还没发布新版本'
        : '这次没连上，等会儿再试（不影响正常用）';
      else if (!r.version || verCmp(r.version, cur) <= 0) up.textContent = `这已经是最新版了（${cur}）`;
      else if (!/^https:\/\//i.test(r.url || '')) up.textContent = `有新版 ${r.version}，但下载地址打不开，请写信问作者`;
      else up.innerHTML = `有新版 <b>${escapeHtml(r.version)}</b>（${escapeHtml(r.date || '')}）　` +
        `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">⬇ 去下载新的安装包</a><em>装上就行，你登记的东西不会丢</em>`;
    } catch (e) {
      up.textContent = e.message;
    }
    btn.disabled = false;
  };
}

/* ---------- 操作手册：独立弹窗（左目录 + 右正文 + 搜索） ----------
   读者是把文件拖进来存着的普通用户，不是写代码的人：
   只说「点哪里、会怎样」，一律不用索引 / 绝对路径 / 端口 / exe 这类词，
   界面按钮名照抄原样（带 emoji），用户能对着屏幕找到。 */
const MANUAL = [
  {
    id: 'start', title: '怎么开始用',
    body: `<ol>
      <li>打开放文件的那个窗口，把文件<b>用鼠标拖到这个程序窗口里</b>，松手就记上了——文件还在原来的位置，没有复制一份，不占额外空间。</li>
      <li>拖不方便就点上方「＋ 登记文件」，在弹出的选择框里一次选好几个。</li>
      <li>程序会自己按类型分好类（PDF、Word、图片……），放进了「默认」那一栏，你不用管。</li>
      <li>要用了就点那张卡片：「👁 新页面预览」直接看内容；「💻 电脑打开」交给你电脑上的软件；「📍 定位文件」打开它所在的文件夹并帮你选中。</li>
      <li>文件一多，上方「排序」能按名称或添加时间排，页面底下会自动翻页。</li>
    </ol>`,
    go: { label: '去登记文件', run: () => $('#btnDropUpload').click() },
  },
  {
    id: 'cat', title: '分类与整理',
    body: `<ul>
      <li><b>想按自己的方式分</b>：点左上「＋ 新建大分类」，起个看得懂的名字，比如「毕业论文」「客户合同」。</li>
      <li>展开一个大分类，里面还能「＋ 新建子分类」，比如「毕业论文」下分「初稿 / 定稿」。</li>
      <li><b>把文件挪过去</b>：点开文件详情 →「🔄 移动」；一次挪好几个就勾上它们，再用「🔄 批量移动」。</li>
      <li><b>删掉分类</b>：鼠标移到分类名字上会出现 ✕。这个分类里还有文件时删不掉，先把文件挪走。</li>
      <li>新起的分类会排在「其他」上面，「其他」是兜底的，一直在最下面。</li>
      <li>分类只是这个程序里的标签，<b>不会在你电脑里新建文件夹，也不会挪动你的文件</b>。</li>
    </ul>`,
    go: { label: '新建一个分类', run: () => promptAddCat() },
  },
  {
    id: 'del', title: '删除与备份',
    body: `<ul>
      <li>点「🗑 删除」只是把它从这个程序里去掉，<b>你电脑里的那个文件不会被删掉</b>。</li>
      <li>删错了？把文件重新拖进来记上一次就回来了。</li>
      <li>要换电脑、重装系统，或者想留个底：把这个记单子拷走就行，它就是你全部登记记录的所在。</li>
    </ul>
    {{PATH}}
    <ul><li>文件自己挪了地方、或者换了硬盘，点开时会说「文件已丢失」。别慌，文件没丢，只是记的单子上还是老地址。找到它现在的位置，重新拖进来记一次就好。</li></ul>`,
  },
  {
    id: 'keys', title: '快捷键',
    body: `<table class="md-keys">
      <tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>光标跳到搜索框，直接打字找文件</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>关掉弹窗 / 收起右边的详情 / 取消勾选</td></tr>
      <tr><td>用鼠标拖进来</td><td>登记文件</td></tr>
      <tr><td>双击中间那条竖线</td><td>右边的详情栏太宽了？双击恢复原来的宽度</td></tr>
    </table>`,
    go: { label: '去找文件', run: () => { $('#searchBox').focus(); $('#searchBox').select(); } },
  },
  {
    id: 'faq', title: '常见问题',
    body: `<dl class="md-faq">
      <dt>拖进来却提示「无法定位源路径」？</dt>
      <dd>很少见：这个文件其实还没真正落到你电脑上（比如只在某个网盘的预览里看到，没下载下来）。先把它存到自己电脑上的某个位置，再拖进来就好了。</dd>
      <dt>哪些文件能直接预览？</dt>
      <dd>PDF、图片、还有 txt / md / csv / log / json 这类纯文本，点「👁 新页面预览」就能看。Word、PPT 请点「💻 电脑打开」，让你电脑上的 Office 来开。</dd>
      <dt>双击程序没反应 / 出不来窗口？</dt>
      <dd>先等两三秒，它要在你自己电脑上悄悄开一个只对你本机可见的小服务（别人连不上）。第一次运行如果 Windows 弹了拦截提示，选「仍要运行」；杀毒软件拦的话，把它加进允许名单就好。</dd>
      <dt>几个人共用一份记录行不行？</dt>
      <dd>装在这台电脑上，这份记录就是这台电脑自己的（换另一个 Windows 账号登录，看到的是另一份空记录）。真要让几个人共用同一份，得把程序和记单子都放在同一个共享位置，但两个人同时改会互相盖掉，不建议。</dd>
      <dt>怎么知道有没有新版本？</dt>
      <dd>点左下角那个「?」小圆钮 →「🔍 检查更新」。它只在你按下去的时候才去问一次有没有新版，平时不联网；查到会给你一个下载的地方，没连上也不影响正常使用。</dd>
      <dt>程序更新 / 升级到新版本，怎么办？</dt>
      <dd>直接双击新的安装包装上就行，装在哪个文件夹都可以（建议用默认位置）。你登记的文件、分类、颜色设置都存在程序自己的数据文件夹里，不在安装文件夹里，所以覆盖安装一样都不会丢，也不用重新登记。</dd>
    </dl>`,
  },
  {
    id: 'theme', title: '界面颜色',
    body: `<ul>
      <li>左侧「🎨 主题」里有 8 套配色（3 套亮的、5 套暗的），点一下就换，马上生效。</li>
      <li>晚上想护眼就换深色的那几套；只改颜色，<b>不会动你任何文件</b>。</li>
      <li>这个选择记在你自己电脑上，下次打开还是这套颜色。</li>
      <li>左上角 ☰ 能把左侧这一栏收起来，看文件的地方就更宽。</li>
    </ul>`,
    go: { label: '换颜色', run: () => openThemePicker() },
  },
  {
    id: 'tool', title: '工具箱（改格式）',
    body: `<ul>
      <li>入口在左侧「🧰 工具箱」，<b>不用先选中文件也能直接点开</b>；进来前已经勾上的文件会自动带进来。</li>
      <li>里面能选已经记上的文件，也能点「＋ 从磁盘选文件」处理没记过的。</li>
      <li><b>放心用：原来的文件一律不动。</b>做出来的是一个新文件，写到<b>你自己挑的文件夹</b>里，名字也能改；碰上同名的会自动加个「(2)」，不会盖掉你原有的东西。</li>
      <li><b>PDF 合并、拆分</b>：几个文件合成一个 PDF；一个 PDF 拆成多份（每页一个，或者按页码拆开）。</li>
      <li><b>PDF 页面</b>：旋转页面方向、只留某几页、去掉某几页、调整页的顺序、把照片或截图拼成一个 PDF。</li>
      <li><b>格式转换</b>：PDF 转图片（清晰度可选、能只转几页）、图片转 PNG / JPG / WEBP（能压小一点）、Word 转 PDF、PDF 转 Word。</li>
      <li>Word 和 PDF 互转<b>需要你电脑上装了 Microsoft Word</b>（它自己在后台干，不弹窗口，一份十几秒）。没装会提示转不了；整页都是图片的扫描件，转成 Word 也拿不到能改的文字。</li>
      <li>填页码的地方这么写：<code>1,3-5</code> 就是第 1 页和第 3、4、5 页；<b>空着就是全部</b>。</li>
      <li>做出来的东西想直接进这个程序：勾上「结果自动登记进索引」，再选放到哪个分类里。</li>
      <li>眼下还做不了：把 PDF 压小、Excel / PPT 转 PDF、从图片里认出文字。</li>
    </ul>`,
    go: { label: '打开工具箱', run: () => openToolbox() },
  },
  {
    id: 'tip', title: '打赏（完全自愿）',
    body: `<ul>
      <li>左侧「💰 打赏」→「💚 打开收款页」，新窗口里是微信、支付宝两张收款码。</li>
      <li>这个页面也在你自己电脑上，不联网也能打开。</li>
      <li>打赏纯属自愿，不打也一样能用全部功能，<b>不解锁、不限制任何东西</b>。</li>
    </ul>`,
    go: { label: '打开收款页', run: () => openTipModal() },
  },
  {
    id: 'fb', title: '找作者（反馈）',
    body: `<ul>
      <li>只用邮箱收反馈：<code>${escapeHtml(FEEDBACK_MAIL)}</code>。</li>
      <li>说不清自己用的是哪个版本、程序装在哪个文件夹？左侧右下角有个「?」小圆钮，点开就是这些，还能一键复制。</li>
      <li>最省事的办法：左侧「✉️ 反馈」→ 说清楚「哪个文件、点了哪个按钮、想要怎样、实际怎样」→ 点「✉️ 写邮件」，你电脑上的邮件程序会自动打开，收件人和正文都已经填好，你只管发送。</li>
      <li>正文下面自动附上的一小段信息（程序版本、你的系统、这个程序放在哪个文件夹、记了多少个文件）<b>请留着别删</b>——作者看不到你的电脑，全靠这几行判断问题出在哪。</li>
      <li>电脑上没装邮件程序？点「📋 复制反馈内容」，贴到微信、QQ 里发给作者也一样。</li>
      <li>这个程序不会替你发任何东西：除了「🔍 检查更新」是你自己点的、点一下才去问一次有没有新版，其余时间不联网，你写的内容只有你自己看得见。</li>
    </ul>`,
    go: { label: '写反馈', run: () => openFeedbackModal() },
  },
];

function manualClearMarks(root) {
  for (const m of root.querySelectorAll('mark.md-hit')) m.replaceWith(document.createTextNode(m.textContent));
  root.normalize();
}

// 只在文本节点上包 <mark>，不重建 innerHTML，正文里的标签不会被搜索打碎
function manualMark(root, kw) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) if (n.nodeValue.toLowerCase().includes(kw)) nodes.push(n);
  for (const node of nodes) {
    const text = node.nodeValue, low = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let i = 0;
    for (let pos = low.indexOf(kw, i); pos >= 0; pos = low.indexOf(kw, i)) {
      if (pos > i) frag.append(document.createTextNode(text.slice(i, pos)));
      const mk = document.createElement('mark');
      mk.className = 'md-hit';
      mk.textContent = text.slice(pos, pos + kw.length);
      frag.append(mk);
      i = pos + kw.length;
    }
    if (i < text.length) frag.append(document.createTextNode(text.slice(i)));
    node.replaceWith(frag);
  }
}

// 这个路径是问服务端要的，不是写死的：开发时是项目目录，装到用户电脑上就是
// exe 所在目录（便携版）或 %APPDATA%\DocShelf（安装版且原目录不可写时）
function manualIndexFile() {
  const r = state.meta?.root;
  return r ? `${r}\\index.json` : '';
}

function manualPathHtml() {
  const p = manualIndexFile();
  if (!p) return ''; // 还没拿到 /api/state，宁可整行不显示也不给个假路径
  return `<p class="md-path"><code>${escapeHtml(p)}</code>
    <button type="button" class="md-copy-path">📋 复制位置</button>
    <button type="button" class="md-reveal">📂 打开所在文件夹</button></p>`;
}

function openManual() {
  const htmlRaw = `<div class="manual-doc">
    <div class="md-side">
      <input class="md-search" type="search" placeholder="想查什么？合并、删除、预览…" autocomplete="off">
      <div class="md-count"></div>
      <nav class="md-toc">${MANUAL.map(m =>
        `<button type="button" class="md-toc-item" data-target="${m.id}">${escapeHtml(m.title)}</button>`).join('')}</nav>
    </div>
    <div class="md-body">${MANUAL.map(m => `
      <section id="md-${m.id}">
        <h3>${escapeHtml(m.title)}</h3>
        ${m.body}
        ${m.go ? `<button type="button" class="md-go" data-run="${m.id}">▸ ${escapeHtml(m.go.label)}</button>` : ''}
      </section>`).join('')}
    </div>
  </div>`;

  openModal('📖 操作手册', htmlRaw.replace('{{PATH}}', manualPathHtml()), () => true, '关闭');

  const body = $('.md-body');
  const search = $('.md-search');
  const count = $('.md-count');
  const tocFor = id => $(`.md-toc-item[data-target="${id}"]`);

  const jump = id => {
    const sec = document.getElementById('md-' + id);
    if (!sec) return;
    body.scrollTop = sec.offsetTop - 10;
    markActive(sec.id.slice(3));
  };
  const markActive = id => {
    for (const b of document.querySelectorAll('.md-toc-item')) b.classList.toggle('active', b.dataset.target === id);
  };
  const syncActive = () => {
    const top = body.scrollTop + 12;
    let cur = MANUAL[0].id;
    for (const m of MANUAL) {
      const sec = document.getElementById('md-' + m.id);
      if (sec && !sec.classList.contains('hidden') && sec.offsetTop <= top) cur = m.id;
    }
    markActive(cur);
  };

  const applySearch = () => {
    const kw = search.value.trim().toLowerCase();
    manualClearMarks(body);
    let hits = 0;
    for (const m of MANUAL) {
      const sec = document.getElementById('md-' + m.id);
      const on = !kw || sec.textContent.toLowerCase().includes(kw);
      sec.classList.toggle('hidden', !on);
      tocFor(m.id).classList.toggle('hidden', !on);
      if (on) hits++;
    }
    if (kw) manualMark(body, kw);
    count.textContent = kw ? (hits ? `命中 ${hits} 节` : '没有匹配的章节') : '';
    if (kw && hits) jump(MANUAL.find(m => !document.getElementById('md-' + m.id).classList.contains('hidden')).id);
    else body.scrollTop = 0;
  };

  for (const b of document.querySelectorAll('.md-toc-item')) b.onclick = () => jump(b.dataset.target);
  for (const btn of body.querySelectorAll('.md-go')) {
    btn.onclick = () => {
      const m = MANUAL.find(x => x.id === btn.dataset.run);
      closeModal();
      m.go.run();
    };
  }
  const cp = $('.md-copy-path');
  if (cp) cp.onclick = () => copyText(manualIndexFile(), '记单子的位置已复制');
  const rv = $('.md-reveal');
  if (rv) rv.onclick = () => api('/api/reveal-root', { method: 'POST' }).catch(e => toast(e.message));
  search.oninput = applySearch;
  // 覆盖 openModal 给第一个输入框绑的「回车=点确定」，回车在手册里应该是跳到命中章节
  search.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = body.querySelector('section:not(.hidden) mark.md-hit');
    // .md-body 是定位父级，mark 的 offsetTop 已经是正文内的绝对位置，别再叠 section 的
    if (first) body.scrollTop = first.offsetTop - 60;
  };
  body.onscroll = syncActive;
  markActive(MANUAL[0].id);
  setTimeout(() => search.focus(), 60);
}

$('#btnSidebarToggle').onclick = () => {
  document.body.classList.toggle('side-hidden');
  renderFiles(); // 卡片视图的每页数量随宽度变化
};
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderFiles, 200);
});
$('#viewSwitch').onclick = e => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  state.view = btn.dataset.view;
  state.page = 1;
  localStorage.setItem('fileView', state.view);
  renderFiles();
  syncViewSwitch();
};
function syncViewSwitch() {
  for (const b of $('#viewSwitch').querySelectorAll('button'))
    b.classList.toggle('active', b.dataset.view === state.view);
}
syncViewSwitch();

$('#searchBox').oninput = e => {
  state.search = e.target.value.trim();
  state.page = 1;
  renderFiles();
};

if (![...$('#sortSelect').options].some(o => o.value === state.sort)) state.sort = 'name:asc';
$('#sortSelect').value = state.sort;
$('#sortSelect').onchange = e => {
  state.sort = e.target.value;
  localStorage.setItem('fileSort', state.sort);
  state.page = 1;
  renderFiles();
};

/* ---------- 工具箱 ---------- */
const DOC_INPUT_EXT = ['doc', 'docx', 'rtf'];
const TOOLS = [
  { id: 'merge', group: 'PDF 整理', name: '合并 PDF', icon: '🔗', exts: ['pdf'], need: 2, unit: 'PDF', tip: '按下面的顺序把多个 PDF 拼成一个' },
  { id: 'split', group: 'PDF 整理', name: '分割 PDF', icon: '✂️', exts: ['pdf'], need: 1, unit: 'PDF', tip: '每页拆一个文件，或按页码范围拆成几份' },
  { id: 'rotate', group: 'PDF 整理', name: '旋转页面', icon: '🔄', exts: ['pdf'], need: 1, unit: 'PDF', tip: '整份或指定页顺时针转 90/180/270°' },
  { id: 'extract', group: 'PDF 整理', name: '提取页面', icon: '📑', exts: ['pdf'], need: 1, unit: 'PDF', tip: '只留下指定页，可重复、可换序' },
  { id: 'remove', group: 'PDF 整理', name: '删除页面', icon: '🗑', exts: ['pdf'], need: 1, unit: 'PDF', tip: '去掉指定页，保留其余' },
  { id: 'reorder', group: 'PDF 整理', name: '整理重排', icon: '↕️', exts: ['pdf'], need: 1, unit: 'PDF', tip: '写满全部页的新顺序，例：5,1,2,3,4' },
  { id: 'images2pdf', group: '格式转换', name: '图片转 PDF', icon: '🖼', exts: ['png', 'jpg', 'jpeg'], need: 1, unit: '图片', tip: '每张图一页，可选 A4 或按图片尺寸' },
  { id: 'pdf2img', group: '格式转换', name: 'PDF 转图片', icon: '📸', exts: ['pdf'], need: 1, unit: 'PDF', client: true, tip: '逐页导出 PNG / JPG，本机渲染不联网' },
  { id: 'img2img', group: '格式转换', name: '图片转换', icon: '🎛', exts: ['png', 'jpg', 'jpeg', 'webp'], need: 1, unit: '图片', client: true, tip: 'PNG / JPG / WEBP 互转，可调尺寸与质量' },
  { id: 'word2pdf', group: '格式转换', name: 'Word 转 PDF', icon: '📝', exts: DOC_INPUT_EXT, need: 1, unit: 'Word', tip: '调用本机 Word 导出 PDF（需装 Microsoft Word）' },
  { id: 'pdf2word', group: '格式转换', name: 'PDF 转 Word', icon: '📄', exts: ['pdf'], need: 1, unit: 'PDF', tip: '本机 Word 导入 PDF 另存 docx（扫描件转不出文字）' },
];
// 除这两个（本身要一次吃多个文件）之外，其余工具对勾选项逐个处理
const BATCH_TOOLS = new Set(['merge', 'images2pdf']);
const tb = { tool: null, files: [], busy: false };

function indexedFiles() {
  return state.categories.flatMap(c => c.subs.flatMap(s => s.files));
}
function selectedRecords() {
  const map = new Map(indexedFiles().map(f => [f.id, f]));
  return [...state.selectedIds].map(id => map.get(id)).filter(Boolean);
}
function parentDir(p) { return p.replace(/[\\/][^\\/]*$/, ''); }
function stripExt(n) { return n.replace(/\.[^.]*$/, ''); }
function pad2(n) { return String(n).padStart(2, '0'); }

// 与后端一致的页码写法：1,3-5
function parsePagesClient(spec, total) {
  if (!String(spec || '').trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [];
  for (const part of String(spec).split(/[,，;；\s]+/).filter(Boolean)) {
    const r = part.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
    if (r) { for (let i = Math.min(+r[1], +r[2]); i <= Math.max(+r[1], +r[2]); i++) out.push(i); }
    else if (/^\d+$/.test(part)) out.push(+part);
    else throw new Error(`页码写法不认识：${part}（例：1,3-5）`);
  }
  for (const p of out) if (p < 1 || p > total) throw new Error(`页码 ${p} 超出范围（共 ${total} 页）`);
  return out;
}

function toolOutputExt(tool, opts) {
  if (tool.id === 'pdf2img') return opts.fmt === 'jpeg' ? 'jpg' : 'png';
  if (tool.id === 'img2img') return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[opts.fmt];
  if (tool.id === 'pdf2word') return 'docx';
  return 'pdf';
}

function openToolbox() {
  tb.files = selectedRecords();
  const n = tb.files.length;
  const groups = [...new Set(TOOLS.map(t => t.group))];
  const html = `<div class="toolbox">${groups.map(g => `
    <div class="tool-group-title">${escapeHtml(g)}</div>
    <div class="tool-grid">${TOOLS.filter(t => t.group === g).map(t => {
      const hit = tb.files.filter(f => t.exts.includes(f.ext)).length;
      return `<button type="button" class="tool-opt" data-tool="${t.id}" title="${escapeHtml(t.tip)}">
        <span class="tool-ico">${t.icon}</span><span class="tool-name">${escapeHtml(t.name)}</span>
        <em>${hit >= t.need ? `已选 ${hit} 个${t.unit}` : `需 ${t.need} 个${t.unit} · 进去可选`}</em></button>`;
    }).join('')}</div>`).join('')}
    <div class="modal-hint">没勾选文件也能直接进来，下一步里可以从磁盘选（未登记的也能转）。结果写到你自选的目录，可重命名；同名不覆盖，自动加 (2)。原文件不会被修改。</div></div>`;
  openModal(`🧰 工具箱${n ? ` · 已带入 ${n} 个勾选文件` : ''}`, html, () => true, '关闭');
  for (const b of $('#modalBody').querySelectorAll('.tool-opt'))
    b.onclick = () => openToolForm(TOOLS.find(t => t.id === b.dataset.tool));
}

function optionsHtml(tool) {
  switch (tool.id) {
    case 'split': return `
      <div class="tb-row"><label>拆分方式</label><select id="oMode">
        <option value="each">每页一个文件</option><option value="ranges">按范围拆成几份</option></select></div>
      <div class="tb-row" id="rowRanges" hidden><label>页码范围</label><input id="oRanges" placeholder="例：1-3,4-8，每段出一个文件">
        <span class="tb-pages" id="pagesHint"></span></div>`;
    case 'rotate': return `
      <div class="tb-row"><label>旋转角度</label><select id="oDeg">
        <option value="90">顺时针 90°</option><option value="180">180°</option><option value="270">逆时针 90°</option></select></div>
      <div class="tb-row"><label>作用页码</label><input id="oPages" placeholder="留空 = 全部页　例：1,3-5">
        <span class="tb-pages" id="pagesHint"></span></div>`;
    case 'extract': case 'remove': return `
      <div class="tb-row"><label>${tool.id === 'extract' ? '要提取' : '要删除'}</label>
        <input id="oPages" placeholder="${tool.id === 'extract' ? '例：1,3-5（可重复、可换序）' : '例：2,4-6'}">
        <span class="tb-pages" id="pagesHint"></span></div>`;
    case 'reorder': return `
      <div class="tb-row"><label>新顺序</label><input id="oPages" placeholder="写满全部页，例：5,1,2,3,4">
        <span class="tb-pages" id="pagesHint"></span></div>`;
    case 'images2pdf': return `
      <div class="tb-row"><label>页面大小</label><select id="oSize">
        <option value="fit">按图片尺寸</option><option value="a4">A4 竖版</option></select></div>
      <div class="tb-row"><label>边距</label><input id="oMargin" type="number" min="0" max="120" value="0"><span class="tb-pages">pt（仅“按图片尺寸”时生效）</span></div>`;
    case 'pdf2img': return `
      <div class="tb-row"><label>导出格式</label><select id="oFmt">
        <option value="png">PNG（清晰、体积大）</option><option value="jpeg">JPG（体积小）</option></select></div>
      <div class="tb-row"><label>清晰度</label><select id="oScale">
        <option value="1.5">标准 1.5×</option><option value="2" selected>清晰 2×</option><option value="3">超清 3×</option></select></div>
      <div class="tb-row"><label>页码</label><input id="oPages" placeholder="留空 = 全部页　例：1,3-5">
        <span class="tb-pages" id="pagesHint"></span></div>`;
    case 'img2img': return `
      <div class="tb-row"><label>目标格式</label><select id="oFmt">
        <option value="image/png">PNG</option><option value="image/jpeg" selected>JPG</option><option value="image/webp">WEBP</option></select></div>
      <div class="tb-row"><label>质量</label><input id="oQuality" type="range" min="30" max="100" value="85"><span class="tb-pages" id="qHint">85%</span></div>
      <div class="tb-row"><label>最长边</label><input id="oMaxW" type="number" min="0" max="10000" value="0"><span class="tb-pages">px，0 = 不缩放</span></div>`;
    default: return '';
  }
}

function filesHtml(tool) {
  const sortable = tool.id === 'merge' && tb.files.length > 1;
  return `<div class="tool-group-title">处理对象（${tb.files.length}${sortable ? ' · 顺序即合并顺序' : ''}）</div>
    ${tb.files.length ? `<ul class="tb-files">${tb.files.map((f, i) => `
      <li><span class="tb-idx">${i + 1}</span><span class="tb-fname" title="${escapeHtml(f.absPath)}">${escapeHtml(f.name)}</span>
        ${sortable ? `<button type="button" class="tb-mini" data-up="${i}" title="上移">↑</button>` : ''}
        <button type="button" class="tb-mini" data-drop="${i}" title="从本次任务移除">✕</button></li>`).join('')}</ul>`
      : '<div class="tb-empty">还没有文件。用下面的按钮从磁盘选，未登记进索引的文件也能转。</div>'}
    <div class="tb-addrow"><button type="button" id="btnAddFiles">＋ 从磁盘选文件</button>
      <span class="tb-pages">接受 ${tool.exts.join(' / ')}${BATCH_TOOLS.has(tool.id) ? '，可多选' : ''}</span></div>`;
}

function renderTbFiles() {
  const host = $('#tbFiles');
  if (host) host.innerHTML = filesHtml(tb.tool);
  const ok = $('#modalOk');
  if (ok) ok.disabled = !tb.files.length;
}

// 刚打开表单时可能还没有文件，补上后把默认的目录 / 文件名填回去
function syncTbOutput(tool) {
  const dir = $('#oDir'), name = $('#oName');
  if (dir && !dir.value.trim()) dir.value = defaultOutDir();
  if (name && (!name.value.trim() || name.value === '转换结果')) name.value = defaultOutName(tool);
}

function defaultOutDir() {
  const first = tb.files[0];
  if (first) return parentDir(first.absPath);
  return JSON.parse(localStorage.getItem('tbDirs') || '[]')[0] || '';
}

function outputHtml(tool) {
  const dirs = JSON.parse(localStorage.getItem('tbDirs') || '[]');
  const quick = [...new Set([defaultOutDir(), ...dirs])].filter(Boolean).slice(0, 5);
  return `<div class="tool-group-title">输出</div>
    <div class="tb-row"><label>保存目录</label><input id="oDir" value="${escapeHtml(defaultOutDir())}">
      <button type="button" id="btnPickDir" title="弹出系统文件夹选择框">📂 浏览…</button></div>
    ${quick.length ? `<div class="tb-row"><label>快捷</label><span class="tb-quick">${
      quick.map(d => `<button type="button" data-dir="${escapeHtml(d)}" title="${escapeHtml(d)}">${escapeHtml(d.length > 26 ? '…' + d.slice(-22) : d)}</button>`).join('')}</span></div>` : ''}
    <div class="tb-row"><label>文件名</label><input id="oName" value="${escapeHtml(defaultOutName(tool))}"><span class="tb-ext" id="extHint">.pdf</span></div>
    <div class="tb-row"><label>登记</label><span class="tb-check"><input type="checkbox" id="oReg" checked>
      <label for="oReg">结果自动登记进索引</label></span>
      <select id="oRegCat"></select><select id="oRegSub"></select></div>
    <div class="tb-progress" id="tbProgress"></div>`;
}

function defaultOutName(tool) {
  if (!tb.files.length) return '转换结果';
  const base = stripExt(tb.files[0].name);
  if (tool.id === 'merge') return `${base}-合并`;
  if (tool.id === 'images2pdf') return `${base}-图片合集`;
  return base.slice(0, 60);
}

function openToolForm(tool) {
  tb.tool = tool;
  tb.files = tb.files.filter(f => tool.exts.includes(f.ext));
  const html = `<div class="toolbox">
      <div id="tbFiles">${filesHtml(tool)}</div>
      ${optionsHtml(tool) ? `<div class="tool-group-title">参数</div>${optionsHtml(tool)}` : ''}
      ${outputHtml(tool)}
    </div>`;
  openModal(`${tool.icon} ${tool.name}`, html, runTool, '开始转换');
  $('#modalOk').disabled = !tb.files.length;
  wireToolForm(tool);
}

function refreshRegSelects() {
  const catSel = $('#oRegCat');
  catSel.innerHTML = state.categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  const first = tb.files[0];
  const guess = first && indexedFiles().find(f => f.id === first.id);
  const fallback = guess ? guess.category : '其他';
  const preferred = state.categories.some(c => c.name === fallback) ? fallback : '其他';
  catSel.value = preferred;
  const refreshSub = () => {
    const cat = state.categories.find(c => c.name === catSel.value);
    $('#oRegSub').innerHTML = (cat?.subs || []).map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
  };
  catSel.onchange = refreshSub;
  refreshSub();
}

function wireToolForm(tool) {
  $('#modalBody').onclick = e => {
    const up = e.target.closest('[data-up]'), drop = e.target.closest('[data-drop]'), dir = e.target.closest('[data-dir]');
    if (drop) { tb.files.splice(+drop.dataset.drop, 1); if (!tb.files.length) { closeModal(); return; } renderTbFiles(); return; }
    if (up) { const i = +up.dataset.up; if (i > 0) [tb.files[i - 1], tb.files[i]] = [tb.files[i], tb.files[i - 1]]; renderTbFiles(); }
    if (dir) { $('#oDir').value = dir.dataset.dir; }
  };
  const mode = $('#oMode');
  if (mode) mode.onchange = () => { $('#rowRanges').hidden = mode.value !== 'ranges'; };
  const q = $('#oQuality');
  if (q) q.oninput = () => { $('#qHint').textContent = q.value + '%'; };
  $('#btnPickDir').onclick = async () => {
    $('#btnPickDir').disabled = true;
    try {
      const r = await api('/api/pick-dir', { method: 'POST' });
      if (r.path) $('#oDir').value = r.path;
    } catch (err) { toast(err.message); }
    $('#btnPickDir').disabled = false;
  };
  $('#btnAddFiles').onclick = async () => {
    $('#btnAddFiles').disabled = true;
    try {
      const r = await api('/api/pick-files', { method: 'POST' });
      const all = r.files || [];
      const ok = all.filter(f => tool.exts.includes(f.ext));
      const known = new Set(tb.files.map(f => f.absPath.toLowerCase()));
      const add = ok.filter(f => !known.has(f.absPath.toLowerCase()));
      tb.files.push(...add);
      if (all.length - ok.length > 0) toast(`已忽略 ${all.length - ok.length} 个格式不支持的文件`);
      else if (!add.length && all.length) toast('这些文件已经在列表里了');
      if (add.length) { renderTbFiles(); syncTbOutput(tool); }
    } catch (err) { toast(err.message); }
    const btn = $('#btnAddFiles');
    if (btn) btn.disabled = false;
  };
  const updExt = () => { $('#extHint').textContent = '.' + toolOutputExt(tool, collectOpts(tool)); };  for (const sel of ['#oFmt', '#oReg']) if ($(sel)) $(sel).addEventListener('change', updExt);
  updExt();
  $('#oReg').onchange = () => {
    $('#oRegCat').disabled = $('#oRegSub').disabled = !$('#oReg').checked;
  };
  refreshRegSelects();
  // 页码相关的工具：先问一次页数，好提示范围
  if (['split', 'rotate', 'extract', 'remove', 'reorder', 'pdf2img'].includes(tool.id) && tb.files[0]?.ext === 'pdf') {
    api('/api/tool/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [tb.files[0].absPath] }) })
      .then(r => { $('#pagesHint') && ($('#pagesHint').textContent = `共 ${r.pages} 页`); })
      .catch(() => {});
  }
}

function collectOpts(tool) {
  const v = s => $(s) ? $(s).value : undefined;
  switch (tool.id) {
    case 'split': return { mode: v('#oMode'), ranges: v('#oRanges')?.trim() };
    case 'rotate': return { degrees: v('#oDeg'), pages: v('#oPages')?.trim() };
    case 'extract': case 'remove': case 'reorder': case 'pdf2img': return { pages: v('#oPages')?.trim(), fmt: v('#oFmt'), scale: v('#oScale') };
    case 'images2pdf': return { pageSize: v('#oSize'), margin: v('#oMargin') };
    case 'img2img': return { fmt: v('#oFmt'), quality: (+v('#oQuality') || 85) / 100, maxWidth: +v('#oMaxW') || 0 };
    default: return {};
  }
}

function tbProgress(msg) { const el = $('#tbProgress'); if (el) el.textContent = msg; }

async function runTool() {
  const tool = tb.tool;
  if (tb.busy) return false;
  if (!tb.files.length) { toast('先添加要处理的文件'); return false; }
  const dir = $('#oDir').value.trim();
  const name = stripExt($('#oName').value.trim()) || defaultOutName(tool);
  if (!dir) { toast('请选择保存目录'); return false; }
  const register = $('#oReg').checked;
  const reg = { register, category: register ? $('#oRegCat').value : undefined, sub: register ? $('#oRegSub').value : undefined };
  const opts = collectOpts(tool);
  const ext = toolOutputExt(tool, opts);
  tb.busy = true;
  $('#modalOk').disabled = true;
  tbProgress('处理中…');
  try {
    const outputs = tool.client
      ? await runClientTool(tool, dir, name, opts, reg, ext)
      : await runServerTool(tool, dir, name, opts, reg);
    rememberDir(dir);
    showToolResult(tool, outputs, ext);
    await load();
    return false; // 留在弹窗里看结果，点「完成」再关
  } catch (err) {
    tbProgress('');
    toast(err.message);
    return false;
  } finally {
    tb.busy = false;
    $('#modalOk').disabled = false;
  }
}

function rememberDir(dir) {
  const list = [...new Set([dir, ...JSON.parse(localStorage.getItem('tbDirs') || '[]')])].slice(0, 5);
  localStorage.setItem('tbDirs', JSON.stringify(list));
}

// 服务端 pdf-lib 操作：批量工具一次请求，其余按勾选逐个处理
async function runServerTool(tool, dir, name, opts, reg) {
  const body = (files, outName) => JSON.stringify({
    op: tool.id, files, outDir: dir, outName, opts, reg,
  });
  if (BATCH_TOOLS.has(tool.id)) {
    const r = await api('/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(tb.files.map(f => f.absPath), name) });
    return r.outputs;
  }
  const outputs = [];
  for (let i = 0; i < tb.files.length; i++) {
    const f = tb.files[i];
    tbProgress(`处理中 ${i + 1}/${tb.files.length}：${f.name}`);
    const outName = tb.files.length > 1 ? `${name}-${stripExt(f.name)}` : name;
    const r = await api('/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body([f.absPath], outName) });
    outputs.push(...r.outputs);
  }
  return outputs;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片编码失败')), type, quality));
}

let pdfjsLib = null;
async function loadPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  const mod = await import('/vendor/pdfjs/legacy/build/pdf.mjs');
  mod.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/legacy/build/pdf.worker.mjs';
  pdfjsLib = mod;
  return mod;
}

async function saveBlob(dir, name, blob, reg) {
  const q = new URLSearchParams({ dir, name, register: reg.register ? '1' : '0' });
  if (reg.register && reg.category) { q.set('cat', reg.category); q.set('sub', reg.sub || '默认'); }
  const res = await fetch('/api/tool/save?' + q.toString(), { method: 'POST', body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存失败');
  return data.path;
}

// 前端渲染：PDF→图片用 pdf.js，图片互转用 canvas
async function runClientTool(tool, dir, name, opts, reg, ext) {
  const outputs = [];
  const multi = tb.files.length > 1;
  for (let n = 0; n < tb.files.length; n++) {
    const f = tb.files[n];
    const base = multi ? `${name}-${stripExt(f.name)}` : name;
    const res = await fetch(f.id ? '/api/raw/' + f.id : '/api/tool/raw?path=' + encodeURIComponent(f.absPath));
    if (!res.ok) throw new Error(`读取失败：${f.name}`);
    if (tool.id === 'pdf2img') {
      const lib = await loadPdfjs();
      const doc = await lib.getDocument({
        data: await res.arrayBuffer(),
        cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      }).promise;
      const pages = parsePagesClient(opts.pages, doc.numPages);
      for (let i = 0; i < pages.length; i++) {
        tbProgress(`导出 ${i + 1}/${pages.length} 页：${f.name}`);
        const page = await doc.getPage(pages[i]);
        const vp = page.getViewport({ scale: +opts.scale || 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const cx = canvas.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: cx, viewport: vp }).promise;
        outputs.push(await saveBlob(dir, `${base}_${pad2(pages[i])}.${ext}`,
          await canvasToBlob(canvas, opts.fmt === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92), reg));
        page.cleanup();
      }
      doc.cleanup();
    } else {
      tbProgress(`转换 ${n + 1}/${tb.files.length}：${f.name}`);
      const bmp = await createImageBitmap(await res.blob());
      const cap = opts.maxWidth > 0 ? Math.min(1, opts.maxWidth / Math.max(bmp.width, bmp.height)) : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * cap));
      canvas.height = Math.max(1, Math.round(bmp.height * cap));
      const cx = canvas.getContext('2d');
      if (opts.fmt === 'image/jpeg') { cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height); }
      cx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      outputs.push(await saveBlob(dir, `${base}.${ext}`, await canvasToBlob(canvas, opts.fmt, opts.quality), reg));
    }
  }
  return outputs;
}

function showToolResult(tool, outputs, ext) {
  const el = $('#tbProgress');
  if (el) el.innerHTML = `<div class="tb-done">✅ ${tool.name} 完成 · 共 ${outputs.length} 个文件
    ${outputs.map(p => `<code title="${escapeHtml(p)}">${escapeHtml(p)}</code>`).join('')}</div>`;
  $('#modalOk').textContent = '完成';
  $('#modalOk').onclick = () => { closeModal(); return true; };
  $('#modalOk').disabled = false;
  toast(`已生成 ${outputs.length} 个 ${ext.toUpperCase()}`);
}

/* ---------- 快捷键 ---------- */
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('#searchBox').focus();
    $('#searchBox').select();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#modal').classList.contains('hidden')) { closeModal(); return; }
    if (state.currentFile) { closePreview(); return; }
    if (state.selectedIds.size) { state.selectedIds.clear(); renderFiles(); updateBulkBar(); }
  }
});

load().catch(err => toast('加载失败：' + err.message));
