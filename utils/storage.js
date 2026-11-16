// 本地存储与统计
const { EXERCISES } = require('../data/exercises');
const {
  DOW_LABELS,
  DEFAULT_PLAN_PREFS,
  normalizePrefs,
  estimateInitialWeight,
  buildWeeklyPlan,
} = require('../data/default-templates');
const {
  isTimedCat,
  timedUnit,
  isCompoundExercise,
  getDefaultRests,
  API_BASE_URL,
  modalColors,
  getPartIcon,
  PART_NAMES,
} = require('./config');
const { formatDate, parseDate, addDays, getMonday, getIsoWeekday, getTodayStr } = require('./date');

const KEYS = {
  SEEDED: 'fitlog_v1_seeded',
  PROFILE: 'fitlog_v1_profile',
  FAVORITES: 'fitlog_v1_favorites',
  CUSTOM_EXERCISES: 'fitlog_v1_custom_exercises',
  TEMPLATES: 'fitlog_v1_custom_templates',
  WORKOUTS: 'fitlog_v1_workouts', // 旧版：全部训练存在一个 key 里，首次读取时迁移到按月分 key
  W_MONTHS: 'fitlog_v3_w_months', // 有记录的月份列表 ['2026-11', ...]
  WEIGHTS: 'fitlog_v1_weights', // Array<{ id, date, weightKg, note }>
  TPL_SEEDED: 'fitlog_v2_tpl_seeded',
  UNASSESSED_CLEANED: 'fitlog_v3_unassessed_cleaned',
  PLAN_PROMPTED: 'fitlog_v3_plan_prompted',
  ACTIVE: 'fitlog_v2_active', // { date, id } 进行中的训练
  DELETED: 'fitlog_v2_deleted', // 删除墓碑，防止多端合并把已删项复活
  SYNC_DIRTY: 'fitlog_v2_sync_dirty',
  SYNC_PREF: 'fitlog_v3_sync_pref', // 'on' | 'off'，未选择时为空
  SYNC_STATE: 'fitlog_v3_sync_state', // { at, ok }
};

// 训练记录按月分 key 存：fitlog_v3_w_2026-11 -> { [dateStr]: { date, sessions, extraLogs } }
// 单个 key 上限 1MB，拆开后不会随使用年限撞上限
const W_PREFIX = 'fitlog_v3_w_';

const USER_DATA_KEYS = new Set([
  KEYS.PROFILE,
  KEYS.FAVORITES,
  KEYS.CUSTOM_EXERCISES,
  KEYS.TEMPLATES,
  KEYS.WEIGHTS,
  KEYS.ACTIVE,
  KEYS.DELETED,
]);

function isUserDataKey(key) {
  return USER_DATA_KEYS.has(key) || key.indexOf(W_PREFIX) === 0;
}

let _suppressDirty = false;
const _changeListeners = [];

function onChange(fn) {
  if (typeof fn === 'function') _changeListeners.push(fn);
}

function notifyChange(urgent = false) {
  if (_suppressDirty) return;
  try {
    wx.setStorageSync(KEYS.SYNC_DIRTY, true);
  } catch (e) {}
  _changeListeners.forEach((fn) => {
    try {
      fn(urgent);
    } catch (e) {}
  });
}

const DEFAULT_PROFILE = {
  gender: 'male',
  age: '',
  heightCm: '',
  targetWeightKg: '',
  theme: 'ink',
};

// 超过这个时间没有任何操作，结束训练时按最后一次操作的时间算时长
const IDLE_CUTOFF_MS = 30 * 60 * 1000;
// 超过 3 小时未操作的进行中训练（如隔夜忘关），再次打开时自动收尾
const STALE_ACTIVE_MS = 3 * 60 * 60 * 1000;

function safeGet(key, fallback) {
  try {
    const val = wx.getStorageSync(key);
    return val === '' || val === undefined || val === null ? fallback : val;
  } catch (e) {
    return fallback;
  }
}

// 写入失败（通常是本机存储满了）要让用户知道，否则记录会悄悄丢失
let _writeFailAt = 0;

function reportWriteFail(key, e) {
  console.error('Storage write failed:', key, e);
  const now = Date.now();
  if (now - _writeFailAt < 10000) return;
  _writeFailAt = now;
  try {
    wx.showModal({
      title: '保存失败',
      content: '手机存储空间不足，清理微信存储空间后再试。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: modalColors().confirmColor,
    });
  } catch (err) {}
}

function safeSet(key, val) {
  try {
    wx.setStorageSync(key, val);
    if (isUserDataKey(key)) notifyChange(false);
    return true;
  } catch (e) {
    reportWriteFail(key, e);
    return false;
  }
}

function safeRemove(key) {
  try {
    wx.removeStorageSync(key);
    if (isUserDataKey(key)) notifyChange(false);
  } catch (e) {
    console.error('Storage remove failed:', key, e);
  }
}

function recordDeleted(bucket, id) {
  if (!id) return;
  const del = safeGet(KEYS.DELETED, {});
  const arr = Array.isArray(del[bucket]) ? del[bucket].filter((x) => x !== id) : [];
  arr.push(id);
  if (arr.length > 300) arr.splice(0, arr.length - 300);
  del[bucket] = arr;
  safeSet(KEYS.DELETED, del);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ensureSeeded() {
  _suppressDirty = true;
  try {
    if (!safeGet(KEYS.SEEDED, false)) {
      if (!safeGet(KEYS.FAVORITES, null)) {
        safeSet(KEYS.FAVORITES, [
          '0198', '0208', '0602', '0190',
          '0314', '0576', '0192', '1723',
          '0740', '0432', '0585', '0826',
        ]);
      }
      safeSet(KEYS.SEEDED, true);
    }

    // 清理旧版本在用户尚未做过评估前默认塞入的预设模板，改为在云同步决策后弹窗引导用户自己定制
    if (!safeGet(KEYS.UNASSESSED_CLEANED, false)) {
      const prof = safeGet(KEYS.PROFILE, {});
      if (!prof || !prof.planPrefs) {
        const list = safeGet(KEYS.TEMPLATES, []);
        const manualOnly = list.filter((t) => {
          if (!t) return false;
          const isAutoSeeded =
            t.generated === true ||
            (typeof t.id === 'string' && t.id.indexOf('tpl_plan_') === 0) ||
            LEGACY_PRESET_IDS.has(t.id);
          return !isAutoSeeded;
        });
        if (manualOnly.length !== list.length) {
          safeSet(KEYS.TEMPLATES, manualOnly);
        }
      }
      safeSet(KEYS.UNASSESSED_CLEANED, true);
    }
  } finally {
    _suppressDirty = false;
  }
}

// ---------- 偏好 ----------

function getProfile() {
  ensureSeeded();
  const prof = Object.assign({}, DEFAULT_PROFILE, safeGet(KEYS.PROFILE, {}));
  // 旧版的头像、昵称已移除，读到就丢掉，下次写入和同步时自然清除
  delete prof.avatarData;
  delete prof.nickname;
  delete prof.restSeconds;
  return prof;
}

// 是否做过计划评估：没做过时不给任何重量建议
function isAssessed() {
  return !!getProfile().planPrefs;
}

function markPlanPrompted() {
  try {
    wx.setStorageSync(KEYS.PLAN_PROMPTED, true);
  } catch (e) {}
}

// 若配置了云同步且用户已练过但尚未选择是否同步，等云同步面板处理完再弹；纯离线模式或首次进入无计划时直接引导
function shouldPromptPlan() {
  if (isCloudConfigured() && getSyncPref() === '' && getTrainedDateSet().size > 0) return false;
  if (safeGet(KEYS.PLAN_PROMPTED, false)) return false;
  return getTemplates().length === 0;
}

function updateProfile(patch) {
  const next = Object.assign({}, getProfile(), patch || {});
  safeSet(KEYS.PROFILE, next);
  return next;
}

// ---------- 动作与收藏 ----------

function getCustomExercises() {
  return safeGet(KEYS.CUSTOM_EXERCISES, []);
}

function addCustomExercise(name) {
  const clean = (name || '').trim();
  if (!clean) return null;
  const list = getCustomExercises();
  const item = {
    id: `custom_${Date.now()}`,
    name: clean,
    en: '',
    cat: 'custom',
    equip: '自建',
    target: '',
    m: '',
    f: '',
    cues: '',
    isCustom: true,
  };
  list.unshift(item);
  safeSet(KEYS.CUSTOM_EXERCISES, list);
  return item;
}

function deleteCustomExercise(id) {
  recordDeleted('customExercises', id);
  safeSet(KEYS.CUSTOM_EXERCISES, getCustomExercises().filter((x) => x.id !== id));
  safeSet(KEYS.FAVORITES, getFavorites().filter((x) => x !== id));
}

function getAllExercises() {
  ensureSeeded();
  return [...getCustomExercises(), ...EXERCISES];
}

function getExerciseMap() {
  const map = {};
  getAllExercises().forEach((ex) => {
    map[ex.id] = ex;
  });
  return map;
}

function getExerciseById(id) {
  return getExerciseMap()[id] || null;
}

function getFavorites() {
  ensureSeeded();
  return safeGet(KEYS.FAVORITES, []);
}

function toggleFavorite(exerciseId) {
  const favs = getFavorites();
  const idx = favs.indexOf(exerciseId);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.unshift(exerciseId);
  safeSet(KEYS.FAVORITES, favs);
  return favs;
}

// ---------- 模板与周期计划 ----------

const LEGACY_PRESET_IDS = new Set([
  'tpl_ppl_pull',
  'tpl_ppl_push',
  'tpl_ppl_legs',
  'tpl_upper_fallback',
  'tpl_home_dumbbell',
]);

const LEGACY_WEEKDAY = {
  tpl_ppl_pull: 1,
  tpl_ppl_push: 3,
  tpl_ppl_legs: 5,
};

const LEGACY_NOTE_FIXES = {
  'V 把对握护腕，后拉主动夹紧肩胛骨': 'V 把对握，拉到底夹紧肩胛骨',
  '轻重量沉肩，改善圆肩体态': '轻重量沉肩往后展，练肩后束',
  '大臂夹紧肋骨，保持绳索恒定张力': '大臂贴住身体，慢放别泄力',
  '手腕立直不后折，大臂呈 45°～60° 下放': '手腕立直，大臂与身体约呈 45°–60°',
  '握把齐胸口中下沿，肩胛骨贴实靠背': '握把对准胸口中下沿，肩膀贴住靠背',
  '手扶立柱沉肩，抬至与肩同高即可': '手扶立柱沉肩，抬到与肩同高就行',
  '固定大臂在肋骨旁，仅小臂下压伸直': '大臂夹在身体两侧不动，只伸直小臂',
  '下背紧贴靠垫不翘尾骨，推起膝微屈不锁紧': '下背贴紧靠垫别翘屁股，推到顶膝盖别锁死',
  '屈髋向后推臀，哑铃贴裤缝感受大腿后侧拉伸': '屁股往后推，哑铃顺着裤缝往下放',
  '膝窝对准器械转轴，顶峰停顿 1 秒': '膝盖对准器械转轴，踢直停 1 秒',
  '前臂撑稳托垫，卷动骨盆抬腿': '前臂撑稳，下腹发力把骨盆往上卷',
};

function sanitizeNote(s) {
  if (typeof s !== 'string') return '';
  const cleaned = s
    .replace(/\u4e13\u6cbb\u5706\u80a9\u5185\u6263/g, '练肩后束')
    .replace(/\u4e13\u6cbb/g, '改善');
  return LEGACY_NOTE_FIXES[cleaned] || cleaned;
}

const SHORT_PLAN_TITLES = {
  拉: '拉 · 背与二头',
  推: '推 · 胸肩三头',
  腿: '腿 · 臀腿核心',
  拉伸恢复: '全身拉伸恢复',
};

function normalizeTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return tpl;
  const copy = Object.assign({}, tpl);
  if (copy.desc) copy.desc = sanitizeNote(copy.desc);
  if (Array.isArray(copy.items)) {
    copy.items = copy.items.map((it) =>
      it && it.note ? Object.assign({}, it, { note: sanitizeNote(it.note) }) : it
    );
  }
  if (copy.weekday === undefined) {
    copy.weekday = LEGACY_WEEKDAY[copy.id] || 0;
  } else {
    copy.weekday = num(copy.weekday);
  }
  if (copy.generated === undefined) {
    copy.generated = copy.id.startsWith('tpl_plan_') || LEGACY_PRESET_IDS.has(copy.id);
  }
  if (copy.generated && typeof copy.name === 'string') {
    const stripped = copy.name.replace(/^周[一二三四五六日]\s*[·\-—]\s*/, '').trim();
    if (stripped) {
      copy.name = SHORT_PLAN_TITLES[stripped] || stripped;
    }
  }
  return copy;
}

