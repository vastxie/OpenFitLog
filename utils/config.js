// 全局配置：应用名称、可选媒体源、可选云同步接口、客服与隐私主体、主题、部位分类、默认休息时长

// 应用名称（分享标题、导出文件名、隐私说明统一引用；导航栏标题请同步修改 app.json）
const APP_NAME = 'OpenFitLog';

// 动作库演示海报与视频源根地址（不带末尾斜杠）
// 默认指向公共免流量 R2 图床，导入微信开发者工具即可直接在线预览 314 个动作的男女 3D 视频与封面；
// 如需正式发布上线你自己的小程序，可执行 npm run download:media 拉取全套素材上传至你自己的已备案域名 OSS/COS，再替换此地址；
// 若留空 '' 则不发起任何外部请求，动作库自动降级为内置肌肉部位剪影图标
const MEDIA_BASE_URL = 'https://fit-media.lightai.io';

// 可选：云同步后端根地址（不带末尾斜杠，例如 'https://api.example.com'，参考 server/ 目录自建）
// 留空时运行在纯本机离线模式，自动隐藏「云同步」入口与首次同步引导弹窗
const API_BASE_URL = '';

// 可选：企业微信客服配置（需同时填写客服链接与 ww 开头的企业 ID，并先在小程序后台绑定该企业 ID）
// 留空时使用微信小程序原生客服会话按钮（open-type="contact"）
const KF_URL = '';
const KF_CORP_ID = '';

// 可选：隐私政策页展示的运营主体与联系邮箱（正式发布上线前请按实际主体填写，并同步更新小程序后台《用户隐私保护指引》）
const PRIVACY_OPERATOR = '';
const PRIVACY_EMAIL = '';

// 基础色：和 app.wxss 里的变量一一对应，给 canvas、弹窗、tabBar 这些用不了 CSS 变量的地方用
const BASE_COLORS = {
  light: { ink: '#111111', ink2: '#666666', ink3: '#a3a3a3', line: '#ebebeb', fill: '#f5f5f5' },
  dark: { ink: '#ededed', ink2: '#9b9b9b', ink3: '#6b6b6b', line: '#2c2c2c', fill: '#2a2a2a' },
};

const TAB_BAR = {
  light: { color: '#a3a3a3', backgroundColor: '#ffffff', borderStyle: 'black' },
  dark: { color: '#6b6b6b', backgroundColor: '#1c1c1c', borderStyle: 'white' },
};

// accent 只用来表示「已完成」；墨黑主题下是绿色，其余主题与主色一致
// dark 是深色模式下的取值：主色提亮一档，热力图从暗到亮
const THEMES = [
  {
    key: 'ink',
    name: '墨黑',
    primary: '#111111',
    accent: '#16a365',
    heat: ['#ededf0', '#b7ebd2', '#64d19f', '#1f9d57', '#136b3a'],
    dark: {
      primary: '#ededed',
      accent: '#22b573',
      heat: ['#2a2a2a', '#14532d', '#15803d', '#22b573', '#86efac'],
    },
  },
  {
    key: 'emerald',
    name: '翡翠',
    primary: '#16a365',
    accent: '#16a365',
    heat: ['#ededf0', '#b7ebd2', '#64d19f', '#1fb574', '#0f7f4f'],
    dark: {
      primary: '#22b573',
      accent: '#22b573',
      heat: ['#2a2a2a', '#064e3b', '#047857', '#22b573', '#6ee7b7'],
    },
  },
  {
    key: 'blue',
    name: '海蓝',
    primary: '#2563eb',
    accent: '#2563eb',
    heat: ['#ededf0', '#bfdbfe', '#60a5fa', '#2563eb', '#1e40af'],
    dark: {
      primary: '#3b82f6',
      accent: '#3b82f6',
      heat: ['#2a2a2a', '#1e3a8a', '#1d4ed8', '#3b82f6', '#93c5fd'],
    },
  },
  {
    key: 'violet',
    name: '藤紫',
    primary: '#7c3aed',
    accent: '#7c3aed',
    heat: ['#ededf0', '#ddd6fe', '#a78bfa', '#7c3aed', '#4c1d95'],
    dark: {
      primary: '#8b5cf6',
      accent: '#8b5cf6',
      heat: ['#2a2a2a', '#4c1d95', '#6d28d9', '#8b5cf6', '#c4b5fd'],
    },
  },
  {
    key: 'orange',
    name: '暖橙',
    primary: '#ea580c',
    accent: '#ea580c',
    heat: ['#ededf0', '#fed7aa', '#fb923c', '#ea580c', '#9a3412'],
    dark: {
      primary: '#f97316',
      accent: '#f97316',
      heat: ['#2a2a2a', '#7c2d12', '#c2410c', '#f97316', '#fdba74'],
    },
  },
  {
    key: 'rose',
    name: '蔷薇',
    primary: '#e0457b',
    accent: '#e0457b',
    heat: ['#ededf0', '#fbcfe0', '#f48fb4', '#e0457b', '#a3264f'],
    dark: {
      primary: '#ec5f8f',
      accent: '#ec5f8f',
      heat: ['#2a2a2a', '#881337', '#be185d', '#ec5f8f', '#f9a8c9'],
    },
  },
  {
    key: 'mauve',
    name: '豆沙',
    primary: '#b85c72',
    accent: '#b85c72',
    heat: ['#ededf0', '#f0d3d9', '#dd9aa8', '#b85c72', '#84394d'],
    dark: {
      primary: '#c97287',
      accent: '#c97287',
      heat: ['#2a2a2a', '#5c2a37', '#8a4256', '#c97287', '#e7b3bf'],
    },
  },
];

