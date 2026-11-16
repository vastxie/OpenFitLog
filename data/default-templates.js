// 按问答结果生成每周计划和起始重量（本地规则，估算值）
const { isTimedCat, getDefaultRests } = require('../utils/config');

const HIP_FLEXOR = 'drv-stretching-crossover-kneeling-hip-flexor-stretch';
const QUAD_STRETCH = 'drv-stretching-quadriceps-stretch';
const HAM_STRETCH = 'drv-stretching-single-straight-leg-stretch';

const DOW_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const STRETCH_PACKS = {
  pull: [
    { exerciseId: '1346', sets: 2, sec: 30 },
    { exerciseId: '1403', sets: 2, sec: 30, note: '每侧 30 秒' },
  ],
  push: [
    { exerciseId: '1167', sets: 2, sec: 30, note: '每侧 30 秒' },
    { exerciseId: '1259', sets: 2, sec: 30, note: '每侧 30 秒' },
  ],
  legs: [
    { exerciseId: HIP_FLEXOR, sets: 2, sec: 35, note: '每侧 35 秒' },
    { exerciseId: QUAD_STRETCH, sets: 2, sec: 35, note: '每侧 35 秒' },
  ],
  legs_post: [
    { exerciseId: HAM_STRETCH, sets: 2, sec: 35, note: '每侧 35 秒' },
    { exerciseId: HIP_FLEXOR, sets: 2, sec: 35, note: '每侧 35 秒' },
  ],
  upper: [
    { exerciseId: '1167', sets: 2, sec: 30, note: '每侧 30 秒' },
    { exerciseId: '1346', sets: 2, sec: 30 },
  ],
  full: [
    { exerciseId: '1167', sets: 2, sec: 30, note: '每侧 30 秒' },
    { exerciseId: HIP_FLEXOR, sets: 2, sec: 30, note: '每侧 30 秒' },
  ],
  recovery: [
    { exerciseId: '1346', sets: 2, sec: 40 },
    { exerciseId: '1167', sets: 2, sec: 35, note: '每侧 35 秒' },
    { exerciseId: HIP_FLEXOR, sets: 2, sec: 40, note: '每侧 40 秒' },
    { exerciseId: HAM_STRETCH, sets: 2, sec: 40, note: '每侧 40 秒' },
    { exerciseId: '1419', sets: 2, sec: 35, note: '每侧 35 秒' },
  ],
};

// 基准中等水平（70kg 男性 / 有一定基础 / 6-15 个俯卧撑）的各动作参考训练重量 (kg)
const BASE_WEIGHT_70M = {
  '0740': 70, // 45° 倒蹬腿举
  '0743': 45, // 哈克深蹲
  '1435': 45, // 杠铃深蹲
  '0025': 40, // 杠铃平板卧推
  '0047': 35, // 杠铃上斜卧推
  '0116': 40, // 杠铃直腿硬拉
  '0027': 35, // 杠铃俯身划船
  '0198': 35, // 宽握高位下拉
  '0208': 32.5, // 坐姿绳索划船
  '0576': 32.5, // 坐姿器械推胸
  '1349': 30, // 胸托 T 杆划船
  '0585': 27.5, // 坐姿腿屈伸
  '0599': 27.5, // 坐姿腿弯举
  '0597': 30, // 坐姿髋外展
  '0594': 30, // 坐姿提踵
  '2286': 20, // 站姿后踢臀
  '1452': 25, // 坐姿器械卷腹
  'drv-lever-pec-deck-fly': 25, // 蝴蝶机夹胸
  '0602': 20, // 蝴蝶机反向飞鸟
  '1723': 17.5, // 绳索三头下压
  '0592': 17.5, // 牧师凳器械弯举
  '0190': 10, // 单臂绳索弯举
  '0192': 5, // 单臂绳索侧平举
  // 哑铃类（单手重量）
  '1760': 16, // 高脚杯深蹲
  'new-dumbbell-sumo-squat': 18, // 哑铃相扑深蹲
  '0432': 14, // 哑铃罗马尼亚硬拉
  '0340': 14, // 平板哑铃对握卧推
  '0314': 12, // 30° 上斜哑铃卧推
  '0327': 12, // 俯卧上斜哑铃划船
  '0293': 14, // 哑铃俯身划船
  '0289': 10, // 坐姿哑铃推肩
  '0361': 10, // 站姿哑铃交替推肩
  '0336': 10, // 哑铃弓步蹲
  '0417': 12, // 哑铃站姿提踵
  '0343': 8, // 俯卧夹哑铃腿弯举
  '2188': 12, // 双手颈后臂屈伸
  '0306': 6, // 单臂颈后臂屈伸
  '0285': 8, // 坐姿交替弯举
  '0294': 8, // 站姿双臂弯举
  '0298': 9, // 锤式弯举
  '0308': 8, // 平板哑铃飞鸟
  '0377': 5, // 俯身后束划船
  '0334': 5, // 站姿哑铃侧平举
};

const DUMBBELL_IDS = new Set([
  '1760', 'new-dumbbell-sumo-squat', '0432', '0340', '0314', '0327', '0293',
  '0289', '0361', '0336', '0417', '0343', '2188', '0306', '0285', '0294',
  '0298', '0308', '0377', '0334',
]);

