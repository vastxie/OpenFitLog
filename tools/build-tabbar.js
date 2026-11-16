// 生成 tabBar 图标 assets/tabbar/*.png（81×81）：未选中是线性，选中是实心。
// 未选中两张（浅色 / 深色），选中每个主题两张，颜色取 utils/config.js 的 THEMES。
// 需要 rsvg-convert（brew install librsvg）。用法：node tools/build-tabbar.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

global.wx = { getAppBaseInfo: () => ({ theme: 'light' }), getStorageSync: () => '' };
const { THEMES } = require('../utils/config.js');

const outDir = path.join(__dirname, '..', 'assets/tabbar');
const OFF = { light: '#a3a3a3', dark: '#6b6b6b' };

const stroke = (c, inner) =>
  `<g fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;

const ICONS = {
  // 训练：哑铃
  train: {
    off: (c) =>
      stroke(c, '<rect x="4.2" y="5.2" width="3.8" height="13.6" rx="1.6"/><rect x="16" y="5.2" width="3.8" height="13.6" rx="1.6"/><path d="M8 12h8M1.8 12h2.4M19.8 12h2.4"/>'),
    on: (c) =>
      `<g fill="${c}"><rect x="3.4" y="4.4" width="5.4" height="15.2" rx="2.2"/><rect x="15.2" y="4.4" width="5.4" height="15.2" rx="2.2"/><rect x="8" y="10.9" width="8" height="2.2"/><rect x="1.2" y="10.9" width="2.6" height="2.2" rx="1.1"/><rect x="20.2" y="10.9" width="2.6" height="2.2" rx="1.1"/></g>`,
  },
  // 动作：翻开的书（动作库）
  exercise: {
    off: (c) =>
      stroke(c, '<path d="M12 6.6C10.2 5.3 7.4 4.8 3.6 5v13.2c3.8-.2 6.6.3 8.4 1.6 1.8-1.3 4.6-1.8 8.4-1.6V5c-3.8-.2-6.6.3-8.4 1.6z"/><path d="M12 6.6v13.2"/>'),
    on: (c) =>
      `<g fill="${c}"><path d="M11.2 5.9C9.3 4.7 6.5 4.2 3.6 4.3c-.6 0-1 .4-1 1v13c0 .6.5 1 1.1 1 2.8-.1 5.4.3 7.5 1.5z"/><path d="M12.8 5.9c1.9-1.2 4.7-1.7 7.6-1.6.6 0 1 .4 1 1v13c0 .6-.5 1-1.1 1-2.8-.1-5.4.3-7.5 1.5z"/></g>`,
  },
  // 我的：人像
  mine: {
    off: (c) => stroke(c, '<circle cx="12" cy="8" r="3.8"/><path d="M4.6 20.2c.4-3.6 3.6-6 7.4-6s7 2.4 7.4 6"/>'),
    on: (c) =>
      `<g fill="${c}"><circle cx="12" cy="7.9" r="4.4"/><path d="M12 13.6c-4.3 0-7.9 2.7-8.3 6.6-.1.6.4 1.1 1 1.1h14.6c.6 0 1.1-.5 1-1.1-.4-3.9-4-6.6-8.3-6.6z"/></g>`,
  },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabbar-'));
let n = 0;
function render(file, inner) {
  const svgFile = path.join(tmp, 'i.svg');
  fs.writeFileSync(svgFile, `<svg xmlns="http://www.w3.org/2000/svg" width="81" height="81" viewBox="0 0 24 24">${inner}</svg>`);
  execFileSync('rsvg-convert', ['-w', '81', '-h', '81', '-o', path.join(outDir, file), svgFile]);
  n += 1;
}

Object.keys(ICONS).forEach((base) => {
  const ic = ICONS[base];
  render(`${base}.png`, ic.off(OFF.light));
  render(`${base}-dark.png`, ic.off(OFF.dark));
  THEMES.forEach((t) => {
    render(`${base}-on-${t.key}.png`, ic.on(t.primary));
    render(`${base}-on-${t.key}-dark.png`, ic.on(t.dark.primary));
  });
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`tabbar icons: ${n}`);