function getTemplates() {
  ensureSeeded();
  return safeGet(KEYS.TEMPLATES, []).map(normalizeTemplate);
}

function getTemplateById(id) {
  return getTemplates().find((t) => t.id === id) || null;
}

function getPlannedTemplateForDate(dateStr) {
  const dow = getIsoWeekday(dateStr);
  return getTemplates().find((t) => t.weekday === dow) || null;
}

// 估算一套计划的训练耗时（分钟）：按每个动作自己的小休息 restSec 与换动作大休息 transRestSec 计算
function estimateTemplateMinutes(tpl, exMap) {
  if (!tpl || !Array.isArray(tpl.items)) return 0;
  const map = exMap || getExerciseMap();
  const goal = (getProfile().planPrefs && getProfile().planPrefs.goal) || 'hypertrophy';
  let totalSec = 0;
  let strengthCount = 0;
  const valid = tpl.items.filter((it) => map[it.exerciseId]);

  valid.forEach((it, idx) => {
    const meta = map[it.exerciseId];
    const defs = getDefaultRests(meta, goal);
    const smallRest = num(it.restSec) || defs.restSec;
    const bigRest = num(it.transRestSec) || defs.transRestSec;
    const sets = Math.max(1, Math.round(num(it.sets)) || 3);
    const isLast = idx === valid.length - 1;

    if (isTimedCat(meta.cat)) {
      const secPerSet = num(it.sec) || timedUnit(meta.cat).defaultSec;
      totalSec += sets * secPerSet + Math.max(0, sets - 1) * smallRest + (isLast ? 0 : 20);
    } else {
      strengthCount += 1;
      totalSec += sets * 42 + Math.max(0, sets - 1) * smallRest + (isLast ? 0 : bigRest);
    }
  });
  if (strengthCount > 0) totalSec += 90;
  return Math.max(3, Math.round(totalSec / 60));
}

// 估算进行中训练的剩余耗时（分钟）
function estimateRemainingMinutes(session, exMap) {
  if (!session || !Array.isArray(session.exercises)) return 0;
  const map = exMap || getExerciseMap();
  const goal = (getProfile().planPrefs && getProfile().planPrefs.goal) || 'hypertrophy';
  let remSec = 0;
  const list = session.exercises;
  list.forEach((ex, idx) => {
    const meta = map[ex.exerciseId];
    const defs = getDefaultRests(meta, goal);
    const smallRest = num(ex.restSec) || defs.restSec;
    const bigRest = num(ex.transRestSec) || defs.transRestSec;
    const timed = !!meta && isTimedCat(meta.cat);
    const undone = (ex.sets || []).filter((st) => !st.done);
    if (undone.length === 0) return;
    const hasFollowing = list.slice(idx + 1).some((nx) => (nx.sets || []).some((s) => !s.done));
    if (timed) {
      const defSec = meta ? timedUnit(meta.cat).defaultSec : 30;
      undone.forEach((st) => {
        remSec += num(st.sec) || defSec;
      });
      remSec += Math.max(0, undone.length - 1) * smallRest + (hasFollowing ? 20 : 0);
    } else {
      remSec += undone.length * 42 + Math.max(0, undone.length - 1) * smallRest + (hasFollowing ? bigRest : 0);
    }
  });
  return remSec <= 0 ? 0 : Math.max(1, Math.round(remSec / 60));
}

// 查找今天之后的下一个计划训练日（休息日提示用）
function getNextPlannedInfo(fromDateStr) {
  const tpls = getTemplates();
  const exMap = getExerciseMap();
  for (let offset = 1; offset <= 7; offset += 1) {
    const ds = addDays(fromDateStr, offset);
    const dow = getIsoWeekday(ds);
    const tpl = tpls.find((t) => t.weekday === dow);
    if (tpl) {
      return {
        dateStr: ds,
        dayLabel: offset === 1 ? '明天' : DOW_LABELS[dow],
        tpl,
        estMin: estimateTemplateMinutes(tpl, exMap),
      };
    }
  }
  return null;
}

function getPlanPrefs() {
  const prof = getProfile();
  return normalizePrefs(prof.planPrefs || DEFAULT_PLAN_PREFS);
}

// 重新生成周期计划：只替换之前生成的周期计划，保留手动自建计划，并同步身体资料
function applyGeneratedPlan(rawPrefs) {
  const prefs = normalizePrefs(rawPrefs);
  const exMap = getExerciseMap();
  const generated = buildWeeklyPlan(prefs, exMap);
  const existing = getTemplates();
  const manual = [];
  existing.forEach((t) => {
    if (t.generated) recordDeleted('templates', t.id);
    else manual.push(t);
  });
  const newIds = new Set(generated.map((t) => t.id));
  const del = safeGet(KEYS.DELETED, {});
  if (Array.isArray(del.templates)) {
    del.templates = del.templates.filter((id) => !newIds.has(id));
    safeSet(KEYS.DELETED, del);
  }
  const nextList = [...generated, ...manual];
  safeSet(KEYS.TEMPLATES, nextList);

  const profilePatch = { planPrefs: prefs, gender: prefs.gender };
  if (prefs.age) profilePatch.age = prefs.age;
  if (prefs.heightCm) profilePatch.heightCm = prefs.heightCm;
  if (prefs.targetWeightKg) profilePatch.targetWeightKg = prefs.targetWeightKg;
  updateProfile(profilePatch);

  // 若向导里填了当前体重且今天尚未记录体重，顺手记入首条体重基线
  if (prefs.weightKg && Number(prefs.weightKg) >= 25 && Number(prefs.weightKg) <= 250) {
    const logs = getWeightLogs();
    const today = getTodayStr();
    if (!logs.some((x) => x.date === today)) {
      addWeightLog({ date: today, weightKg: prefs.weightKg });
    }
  }

  markPlanPrompted();
  notifyChange(true);
  return generated;
}