function roundGymWeight(raw, isDumbbell) {
  if (raw <= 0) return 0;
  if (isDumbbell) {
    if (raw <= 4) return Math.max(1, Math.round(raw));
    return Math.max(2, Math.round(raw / 2) * 2);
  }
  if (raw < 10) return Math.max(2.5, Math.round(raw * 2) / 2);
  return Math.max(5, Math.round(raw / 2.5) * 2.5);
}

// 综合性别、体重、训练年限、俯卧撑测试估算安全起始负重
function estimateInitialWeight(exerciseId, prefs) {
  const base = BASE_WEIGHT_70M[exerciseId];
  if (!base) return 0;

  const isFemale = prefs.gender === 'female';
  const refBw = isFemale ? 54 : 70;
  const userBw = Number(prefs.weightKg) > 30 ? Number(prefs.weightKg) : refBw;
  // 体重影响采用温和幂次缩放，避免大体重零基础被高估
  const bwFactor = Math.pow(userBw / refBw, 0.55);
  const genderFactor = isFemale ? 0.54 : 1.0;

  const expMap = { beginner: 0.72, intermediate: 1.0, advanced: 1.25 };
  const expFactor = expMap[prefs.experience] || 0.85;

  const pushMap = { '0_5': 0.82, '6_15': 1.0, '16_30': 1.12, '30_plus': 1.22 };
  const pushFactor = pushMap[prefs.pushups] || 1.0;

  const age = Number(prefs.age) || 28;
  const ageFactor = age >= 50 ? 0.85 : age >= 40 ? 0.93 : 1.0;

  const goalFactor = prefs.goal === 'strength' ? 1.08 : prefs.goal === 'fat_loss' ? 0.9 : 1.0;

  const raw = base * genderFactor * bwFactor * expFactor * pushFactor * ageFactor * goalFactor;
  return roundGymWeight(raw, DUMBBELL_IDS.has(exerciseId));
}