// 系统当前是否深色模式（app.json 开了 darkmode 才会返回 theme）
function isDark() {
  try {
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    return info.theme === 'dark';
  } catch (e) {
    return false;
  }
}

function getThemeConfig(key) {
  return THEMES.find((t) => t.key === key) || THEMES[0];
}

// 当前深浅色下的实际颜色值，canvas 和热力图用
function getPalette(key) {
  const t = getThemeConfig(key);
  const dark = isDark();
  const mode = dark ? t.dark : t;
  return Object.assign({}, dark ? BASE_COLORS.dark : BASE_COLORS.light, {
    dark,
    primary: mode.primary,
    accent: mode.accent,
    heat: mode.heat,
  });
}

// 页面根节点的 style：只引用 app.wxss 里的变量，深浅色切换不需要重新 setData
function getThemeStyle(key) {
  const k = getThemeConfig(key).key;
  return `--primary:var(--p-${k});--on-primary:var(--op-${k});--accent:var(--a-${k});`;
}

// 系统弹窗的按钮颜色
function modalColors() {
  const c = isDark() ? BASE_COLORS.dark : BASE_COLORS.light;
  return { confirmColor: c.ink, cancelColor: c.ink2 };
}

// Tab 页 onShow 和系统切换深浅色时调用；主题和深浅色都没变就不重复设置
let _tabBarSig = '';

function applyTabBarTheme(key) {
  const t = getThemeConfig(key);
  const dark = isDark();
  const sig = `${t.key}:${dark ? 'dark' : 'light'}`;
  if (sig === _tabBarSig) return;
  _tabBarSig = sig;
  const suffix = dark ? '-dark' : '';
  const fail = () => {
    _tabBarSig = '';
  };
  try {
    wx.setTabBarStyle(
      Object.assign({ selectedColor: dark ? t.dark.primary : t.primary, fail }, dark ? TAB_BAR.dark : TAB_BAR.light)
    );
    ['train', 'exercise', 'mine'].forEach((base, index) => {
      wx.setTabBarItem({
        index,
        iconPath: `assets/tabbar/${base}${suffix}.png`,
        selectedIconPath: `assets/tabbar/${base}-on-${t.key}${suffix}.png`,
        fail,
      });
    });
  } catch (e) {
    fail();
  }
}

const BODY_PARTS = [
  { key: 'chest', name: '胸部' },
  { key: 'shoulders', name: '肩膀' },
  { key: 'back', name: '背部' },
  { key: 'biceps', name: '二头' },
  { key: 'triceps', name: '三头' },
  { key: 'forearms', name: '小臂' },
  { key: 'glutes', name: '臀部' },
  { key: 'legs', name: '腿部' },
  { key: 'core', name: '核心' },
  { key: 'stretch', name: '拉伸' },
  { key: 'cardio', name: '有氧' },
];

const CATEGORIES = [
  { key: 'fav', name: '收藏' },
  ...BODY_PARTS,
  { key: 'custom', name: '自建' },
];

const CATEGORY_LABELS = BODY_PARTS.reduce((map, c) => {
  map[c.key] = c.name;
  return map;
}, {});

const REST_OPTIONS = [30, 45, 60, 75, 90, 120, 150, 180];

function isTimedCat(cat) {
  return cat === 'stretch' || cat === 'cardio';
}

function timedUnit(cat) {
  return cat === 'cardio'
    ? { label: '分钟', factor: 60, defaultSec: 1200, defaultSets: 1 }
    : { label: '秒', factor: 1, defaultSec: 30, defaultSets: 2 };
}