function saveTemplate(tpl) {
  const list = getTemplates();
  const id = tpl.id || `tpl_${Date.now()}`;
  const idx = list.findIndex((x) => x.id === id);
  const prev = idx >= 0 ? list[idx] : null;
  const weekday = tpl.weekday !== undefined ? num(tpl.weekday) : prev ? prev.weekday : 0;
  const generated = tpl.generated !== undefined ? !!tpl.generated : prev ? !!prev.generated : false;
  const exMap = getExerciseMap();
  const goal = (getProfile().planPrefs && getProfile().planPrefs.goal) || 'hypertrophy';

  const clean = {
    id,
    name: (tpl.name || '').trim() || '未命名计划',
    desc: (tpl.desc || '').trim(),
    weekday: weekday >= 1 && weekday <= 7 ? weekday : 0,
    generated,
    items: (tpl.items || []).map((it) => {
      const meta = exMap[it.exerciseId];
      const defs = getDefaultRests(meta, goal);
      const item = {
        exerciseId: it.exerciseId,
        sets: Math.max(1, Math.round(num(it.sets)) || 3),
        restSec: num(it.restSec) || defs.restSec,
        transRestSec: num(it.transRestSec) || defs.transRestSec,
        note: it.note || '',
      };
      if (it.sec !== undefined && it.sec !== null && it.sec !== '') {
        item.sec = Math.max(1, Math.round(num(it.sec)));
      } else {
        item.reps = Math.max(1, Math.round(num(it.reps)) || 10);
        if (it.weight !== undefined && it.weight !== null && it.weight !== '') {
          item.weight = num(it.weight);
        }
      }
      return item;
    }),
  };
  if (idx >= 0) list[idx] = clean;
  else list.unshift(clean);
  safeSet(KEYS.TEMPLATES, list);
  markPlanPrompted();
  return clean;
}

function deleteTemplate(id) {
  recordDeleted('templates', id);
  safeSet(KEYS.TEMPLATES, getTemplates().filter((x) => x.id !== id));
}

// 把一次训练存成模板
function saveSessionAsTemplate(session) {
  const exMap = getExerciseMap();
  const items = (session.exercises || [])
    .filter((ex) => (ex.sets || []).length > 0)
    .map((ex) => {
      const first = ex.sets[0];
      const meta = exMap[ex.exerciseId];
      const base = {
        exerciseId: ex.exerciseId,
        sets: ex.sets.length,
        restSec: num(ex.restSec) || 0,
        transRestSec: num(ex.transRestSec) || 0,
        note: ex.note || '',
      };
      if (meta && isTimedCat(meta.cat)) {
        return Object.assign(base, { sec: num(first.sec) || timedUnit(meta.cat).defaultSec });
      }
      return Object.assign(base, { reps: num(first.reps) || 10, weight: num(first.weight) });
    });
  if (items.length === 0) return null;
  return saveTemplate({ name: session.title || '我的训练', items });
}

// ---------- 训练记录 ----------

function getMonths() {
  return safeGet(KEYS.W_MONTHS, []);
}

function setMonths(months) {
  try {
    wx.setStorageSync(KEYS.W_MONTHS, months);
  } catch (e) {}
}

function readMonth(ym) {
  return safeGet(W_PREFIX + ym, {});
}

function writeMonth(ym, days) {
  const months = getMonths();
  const has = months.indexOf(ym) >= 0;
  if (Object.keys(days).length === 0) {
    if (has) {
      safeRemove(W_PREFIX + ym);
      setMonths(months.filter((m) => m !== ym));
    }
    return true;
  }
  const ok = safeSet(W_PREFIX + ym, days);
  if (ok && !has) {
    months.push(ym);
    months.sort();
    setMonths(months);
  }
  return ok;
}

function groupByMonth(all) {
  const byMonth = {};
  Object.keys(all || {}).forEach((ds) => {
    const ym = ds.slice(0, 7);
    if (!byMonth[ym]) byMonth[ym] = {};
    byMonth[ym][ds] = all[ds];
  });
  return byMonth;
}

// 旧版单 key -> 按月分 key。全部写成功后才删除旧 key，中途失败下次重试
let _workoutsMigrated = false;

function migrateWorkouts() {
  if (_workoutsMigrated) return;
  _workoutsMigrated = true;
  let old = null;
  try {
    old = wx.getStorageSync(KEYS.WORKOUTS);
  } catch (e) {
    return;
  }
  if (!old || typeof old !== 'object') return;
  const prevSuppress = _suppressDirty;
  _suppressDirty = true;
  try {
    const byMonth = groupByMonth(old);
    const ok = Object.keys(byMonth).every((ym) =>
      writeMonth(ym, Object.assign({}, byMonth[ym], readMonth(ym)))
    );
    if (ok) wx.removeStorageSync(KEYS.WORKOUTS);
    else _workoutsMigrated = false;
  } catch (e) {
    _workoutsMigrated = false;
  } finally {
    _suppressDirty = prevSuppress;
  }
}

function getAllWorkouts() {
  ensureSeeded();
  migrateWorkouts();
  const all = {};
  getMonths().forEach((ym) => Object.assign(all, readMonth(ym)));
  return all;
}

// 整体替换全部训练记录（云端合并后用）
function setAllWorkouts(all) {
  migrateWorkouts();
  const byMonth = groupByMonth(all);
  const months = new Set([...getMonths(), ...Object.keys(byMonth)]);
  months.forEach((ym) => writeMonth(ym, byMonth[ym] || {}));
}

function getDayRecord(dateStr) {
  migrateWorkouts();
  const rec = readMonth(dateStr.slice(0, 7))[dateStr] || { date: dateStr };
  rec.sessions = rec.sessions || [];
  rec.extraLogs = rec.extraLogs || []; // 旧版的拉伸/有氧打卡，只读保留
  return rec;
}

function saveDayRecord(dateStr, record) {
  migrateWorkouts();
  const ym = dateStr.slice(0, 7);
  const days = readMonth(ym);
  if (record.sessions.length > 0 || record.extraLogs.length > 0) {
    days[dateStr] = record;
  } else {
    delete days[dateStr];
  }
  return writeMonth(ym, days);
}

// 没有 status 的是旧数据，一律视为已结束
function isActive(session) {
  return !!session && session.status === 'active';
}

function countDoneSets(session) {
  let n = 0;
  (session.exercises || []).forEach((ex) => {
    (ex.sets || []).forEach((st) => {
      if (st.done) n += 1;
    });
  });
  return n;
}

function hasDoneSet(rec) {
  return (rec.sessions || []).some((ses) => countDoneSets(ses) > 0);
}

// 练过 = 至少完成一组（或有旧版的拉伸/有氧打卡）
function getTrainedDateSet() {
  const all = getAllWorkouts();
  const set = new Set();
  Object.keys(all).forEach((ds) => {
    const rec = all[ds];
    if (hasDoneSet(rec) || (rec.extraLogs && rec.extraLogs.length > 0)) set.add(ds);
  });
  return set;
}

// 一次训练的合计
function summarizeSession(session, exMap) {
  const map = exMap || getExerciseMap();
  let totalSets = 0;
  let doneSets = 0;
  let volume = 0;
  (session.exercises || []).forEach((ex) => {
    const meta = map[ex.exerciseId];
    const timed = !!meta && isTimedCat(meta.cat);
    (ex.sets || []).forEach((st) => {
      totalSets += 1;
      if (!st.done) return;
      doneSets += 1;
      if (!timed) volume += num(st.weight) * num(st.reps);
    });
  });
  return {
    exCount: (session.exercises || []).length,
    totalSets,
    doneSets,
    volume: Math.round(volume),
  };
}

// 每个动作最近一次已完成的各组与体感反馈：{ [exerciseId]: { date, sets, rpe } }
function getLastPerformanceMap(exerciseIds, excludeSessionId) {
  const need = new Set(exerciseIds);
  const out = {};
  if (need.size === 0) return out;
  migrateWorkouts();
  const months = getMonths().slice().sort().reverse();
  for (let k = 0; k < months.length && need.size > 0; k += 1) {
    const all = readMonth(months[k]);
    const dates = Object.keys(all).sort().reverse();
    for (let i = 0; i < dates.length && need.size > 0; i += 1) {
      const sessions = (all[dates[i]].sessions || []).slice().reverse();
      sessions.forEach((ses) => {
        if (ses.id === excludeSessionId) return;
        (ses.exercises || []).forEach((ex) => {
          if (!need.has(ex.exerciseId)) return;
          const done = (ex.sets || []).filter((st) => st.done);
          if (done.length === 0) return;
          out[ex.exerciseId] = { date: dates[i], sets: done, rpe: ex.rpe || '' };
          need.delete(ex.exerciseId);
        });
      });
    }
  }
  return out;
}