// 商业健身房蓝图池
const GYM_POOL = {
  pull: {
    title: '拉 · 背与二头',
    desc: '背阔 · 中背 · 后束 · 二头',
    stretch: 'pull',
    core: [
      { exerciseId: '0198', sets: 4, reps: 10, note: '挺胸沉肩，手肘往身体两侧下方带' },
      { exerciseId: '0208', sets: 4, reps: 10, note: 'V 把对握，拉到底夹紧肩胛骨' },
      { exerciseId: '0602', sets: 3, reps: 15, note: '轻重量沉肩往后展，练肩后束' },
      { exerciseId: '0190', sets: 3, reps: 12, note: '大臂贴住身体，慢放别泄力' },
    ],
    extraUpper: { exerciseId: '1349', sets: 3, reps: 10, note: '胸口贴稳靠垫，手肘往后拉' },
    extraBack: { exerciseId: '1349', sets: 3, reps: 10, note: '胸口贴稳靠垫，练中上背厚度' },
  },
  push: {
    title: '推 · 胸肩三头',
    desc: '上胸 · 胸大肌 · 肩中束 · 三头',
    stretch: 'push',
    core: [
      { exerciseId: '0314', sets: 4, reps: 10, note: '手腕立直，大臂与身体约呈 45°–60°' },
      { exerciseId: '0576', sets: 3, reps: 10, note: '握把对准胸口中下沿，肩膀贴住靠背' },
      { exerciseId: '0192', sets: 4, reps: 15, note: '手扶立柱沉肩，抬到与肩同高就行' },
      { exerciseId: '1723', sets: 3, reps: 12, note: '大臂夹在身体两侧不动，只伸直小臂' },
    ],
    extraUpper: { exerciseId: 'drv-lever-pec-deck-fly', sets: 3, reps: 12, note: '手肘微屈固定，合拢时挤一下胸肌' },
    extraBack: { exerciseId: '0602', sets: 3, reps: 15, note: '推日顺带练几组后束，前后肩更平衡' },
  },
  legs: {
    title: '腿 · 臀腿核心',
    desc: '股四头 · 臀腿后侧 · 核心',
    stretch: 'legs',
    core: [
      { exerciseId: '0740', sets: 4, reps: 10, note: '下背贴紧靠垫别翘屁股，推到顶膝盖别锁死' },
      { exerciseId: '0432', sets: 4, reps: 10, note: '屁股往后推，哑铃顺着裤缝往下放' },
      { exerciseId: '0585', sets: 3, reps: 12, note: '膝盖对准器械转轴，踢直停 1 秒' },
      { exerciseId: '0826', sets: 3, reps: 15, weight: 0, note: '前臂撑稳，下腹发力把骨盆往上卷' },
    ],
    extraLower: { exerciseId: '0597', sets: 3, reps: 15, note: '上身微前倾，往外推开停一下' },
  },
  upper_a: {
    title: '上肢 A · 胸背推拉',
    desc: '推胸 · 划船 · 肩中束 · 三头',
    stretch: 'upper',
    core: [
      { exerciseId: '0576', sets: 4, reps: 10, note: '肩膀贴稳靠背，匀速推起' },
      { exerciseId: '0208', sets: 4, reps: 10, note: '拉到底夹紧中背，回放慢一点' },
      { exerciseId: '0192', sets: 3, reps: 15, note: '沉肩别耸肩，手肘微屈平抬' },
      { exerciseId: '1723', sets: 3, reps: 12, note: '大臂贴住身体，小臂压到底' },
    ],
    extraUpper: { exerciseId: '0592', sets: 3, reps: 12, note: '大臂贴实斜托，下放别猛甩到底' },
    extraBack: { exerciseId: '0602', sets: 3, reps: 15, note: '轻重量反向飞鸟，练肩后束' },
  },
  upper_b: {
    title: '上肢 B · 上胸与背宽',
    desc: '上斜推 · 高位下拉 · 后束 · 二头',
    stretch: 'upper',
    core: [
      { exerciseId: '0314', sets: 4, reps: 10, note: '上斜角度主练上胸，下放稳住节奏' },
      { exerciseId: '0198', sets: 4, reps: 10, note: '挺胸拉到锁骨上方，别靠后仰猛拽' },
      { exerciseId: '0602', sets: 3, reps: 15, note: '沉肩往两侧打开，后束发力' },
      { exerciseId: '0190', sets: 3, reps: 12, note: '弯举到顶停半秒，慢慢放回' },
    ],
    extraUpper: { exerciseId: '0289', sets: 3, reps: 10, note: '后背贴稳靠背，往上推别塌腰' },
    extraBack: { exerciseId: '1349', sets: 3, reps: 10, note: '胸口贴垫，集中练中背' },
  },
  lower_a: {
    title: '下肢 A · 大腿前侧为主',
    desc: '蹬腿 · 腿弯举 · 腿屈伸 · 核心',
    stretch: 'legs',
    core: [
      { exerciseId: '0740', sets: 4, reps: 10, note: '双脚与肩同宽踩稳，下放到大小腿约 90°' },
      { exerciseId: '0599', sets: 3, reps: 12, note: '往下勾到底停半秒，慢放回来' },
      { exerciseId: '0585', sets: 3, reps: 12, note: '踢直停一下，慢放别让配重片乱撞' },
      { exerciseId: '0826', sets: 3, reps: 15, weight: 0, note: '下腹发力带动骨盆往上卷' },
    ],
    extraLower: { exerciseId: '0594', sets: 3, reps: 15, note: '前脚掌踩稳，脚跟落到底再踮高' },
  },
  lower_b: {
    title: '下肢 B · 臀腿后侧为主',
    desc: '硬拉 · 深蹲 · 臀中肌 · 核心',
    stretch: 'legs_post',
    core: [
      { exerciseId: '0432', sets: 4, reps: 10, note: '腰背打直，屁股往后推到大腿后侧拉紧' },
      { exerciseId: '0743', sets: 3, reps: 10, note: '后背贴紧滑架，膝盖顺着脚尖方向蹲' },
      { exerciseId: '0597', sets: 3, reps: 15, note: '坐稳往两侧推开，练臀部外侧' },
      { exerciseId: '1452', sets: 3, reps: 15, note: '呼气上身往下卷，收紧腹肌' },
    ],
    extraLower: { exerciseId: '2286', sets: 3, reps: 12, note: '肚子收紧别塌腰，单腿往后蹬' },
  },
  full_a: {
    title: '全身综合 A',
    desc: '蹬腿 · 推胸 · 下拉 · 侧平举',
    stretch: 'full',
    core: [
      { exerciseId: '0740', sets: 3, reps: 10, note: '下背贴紧靠垫，推到顶膝盖留一点微屈' },
      { exerciseId: '0576', sets: 3, reps: 10, note: '肩膀贴稳靠背，匀速推起' },
      { exerciseId: '0198', sets: 3, reps: 10, note: '挺胸沉肩，拉到锁骨前侧' },
      { exerciseId: '0192', sets: 3, reps: 15, note: '手扶立柱沉肩，抬到与肩同高' },
    ],
    extraUpper: { exerciseId: '1723', sets: 3, reps: 12, note: '大臂贴住身体，小臂下压伸直' },
    extraBack: { exerciseId: '0602', sets: 3, reps: 15, note: '轻重量反向飞鸟，练肩后束' },
    extraLower: { exerciseId: '0599', sets: 3, reps: 12, note: '勾腿到底停半秒，练大腿后侧' },
  },
  full_b: {
    title: '全身综合 B',
    desc: '硬拉 · 上斜推 · 划船 · 核心',
    stretch: 'full',
    core: [
      { exerciseId: '0432', sets: 3, reps: 10, note: '腰背打直，哑铃贴腿下放' },
      { exerciseId: '0314', sets: 3, reps: 10, note: '上斜角度兼顾上胸和肩前侧' },
      { exerciseId: '0208', sets: 3, reps: 10, note: '坐稳挺背，拉到底夹紧肩胛骨' },
      { exerciseId: '0826', sets: 3, reps: 15, weight: 0, note: '卷起骨盆抬腿，别靠晃动借力' },
    ],
    extraUpper: { exerciseId: '0190', sets: 3, reps: 12, note: '大臂夹紧身体，单臂绳索弯举' },
    extraBack: { exerciseId: '1349', sets: 3, reps: 10, note: '胸口贴稳靠垫，加练中背' },
    extraLower: { exerciseId: '0597', sets: 3, reps: 15, note: '坐姿髋外展，练臀部外侧' },
  },
};

