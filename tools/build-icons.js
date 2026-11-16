// 把 assets/icons/*.svg 转成 CSS mask 图标，写进 app.wxss 的 ICONS 区块。
// 图标颜色由 background-color 决定，所以一套 SVG 同时适配深浅色和主题色。
// 用法：node tools/build-icons.js（新增或修改 SVG 后运行）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const iconDir = path.join(root, 'assets/icons');
const wxssPath = path.join(root, 'app.wxss');

// 每个图标的默认颜色；页面里可以用更具体的选择器覆盖
const DEFAULT_COLOR = {
  check: 'var(--on-primary)',
  'chevron-right': 'var(--ink-4)',
  close: 'var(--ink-3)',
  heart: 'var(--ink-3)',
  search: 'var(--ink-3)',
  'heart-fill': 'var(--ink)',
  plus: 'var(--ink)',
};

const START = '/* ICONS:START 由 tools/build-icons.js 生成，不要手改 */';
const END = '/* ICONS:END */';

const names = fs
  .readdirSync(iconDir)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .sort();

const rules = names.map((name) => {
  const svg = fs.readFileSync(path.join(iconDir, `${name}.svg`), 'utf8').trim();
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const color = DEFAULT_COLOR[name] || 'var(--ink-2)';
  return `.i-${name} {\n  background-color: ${color};\n  -webkit-mask-image: url("${uri}");\n  mask-image: url("${uri}");\n}`;
});

const block = [
  START,
  '.i {',
  '  display: block;',
  '  flex-shrink: 0;',
  '  -webkit-mask-size: contain;',
  '  mask-size: contain;',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '}',
  '',
  rules.join('\n\n'),
  END,
].join('\n');

let wxss = fs.readFileSync(wxssPath, 'utf8');
const s = wxss.indexOf(START);
const e = wxss.indexOf(END);
if (s >= 0 && e > s) {
  wxss = wxss.slice(0, s) + block + wxss.slice(e + END.length);
} else {
  wxss = `${wxss.trimEnd()}\n\n${block}\n`;
}
fs.writeFileSync(wxssPath, wxss);
console.log(`icons: ${names.length}`);