// 依据上次动作体感反馈 (easy / good / hard) 与器械力学特征，计算渐进调重步长
function calcWeightDelta(baseWeight, rpe, meta) {
  const w = num(baseWeight);
  if (w <= 0 || !rpe || rpe === 'good') return { delta: 0, hint: '' };
  const isDb = meta && meta.equip === '哑铃';
  const isLowerBig = meta && (meta.cat === 'legs' || meta.cat === 'glutes') && isCompoundExercise(meta);
  const isUpperBig = meta && isCompoundExercise(meta) && !isLowerBig;

  let step = 2.5;
  if (isDb) step = w < 10 ? 1 : 2;
  else if (isLowerBig) step = 5;
  else if (isUpperBig) step = 2.5;
  else step = w < 15 ? 1.5 : 2.5;

  if (rpe === 'easy') {
    return { delta: step, hint: `上次轻松，这次 +${step} kg` };
  }
  if (rpe === 'hard') {
    const drop = Math.min(step, Math.max(0, w - (isDb ? 2 : 2.5)));
    return drop > 0
      ? { delta: -drop, hint: `上次吃力，这次 -${drop} kg` }
      : { delta: 0, hint: '' };
  }
  return { delta: 0, hint: '' };
}

// 生成一个动作的初始组：沿用上次成绩，按上次体感调重量
// useEstimate 为 false 时不预填任何估算重量（没做过评估的用户）
function buildEntry(exerciseId, tplItem, last, exMap, useEstimate) {
  const meta = exMap[exerciseId];
  const goal = (getProfile().planPrefs && getProfile().planPrefs.goal) || 'hypertrophy';
  const defRests = getDefaultRests(meta, goal);
  const lastSets = last ? last.sets : [];
  const ref = (i) => lastSets[i] || lastSets[lastSets.length - 1] || null;
  const item = tplItem || {};
  const restSec = num(item.restSec) || defRests.restSec;
  const transRestSec = num(item.transRestSec) || defRests.transRestSec;

  let sets;
  let weightHint = '';

  if (meta && isTimedCat(meta.cat)) {
    const unit = timedUnit(meta.cat);
    const count = item.sets || lastSets.length || unit.defaultSets;
    sets = Array.from({ length: count }, (_, i) => {
      const r = ref(i);
      return { sec: (r && num(r.sec)) || num(item.sec) || unit.defaultSec, done: false };
    });
  } else {
    const count = item.sets || lastSets.length || 3;
    const firstLastW = lastSets.length > 0 ? num(lastSets[0].weight) : 0;
    const adj = last ? calcWeightDelta(firstLastW, last.rpe, meta) : { delta: 0, hint: '' };
    let startWeight = item.weight !== undefined && item.weight !== '' ? item.weight : '';
    let estimated = false;
    if (!last && startWeight === '' && useEstimate) {
      const estW = estimateInitialWeight(exerciseId, getPlanPrefs());
      if (estW > 0) {
        startWeight = estW;
        estimated = true;
      }
    }

    if (adj.hint) {
      weightHint = adj.hint;
    } else if (estimated) {
      weightHint = `建议先试 ${num(startWeight)} kg`;
    }

    sets = Array.from({ length: count }, (_, i) => {
      const r = ref(i);
      let w = '';
      if (r) {
        const rw = num(r.weight);
        w = rw > 0 ? Math.round((rw + adj.delta) * 10) / 10 : r.weight;
      } else if (startWeight !== '') {
        w = startWeight;
      }
      return {
        weight: w,
        reps: r ? r.reps : item.reps || 10,
        done: false,
      };
    });
  }

  return {
    exerciseId,
    note: item.note || '',
    restSec,
    transRestSec,
    rpe: '',
    weightHint,
    sets,
  };
}

function buildEntries(exerciseIds, excludeSessionId) {
  const exMap = getExerciseMap();
  const lastMap = getLastPerformanceMap(exerciseIds, excludeSessionId);
  const assessed = isAssessed();
  return exerciseIds.map((id) => buildEntry(id, null, lastMap[id], exMap, assessed));
}

function getSession(dateStr, sessionId) {
  return getDayRecord(dateStr).sessions.find((s) => s.id === sessionId) || null;
}

function getActiveSession() {
  const ptr = safeGet(KEYS.ACTIVE, null);
  if (!ptr) return null;
  const session = getSession(ptr.date, ptr.id);
  if (!isActive(session)) {
    safeRemove(KEYS.ACTIVE);
    return null;
  }
  const lastTouch = session.lastActiveAt || session.startedAt || 0;
  if (lastTouch && Date.now() - lastTouch > STALE_ACTIVE_MS) {
    if (countDoneSets(session) > 0) finishSession(ptr.date, ptr.id);
    else deleteSession(ptr.date, ptr.id);
    return null;
  }
  return { dateStr: ptr.date, session };
}

// 今天的训练立即开始计时；其他日期是补记，直接生成已结束的记录
function startSession(dateStr, tpl) {
  const live = dateStr === getTodayStr();
  if (live) {
    const active = getActiveSession();
    if (active) return active;
  }
  const exMap = getExerciseMap();
  const items = tpl ? tpl.items || [] : [];
  const lastMap = getLastPerformanceMap(items.map((it) => it.exerciseId));
  const assessed = isAssessed();
  const now = Date.now();
  const session = {
    id: `ses_${now}_${Math.random().toString(36).slice(2, 6)}`,
    title: tpl ? tpl.name : '',
    status: live ? 'active' : 'done',
    startedAt: live ? now : null,
    endedAt: null,
    durationSec: 0,
    createdAt: new Date(now).toISOString(),
    exercises: items
      .filter((it) => exMap[it.exerciseId])
      .map((it) => {
        // 自动生成的计划在没做过评估时，重量只是默认体型的估值，不预填
        const item = tpl.generated && !assessed && it.weight ? Object.assign({}, it, { weight: '' }) : it;
        return buildEntry(it.exerciseId, item, lastMap[it.exerciseId], exMap, assessed);
      }),
  };
  const rec = getDayRecord(dateStr);
  rec.sessions.push(session);
  saveDayRecord(dateStr, rec);
  if (live) safeSet(KEYS.ACTIVE, { date: dateStr, id: session.id });
  return { dateStr, session };
}

function updateSession(dateStr, session) {
  const rec = getDayRecord(dateStr);
  const idx = rec.sessions.findIndex((s) => s.id === session.id);
  if (idx < 0) return null;
  if (isActive(session)) session.lastActiveAt = Date.now();
  rec.sessions[idx] = session;
  saveDayRecord(dateStr, rec);
  return session;
}

function finishSession(dateStr, sessionId) {
  const rec = getDayRecord(dateStr);
  const session = rec.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  if (isActive(session)) {
    const now = Date.now();
    const last = session.lastActiveAt || now;
    const end = now - last > IDLE_CUTOFF_MS ? last : now;
    session.status = 'done';
    session.endedAt = end;
    session.durationSec = session.startedAt
      ? Math.max(0, Math.round((end - session.startedAt) / 1000))
      : 0;
    saveDayRecord(dateStr, rec);
  }
  const ptr = safeGet(KEYS.ACTIVE, null);
  if (ptr && ptr.id === sessionId) safeRemove(KEYS.ACTIVE);
  notifyChange(true);
  return session;
}

function deleteSession(dateStr, sessionId) {
  recordDeleted('sessions', sessionId);
  const rec = getDayRecord(dateStr);
  rec.sessions = rec.sessions.filter((s) => s.id !== sessionId);
  saveDayRecord(dateStr, rec);
  const ptr = safeGet(KEYS.ACTIVE, null);
  if (ptr && ptr.id === sessionId) safeRemove(KEYS.ACTIVE);
}

// 把动作加进进行中的训练（动作详情页用）
function appendToActiveSession(exerciseId) {
  const active = getActiveSession();
  if (!active) return null;
  const { dateStr, session } = active;
  session.exercises.push(...buildEntries([exerciseId], session.id));
  updateSession(dateStr, session);
  return active;
}

// 从动作详情页一键快速开练当前动作
function startQuickSession(exerciseId) {
  const active = getActiveSession();
  if (active) {
    const exists = active.session.exercises.some((ex) => ex.exerciseId === exerciseId);
    if (!exists) {
      active.session.exercises.push(...buildEntries([exerciseId], active.session.id));
      updateSession(active.dateStr, active.session);
    }
    return active;
  }
  const ex = getExerciseById(exerciseId);
  return startSession(getTodayStr(), {
    name: ex ? ex.name : '快速训练',
    items: [{ exerciseId }],
  });
}