// 纯自重池
const BODYWEIGHT_POOL = {
  pull: {
    title: '拉 · 引体与背部',
    desc: '水平引体 · 反向划船 · 核心',
    stretch: 'pull',
    core: [
      { exerciseId: '0570', sets: 4, reps: 10, weight: 0, note: '屈膝好发力，胸口尽量贴向横杆' },
      { exerciseId: '0499', sets: 4, reps: 12, weight: 0, note: '身体绷直不塌腰，拉起夹紧中背' },
      { exerciseId: '0872', sets: 3, reps: 15, weight: 0, note: '下腹发力把屁股微微卷离垫面' },
      { exerciseId: '0464', sets: 3, reps: 45, weight: 0, note: '收腹夹臀，头肩背臀保持一条直线' },
    ],
    extraUpper: { exerciseId: '0651', sets: 3, reps: 8, weight: 0, note: '先沉肩再往上拉，别晃腿借力' },
  },
  push: {
    title: '推 · 俯卧撑与臂屈伸',
    desc: '俯卧撑 · 垫高俯卧撑 · 臂屈伸',
    stretch: 'push',
    core: [
      { exerciseId: 'drv-push-ups', sets: 4, reps: 12, weight: 0, note: '身体成一直线，大臂与身体约呈 45°' },
      { exerciseId: '1274', sets: 3, reps: 10, weight: 0, note: '双手垫高一点，下放更深更能拉到胸肌' },
      { exerciseId: '0259', sets: 3, reps: 10, weight: 0, note: '双手与肩同宽贴肘下放，主练三头' },
      { exerciseId: 'drv-bench-dips', sets: 3, reps: 12, weight: 0, note: '后背贴近凳子边缘上下屈伸' },
    ],
    extraUpper: { exerciseId: '0493', sets: 3, reps: 15, weight: 0, note: '手扶高台做俯卧撑，慢下快推' },
  },
  legs: {
    title: '腿 · 徒手臀腿核心',
    desc: '徒手深蹲 · 臀桥 · 核心',
    stretch: 'legs',
    core: [
      { exerciseId: 'drv-squat', sets: 4, reps: 20, weight: 0, note: '慢下快起，蹲到底停 1 秒再起' },
      { exerciseId: 'drv-hip-raise-bridge', sets: 4, reps: 18, weight: 0, note: '脚跟踩实往上顶，到顶夹紧臀部停 2 秒' },
      { exerciseId: '0668', sets: 3, reps: 12, weight: 0, note: '双手在身后撑稳，把髋往上顶平' },
      { exerciseId: 'drv-leg-raise-hip-lift', sets: 3, reps: 15, weight: 0, note: '慢放双腿，下背尽量贴住垫子' },
    ],
    extraLower: { exerciseId: 'drv-jump-step-up', sets: 3, reps: 12, weight: 0, note: '全脚掌踩稳台阶，左右交替蹬起' },
  },
  upper_a: {
    title: '上肢 A · 推拉均衡',
    desc: '俯卧撑 · 水平引体 · 臂屈伸 · 卷腹',
    stretch: 'upper',
    core: [
      { exerciseId: 'drv-push-ups', sets: 4, reps: 12, weight: 0, note: '稳住核心不塌腰，匀速完成' },
      { exerciseId: '0570', sets: 4, reps: 10, weight: 0, note: '胸口往横杆贴，平衡推拉肌力' },
      { exerciseId: 'drv-bench-dips', sets: 3, reps: 12, weight: 0, note: '屁股贴近凳沿，主练手臂后侧' },
      { exerciseId: '0274', sets: 3, reps: 18, weight: 0, note: '呼气把肩胛骨卷离地面就行，别抱头硬掰' },
    ],
    extraUpper: { exerciseId: '1274', sets: 3, reps: 10, weight: 0, note: '双手垫高，下放幅度更充分' },
  },
  upper_b: {
    title: '上肢 B · 窄推与中背',
    desc: '窄距俯卧撑 · 反向划船 · 侧腹',
    stretch: 'upper',
    core: [
      { exerciseId: '0259', sets: 4, reps: 10, weight: 0, note: '手肘贴近身体两侧下放' },
      { exerciseId: '0499', sets: 4, reps: 12, weight: 0, note: '拉起时夹紧肩胛骨，练中背' },
      { exerciseId: '0493', sets: 3, reps: 15, weight: 0, note: '手扶稳固台面，保持匀速节奏' },
      { exerciseId: '0985', sets: 3, reps: 16, weight: 0, note: '左右交替转体，练腹部两侧' },
    ],
    extraUpper: { exerciseId: '2327', sets: 3, reps: 8, weight: 0, note: '反握引体，背和二头一起发力' },
  },
  lower_a: {
    title: '下肢 A · 大腿与核心',
    desc: '慢速深蹲 · 交替蹬阶 · 举腿',
    stretch: 'legs',
    core: [
      { exerciseId: 'drv-squat', sets: 4, reps: 20, weight: 0, note: '数 3 秒慢慢往下蹲，大腿前侧更吃力' },
      { exerciseId: 'drv-jump-step-up', sets: 3, reps: 12, weight: 0, note: '踩实台面再蹬直，注意稳住膝盖' },
      { exerciseId: 'drv-leg-raise-hip-lift', sets: 3, reps: 15, weight: 0, note: '下腹发力控制抬放，别猛砸腿' },
      { exerciseId: '0274', sets: 3, reps: 20, weight: 0, note: '卷起上背收紧腹肌' },
    ],
    extraLower: { exerciseId: 'drv-hip-raise-bridge', sets: 3, reps: 18, weight: 0, note: '顶到最高处夹臀停一下' },
  },
  lower_b: {
    title: '下肢 B · 臀腿后侧',
    desc: '臀桥 · 反向臀桥 · 深蹲 · 核心',
    stretch: 'legs_post',
    core: [
      { exerciseId: 'drv-hip-raise-bridge', sets: 4, reps: 20, weight: 0, note: '到顶夹紧臀部停 2 秒，别顶肚子反弓腰' },
      { exerciseId: '0668', sets: 3, reps: 12, weight: 0, note: '双手后撑往上顶髋，同时展开肩前侧' },
      { exerciseId: 'drv-squat', sets: 3, reps: 18, weight: 0, note: '站距比肩稍宽，脚尖自然朝外' },
      { exerciseId: '0872', sets: 3, reps: 15, weight: 0, note: '卷动骨盆练下腹' },
    ],
    extraLower: { exerciseId: '0985', sets: 3, reps: 20, weight: 0, note: '转体卷腹收紧侧腰' },
  },
  full_a: {
    title: '全身综合 A',
    desc: '深蹲 · 俯卧撑 · 水平引体 · 卷腹',
    stretch: 'full',
    core: [
      { exerciseId: 'drv-squat', sets: 4, reps: 18, weight: 0, note: '膝盖顺脚尖方向蹲，脚跟踩稳' },
      { exerciseId: 'drv-push-ups', sets: 4, reps: 12, weight: 0, note: '收紧腰腹，手肘往斜后方放' },
      { exerciseId: '0570', sets: 4, reps: 10, weight: 0, note: '沉肩后拉，胸口贴向横杆' },
      { exerciseId: '0872', sets: 3, reps: 15, weight: 0, note: '下腹卷起尾骨，慢放还原' },
    ],
    extraUpper: { exerciseId: 'drv-bench-dips', sets: 3, reps: 12, weight: 0, note: '加练三头臂屈伸' },
    extraLower: { exerciseId: 'drv-hip-raise-bridge', sets: 3, reps: 18, weight: 0, note: '加练垫上臀桥' },
  },
  full_b: {
    title: '全身综合 B',
    desc: '臀桥 · 垫高俯卧撑 · 反向划船 · 举腿',
    stretch: 'full',
    core: [
      { exerciseId: 'drv-hip-raise-bridge', sets: 4, reps: 18, weight: 0, note: '脚跟发力顶髋，到顶夹臀停顿' },
      { exerciseId: '1274', sets: 3, reps: 10, weight: 0, note: '双手垫高下放，把胸肌充分拉开' },
      { exerciseId: '0499', sets: 3, reps: 12, weight: 0, note: '身体保持直线，拉起夹背' },
      { exerciseId: 'drv-leg-raise-hip-lift', sets: 3, reps: 15, weight: 0, note: '慢放双腿，下背别悬空拱起' },
    ],
    extraUpper: { exerciseId: '0259', sets: 3, reps: 10, weight: 0, note: '加练窄距俯卧撑' },
    extraLower: { exerciseId: 'drv-squat', sets: 3, reps: 20, weight: 0, note: '加练徒手深蹲' },
  },
};

