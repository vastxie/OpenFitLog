// 训练中和计划编辑里填组数 / 次数 / 重量 / 时长时，内置数字键盘的设置（范围、小数位、快捷加减的步长）
// 两处共用，保证同一种数值在哪里改都是同一个键盘
const { isTimedCat, timedUnit } = require('./config');

// field: 'weight' | 'reps' | 'sets' | 'val'（拉伸 / 有氧的时长，按显示单位：秒或分钟）
// value: 当前显示的值；返回传给 <num-pad> 的属性（不含 show）
function padFor(field, meta, value, title) {
  const base = { title, value, min: 0, max: 999, decimals: 0, allowEmpty: true, steps: [], step: 0, stepKey: '' };
  if (field === 'weight') {
    const equip = (meta && meta.equip) || '';
    return Object.assign(base, {
      unit: 'kg',
      max: 500,
      decimals: 1,
      steps: [0.5, 1, 2, 5],
      step: equip === '哑铃' ? 1 : equip === '杠铃' ? 5 : 2,
      // 不同器械各记各的步长
      stepKey: `w_${equip || 'other'}`,
    });
  }
  if (field === 'reps') {
    return Object.assign(base, { unit: '次', steps: [1], step: 1 });
  }
  if (field === 'sets') {
    return Object.assign(base, { unit: '组', min: 1, max: 20, allowEmpty: false, steps: [1], step: 1 });
  }
  const unit = meta && isTimedCat(meta.cat) ? timedUnit(meta.cat) : timedUnit('stretch');
  const isMin = unit.factor > 1;
  return Object.assign(base, {
    unit: unit.label,
    decimals: isMin ? 1 : 0,
    steps: isMin ? [1, 5, 10] : [5, 15, 30],
    step: isMin ? 5 : 15,
    stepKey: isMin ? 't_min' : 't_sec',
  });
}

module.exports = { padFor };