function deleteExtraLog(dateStr, extraId) {
  const rec = getDayRecord(dateStr);
  rec.extraLogs = rec.extraLogs.filter((x) => x.id !== extraId);
  saveDayRecord(dateStr, rec);
}

// ---------- 动作历史 ----------

// 30×10  或  30 秒
function formatSet(st, unit) {
  if (unit) return `${Math.round((num(st.sec) / unit.factor) * 10) / 10} ${unit.label}`;
  return `${num(st.weight)}×${num(st.reps)}`;
}

// 一个数或一个区间：10 / 8–10
function rangeText(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

// 一个动作若干组的统一写法（训练记录、计划、历史都用它）：
//   30 kg × 10 · 4 组   20–22.5 kg × 8–10 · 4 组   12 次 · 3 组   30 秒 · 2 组
function formatSetsSummary(sets, unit) {
  if (!sets || sets.length === 0) return '';
  let head;
  if (unit) {
    head = `${rangeText(sets.map((st) => Math.round((num(st.sec) / unit.factor) * 10) / 10))} ${unit.label}`;
  } else {
    const weights = sets.map((st) => num(st.weight));
    const reps = rangeText(sets.map((st) => num(st.reps)));
    head = Math.max(...weights) > 0 ? `${rangeText(weights)} kg × ${reps}` : `${reps} 次`;
  }
  return sets.length > 1 ? `${head} · ${sets.length} 组` : head;
}

// 计划里的一项（组数 + 每组目标）按同样的写法显示
function formatPlanItem(item, meta) {
  const n = Math.max(1, Number(item.sets) || 3);
  const unit = meta && isTimedCat(meta.cat) ? timedUnit(meta.cat) : null;
  const one = unit
    ? { sec: Number(item.sec) || unit.defaultSec }
    : { weight: item.weight, reps: Number(item.reps) || 10 };
  return formatSetsSummary(new Array(n).fill(one), unit);
}

// 一组里的最大重量（只算力量动作、次数 > 0 的已完成组）
function topSet(sets) {
  let best = null;
  (sets || []).forEach((st) => {
    if (!st.done || num(st.reps) <= 0 || num(st.weight) <= 0) return;
    if (!best || num(st.weight) > num(best.weight) || (num(st.weight) === num(best.weight) && num(st.reps) > num(best.reps))) {
      best = st;
    }
  });
  return best ? { weight: num(best.weight), reps: num(best.reps) } : null;
}

function getExerciseHistory(exerciseId) {
  const meta = getExerciseById(exerciseId);
  const unit = meta && isTimedCat(meta.cat) ? timedUnit(meta.cat) : null;
  const all = getAllWorkouts();
  const dates = Object.keys(all).sort().reverse();
  let totalDoneSets = 0;
  let best = null; // { weight, reps, date }
  const recent = [];
  const points = []; // 每次训练的最大重量，新的在前

  dates.forEach((ds) => {
    (all[ds].sessions || []).slice().reverse().forEach((ses) => {
      (ses.exercises || []).forEach((ex) => {
        if (ex.exerciseId !== exerciseId) return;
        const done = (ex.sets || []).filter((st) => st.done);
        if (done.length === 0) return;
        totalDoneSets += done.length;
        if (!unit) {
          const top = topSet(done);
          if (top) {
            points.push({ date: ds, weight: top.weight });
            if (!best || top.weight > best.weight || (top.weight === best.weight && top.reps > best.reps)) {
              best = { weight: top.weight, reps: top.reps, date: ds };
            }
          }
        }
        if (recent.length < 8) {
          recent.push({ key: `${ses.id}_${recent.length}`, date: ds, summary: formatSetsSummary(done, unit) });
        }
      });
    });
  });

  return {
    timed: !!unit,
    best,
    totalDoneSets,
    recent,
    trend: points.slice(0, 12).reverse(),
  };
}

// 结束一次训练后的小结：合计、和上次同名训练比、破纪录的动作
function getSessionReport(dateStr, sessionId) {
  const exMap = getExerciseMap();
  const session = getSession(dateStr, sessionId);
  if (!session) return null;
  const sum = summarizeSession(session, exMap);
  const all = getAllWorkouts();
  const dates = Object.keys(all).filter((ds) => ds <= dateStr).sort().reverse();

  // 之前每个动作的最大重量、上一次同名训练的容量
  const ids = new Set();
  (session.exercises || []).forEach((ex) => ids.add(ex.exerciseId));
  const prevMax = {};
  let prevVolume = null;
  dates.forEach((ds) => {
    (all[ds].sessions || []).forEach((ses) => {
      if (ses.id === session.id) return;
      if (ds === dateStr && (ses.startedAt || 0) > (session.startedAt || 0)) return;
      if (countDoneSets(ses) === 0) return;
      if (prevVolume === null && session.title && ses.title === session.title) {
        prevVolume = summarizeSession(ses, exMap).volume;
      }
      (ses.exercises || []).forEach((ex) => {
        if (!ids.has(ex.exerciseId)) return;
        const top = topSet(ex.sets);
        if (top && top.weight > (prevMax[ex.exerciseId] || 0)) prevMax[ex.exerciseId] = top.weight;
      });
    });
  });

  const records = [];
  (session.exercises || []).forEach((ex) => {
    const meta = exMap[ex.exerciseId];
    if (!meta || isTimedCat(meta.cat)) return;
    const top = topSet(ex.sets);
    const before = prevMax[ex.exerciseId] || 0;
    // 第一次练的动作不算破纪录
    if (top && before > 0 && top.weight > before) {
      records.push({ id: ex.exerciseId, name: meta.name, text: `${top.weight} kg × ${top.reps}`, before: `${before} kg` });
    }
  });

  let volumeDelta = '';
  if (prevVolume && sum.volume > 0) {
    const pct = Math.round(((sum.volume - prevVolume) / prevVolume) * 100);
    if (pct !== 0) volumeDelta = `${pct > 0 ? '+' : ''}${pct}%`;
  }

  return {
    minutes: session.durationSec >= 60 ? Math.round(session.durationSec / 60) : 0,
    doneSets: sum.doneSets,
    volume: sum.volume,
    volumeDelta,
    records,
  };
}

// 导出全部训练和体重记录为 CSV（Excel 能直接打开）
function buildExportCsv() {
  const exMap = getExerciseMap();
  const all = getAllWorkouts();
  const cell = (v) => {
    const t = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [['日期', '训练', '动作', '组', '重量(kg)', '次数', '时长(秒)'].join(',')];
  Object.keys(all).sort().forEach((ds) => {
    (all[ds].sessions || []).forEach((ses) => {
      (ses.exercises || []).forEach((ex) => {
        const meta = exMap[ex.exerciseId];
        const timed = !!meta && isTimedCat(meta.cat);
        (ex.sets || []).filter((st) => st.done).forEach((st, i) => {
          rows.push([
            ds,
            ses.title || '自由训练',
            meta ? meta.name : '已删除的动作',
            i + 1,
            timed ? '' : num(st.weight),
            timed ? '' : num(st.reps),
            timed ? num(st.sec) : '',
          ].map(cell).join(','));
        });
      });
    });
    (all[ds].extraLogs || []).forEach((ext) => {
      rows.push([ds, ext.title, ext.title, 1, '', '', num(ext.minutes) * 60].map(cell).join(','));
    });
  });
  const logs = getWeightLogs();
  if (logs.length > 0) {
    rows.push('', ['日期', '体重(kg)'].join(','));
    logs.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((l) => rows.push([l.date, l.weightKg].join(',')));
  }
  // 带 BOM，Excel 打开中文不乱码
  return `﻿${rows.join('\n')}\n`;
}

// ---------- 统计 ----------

function getOverviewCounts() {
  const trained = Array.from(getTrainedDateSet());
  const now = new Date();
  const yPrefix = `${now.getFullYear()}-`;
  const mPrefix = formatDate(now).slice(0, 8);
  const monday = getMonday(formatDate(now));
  return {
    totalDays: trained.length,
    weekDays: trained.filter((d) => d >= monday && d <= addDays(monday, 6)).length,
    yearDays: trained.filter((d) => d.startsWith(yPrefix)).length,
    monthDays: trained.filter((d) => d.startsWith(mPrefix)).length,
  };
}

// mode: 'week' | 'month' | 'year'
function getSummaryStats(mode, anchorDateStr) {
  const all = getAllWorkouts();
  const exMap = getExerciseMap();
  const anchor = parseDate(anchorDateStr || getTodayStr());
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + 1;
  const mm = m < 10 ? `0${m}` : `${m}`;
  let startStr = '';
  let endStr = '';
  let rangeLabel = '';
  const buckets = []; // { key, label, minutes }

  if (mode === 'week') {
    startStr = getMonday(formatDate(anchor));
    endStr = addDays(startStr, 6);
    const s = parseDate(startStr);
    const e = parseDate(endStr);
    rangeLabel = `${s.getMonth() + 1}月${s.getDate()}日 – ${e.getMonth() + 1}月${e.getDate()}日`;
    ['一', '二', '三', '四', '五', '六', '日'].forEach((label, i) => {
      buckets.push({ key: addDays(startStr, i), label, minutes: 0 });
    });
  } else if (mode === 'month') {
    const lastDay = new Date(y, m, 0).getDate();
    startStr = `${y}-${mm}-01`;
    endStr = `${y}-${mm}-${lastDay}`;
    rangeLabel = `${y}年${m}月`;
    for (let d = 1; d <= lastDay; d += 1) {
      buckets.push({
        key: `${y}-${mm}-${d < 10 ? '0' : ''}${d}`,
        label: d === 1 || d % 5 === 0 ? `${d}` : '',
        minutes: 0,
      });
    }
  } else {
    startStr = `${y}-01-01`;
    endStr = `${y}-12-31`;
    rangeLabel = `${y}年`;
    for (let i = 1; i <= 12; i += 1) {
      buckets.push({ key: `${y}-${i < 10 ? '0' : ''}${i}`, label: `${i}`, minutes: 0 });
    }
  }

  let trainDays = 0;
  let sessionCount = 0;
  let totalMinutes = 0;
  let totalSets = 0;
  let totalVolume = 0;
  const usedExercises = new Set();
  const partSets = {};

  Object.keys(all).forEach((ds) => {
    if (ds < startStr || ds > endStr) return;
    const rec = all[ds];
    let dayMin = 0;
    let trained = false;

    (rec.sessions || []).forEach((ses) => {
      const sum = summarizeSession(ses, exMap);
      if (sum.doneSets === 0) return;
      trained = true;
      sessionCount += 1;
      totalSets += sum.doneSets;
      totalVolume += sum.volume;
      (ses.exercises || []).forEach((ex) => {
        const n = (ex.sets || []).filter((st) => st.done).length;
        if (n === 0) return;
        usedExercises.add(ex.exerciseId);
        // 部位分布只算力量动作；拉伸和有氧不按组数比
        const meta = exMap[ex.exerciseId];
        if (meta && isTimedCat(meta.cat)) return;
        const part = getPartIcon(meta);
        partSets[part] = (partSets[part] || 0) + n;
      });
      if (!isActive(ses) && ses.durationSec > 0) {
        dayMin += Math.max(1, Math.round(ses.durationSec / 60));
      }
    });

    (rec.extraLogs || []).forEach((ext) => {
      trained = true;
      dayMin += Math.max(0, num(ext.minutes));
    });

    if (!trained) return;
    trainDays += 1;
    totalMinutes += dayMin;
    const b = buckets.find((x) => x.key === (mode === 'year' ? ds.slice(0, 7) : ds));
    if (b) b.minutes += dayMin;
  });

  return {
    rangeLabel,
    trainDays,
    sessionCount,
    totalMinutes,
    totalSets,
    totalVolume,
    exerciseCount: usedExercises.size,
    parts: Object.keys(partSets)
      .map((key) => ({ key, name: PART_NAMES[key] || '其他', sets: partSets[key] }))
      .sort((a, b) => b.sets - a.sets),
    buckets,
  };
}

function minutesToHeatLevel(min, trained) {
  if (!trained && min <= 0) return 0;
  if (min < 25) return 1;
  if (min < 45) return 2;
  if (min < 65) return 3;
  return 4;
}

function getDailyMinutesMap() {
  const all = getAllWorkouts();
  const exMap = getExerciseMap();
  const map = {};
  Object.keys(all).forEach((ds) => {
    const rec = all[ds];
    let min = 0;
    let trained = false;
    (rec.sessions || []).forEach((ses) => {
      const sum = summarizeSession(ses, exMap);
      if (sum.doneSets === 0) return;
      trained = true;
      if (!isActive(ses) && ses.durationSec > 0) min += Math.max(1, Math.round(ses.durationSec / 60));
      else min += Math.max(5, sum.doneSets * 3);
    });
    (rec.extraLogs || []).forEach((ext) => {
      trained = true;
      min += Math.max(1, num(ext.minutes));
    });
    if (trained) map[ds] = min;
  });
  return map;
}

// 生成整年 53 周 × 7 天热力图矩阵（类似 GitHub 年历贡献图）与最长连续打卡天数
function getYearHeatmap(year) {
  const y = Number(year) || new Date().getFullYear();
  const minMap = getDailyMinutesMap();
  const todayStr = getTodayStr();

  const jan1Str = `${y}-01-01`;
  const dec31Str = `${y}-12-31`;
  const firstMon = getMonday(jan1Str);

  const weeks = [];
  const monthLabels = [];
  let cur = firstMon;
  let lastLabeledMonth = 0;

  for (let w = 0; w < 54; w += 1) {
    if (cur > dec31Str) break;
    const days = [];
    let monthMark = '';
    for (let dow = 0; dow < 7; dow += 1) {
      const ds = addDays(cur, dow);
      const inYear = ds >= jan1Str && ds <= dec31Str;
      const mins = inYear ? minMap[ds] || 0 : 0;
      if (inYear && ds.slice(8, 10) === '01') {
        const m = Number(ds.slice(5, 7));
        if (m !== lastLabeledMonth) {
          monthMark = `${m}月`;
          lastLabeledMonth = m;
        }
      }
      days.push({
        dateStr: ds,
        inYear,
        minutes: mins,
        level: inYear ? minutesToHeatLevel(mins, mins > 0) : -1,
        isToday: ds === todayStr,
      });
    }
    if (!monthMark && w === 0) {
      monthMark = '1月';
      lastLabeledMonth = 1;
    }
    monthLabels.push({ col: w, text: monthMark });
    weeks.push({ col: w, monthMark, days });
    cur = addDays(cur, 7);
  }

  return { year: y, weeks, monthLabels };
}

// 生成单月热力日历矩阵（月统计页展示哪几天练了及强度深浅）
function getMonthHeatmap(year, month) {
  const y = Number(year);
  const m = Number(month);
  const minMap = getDailyMinutesMap();
  const todayStr = getTodayStr();
  const firstDay = new Date(y, m - 1, 1);
  const startDow = firstDay.getDay() === 0 ? 7 : firstDay.getDay();
  const lead = startDow - 1;
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const dt = new Date(y, m - 1, 1 - lead + i);
    const inMonth = dt.getMonth() === m - 1;
    const ds = formatDate(dt);
    const mins = inMonth ? minMap[ds] || 0 : 0;
    cells.push({
      dateStr: ds,
      dayNum: dt.getDate(),
      inMonth,
      minutes: mins,
      level: inMonth ? minutesToHeatLevel(mins, mins > 0) : -1,
      isToday: ds === todayStr,
    });
  }
  return cells.slice(35).some((c) => c.inMonth) ? cells : cells.slice(0, 35);
}

// ---------- 体重 ----------

function getWeightLogs() {
  const list = safeGet(KEYS.WEIGHTS, []);
  return list.sort((a, b) =>
    a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)
  );
}