// 判断是否为多关节大复合动作（决定组间小休、换动作大休以及渐进调重步长）
function isCompoundExercise(meta) {
  if (!meta || isTimedCat(meta.cat)) return false;
  const n = meta.name || '';
  return /深蹲|硬拉|腿举|蹬腿|弓步|卧推|推胸|推肩|推举|引体|下拉|划船|双杠/.test(n);
}

// 根据动作力学级别和训练目标，给出默认的「组间小休 (restSec)」与「换动作大休 (transRestSec)」
function getDefaultRests(meta, goal) {
  if (!meta) return { restSec: 75, transRestSec: 105 };
  if (meta.cat === 'stretch') return { restSec: 15, transRestSec: 25 };
  if (meta.cat === 'cardio') return { restSec: 30, transRestSec: 60 };

  const compound = isCompoundExercise(meta);
  if (goal === 'strength') {
    return compound ? { restSec: 120, transRestSec: 150 } : { restSec: 75, transRestSec: 105 };
  }
  if (goal === 'fat_loss') {
    return compound ? { restSec: 60, transRestSec: 90 } : { restSec: 45, transRestSec: 75 };
  }
  return compound ? { restSec: 90, transRestSec: 120 } : { restSec: 60, transRestSec: 90 };
}

// 动作主练部位 → 部位图标（assets/icons/part-*.svg）
// 先看目标肌肉（拉伸动作也能对上具体部位），对不上再按分类；顺序有讲究，比如「胸椎」要先归到背
const PART_RULES = [
  [/心肺/, 'cardio'],
  [/胸椎|背|斜方|菱形|竖脊|脊柱|颈/, 'back'],
  [/胸/, 'chest'],
  [/三角肌/, 'shoulders'],
  [/肱二头/, 'biceps'],
  [/肱三头/, 'triceps'],
  [/前臂/, 'forearms'],
  [/腹|髂腰|髋屈/, 'core'],
  [/臀|髋外展/, 'glutes'],
  [/股四头|内收|腘绳|小腿|腓骨/, 'legs'],
];
// 部位图标对应的名称（统计页的部位分布用）
const PART_NAMES = {
  chest: '胸',
  shoulders: '肩',
  back: '背',
  biceps: '二头',
  triceps: '三头',
  forearms: '小臂',
  glutes: '臀',
  legs: '腿',
  core: '腹',
  cardio: '有氧',
  other: '其他',
};
const PART_BY_CAT = {
  chest: 'chest',
  shoulders: 'shoulders',
  back: 'back',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  glutes: 'glutes',
  legs: 'legs',
  core: 'core',
  cardio: 'cardio',
};

function getPartIcon(meta) {
  if (!meta) return 'other';
  const target = meta.target || '';
  const hit = PART_RULES.find(([re]) => re.test(target));
  if (hit) return hit[1];
  return PART_BY_CAT[meta.cat] || 'other';
}

function getMediaUrls(exercise, preferredGender) {
  const base = (MEDIA_BASE_URL || '').replace(/\/+$/, '');
  if (!base || !exercise || exercise.isCustom) {
    return { posterUrl: '', videoUrl: '', modelGender: preferredGender || 'male' };
  }
  const wantFemale = preferredGender === 'female';
  let slug = wantFemale ? exercise.f : exercise.m;
  let actualGender = wantFemale ? 'female' : 'male';
  if (!slug) {
    slug = wantFemale ? exercise.m : exercise.f;
    actualGender = wantFemale ? 'male' : 'female';
  }
  if (!slug) {
    return { posterUrl: '', videoUrl: '', modelGender: actualGender };
  }
  return {
    posterUrl: `${base}/exercise-posters/${actualGender}/${slug}.jpg`,
    videoUrl: `${base}/exercise-videos/${actualGender}/${slug}.mp4`,
    modelGender: actualGender,
  };
}

function exerciseSub(ex) {
  if (!ex) return '';
  return [ex.equip, ex.target].filter(Boolean).join(' · ');
}

module.exports = {
  APP_NAME,
  MEDIA_BASE_URL,
  API_BASE_URL,
  KF_URL,
  KF_CORP_ID,
  PRIVACY_OPERATOR,
  PRIVACY_EMAIL,
  THEMES,
  isDark,
  getThemeConfig,
  getPalette,
  getThemeStyle,
  modalColors,
  applyTabBarTheme,
  BODY_PARTS,
  CATEGORIES,
  CATEGORY_LABELS,
  REST_OPTIONS,
  isTimedCat,
  timedUnit,
  isCompoundExercise,
  getDefaultRests,
  getMediaUrls,
  getPartIcon,
  PART_NAMES,
  exerciseSub,
};
