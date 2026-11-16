// 日期、日历矩阵与时长格式化

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function getTodayStr() {
  return formatDate(new Date());
}

function addDays(dateStr, delta) {
  const dt = parseDate(dateStr);
  dt.setDate(dt.getDate() + delta);
  return formatDate(dt);
}

function addMonths(dateStr, delta) {
  const dt = parseDate(dateStr);
  return formatDate(new Date(dt.getFullYear(), dt.getMonth() + delta, 1));
}

// 周一为每周第一天
function getMonday(dateStr) {
  const dt = parseDate(dateStr);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return formatDate(dt);
}

function buildCell(dt, month, trainedSet, selectedDateStr, todayStr) {
  const ds = formatDate(dt);
  return {
    dateStr: ds,
    dayNum: dt.getDate(),
    inMonth: month === null || dt.getMonth() === month,
    isToday: ds === todayStr,
    isSelected: ds === selectedDateStr,
    isTrained: trainedSet.has(ds),
  };
}

function buildWeekDays(anchorDateStr, trainedSet, selectedDateStr) {
  const mondayStr = getMonday(anchorDateStr);
  const todayStr = getTodayStr();
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    days.push(buildCell(parseDate(addDays(mondayStr, i)), null, trainedSet, selectedDateStr, todayStr));
  }
  return days;
}

// month: 1..12
function buildMonthDays(year, month, trainedSet, selectedDateStr) {
  const firstDay = new Date(year, month - 1, 1);
  const startDow = firstDay.getDay() === 0 ? 7 : firstDay.getDay();
  const lead = startDow - 1;
  const todayStr = getTodayStr();
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const dt = new Date(year, month - 1, 1 - lead + i);
    cells.push(buildCell(dt, month - 1, trainedSet, selectedDateStr, todayStr));
  }
  // 最后一行全不属于本月时裁掉
  return cells.slice(35).some((c) => c.inMonth) ? cells : cells.slice(0, 35);
}

// 1:05:20 或 32:10
function formatClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

// 11月15日 周日
function formatDayTitle(dateStr) {
  const dt = parseDate(dateStr);
  return `${dt.getMonth() + 1}月${dt.getDate()}日 ${WEEKDAYS[dt.getDay()]}`;
}

// 11月15日
function formatMonthDay(dateStr) {
  const dt = parseDate(dateStr);
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
}

// 返回 ISO 星期：1（周一）.. 7（周日）
function getIsoWeekday(dateStr) {
  const d = parseDate(dateStr).getDay();
  return d === 0 ? 7 : d;
}

// 千分位：33060 → 33,060（不依赖 toLocaleString，各端表现一致）
function formatThousands(n) {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = {
  formatThousands,
  pad2,
  formatDate,
  parseDate,
  getTodayStr,
  addDays,
  addMonths,
  getMonday,
  getIsoWeekday,
  buildWeekDays,
  buildMonthDays,
  formatClock,
  formatDayTitle,
  formatMonthDay,
};