function addWeightLog({ date, weightKg }) {
  const w = Number(weightKg);
  if (!w || w < 25 || w > 250) return null;
  const list = safeGet(KEYS.WEIGHTS, []);
  const item = {
    id: `wt_${Date.now()}`,
    date: date || getTodayStr(),
    weightKg: Number(w.toFixed(1)),
    note: '',
  };
  list.unshift(item);
  safeSet(KEYS.WEIGHTS, list);
  return item;
}

function deleteWeightLog(id) {
  recordDeleted('weights', id);
  safeSet(KEYS.WEIGHTS, safeGet(KEYS.WEIGHTS, []).filter((x) => x.id !== id));
}

// rangeDays 为 0 表示全部
function getWeightOverview(rangeDays) {
  const logs = getWeightLogs();
  const current = logs.length > 0 ? logs[0] : null;
  const prev = logs.length > 1 ? logs[1] : null;
  const prevDiff = current && prev ? Number((current.weightKg - prev.weightKg).toFixed(1)) : null;

  let filtered = logs.slice().reverse();
  if (rangeDays > 0) {
    const minDate = addDays(getTodayStr(), -(rangeDays - 1));
    filtered = filtered.filter((x) => x.date >= minDate);
  }
  // 同一天多条时取最新一条
  const byDate = {};
  filtered.forEach((x) => {
    byDate[x.date] = x.weightKg;
  });
  const points = Object.keys(byDate)
    .sort()
    .map((ds) => ({ label: `${Number(ds.slice(5, 7))}/${Number(ds.slice(8))}`, value: byDate[ds] }));

  return {
    current: current ? current.weightKg : null,
    currentDate: current ? current.date : '',
    prevDiff,
    points,
    logs,
  };
}

// ---------- 云端无感同步快照与合并 ----------

function isSyncDirty() {
  return !!safeGet(KEYS.SYNC_DIRTY, false);
}

function clearSyncDirty() {
  try {
    wx.removeStorageSync(KEYS.SYNC_DIRTY);
  } catch (e) {}
}