// 根据用户勾选的居家具体器材（哑铃 / 杠铃 / 健身椅 / 引体单杠 / 弹力带）动态组装居家动作池
function buildHomePool(homeEquip) {
  const eq = new Set(Array.isArray(homeEquip) ? homeEquip : ['dumbbell']);
  const hasDb = eq.has('dumbbell');
  const hasBb = eq.has('barbell');
  const hasBench = eq.has('bench');
  const hasBar = eq.has('pullup');
  const hasBand = eq.has('band');

  // 若一件负重器材都没勾，回退到纯自重（叠加单杠/弹力带加成）
  if (!hasDb && !hasBb) {
    const base = JSON.parse(JSON.stringify(BODYWEIGHT_POOL));
    if (hasBar) {
      base.pull.core[0] = { exerciseId: '0651', sets: 4, reps: 8, weight: 0, note: '先沉肩再往上拉，稳住别晃腿' };
      base.upper_b.core[0] = { exerciseId: '2327', sets: 4, reps: 8, weight: 0, note: '反握引体，背和二头一起练' };
    }
    if (hasBand) {
      base.pull.core[2] = { exerciseId: '1022', sets: 3, reps: 15, weight: 0, note: '弹力带往后拉开，练上背和后束' };
      base.push.extraUpper = { exerciseId: 'drv-band-high-fly', sets: 3, reps: 15, weight: 0, note: '弹力带身前合拢，挤一下胸肌' };
      base.legs.extraLower = { exerciseId: '3006', sets: 3, reps: 18, weight: 0, note: '弹力带套腿往外展，练臀中肌' };
    }
    return base;
  }

  // 有哑铃或杠铃：严格校验是否有健身椅（无凳绝不排卧推凳动作！）
  const chestMain = hasBench
    ? hasDb
      ? { exerciseId: '0340', sets: 4, reps: 10, note: '掌心相对握哑铃，对肩和手腕更友好' }
      : { exerciseId: '0025', sets: 4, reps: 10, note: '沉肩收紧肩胛骨，手腕立直稳推' }
    : { exerciseId: 'drv-push-ups', sets: 4, reps: 12, weight: 0, note: '收紧腰腹，标准俯卧撑练胸' };

  const chestSec = hasBench
    ? hasDb
      ? { exerciseId: '0314', sets: 4, reps: 10, note: '凳子调 30° 左右，主练上胸' }
      : { exerciseId: '0047', sets: 4, reps: 10, note: '上斜杠铃卧推，主练上胸' }
    : { exerciseId: '1274', sets: 3, reps: 12, weight: 0, note: '双手垫高一点，增加胸肌下放幅度' };

  const shoulderPress = hasDb
    ? hasBench
      ? { exerciseId: '0289', sets: 3, reps: 10, note: '后背贴紧靠背，往上推别耸肩' }
      : { exerciseId: '0361', sets: 3, reps: 10, note: '收紧臀腹站稳，左右交替推肩' }
    : { exerciseId: '0553', sets: 4, reps: 8, note: '夹臀收腹别塌腰，站姿杠铃推举' };

  const latRaise = hasDb
    ? { exerciseId: '0334', sets: 3, reps: 15, note: '手肘微屈别耸肩，抬到与肩同高' }
    : { exerciseId: '0123', sets: 3, reps: 12, note: '握距比肩略宽，顺着身体提到胸口' };

  const tricepsIso = hasDb
    ? { exerciseId: '0306', sets: 3, reps: 12, note: '大臂贴耳侧不动，单手颈后臂屈伸' }
    : { exerciseId: '0259', sets: 3, reps: 12, weight: 0, note: '窄距贴肘俯卧撑，主练三头' };

  const rowPrimary = hasBb
    ? { exerciseId: '0027', sets: 4, reps: 10, note: '俯身挺直腰背，杠铃贴腿拉向下腹' }
    : { exerciseId: '0293', sets: 4, reps: 10, note: '俯身稳住腰背，双臂贴身往后拉' };

  const rowSecondary = hasBar
    ? { exerciseId: '0651', sets: 4, reps: 8, weight: 0, note: '单杠正握引体，练背阔宽度' }
    : hasDb && hasBench
      ? { exerciseId: '0327', sets: 4, reps: 10, note: '胸口趴稳斜凳，不伤腰专注夹背' }
      : hasDb
        ? { exerciseId: '0293', sets: 4, reps: 12, note: '慢放到底把背拉开，再贴身拉起' }
        : { exerciseId: '0499', sets: 3, reps: 12, weight: 0, note: '身体成直线，反向划船练中背' };

  const rearDelt = hasDb
    ? { exerciseId: '0377', sets: 3, reps: 15, note: '俯身手肘往外打开拉起，练肩后束' }
    : hasBand
      ? { exerciseId: '1022', sets: 3, reps: 15, weight: 0, note: '弹力带往后拉开，练肩后束' }
      : { exerciseId: '0075', sets: 3, reps: 12, note: '俯身用轻重量往两侧提拉后束' };

  const curlIso = hasDb
    ? { exerciseId: '0294', sets: 3, reps: 12, note: '大臂贴住肋骨，别晃腰甩铃' }
    : { exerciseId: '0031', sets: 3, reps: 10, note: '站稳别晃腰，杠铃慢起慢放' };

  const squatMain = hasDb
    ? { exerciseId: '1760', sets: 4, reps: 12, note: '双手捧铃贴在胸前，挺胸往下蹲' }
    : { exerciseId: '1435', sets: 4, reps: 10, note: '吸气绷紧腰腹，膝盖顺脚尖方向蹲' };

  const hingeMain = hasDb
    ? { exerciseId: '0432', sets: 4, reps: 10, note: '屁股往后推，哑铃贴腿下放到后侧拉紧' }
    : { exerciseId: '0116', sets: 4, reps: 10, note: '腰背打直，杠铃贴腿下放做直腿硬拉' };

  const legSec = hasDb
    ? { exerciseId: '0336', sets: 3, reps: 10, note: '前后跨步下蹲，前脚全脚掌踩稳蹬起' }
    : { exerciseId: '0054', sets: 3, reps: 10, note: '上身稳住，前脚踩实做杠铃弓步蹲' };

  const legExtra = hasDb
    ? { exerciseId: 'new-dumbbell-sumo-squat', sets: 3, reps: 12, note: '宽站距脚尖朝外，兼顾臀部和大腿内侧' }
    : { exerciseId: 'drv-hip-raise-bridge', sets: 3, reps: 18, weight: 0, note: '垫上臀桥，到顶夹紧臀部停 2 秒' };

  return {
    pull: {
      title: '拉 · 背与二头',
      desc: '划船/引体 · 后束 · 二头',
      stretch: 'pull',
      core: [rowPrimary, rowSecondary, rearDelt, curlIso],
      extraUpper: hasDb ? { exerciseId: '0298', sets: 3, reps: 12, note: '大拇指朝上锤式弯举，兼顾小臂' } : curlIso,
      extraBack: rearDelt,
    },
    push: {
      title: '推 · 胸肩三头',
      desc: '胸推 · 推肩 · 侧平举 · 三头',
      stretch: 'push',
      core: [chestMain, shoulderPress, latRaise, tricepsIso],
      extraUpper: chestSec,
      extraBack: rearDelt,
    },
    legs: {
      title: '腿 · 臀腿核心',
      desc: '深蹲 · 硬拉 · 单腿 · 核心',
      stretch: 'legs',
      core: [
        squatMain,
        hingeMain,
        legSec,
        { exerciseId: '0872', sets: 3, reps: 15, weight: 0, note: '下腹发力把屁股微微卷起' },
      ],
      extraLower: legExtra,
    },
    upper_a: {
      title: '上肢 A · 胸背推拉',
      desc: '胸推 · 划船 · 侧平举 · 臂屈伸',
      stretch: 'upper',
      core: [chestMain, rowPrimary, latRaise, tricepsIso],
      extraUpper: curlIso,
      extraBack: rearDelt,
    },
    upper_b: {
      title: '上肢 B · 推肩与背宽',
      desc: '推肩 · 拉背 · 上胸 · 弯举',
      stretch: 'upper',
      core: [shoulderPress, rowSecondary, chestSec, curlIso],
      extraUpper: rearDelt,
      extraBack: rearDelt,
    },
    lower_a: {
      title: '下肢 A · 深蹲为主',
      desc: '深蹲 · 弓步蹲 · 提踵 · 核心',
      stretch: 'legs',
      core: [
        squatMain,
        legSec,
        hasDb
          ? { exerciseId: '0417', sets: 3, reps: 15, note: '踮起脚尖到最高处停 1 秒' }
          : { exerciseId: 'drv-hip-raise-bridge', sets: 3, reps: 18, weight: 0, note: '到顶夹紧臀部停一下' },
        { exerciseId: '0872', sets: 3, reps: 15, weight: 0, note: '下腹发力卷动骨盆' },
      ],
      extraLower: legExtra,
    },
    lower_b: {
      title: '下肢 B · 硬拉与臀部',
      desc: '硬拉 · 宽距深蹲 · 臀桥 · 侧腹',
      stretch: 'legs_post',
      core: [
        hingeMain,
        legExtra,
        { exerciseId: 'drv-hip-raise-bridge', sets: 3, reps: 18, weight: 0, note: '脚跟踩实往上顶髋' },
        { exerciseId: '0985', sets: 3, reps: 16, weight: 0, note: '左右交替肘碰膝，练侧腹' },
      ],
      extraLower: legSec,
    },
    full_a: {
      title: '全身综合 A',
      desc: '深蹲 · 胸推 · 划船 · 侧平举',
      stretch: 'full',
      core: [squatMain, chestMain, rowPrimary, latRaise],
      extraUpper: curlIso,
      extraBack: rearDelt,
      extraLower: legSec,
    },
    full_b: {
      title: '全身综合 B',
      desc: '硬拉 · 推肩 · 拉背 · 核心',
      stretch: 'full',
      core: [
        hingeMain,
        shoulderPress,
        rowSecondary,
        { exerciseId: '0872', sets: 3, reps: 15, weight: 0, note: '反向卷腹练下腹' },
      ],
      extraUpper: tricepsIso,
      extraBack: rearDelt,
      extraLower: legExtra,
    },
  };
}

