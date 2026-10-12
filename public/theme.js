/* 主题配色表。theme.js 在 <head> 里同步执行，先于首帧上色（CSP 禁内联脚本，所以独立成文件）。
   变量集合与 style.css 的 :root 默认值一致：新增变量时两边都要补。 */
const DOC_THEMES = [
  {
    id: 'default', name: 'DocShelf 默认', tag: '浅色',
    vars: {
      '--bg': '#f5f6f8', '--panel': '#ffffff', '--border': '#e3e6ea',
      '--text': '#1f2430', '--muted': '#7a8394',
      '--accent': '#3b6cf0', '--accent-hover': '#2f5ad0', '--accent-soft': '#eaf0fe', '--on-accent': '#ffffff',
      '--danger': '#d64545', '--danger-soft': '#fbeaea',
      '--doc-bg': '#ffffff', '--code-bg': '#f0f2f5', '--badge-text': '#ffffff',
      '--h-orange': '#e06b2d', '--h-green': '#2f9e6e', '--h-green-2': '#217346', '--h-gray': '#7a8394',
      '--shadow': 'rgba(59,108,240,.12)', '--drop-bg': 'rgba(59,108,240,.12)', '--scroll-thumb': '#c6ccd6',
    },
  },
  {
    id: 'latte', name: 'Catppuccin Latte', tag: '浅色',
    vars: {
      '--bg': '#dce0e8', '--panel': '#eff1f5', '--border': '#ccd0da',
      '--text': '#4c4f69', '--muted': '#6c6f85',
      '--accent': '#1e66f5', '--accent-hover': '#1a56d0', '--accent-soft': 'rgba(30,102,245,.13)', '--on-accent': '#eff1f5',
      '--danger': '#d20f39', '--danger-soft': 'rgba(210,15,57,.12)',
      '--doc-bg': '#ffffff', '--code-bg': '#e6e9ef', '--badge-text': '#eff1f5',
      '--h-orange': '#fe640b', '--h-green': '#40a02b', '--h-green-2': '#179299', '--h-gray': '#7c7f93',
      '--shadow': 'rgba(30,102,245,.14)', '--drop-bg': 'rgba(30,102,245,.14)', '--scroll-thumb': '#bcc0cc',
    },
  },
  {
    id: 'solarized', name: 'Solarized Light', tag: '浅色',
    vars: {
      '--bg': '#eee8d5', '--panel': '#fdf6e3', '--border': '#ded7bb',
      '--text': '#586e75', '--muted': '#93a1a1',
      '--accent': '#268bd2', '--accent-hover': '#1a6bab', '--accent-soft': 'rgba(38,139,210,.14)', '--on-accent': '#fdf6e3',
      '--danger': '#dc322f', '--danger-soft': 'rgba(220,50,47,.12)',
      '--doc-bg': '#fdf6e3', '--code-bg': '#eee8d5', '--badge-text': '#fdf6e3',
      '--h-orange': '#cb4b16', '--h-green': '#859900', '--h-green-2': '#2aa198', '--h-gray': '#657b83',
      '--shadow': 'rgba(38,139,210,.16)', '--drop-bg': 'rgba(38,139,210,.16)', '--scroll-thumb': '#ccc4a4',
    },
  },
  {
    id: 'mocha', name: 'Catppuccin Mocha', tag: '深色',
    vars: {
      '--bg': '#1e1e2e', '--panel': '#181825', '--border': '#313244',
      '--text': '#cdd6f4', '--muted': '#a6adc8',
      '--accent': '#89b4fa', '--accent-hover': '#b4befe', '--accent-soft': 'rgba(137,180,250,.16)', '--on-accent': '#11111b',
      '--danger': '#f38ba8', '--danger-soft': 'rgba(243,139,168,.16)',
      '--doc-bg': '#1e1e2e', '--code-bg': '#313244', '--badge-text': '#11111b',
      '--h-orange': '#fab387', '--h-green': '#a6e3a1', '--h-green-2': '#94e2d5', '--h-gray': '#7f849c',
      '--shadow': 'rgba(0,0,0,.45)', '--drop-bg': 'rgba(137,180,250,.14)', '--scroll-thumb': '#45475a',
    },
  },
  {
    id: 'dracula', name: 'Dracula', tag: '深色',
    vars: {
      '--bg': '#282a36', '--panel': '#21222c', '--border': '#44475a',
      '--text': '#f8f8f2', '--muted': '#8b91b7',
      '--accent': '#bd93f9', '--accent-hover': '#caa4fb', '--accent-soft': 'rgba(189,147,249,.16)', '--on-accent': '#21222c',
      '--danger': '#ff5555', '--danger-soft': 'rgba(255,85,85,.16)',
      '--doc-bg': '#282a36', '--code-bg': '#44475a', '--badge-text': '#282a36',
      '--h-orange': '#ffb86c', '--h-green': '#50fa7b', '--h-green-2': '#8be9fd', '--h-gray': '#7f8ab5',
      '--shadow': 'rgba(0,0,0,.5)', '--drop-bg': 'rgba(189,147,249,.14)', '--scroll-thumb': '#44475a',
    },
  },
  {
    id: 'nord', name: 'Nord', tag: '深色',
    vars: {
      '--bg': '#2e3440', '--panel': '#3b4252', '--border': '#4c566a',
      '--text': '#d8dee9', '--muted': '#8f9bb0',
      '--accent': '#88c0d0', '--accent-hover': '#8fbcbb', '--accent-soft': 'rgba(136,192,208,.16)', '--on-accent': '#2e3440',
      '--danger': '#bf616a', '--danger-soft': 'rgba(191,97,106,.18)',
      '--doc-bg': '#2e3440', '--code-bg': '#434c5e', '--badge-text': '#2e3440',
      '--h-orange': '#d08770', '--h-green': '#a3be8c', '--h-green-2': '#ebcb8b', '--h-gray': '#6b7689',
      '--shadow': 'rgba(0,0,0,.45)', '--drop-bg': 'rgba(136,192,208,.14)', '--scroll-thumb': '#434c5e',
    },
  },
  {
    id: 'one-dark', name: 'One Dark', tag: '深色',
    vars: {
      '--bg': '#21252b', '--panel': '#282c34', '--border': '#3a3f4b',
      '--text': '#abb2bf', '--muted': '#7f848e',
      '--accent': '#61afef', '--accent-hover': '#7dc3f2', '--accent-soft': 'rgba(97,175,239,.16)', '--on-accent': '#21252b',
      '--danger': '#e06c75', '--danger-soft': 'rgba(224,108,117,.16)',
      '--doc-bg': '#282c34', '--code-bg': '#3a3f4b', '--badge-text': '#21252b',
      '--h-orange': '#d19a66', '--h-green': '#98c379', '--h-green-2': '#56b6c2', '--h-gray': '#7d8590',
      '--shadow': 'rgba(0,0,0,.45)', '--drop-bg': 'rgba(97,175,239,.14)', '--scroll-thumb': '#3f4451',
    },
  },
  {
    id: 'rose-pine', name: 'Rosé Pine', tag: '深色',
    vars: {
      '--bg': '#191724', '--panel': '#1f1d2e', '--border': '#2a283c',
      '--text': '#e0def4', '--muted': '#908caa',
      '--accent': '#c4a7e7', '--accent-hover': '#d8c4f0', '--accent-soft': 'rgba(196,167,231,.16)', '--on-accent': '#191724',
      '--danger': '#eb6f92', '--danger-soft': 'rgba(235,111,146,.16)',
      '--doc-bg': '#191724', '--code-bg': '#2a283c', '--badge-text': '#191724',
      '--h-orange': '#f6c177', '--h-green': '#9ccfd8', '--h-green-2': '#3e8fb8', '--h-gray': '#908caa',
      '--shadow': 'rgba(0,0,0,.5)', '--drop-bg': 'rgba(196,167,231,.14)', '--scroll-thumb': '#2a283c',
    },
  },
];

function docApplyTheme(id, animate) {
  const theme = DOC_THEMES.find(t => t.id === id) || DOC_THEMES[0];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.dataset.theme = theme.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.vars['--accent']);
  try { localStorage.setItem('theme', theme.id); } catch (e) { /* 隐私模式下忽略 */ }
  if (animate) {
    root.classList.add('theme-anim');
    clearTimeout(docApplyTheme._timer);
    docApplyTheme._timer = setTimeout(() => root.classList.remove('theme-anim'), 320);
  }
  return theme;
}

let savedTheme = 'default';
try { savedTheme = localStorage.getItem('theme') || 'default'; } catch (e) { /* ignore */ }
docApplyTheme(savedTheme, false);

window.DocShelfTheme = { themes: DOC_THEMES, apply: docApplyTheme };