function buildSyncSnapshot() {
  ensureSeeded();
  return {
    schema: 1,
    clientUpdatedAt: Date.now(),
    profile: getProfile(),
    favorites: getFavorites(),
    customExercises: getCustomExercises(),
    templates: getTemplates(),
    workouts: getAllWorkouts(),
    weights: safeGet(KEYS.WEIGHTS, []),
    active: safeGet(KEYS.ACTIVE, null),
    deleted: safeGet(KEYS.DELETED, {}),
  };
}

function mergeDeleted(a, b) {
  const out = {};
  ['sessions', 'weights', 'templates', 'customExercises'].forEach((k) => {
    const combined = [...((a && a[k]) || []), ...((b && b[k]) || [])];
    const uniq = Array.from(new Set(combined));
    out[k] = uniq.slice(-300);
  });
  return out;
}

function sessionRank(ses) {
  if (!ses) return 0;
  return (ses.endedAt || ses.lastActiveAt || ses.startedAt || 0) + countDoneSets(ses) * 1000;
}

// 合并云端快照到本地：墓碑过滤 + ID 级并集，确保换机/离线双端都不丢记录
function applyCloudSnapshot(cloud) {
  if (!cloud || typeof cloud !== 'object') return { needsPushBack: false };
  // 云端数据被用户主动清空过：不拿空快照覆盖本机，把本机数据重新传上去
  if (cloud.wiped) return { needsPushBack: true };
  ensureSeeded();
  const dirty = isSyncDirty();
  const localWorkouts = getAllWorkouts();
  const localWeights = safeGet(KEYS.WEIGHTS, []);
  const hasLocalData = dirty || Object.keys(localWorkouts).length > 0 || localWeights.length > 0;

  const mergedDel = mergeDeleted(cloud.deleted, safeGet(KEYS.DELETED, {}));
  const delSessions = new Set(mergedDel.sessions);
  const delWeights = new Set(mergedDel.weights);
  const delTpls = new Set(mergedDel.templates);
  const delCustom = new Set(mergedDel.customExercises);

  _suppressDirty = true;
  let needsPushBack = false;
  try {
    safeSet(KEYS.DELETED, mergedDel);

    if (!hasLocalData) {
      // 新设备首次拉取：直接完整采用云端档案
      if (cloud.profile) safeSet(KEYS.PROFILE, Object.assign({}, DEFAULT_PROFILE, cloud.profile));
      if (Array.isArray(cloud.favorites)) safeSet(KEYS.FAVORITES, cloud.favorites);
      if (Array.isArray(cloud.customExercises)) {
        safeSet(KEYS.CUSTOM_EXERCISES, cloud.customExercises.filter((x) => x && !delCustom.has(x.id)));
      }
      if (Array.isArray(cloud.templates)) {
        safeSet(KEYS.TEMPLATES, cloud.templates.filter((x) => x && !delTpls.has(x.id)));
      }
      if (cloud.workouts && typeof cloud.workouts === 'object') {
        setAllWorkouts(cloud.workouts);
      }
      if (Array.isArray(cloud.weights)) {
        safeSet(KEYS.WEIGHTS, cloud.weights.filter((x) => x && !delWeights.has(x.id)));
      }
      if (cloud.active && cloud.active.id) safeSet(KEYS.ACTIVE, cloud.active);
      else safeRemove(KEYS.ACTIVE);
      safeSet(KEYS.SEEDED, true);
      safeSet(KEYS.UNASSESSED_CLEANED, true);
      if (Array.isArray(cloud.templates) && cloud.templates.length > 0) {
        markPlanPrompted();
      }
      return { needsPushBack: false };
    }

    // 本机已有数据：按唯一 ID 做墓碑感知合并
    if (!dirty && cloud.profile) {
      safeSet(KEYS.PROFILE, Object.assign({}, DEFAULT_PROFILE, cloud.profile));
    }

    // 自建动作并集
    const customMap = {};
    [...(cloud.customExercises || []), ...getCustomExercises()].forEach((ex) => {
      if (ex && ex.id && !delCustom.has(ex.id)) customMap[ex.id] = ex;
    });
    safeSet(KEYS.CUSTOM_EXERCISES, Object.values(customMap));

    // 收藏：若本机未改则采用云端，否则做并集
    if (!dirty && Array.isArray(cloud.favorites)) {
      safeSet(KEYS.FAVORITES, cloud.favorites.filter((id) => !delCustom.has(id)));
    } else if (Array.isArray(cloud.favorites)) {
      const favSet = new Set([...getFavorites(), ...cloud.favorites]);
      safeSet(KEYS.FAVORITES, Array.from(favSet).filter((id) => !delCustom.has(id)));
    }

    // 模板：保留本机修改，补入云端新增
    const localTpls = getTemplates().filter((t) => t && !delTpls.has(t.id));
    const cloudTpls = (cloud.templates || []).filter((t) => t && !delTpls.has(t.id));
    if (!dirty && cloudTpls.length > 0) {
      safeSet(KEYS.TEMPLATES, cloudTpls);
    } else {
      const byId = {};
      cloudTpls.forEach((t) => { byId[t.id] = t; });
      localTpls.forEach((t) => { byId[t.id] = t; });
      safeSet(KEYS.TEMPLATES, Object.values(byId));
    }

    // 训练记录：按日期和 session.id 合并
    const cloudWorkouts = cloud.workouts || {};
    const allDates = new Set([...Object.keys(cloudWorkouts), ...Object.keys(localWorkouts)]);
    const mergedWorkouts = {};
    allDates.forEach((ds) => {
      const cDay = cloudWorkouts[ds] || {};
      const lDay = localWorkouts[ds] || {};
      const sesMap = {};
      const order = [];
      (cDay.sessions || []).forEach((s) => {
        if (!s || !s.id || delSessions.has(s.id)) return;
        sesMap[s.id] = s;
        order.push(s.id);
      });
      (lDay.sessions || []).forEach((s) => {
        if (!s || !s.id || delSessions.has(s.id)) return;
        if (!sesMap[s.id]) {
          sesMap[s.id] = s;
          order.push(s.id);
          needsPushBack = true;
        } else if (sessionRank(s) >= sessionRank(sesMap[s.id])) {
          sesMap[s.id] = s;
        }
      });
      const sessions = order.map((id) => sesMap[id]);
      const extraMap = {};
      [...(cDay.extraLogs || []), ...(lDay.extraLogs || [])].forEach((e) => {
        if (e && e.id) extraMap[e.id] = e;
      });
      const extraLogs = Object.values(extraMap);
      if (sessions.length > 0 || extraLogs.length > 0) {
        mergedWorkouts[ds] = { date: ds, sessions, extraLogs };
      }
    });
    setAllWorkouts(mergedWorkouts);

    // 体重记录：按 id 并集
    const wtMap = {};
    (cloud.weights || []).forEach((w) => {
      if (w && w.id && !delWeights.has(w.id)) wtMap[w.id] = w;
    });
    localWeights.forEach((w) => {
      if (!w || !w.id || delWeights.has(w.id)) return;
      if (!wtMap[w.id]) needsPushBack = true;
      wtMap[w.id] = w;
    });
    safeSet(KEYS.WEIGHTS, Object.values(wtMap));

    // 进行中指针
    if (!safeGet(KEYS.ACTIVE, null) && cloud.active && cloud.active.id && !delSessions.has(cloud.active.id)) {
      safeSet(KEYS.ACTIVE, cloud.active);
    }
  } finally {
    _suppressDirty = false;
  }

  return { needsPushBack: dirty || needsPushBack };
}

// ---------- 云同步（离线优先；用户同意后才开启，断网时保留 dirty 下次补传） ----------

const AUTH_KEY = 'fitlog_v2_auth_token';
const REV_KEY = 'fitlog_v2_cloud_rev';
const PUSH_DEBOUNCE_MS = 1200;

let _pushTimer = null;
let _syncing = false;
let _pendingPush = false;
let _syncInited = false;

function rawGet(key, fallback) {
  try {
    const val = wx.getStorageSync(key);
    return val === '' || val === undefined || val === null ? fallback : val;
  } catch (e) {
    return fallback;
  }
}

function rawSet(key, val) {
  try {
    if (val === '' || val === null || val === undefined) wx.removeStorageSync(key);
    else wx.setStorageSync(key, val);
  } catch (e) {}
}

function getAuthToken() {
  return rawGet(AUTH_KEY, '');
}

function setAuthToken(token) {
  rawSet(AUTH_KEY, token);
}

function getLocalRev() {
  return num(rawGet(REV_KEY, 0));
}

function setLocalRev(rev) {
  rawSet(REV_KEY, num(rev));
}

// 'on' | 'off' | ''（还没选过）。旧版本已经在同步的用户视为已开启
function getSyncPref() {
  const pref = rawGet(KEYS.SYNC_PREF, '');
  if (pref === 'on' || pref === 'off') return pref;
  if (getAuthToken()) {
    rawSet(KEYS.SYNC_PREF, 'on');
    return 'on';
  }
  return '';
}

const API_BASE = (API_BASE_URL || '').replace(/\/+$/, '');

