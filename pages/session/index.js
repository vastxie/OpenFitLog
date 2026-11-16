const {
  getThemeStyle,
  getDefaultRests,
  getMediaUrls,
  exerciseSub,
  isTimedCat,
  timedUnit,
} = require('../../utils/config');
const { formatClock, formatDayTitle, formatThousands } = require('../../utils/date');
const storage = require('../../utils/storage');
const { padFor } = require('../../utils/pad');
const { confirm, toast, closeSheet } = require('../../utils/ui');

const SAVE_DELAY_MS = 400;
const SMALL_REST_OPTS = [30, 45, 60, 75, 90, 120];
const BIG_REST_OPTS = [60, 90, 120, 150, 180, 210];

Page({
  data: {
    themeStyle: '',
    live: false,
    title: '',
    clock: '',
    statText: '',
    exercises: [],

    restLeft: 0,
    restText: '',
    restLabel: '',

    showReport: false,
    report: null,

    // 内置数字键盘
    pad: { show: false },

    showPicker: false,
    showRestSheet: false,
    restEditIdx: -1,
    restEditName: '',
    restEditSmall: 75,
    restEditBig: 105,
    smallRestOpts: SMALL_REST_OPTS,
    bigRestOpts: BIG_REST_OPTS,
  },

  onLoad(options) {
    this.dateStr = options.date;
    this.sessionId = options.id;
    this.restEndAt = 0;
  },

  onShow() {
    const session = storage.getSession(this.dateStr, this.sessionId);
    if (!session) {
      this.gone = true;
      wx.navigateBack();
      return;
    }
    session.exercises = session.exercises || [];
    session.exercises.forEach((entry) => {
      entry.sets = entry.sets || [];
    });
    this.session = session;
    this.setData({ themeStyle: getThemeStyle(storage.getProfile().theme) });
    this.rebuild();
    this.startTick();
    // 训练中保持屏幕常亮，否则锁屏后倒计时会停
    this.keepAwake(storage.isActive(session));
  },

  onHide() {
    this.stopTick();
    this.keepAwake(false);
    this.flush();
  },

  onUnload() {
    this.stopTick();
    this.keepAwake(false);
    if (this.gone || !this.session) return;
    this.flush();
    if (this.session.exercises.length === 0) {
      storage.deleteSession(this.dateStr, this.sessionId);
    }
  },

  keepAwake(on) {
    if (!!this.awake === !!on) return;
    this.awake = !!on;
    wx.setKeepScreenOn({ keepScreenOn: !!on, fail: () => {} });
  },

  // ---------- 视图 ----------

  ensureEntryRests(entry, meta) {
    const prof = storage.getProfile();
    const goal = (prof.planPrefs && prof.planPrefs.goal) || 'hypertrophy';
    const defs = getDefaultRests(meta, goal);
    if (!entry.restSec) entry.restSec = defs.restSec;
    if (!entry.transRestSec) entry.transRestSec = defs.transRestSec;
  },

  rebuild() {
    const session = this.session;
    const gender = storage.getProfile().gender;
    this.exMap = storage.getExerciseMap();
    this.lastMap = storage.getLastPerformanceMap(
      session.exercises.map((entry) => entry.exerciseId),
      session.id
    );
    this.setData({
      live: storage.isActive(session),
      title: session.title,
      exercises: session.exercises.map((entry, i) => {
        const meta = this.exMap[entry.exerciseId];
        this.ensureEntryRests(entry, meta);
        const unit = this.unitOf(entry);
        const viewSets = this.viewSets(entry);
        const allDone = viewSets.length > 0 && viewSets.every((s) => s.done);
        return {
          key: `${i}_${entry.exerciseId}`,
          exerciseId: entry.exerciseId,
          name: meta ? meta.name : '已删除的动作',
          sub: exerciseSub(meta),
          hint: entry.weightHint || '',
          note: entry.note || '',
          rpe: entry.rpe || '',
          allDone,
          posterUrl: getMediaUrls(meta, gender).posterUrl,
          timed: !!unit,
          unitLabel: unit ? unit.label : '',
          sets: viewSets,
        };
      }),
    });
    this.refreshStats();
    this.tick();
  },

  unitOf(entry) {
    const meta = this.exMap[entry.exerciseId];
    return meta && isTimedCat(meta.cat) ? timedUnit(meta.cat) : null;
  },

  viewSets(entry) {
    const unit = this.unitOf(entry);
    const last = this.lastMap[entry.exerciseId];
    return entry.sets.map((st, index) => {
      const prev = last && last.sets[index];
      const row = { index, done: !!st.done, last: prev ? storage.formatSet(prev, unit) : '–' };
      if (unit) {
        row.val = st.sec ? Math.round((st.sec / unit.factor) * 10) / 10 : '';
      } else {
        row.weight = st.weight;
        row.reps = st.reps;
      }
      return row;
    });
  },

  refreshStats() {
    const session = this.session;
    const sum = storage.summarizeSession(session, this.exMap);
    const parts = [];
    if (storage.isActive(session)) {
      parts.push(`${sum.doneSets}/${sum.totalSets} 组`);
    } else {
      parts.push(formatDayTitle(this.dateStr));
      if (session.durationSec >= 60) parts.push(`${Math.round(session.durationSec / 60)} 分钟`);
      parts.push(`${sum.doneSets} 组`);
    }
    if (sum.volume > 0) parts.push(`${sum.volume} kg`);
    this.setData({ statText: parts.join(' · ') });
  },

  // ---------- 计时（区分组间小休 vs 换动作大休） ----------

  startTick() {
    this.stopTick();
    if (!storage.isActive(this.session)) return;
    this.timer = setInterval(() => this.tick(), 1000);
  },

  stopTick() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  tick() {
    const session = this.session;
    if (!storage.isActive(session)) return;
    const now = Date.now();
    const patch = { clock: formatClock((now - session.startedAt) / 1000) };
    if (this.restEndAt) {
      const left = Math.ceil((this.restEndAt - now) / 1000);
      if (left <= 0) {
        this.restEndAt = 0;
        patch.restLeft = 0;
        // 刚到点才震；离开页面很久后回来就不补震了
        if (left > -3) wx.vibrateLong({ fail: () => {} });
      } else {
        patch.restLeft = left;
        patch.restText = formatClock(left);
      }
    }
    this.setData(patch);
  },

  subRest() {
    if (!this.restEndAt) return;
    this.restEndAt = Math.max(Date.now() + 1000, this.restEndAt - 15 * 1000);
    this.tick();
  },

  addRest() {
    if (!this.restEndAt) return;
    this.restEndAt += 15 * 1000;
    this.tick();
  },

  skipRest() {
    this.restEndAt = 0;
    this.setData({ restLeft: 0 });
  },

  // ---------- 单动作灵活调休息 ----------

  openRestSheet(e) {
    const i = Number(e.currentTarget.dataset.i);
    const entry = this.session.exercises[i];
    const meta = this.exMap[entry.exerciseId];
    this.ensureEntryRests(entry, meta);
    this.setData({
      showRestSheet: true,
      restEditIdx: i,
      restEditName: meta ? meta.name : '休息时长',
      restEditSmall: entry.restSec,
      restEditBig: entry.transRestSec,
    });
  },

  closeRestSheet() {
    closeSheet(this, { showRestSheet: false });
  },

  pickSmallRest(e) {
    const val = Number(e.currentTarget.dataset.s);
    const i = this.data.restEditIdx;
    if (i < 0) return;
    this.session.exercises[i].restSec = val;
    this.setData({ restEditSmall: val });
    this.touch();
  },

  pickBigRest(e) {
    const val = Number(e.currentTarget.dataset.s);
    const i = this.data.restEditIdx;
    if (i < 0) return;
    this.session.exercises[i].transRestSec = val;
    this.setData({ restEditBig: val });
    this.touch();
  },

  // ---------- 保存 ----------

  touch() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  },

  flush() {
    clearTimeout(this.saveTimer);
    if (!this.dirty || this.gone) return;
    storage.updateSession(this.dateStr, this.session);
    this.dirty = false;
  },

  // ---------- 编辑与打卡 ----------

  onTitleInput(e) {
    this.session.title = e.detail.value;
    this.touch();
  },

  // 点重量 / 次数 / 时长：弹内置数字键盘
  openPad(e) {
    const { i, j, f } = e.currentTarget.dataset;
    const entry = this.session.exercises[i];
    const meta = this.exMap[entry.exerciseId];
    const st = entry.sets[j];
    const unit = this.unitOf(entry);
    let value = st[f];
    if (f === 'val') value = st.sec ? Math.round((st.sec / unit.factor) * 10) / 10 : '';
    const title = `${meta ? meta.name : '已删除的动作'} · 第 ${j + 1} 组`;
    this.padTarget = { i, j, f };
    this.setData({ pad: Object.assign(padFor(f, meta, value, title), { show: true }) });
  },

  closePad() {
    this.setData({ 'pad.show': false });
  },

  onPadConfirm(e) {
    this.setData({ 'pad.show': false });
    const t = this.padTarget;
    if (t) this.applySetValue(t.i, t.j, t.f, e.detail.value);
  },

  // 写入一组的数值；后面还没做、数值和这组原来一样的组跟着改，不用一组组重填
  applySetValue(i, j, f, value) {
    const entry = this.session.exercises[i];
    const st = entry.sets[j];
    const key = f === 'val' ? 'sec' : f;
    const next = f === 'val' && value !== '' ? value * this.unitOf(entry).factor : value;
    const prev = st[key];
    st[key] = next;

    const patch = { [`exercises[${i}].sets[${j}].${f}`]: value };
    for (let k = j + 1; k < entry.sets.length; k += 1) {
      const other = entry.sets[k];
      if (other.done || String(other[key]) !== String(prev)) continue;
      other[key] = next;
      patch[`exercises[${i}].sets[${k}].${f}`] = value;
    }
    this.setData(patch);
    this.refreshStats();
    this.touch();
  },

  toggleDone(e) {
    const { i, j } = e.currentTarget.dataset;
    const entry = this.session.exercises[i];
    const meta = this.exMap[entry.exerciseId];
    this.ensureEntryRests(entry, meta);

    const st = entry.sets[j];
    st.done = !st.done;
    const allDone = entry.sets.length > 0 && entry.sets.every((s) => s.done);

    this.setData({
      [`exercises[${i}].sets[${j}].done`]: st.done,
      [`exercises[${i}].allDone`]: allDone,
    });
    this.refreshStats();
    this.dirty = true;
    this.flush();

    if (st.done && storage.isActive(this.session)) {
      wx.vibrateShort({ type: 'light' });
      this.startRest(i, allDone);
    }
  },

  // 做完一组后开始休息：动作没做完用组间休息，做完了用换动作的休息并提示下一个
  startRest(i, allDone) {
    const entry = this.session.exercises[i];
    if (!allDone) {
      this.restEndAt = Date.now() + entry.restSec * 1000;
      this.setData({ restLabel: '组间休息' });
      this.tick();
      return;
    }
    const nextEntry = this.session.exercises
      .slice(i + 1)
      .find((nx) => (nx.sets || []).some((s) => !s.done));
    if (!nextEntry) {
      this.restEndAt = 0;
      this.setData({ restLeft: 0 });
      return;
    }
    const nextMeta = this.exMap[nextEntry.exerciseId];
    this.restEndAt = Date.now() + entry.transRestSec * 1000;
    this.setData({ restLabel: nextMeta ? `下一个：${nextMeta.name}` : '下一个动作' });
    this.tick();
  },

  // 做完一个动作后记感觉：下次开练时据此加减重量
  onPickRpe(e) {
    const { i, rpe } = e.currentTarget.dataset;
    const entry = this.session.exercises[i];
    const nextVal = entry.rpe === rpe ? '' : rpe;
    entry.rpe = nextVal;
    this.setData({ [`exercises[${i}].rpe`]: nextVal });
    this.dirty = true;
    this.flush();
    if (nextVal === 'easy') toast('下次会自动加一点重量');
    else if (nextVal === 'hard') toast('下次会自动降一点重量');
  },

  addSet(e) {
    const { i } = e.currentTarget.dataset;
    const entry = this.session.exercises[i];
    const unit = this.unitOf(entry);
    const prev = entry.sets[entry.sets.length - 1];
    let next;
    if (unit) next = { sec: prev ? prev.sec : unit.defaultSec, done: false };
    else next = { weight: prev ? prev.weight : '', reps: prev ? prev.reps : 10, done: false };
    entry.sets.push(next);
    this.setData({
      [`exercises[${i}].sets`]: this.viewSets(entry),
      [`exercises[${i}].allDone`]: false,
    });
    this.refreshStats();
    this.touch();
  },

  // 长按一组（或点组号）：删除这一组（至少留一组）
  openSetMenu(e) {
    const { i, j } = e.currentTarget.dataset;
    const entry = this.session.exercises[i];
    if (entry.sets.length <= 1) return;
    wx.showActionSheet({
      itemList: [`删除第 ${j + 1} 组`],
      success: () => {
        entry.sets.splice(j, 1);
        this.setData({
          [`exercises[${i}].sets`]: this.viewSets(entry),
          [`exercises[${i}].allDone`]: entry.sets.every((s) => s.done),
        });
        this.refreshStats();
        this.touch();
      },
    });
  },

  openExMenu(e) {
    const { i } = e.currentTarget.dataset;
    const count = this.session.exercises.length;
    const actions = [{ text: '休息时长', run: () => this.openRestSheet({ currentTarget: { dataset: { i } } }) }];
    if (i > 0) actions.push({ text: '上移', run: () => this.moveExercise(i, i - 1) });
    if (i < count - 1) actions.push({ text: '下移', run: () => this.moveExercise(i, i + 1) });
    actions.push({ text: '移除动作', run: () => this.removeExercise(i) });
    wx.showActionSheet({
      itemList: actions.map((a) => a.text),
      success: (res) => actions[res.tapIndex].run(),
    });
  },

  moveExercise(from, to) {
    const list = this.session.exercises;
    const [entry] = list.splice(from, 1);
    list.splice(to, 0, entry);
    this.rebuild();
    this.touch();
  },

  async removeExercise(i) {
    const ok = await confirm({
      title: '移除动作？',
      content: this.data.exercises[i].name,
      confirmText: '移除',
    });
    if (!ok) return;
    this.session.exercises.splice(i, 1);
    this.rebuild();
    this.touch();
  },

  openDetail(e) {
    this.flush();
    wx.navigateTo({ url: `/pages/exercise-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  // ---------- 添加动作 ----------

  openPicker() {
    this.setData({ showPicker: true });
  },

  closePicker() {
    this.setData({ showPicker: false });
  },

  onPicked(e) {
    this.session.exercises.push(...storage.buildEntries(e.detail.ids, this.session.id));
    this.setData({ showPicker: false });
    this.rebuild();
    this.touch();
  },

  // ---------- 结束 / 删除 ----------

  openMenu() {
    const live = storage.isActive(this.session);
    wx.showActionSheet({
      itemList: ['存为计划', live ? '放弃训练' : '删除训练'],
      success: (res) => {
        if (res.tapIndex === 0) this.saveAsTemplate();
        else this.remove(live);
      },
    });
  },

  saveAsTemplate() {
    this.flush();
    const tpl = storage.saveSessionAsTemplate(this.session);
    toast(tpl ? '已存为计划' : '先添加动作');
  },

  async remove(live) {
    const ok = await confirm({
      title: live ? '放弃这次训练？' : '删除训练记录？',
      content: live ? '已记录的组数不会保存。' : '删除后无法恢复。',
      confirmText: live ? '放弃' : '删除',
    });
    if (!ok) return;
    this.leaveWithout();
  },

  leaveWithout() {
    this.gone = true;
    clearTimeout(this.saveTimer);
    storage.deleteSession(this.dateStr, this.sessionId);
    wx.navigateBack();
  },

  async finish() {
    this.flush();
    const sum = storage.summarizeSession(this.session, this.exMap);
    if (sum.doneSets === 0) {
      const ok = await confirm({
        title: '还没有完成的组',
        content: '现在结束不会保存这次训练。',
        confirmText: '不保存',
        cancelText: '继续练',
      });
      if (ok) this.leaveWithout();
      return;
    }
    const left = sum.totalSets - sum.doneSets;
    if (left > 0) {
      const ok = await confirm({
        title: '结束训练？',
        content: `还有 ${left} 组没完成。`,
        confirmText: '结束',
        cancelText: '继续练',
      });
      if (!ok) return;
    }
    storage.finishSession(this.dateStr, this.sessionId);
    this.gone = true;
    this.stopTick();
    this.keepAwake(false);
    this.restEndAt = 0;
    const report = storage.getSessionReport(this.dateStr, this.sessionId);
    if (report) report.volumeText = formatThousands(report.volume);
    this.setData({ live: false, restLeft: 0, report, showReport: !!report });
    if (!report) wx.navigateBack();
  },

  closeReport() {
    wx.navigateBack();
  },

  noop() {},
});