function getSplitSpec(dayCount) {
  switch (dayCount) {
    case 1:
      return { slots: ['full_a'], summary: '每周 1 练 · 全身' };
    case 2:
      return { slots: ['full_a', 'full_b'], summary: '每周 2 练 · 全身 A / B' };
    case 3:
      return { slots: ['pull', 'push', 'legs'], summary: '每周 3 练 · 拉 / 推 / 腿' };
    case 4:
      return { slots: ['upper_a', 'lower_a', 'upper_b', 'lower_b'], summary: '每周 4 练 · 上肢 / 下肢' };
    case 5:
      return { slots: ['push', 'pull', 'legs', 'upper_a', 'lower_b'], summary: '每周 5 练 · 推拉腿 + 上下肢' };
    case 6:
      return { slots: ['pull', 'push', 'legs', 'pull', 'push', 'legs'], summary: '每周 6 练 · 推拉腿两轮' };
    default:
      return {
        slots: ['pull', 'push', 'legs', 'upper_a', 'lower_b', 'full_a', 'recovery'],
        summary: '每周 7 练 · 含 1 天拉伸',
      };
  }
}

const DEFAULT_PLAN_PREFS = {
  gender: 'male',
  age: 28,
  heightCm: '',
  weightKg: '',
  targetWeightKg: '',
  goal: 'hypertrophy', // 'hypertrophy' | 'strength' | 'fat_loss' | 'posture'
  experience: 'intermediate', // 'beginner' | 'intermediate' | 'advanced'
  pushups: '6_15', // '0_5' | '6_15' | '16_30' | '30_plus'
  place: 'gym', // 'gym' | 'home' | 'bodyweight'
  homeEquip: ['dumbbell', 'bench'], // 居家细选器材
  weekdays: [1, 3, 5],
  focus: 'balanced', // 'balanced' | 'upper' | 'back_posture' | 'lower'
  durationPref: 'normal', // 'short' | 'normal' | 'long'
  withStretch: true,
};