function isCloudConfigured() {
  return Boolean(API_BASE);
}

function isSyncEnabled() {
  return isCloudConfigured() && getSyncPref() === 'on';
}

function setSyncEnabled(on) {
  rawSet(KEYS.SYNC_PREF, on ? 'on' : 'off');
  clearTimeout(_pushTimer);
  _pushTimer = null;
  if (on && isCloudConfigured()) return syncNow();
  return Promise.resolve(false);
}

function markSync(ok) {
  rawSet(KEYS.SYNC_STATE, { at: Date.now(), ok: !!ok });
}

// 给「我的」页显示用
function getSyncStatus() {
  if (!isCloudConfigured()) {
    return { pref: 'off', enabled: false, text: '未配置' };
  }
  const pref = getSyncPref();
  const state = rawGet(KEYS.SYNC_STATE, null);
  let text = '未开启';
  if (pref === 'on') {
    if (!state) text = '已开启';
    else if (!state.ok) text = '上次同步失败';
    else text = isSyncDirty() ? '等待同步' : '已同步';
  }
  return { pref, enabled: pref === 'on', text };
}

function apiRequest({ method = 'GET', path, data, token }) {
  if (!API_BASE) return Promise.reject(new Error('cloud_not_configured'));
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' };
    if (token) header.Authorization = `Bearer ${token}`;
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data,
      header,
      timeout: 8000,
      success: (res) => resolve(res),
      fail: (err) => reject(err),
    });
  });
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 6000,
      success: (res) => (res && res.code ? resolve(res.code) : reject(new Error('no_code'))),
      fail: (err) => reject(err),
    });
  });
}

function notifyVisiblePage() {
  try {
    if (typeof getCurrentPages !== 'function') return;
    const pages = getCurrentPages();
    const top = pages && pages[pages.length - 1];
    if (!top) return;
    // 正在编辑的页面不打断
    if (['pages/session/index', 'pages/template-edit/index', 'pages/profile/index'].indexOf(top.route) >= 0) return;
    if (typeof top.refresh === 'function') top.refresh();
    else if (typeof top.onShow === 'function') top.onShow();
  } catch (e) {}
}

async function requestLogin() {
  const code = await wxLoginCode();
  const res = await apiRequest({
    method: 'POST',
    path: '/api/auth/wx-login',
    data: { code },
  });
  if (res.statusCode !== 200 || !res.data || !res.data.ok || !res.data.token) {
    throw new Error('login_failed');
  }
  setAuthToken(res.data.token);
  return res.data;
}

async function loginAndBootstrap() {
  const { token, rev, snapshot } = await requestLogin();
  let needsPush = isSyncDirty();
  if (snapshot && rev > getLocalRev()) {
    const merged = applyCloudSnapshot(snapshot);
    setLocalRev(rev);
    needsPush = needsPush || merged.needsPushBack;
    notifyVisiblePage();
  } else if (!snapshot && rev === 0) {
    const snap = buildSyncSnapshot();
    if (Object.keys(snap.workouts).length > 0 || snap.weights.length > 0) {
      needsPush = true;
    }
  }
  return { token, needsPush };
}

async function pushSnapshot(tokenOverride, retried) {
  const token = tokenOverride || getAuthToken();
  if (!token) return false;
  const snapshot = buildSyncSnapshot();
  const res = await apiRequest({
    method: 'POST',
    path: '/api/sync/push',
    token,
    data: { baseRev: getLocalRev(), snapshot },
  });
  if (res.statusCode === 401 && !retried) {
    setAuthToken('');
    const relogin = await loginAndBootstrap();
    return pushSnapshot(relogin.token, true);
  }
  if (res.statusCode === 200 && res.data && res.data.ok) {
    setLocalRev(res.data.rev);
    clearSyncDirty();
    return true;
  }
  return false;
}

// 拉取并合并云端，有本机改动就推上去。返回是否成功
async function syncNow() {
  if (!isSyncEnabled() || _syncing) return false;
  _syncing = true;
  let ok = false;
  try {
    const token = getAuthToken();
    if (!token) {
      const boot = await loginAndBootstrap();
      ok = boot.needsPush ? await pushSnapshot(boot.token) : true;
    } else {
      const res = await apiRequest({
        method: 'GET',
        path: `/api/sync/pull?sinceRev=${getLocalRev()}`,
        token,
      });
      if (res.statusCode === 401) {
        setAuthToken('');
        const boot = await loginAndBootstrap();
        ok = boot.needsPush ? await pushSnapshot(boot.token) : true;
      } else if (res.statusCode === 200 && res.data && res.data.ok) {
        let needsPush = isSyncDirty();
        if (!res.data.upToDate && res.data.snapshot) {
          const merged = applyCloudSnapshot(res.data.snapshot);
          setLocalRev(res.data.rev);
          needsPush = needsPush || merged.needsPushBack;
          notifyVisiblePage();
        }
        if (needsPush || _pendingPush) {
          _pendingPush = false;
          ok = await pushSnapshot(token);
        } else {
          ok = true;
        }
      }
    }
  } catch (e) {
    ok = false; // 离线：保留 dirty，下次补传
  } finally {
    _syncing = false;
  }
  markSync(ok);
  return ok;
}

async function flushSync() {
  clearTimeout(_pushTimer);
  _pushTimer = null;
  if (!isSyncEnabled() || _syncing) return;
  if (!isSyncDirty() && !_pendingPush) return;
  _syncing = true;
  let ok = false;
  try {
    let token = getAuthToken();
    if (!token) {
      const boot = await loginAndBootstrap();
      token = boot.token;
    }
    _pendingPush = false;
    ok = await pushSnapshot(token);
  } catch (e) {
    ok = false;
  } finally {
    _syncing = false;
  }
  markSync(ok);
}

// 删除云端数据并关闭同步：用一份空快照覆盖云端，本机数据不动
async function deleteCloudData() {
  if (_syncing) return false;
  _syncing = true;
  clearTimeout(_pushTimer);
  _pushTimer = null;
  try {
    let token = getAuthToken();
    let rev = getLocalRev();
    if (!token) {
      const login = await requestLogin();
      token = login.token;
      rev = num(login.rev);
    }
    const res = await apiRequest({
      method: 'POST',
      path: '/api/sync/push',
      token,
      data: {
        baseRev: rev,
        snapshot: {
          schema: 1,
          wiped: true,
          clientUpdatedAt: Date.now(),
          profile: {},
          favorites: [],
          customExercises: [],
          templates: [],
          workouts: {},
          weights: [],
          active: null,
          deleted: {},
        },
      },
    });
    if (res.statusCode !== 200 || !res.data || !res.data.ok) return false;
    setAuthToken('');
    setLocalRev(0);
    rawSet(KEYS.SYNC_PREF, 'off');
    rawSet(KEYS.SYNC_STATE, '');
    rawSet(KEYS.SYNC_DIRTY, true); // 以后重新开启时把本机数据整份传上去
    return true;
  } catch (e) {
    return false;
  } finally {
    _syncing = false;
  }
}

function initSync() {
  if (_syncInited) return;
  _syncInited = true;
  onChange((urgent) => {
    if (!isSyncEnabled()) return;
    _pendingPush = true;
    clearTimeout(_pushTimer);
    if (urgent) {
      flushSync();
      return;
    }
    _pushTimer = setTimeout(() => flushSync(), PUSH_DEBOUNCE_MS);
  });
}

module.exports = {
  isCloudConfigured,
  initSync,
  syncNow,
  flushSync,
  getSyncPref,
  getSyncStatus,
  setSyncEnabled,
  deleteCloudData,
  isAssessed,
  shouldPromptPlan,
  markPlanPrompted,
  onChange,
  isSyncDirty,
  clearSyncDirty,
  buildSyncSnapshot,
  applyCloudSnapshot,
  getProfile,
  updateProfile,
  getAllExercises,
  getExerciseMap,
  getExerciseById,
  addCustomExercise,
  deleteCustomExercise,
  getFavorites,
  toggleFavorite,
  DOW_LABELS,
  formatSetsSummary,
  formatPlanItem,
  getSessionReport,
  buildExportCsv,
  getTemplates,
  getTemplateById,
  getPlannedTemplateForDate,
  estimateTemplateMinutes,
  estimateRemainingMinutes,
  getNextPlannedInfo,
  getPlanPrefs,
  applyGeneratedPlan,
  saveTemplate,
  deleteTemplate,
  saveSessionAsTemplate,
  getDayRecord,
  getTrainedDateSet,
  isActive,
  summarizeSession,
  getLastPerformanceMap,
  buildEntries,
  getSession,
  getActiveSession,
  startSession,
  updateSession,
  finishSession,
  deleteSession,
  appendToActiveSession,
  startQuickSession,
  deleteExtraLog,
  formatSet,
  getExerciseHistory,
  getOverviewCounts,
  getSummaryStats,
  getYearHeatmap,
  getMonthHeatmap,
  getWeightLogs,
  addWeightLog,
  deleteWeightLog,
  getWeightOverview,
};
