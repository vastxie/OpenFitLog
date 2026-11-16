const { getThemeStyle, isTimedCat, timedUnit, getDefaultRests } = require('../../utils/config');
const storage = require('../../utils/storage');
const { padFor } = require('../../utils/pad');
const { confirm, toast, closeSheet } = require('../../utils/ui');

const DOW_OPTIONS = ['不固定', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SMALL_REST_OPTS = [30, 45, 60, 75, 90, 120];
const BIG_REST_OPTS = [60, 90, 120, 150, 180, 210];

Page({
  data: {
    themeStyle: '',
    id: '',
    name: '',
    desc: '',
    weekday: 0,
    dowOptions: DOW_OPTIONS,
    items: [],
    showPicker: false,
    pad: { show: false },

    showRestSheet: false,
    restEditIdx: -1,
    restEditName: '',
    restEditSmall: 75,
    restEditBig: 105,
    smallRestOpts: SMALL_REST_OPTS,
    bigRestOpts: BIG_REST_OPTS,
  },

  onLoad(options) {
    this.exMap = storage.getExerciseMap();
    const prof = storage.getProfile();
    const goal = (prof.planPrefs && prof.planPrefs.goal) || 'hypertrophy';
    const tpl = options.id ? storage.getTemplateById(options.id) : null;

    this.items = tpl
      ? tpl.items
          .filter((it) => this.exMap[it.exerciseId])
          .map((it) => {
            const copy = Object.assign({}, it);
            const defs = getDefaultRests(this.exMap[copy.exerciseId], goal);
            if (!copy.restSec) copy.restSec = defs.restSec;
            if (!copy.transRestSec) copy.transRestSec = defs.transRestSec;
            return copy;
          })
      : [];

    this.setData({
      themeStyle: getThemeStyle(prof.theme),
      id: tpl ? tpl.id : '',
      name: tpl ? tpl.name : '',
      desc: tpl ? tpl.desc || '' : '',
      weekday: tpl && tpl.weekday ? tpl.weekday : 0,
    });
    wx.setNavigationBarTitle({ title: tpl ? '编辑计划' : '新建计划' });
    this.render();
  },

  onShow() {
    this.setData({ themeStyle: getThemeStyle(storage.getProfile().theme) });
  },

  unitOf(it) {
    const meta = this.exMap[it.exerciseId];
    return meta && isTimedCat(meta.cat) ? timedUnit(meta.cat) : null;
  },

  render() {
    this.setData({
      items: this.items.map((it, i) => {
        const unit = this.unitOf(it);
        return {
          key: `${i}_${it.exerciseId}`,
          name: this.exMap[it.exerciseId].name,
          timed: !!unit,
          sets: it.sets,
          amount: unit ? Math.round((it.sec / unit.factor) * 10) / 10 : it.reps,
          unitLabel: unit ? unit.label : '次',
          weight: !unit && it.weight !== undefined && it.weight !== '' ? it.weight : '',
        };
      }),
    });
  },

  // 有改动没保存时，返回前提醒
  markDirty() {
    if (this.dirty) return;
    this.dirty = true;
    wx.enableAlertBeforeUnload({ message: '改动还没保存，确定离开吗？' });
  },

  clearDirty() {
    this.dirty = false;
    wx.disableAlertBeforeUnload();
  },

  onName(e) {
    this.setData({ name: e.detail.value });
    this.markDirty();
  },

  onDesc(e) {
    this.setData({ desc: e.detail.value });
    this.markDirty();
  },

  onDow(e) {
    this.setData({ weekday: Number(e.detail.value) || 0 });
    this.markDirty();
  },

  // 点组数 / 次数（时长）/ 重量：弹内置数字键盘，和训练中同一套
  openPad(e) {
    const { i, f } = e.currentTarget.dataset;
    const it = this.items[i];
    const meta = this.exMap[it.exerciseId];
    const view = this.data.items[i];
    const field = f === 'amount' ? (view.timed ? 'val' : 'reps') : f;
    const pad = padFor(field, meta, view[f], meta.name);
    // 计划里的次数 / 时长不能空着
    if (field === 'reps' || field === 'val') Object.assign(pad, { min: 1, allowEmpty: false });
    this.padTarget = { i, f };
    this.setData({ pad: Object.assign(pad, { show: true }) });
  },

  closePad() {
    this.setData({ 'pad.show': false });
  },

  onPadConfirm(e) {
    this.setData({ 'pad.show': false });
    const t = this.padTarget;
    if (!t) return;
    const value = e.detail.value;
    const it = this.items[t.i];
    if (t.f === 'weight') {
      it.weight = value;
    } else if (t.f === 'sets') {
      it.sets = value;
    } else {
      const unit = this.unitOf(it);
      if (unit) it.sec = value * unit.factor;
      else it.reps = value;
    }
    this.setData({ [`items[${t.i}].${t.f}`]: value });
    this.markDirty();
  },

  openRestSheet(e) {
    const i = Number(e.currentTarget.dataset.i);
    const it = this.items[i];
    const meta = this.exMap[it.exerciseId];
    this.setData({
      showRestSheet: true,
      restEditIdx: i,
      restEditName: meta ? meta.name : '休息时长',
      restEditSmall: it.restSec,
      restEditBig: it.transRestSec,
    });
  },

  closeRestSheet() {
    closeSheet(this, { showRestSheet: false });
  },

  pickSmallRest(e) {
    const val = Number(e.currentTarget.dataset.s);
    const i = this.data.restEditIdx;
    if (i < 0) return;
    this.items[i].restSec = val;
    this.setData({ restEditSmall: val });
    this.markDirty();
  },

  pickBigRest(e) {
    const val = Number(e.currentTarget.dataset.s);
    const i = this.data.restEditIdx;
    if (i < 0) return;
    this.items[i].transRestSec = val;
    this.setData({ restEditBig: val });
    this.markDirty();
  },

  openItemMenu(e) {
    const { i } = e.currentTarget.dataset;
    const actions = [{ text: '休息时长', run: () => this.openRestSheet({ currentTarget: { dataset: { i } } }) }];
    if (i > 0) actions.push({ text: '上移', run: () => this.move(i, i - 1) });
    if (i < this.items.length - 1) actions.push({ text: '下移', run: () => this.move(i, i + 1) });
    actions.push({
      text: '移除动作',
      run: () => {
        this.items.splice(i, 1);
        this.render();
        this.markDirty();
      },
    });
    wx.showActionSheet({
      itemList: actions.map((a) => a.text),
      success: (res) => actions[res.tapIndex].run(),
    });
  },

  move(from, to) {
    const [it] = this.items.splice(from, 1);
    this.items.splice(to, 0, it);
    this.render();
    this.markDirty();
  },

  openPicker() {
    this.setData({ showPicker: true });
  },

  closePicker() {
    this.setData({ showPicker: false });
  },

  onPicked(e) {
    this.exMap = storage.getExerciseMap();
    const prof = storage.getProfile();
    const goal = (prof.planPrefs && prof.planPrefs.goal) || 'hypertrophy';
    e.detail.ids.forEach((exerciseId) => {
      const meta = this.exMap[exerciseId];
      const defs = getDefaultRests(meta, goal);
      const unit = this.unitOf({ exerciseId });
      this.items.push(
        unit
          ? { exerciseId, sets: unit.defaultSets, sec: unit.defaultSec, restSec: defs.restSec, transRestSec: defs.transRestSec }
          : { exerciseId, sets: 3, reps: 10, restSec: defs.restSec, transRestSec: defs.transRestSec }
      );
    });
    this.setData({ showPicker: false });
    this.render();
    this.markDirty();
  },

  save() {
    if (!this.data.name.trim()) {
      toast('先填计划名称');
      return;
    }
    if (this.items.length === 0) {
      toast('先添加动作');
      return;
    }
    storage.saveTemplate({
      id: this.data.id,
      name: this.data.name,
      desc: this.data.desc,
      weekday: this.data.weekday,
      items: this.items,
    });
    this.clearDirty();
    wx.navigateBack();
  },

  async remove() {
    const ok = await confirm({
      title: '删除这套计划？',
      content: '之前的训练记录不受影响。',
      confirmText: '删除',
    });
    if (!ok) return;
    storage.deleteTemplate(this.data.id);
    this.clearDirty();
    wx.navigateBack();
  },

  noop() {},
});
