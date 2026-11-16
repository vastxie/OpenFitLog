// 生成部位图标 assets/icons/part-*.svg：同一个人体剪影（25% 不透明）+ 目标肌肉实心。
// 剪影从头到膝盖，正面和背面轮廓相同；背面的图标在躯干中间留一道脊柱缝。
// 肌肉形状裁剪在剪影内，所以边缘总是贴着轮廓。改完运行：
//   node tools/build-part-icons.js && node tools/build-icons.js
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'assets/icons');

// 只写左半边（画面左侧），右半边镜像
const MIRROR = 'matrix(-1 0 0 1 24 0)';
const both = (d) => `<path d="${d}"/><path d="${d}" transform="${MIRROR}"/>`;

const HEAD = '<circle cx="12" cy="3" r="2.2"/>';
// 躯干左半：颈 → 斜方 → 肩 → 腋下 → 腰 → 胯，中线 x=12
const TORSO_L = 'M12 5H11V5.9C10.3 6.4 9 6.6 7.9 6.9C7.3 7.1 7.2 7.6 7.5 8.2L7.9 9.8C8 11.3 8.4 12.8 8.9 14C8.7 15 8.5 16 8.4 17.2H12Z';
// 背面：中线留 0.6 的缝
const TORSO_L_BACK = TORSO_L.replace(/^M12 5H/, 'M11.7 5H').replace(/H12Z$/, 'H11.7Z');
// 手臂左半：肩头 → 上臂 → 肘 → 前臂 → 手
const ARM_L = 'M7.9 6.9C6.6 6.9 5.4 7.5 5 8.7C4.8 9.6 4.8 10.8 4.7 12C4.6 13.6 4.3 15.4 4.1 17.2C4 18.1 4.3 18.7 4.8 18.7C5.3 18.7 5.5 18.2 5.6 17.5C5.9 16 6.2 14.6 6.4 13.4C6.7 12.2 7 11 7.2 9.8C7.4 9.1 7.6 8.2 7.9 6.9Z';
// 腿左半：胯 → 大腿 → 膝
const LEG_L = 'M8.4 16.6C8.1 18.6 8.3 20.9 8.8 23.4H11.2C11.4 21.4 11.6 19.5 11.7 17.9C11.8 17.4 11.9 17.1 12 17Z';

const silhouette = (back) =>
  [HEAD, both(back ? TORSO_L_BACK : TORSO_L), both(ARM_L), both(LEG_L)].join('');

// 每个部位：是否背面、肌肉形状（左半，会镜像；full 为不镜像的形状）
const PARTS = {
  chest: {
    l: ['M11.7 7C10.3 7 8.9 7.3 7.9 7.9L8.1 10.2C9.3 11 10.7 11 11.7 10.5Z'],
  },
  shoulders: {
    l: ['M8.4 6.8C6.6 6.6 5.1 7.5 4.8 9C4.7 9.8 4.8 10.5 5.1 10.9C5.8 10 6.8 9.3 8.2 9Z'],
  },
  biceps: {
    l: ['M7.1 9.3C6 9.4 5.1 10.1 4.8 11.1C4.7 11.9 4.8 12.7 5.1 13.2C6 13.1 6.6 12.4 6.9 11.6C7.1 10.8 7.3 10 7.1 9.3Z'],
  },
  triceps: {
    back: true,
    l: ['M5.3 8.5C4.8 9.3 4.7 10.6 4.6 11.8C4.6 12.6 4.7 13.2 4.9 13.6C5.6 13.3 6.1 12.5 6.4 11.5C6.6 10.5 6.5 9.3 5.3 8.5Z'],
  },
  forearms: {
    l: ['M6.5 12.9C5.7 13 4.8 13.4 4.4 13.9C4.2 15.2 4.1 16.3 4 17.2H5.7C6 15.8 6.3 14.3 6.5 12.9Z'],
  },
  back: {
    back: true,
    l: [
      // 斜方
      'M11.4 5.4V6.1C10.5 6.6 9.3 6.9 8.3 7.2C9.5 7.6 10.6 8.3 11.4 9.2Z',
      // 背阔
      'M8 8C8.3 9.6 8.5 11.2 9 12.7C9.9 13.2 10.7 13.7 11.4 14.2V10.3C10.4 9.3 9.3 8.5 8 8Z',
    ],
  },
  core: {
    l: [
      'M11.6 11.4H9.4C9.4 12.1 9.5 12.7 9.6 13.2H11.6Z',
      'M11.6 13.8H9.7C9.8 14.4 9.8 15 9.8 15.5H11.6Z',
      'M11.6 16.1H9.8C9.8 16.5 9.9 16.9 10.1 17.3H11.6Z',
    ],
  },
  glutes: {
    back: true,
    l: ['M11.6 14.8C10.4 14.8 9.2 15.1 8.5 15.6C8.2 16.6 8.2 17.6 8.4 18.4C9.4 19 10.6 19 11.6 18.6Z'],
  },
  legs: {
    l: ['M8.4 17.6C8.3 19.2 8.5 20.8 8.9 22.4H10.9C11.1 20.8 11.3 19.2 11.4 17.6C10.4 17.2 9.4 17.2 8.4 17.6Z'],
  },
  cardio: {
    // 心脏，画在胸口偏身体左侧（画面右侧）
    full: ['M13.9 12.6C13.9 12.6 11.9 11.4 11.9 9.9C11.9 9.2 12.4 8.7 13 8.7C13.4 8.7 13.7 8.9 13.9 9.2C14.1 8.9 14.4 8.7 14.8 8.7C15.4 8.7 15.9 9.2 15.9 9.9C15.9 11.4 13.9 12.6 13.9 12.6Z'],
  },
  // 自建动作没有部位信息：只有剪影，不高亮
  other: {},
};

function build(name, p) {
  const sil = silhouette(!!p.back);
  const muscles = (p.l || []).map(both).join('') + (p.full || []).map((d) => `<path d="${d}"/>`).join('');
  return svg(
    `<defs><clipPath id="s">${sil}</clipPath></defs>` +
      `<g opacity=".25">${sil}</g>` +
      `<g clip-path="url(#s)">${muscles}</g>`
  );
}

function svg(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#111111">${inner}</svg>\n`;
}

Object.keys(PARTS).forEach((name) => {
  fs.writeFileSync(path.join(outDir, `part-${name}.svg`), build(name, PARTS[name]));
});
console.log(`part icons: ${Object.keys(PARTS).length}`);