function normalizePrefs(raw) {
  const p = Object.assign({}, DEFAULT_PLAN_PREFS, raw || {});
  if (p.place === 'home_weights') p.place = 'home';
  const days = Array.from(
    new Set((Array.isArray(p.weekdays) ? p.weekdays : [1, 3, 5]).map(Number).filter((d) => d >= 1 && d <= 7))
  ).sort((a, b) => a - b);
  const homeEquip = Array.isArray(p.homeEquip) && p.homeEquip.length > 0 ? p.homeEquip : ['dumbbell'];
  return {
    gender: p.gender === 'female' ? 'female' : 'male',
    age: p.age ? Number(p.age) || '' : '',
    heightCm: p.heightCm ? Number(p.heightCm) || '' : '',
    weightKg: p.weightKg ? Number(p.weightKg) || '' : '',
    targetWeightKg: p.targetWeightKg ? Number(p.targetWeightKg) || '' : '',
    goal: ['hypertrophy', 'strength', 'fat_loss', 'posture'].includes(p.goal) ? p.goal : 'hypertrophy',
    experience: ['beginner', 'intermediate', 'advanced'].includes(p.experience) ? p.experience : 'intermediate',
    pushups: ['0_5', '6_15', '16_30', '30_plus'].includes(p.pushups) ? p.pushups : '6_15',
    place: ['gym', 'home', 'bodyweight'].includes(p.place) ? p.place : 'gym',
    homeEquip,
    weekdays: days.length > 0 ? days : [1, 3, 5],
    focus: ['balanced', 'upper', 'back_posture', 'lower'].includes(p.focus) ? p.focus : 'balanced',
    durationPref: ['short', 'normal', 'long'].includes(p.durationPref) ? p.durationPref : 'normal',
    withStretch: p.withStretch !== false,
  };
}

function cloneItem(it) {
  return JSON.parse(JSON.stringify(it));
}

// 为每个生成的动作注入个性化起始重量 + 组数次数微调 + 大小休息秒数
function enrichPlanItem(rawItem, prefs, exMap) {
  const item = cloneItem(rawItem);
  const meta = exMap ? exMap[item.exerciseId] : null;
  const timed = meta ? isTimedCat(meta.cat) : item.sec !== undefined;
  const rests = getDefaultRests(meta || { name: '', cat: timed ? 'stretch' : 'chest' }, prefs.goal);

  item.restSec = rests.restSec;
  item.transRestSec = rests.transRestSec;

  if (timed) return item;

  // 时长偏好调整组数
  if (prefs.durationPref === 'short') {
    item.sets = Math.max(2, (item.sets || 3) - 1);
  } else if (prefs.durationPref === 'long' && (item.sets || 3) < 4) {
    item.sets = (item.sets || 3) + 1;
  }

  // 训练目标微调次数区间
  if (item.weight !== 0) {
    if (prefs.goal === 'strength' && item.reps <= 10) {
      item.reps = 8;
    } else if (prefs.goal === 'fat_loss' && item.reps >= 10) {
      item.reps = Math.min(15, item.reps + 2);
    }
    const estW = estimateInitialWeight(item.exerciseId, prefs);
    if (estW > 0) item.weight = estW;
  }
  return item;
}

function buildWeeklyPlan(rawPrefs, exMap) {
  const prefs = normalizePrefs(rawPrefs);
  let pool = GYM_POOL;
  if (prefs.place === 'bodyweight') pool = BODYWEIGHT_POOL;
  else if (prefs.place === 'home') pool = buildHomePool(prefs.homeEquip);

  const spec = getSplitSpec(prefs.weekdays.length);
  const slotTotals = {};
  spec.slots.forEach((sk) => {
    slotTotals[sk] = (slotTotals[sk] || 0) + 1;
  });
  const slotSeen = {};

  return prefs.weekdays.map((dow, idx) => {
    const slotKey = spec.slots[idx];
    slotSeen[slotKey] = (slotSeen[slotKey] || 0) + 1;

    if (slotKey === 'recovery') {
      return {
        id: `tpl_plan_${dow}`,
        name: '全身拉伸恢复',
        desc: '全身拉伸放松',
        weekday: dow,
        generated: true,
        items: STRETCH_PACKS.recovery.map((st) => enrichPlanItem(st, prefs, exMap)),
      };
    }

    const bp = pool[slotKey];
    let rawList = bp.core.map(cloneItem);

    // 紧凑 30 分钟模式精简为前 3 个核心动作
    if (prefs.durationPref === 'short') {
      if (rawList.length > 3) rawList = rawList.slice(0, 3);
    }

    // 按侧重方向追加专项动作（避免重复动作 ID）
    const existingIds = new Set(rawList.map((x) => x.exerciseId));
    const maybePush = (cand) => {
      if (cand && !existingIds.has(cand.exerciseId)) {
        rawList.push(cloneItem(cand));
        existingIds.add(cand.exerciseId);
      }
    };

    if (prefs.focus === 'upper') maybePush(bp.extraUpper);
    else if (prefs.focus === 'back_posture' || prefs.goal === 'posture') maybePush(bp.extraBack || bp.extraUpper);
    else if (prefs.focus === 'lower') maybePush(bp.extraLower);
    else if (prefs.durationPref === 'long') maybePush(bp.extraUpper || bp.extraLower);

    if (prefs.withStretch && bp.stretch && STRETCH_PACKS[bp.stretch]) {
      STRETCH_PACKS[bp.stretch].forEach((st) => rawList.push(cloneItem(st)));
    }

    let planName = bp.title;
    if (slotTotals[slotKey] > 1) {
      const tag = slotSeen[slotKey] === 1 ? 'A' : 'B';
      const parts = bp.title.split(' · ');
      planName = parts.length > 1 ? `${parts[0]} ${tag} · ${parts.slice(1).join(' · ')}` : `${bp.title} ${tag}`;
    }

    return {
      id: `tpl_plan_${dow}`,
      name: planName,
      desc: bp.desc,
      weekday: dow,
      generated: true,
      items: rawList.map((it) => enrichPlanItem(it, prefs, exMap)),
    };
  });
}

module.exports = {
  DOW_LABELS,
  DEFAULT_PLAN_PREFS,
  getSplitSpec,
  normalizePrefs,
  estimateInitialWeight,
  buildWeeklyPlan,
};
