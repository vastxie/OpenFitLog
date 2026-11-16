const { APP_NAME, isTimedCat, timedUnit, getThemeStyle, applyTabBarTheme, getPartIcon } = require('../../utils/config');
const {
  getTodayStr,
  parseDate,
  addDays,
  addMonths,
  getIsoWeekday,
  getMonday,
  buildWeekDays,
  buildMonthDays,
  formatDayTitle,
} = require('../../utils/date');
const storage = require('../../utils/storage');
const { toast, closeSheet } = require('../../utils/ui');

function shiftAnchorDate(calMode, anchorDate, todayStr, dir) {
  if (calMode === 'week') {
    return addDays(anchorDate, dir * 7);
  }
  const next = addMonths(anchorDate, dir);
  return next.slice(0, 7) === todayStr.slice(0, 7) ? todayStr : next;
}

function buildPeriodDays(calMode, periodDateStr, trainedSet, selectedDateStr) {
  if (calMode === 'week') {
    return buildWeekDays(periodDateStr, trainedSet, selectedDateStr);
  }
  const dt = parseDate(periodDateStr);
  return buildMonthDays(dt.getFullYear(), dt.getMonth() + 1, trainedSet, selectedDateStr);
}

Page({
  data: {
    themeStyle: '',
    todayStr: '',
    selectedDate: '',
    calMode: 'week',
    anchorDate: '',
    calTitle: '',
    calCurrent: 1,
    calSlides: [
      { idx: 0, days: [] },
      { idx: 1, days: [] },
      { idx: 2, days: [] },
    ],
    calSwiperHeight: 96,
    calAnimCls: '',

    dayTitle: '',
    sessionCards: [],
    extraRows: [],
    planPreview: null,
    emptyText: '',
    nextText: '',
    weekText: '',

    // 'resume' | 'plan' | 'start' | 'again' | 'past' | ''
    dockMode: '',
    sheetTitle: '',
    showStart: false,
    templates: [],
    hasAnyPlan: false,
    showSync: false,
    showPlanPrompt: false,
  },

  onLoad() {
    this.calIndex = 1;
    this._animFlip = false;
    const today = getTodayStr();
    this.setData({ todayStr: today, selectedDate: today, anchorDate: today });
  },

  onShow() {
    this.navigating = false;
    const prof = storage.getProfile();
    applyTabBarTheme(prof.theme);
    const today = getTodayStr();
    // 第一次打开只问要不要排计划；若配置了云同步后端，等练完第一次再询问是否开启同步
    const needSyncChoice =
      storage.isCloudConfigured() && storage.getSyncPref() === '' && storage.getTrainedDateSet().size > 0;
    const patch = {
      themeStyle: getThemeStyle(prof.theme),
      showSync: needSyncChoice,
      showPlanPrompt: !needSyncChoice && storage.shouldPromptPlan(),
    };
    if (today !== this.data.todayStr) {
      patch.todayStr = today;
      patch.selectedDate = today;
      patch.anchorDate = today;
    }
    this.setData(patch, () => this.refresh());
  },

  onShareAppMessage() {
    return { title: APP_NAME, path: '/pages/train/index' };
  },

  refresh(overrides) {
    const extra = overrides || {};
    const calMode = extra.calMode !== undefined ? extra.calMode : this.data.calMode;
    const anchorDate = extra.anchorDate !== undefined ? extra.anchorDate : this.data.anchorDate;
    const selectedDate = extra.selectedDate !== undefined ? extra.selectedDate : this.data.selectedDate;
    const todayStr = extra.todayStr !== undefined ? extra.todayStr : this.data.todayStr;

    const trainedSet = storage.getTrainedDateSet();
    const anchor = parseDate(anchorDate);
    const y = anchor.getFullYear();
    const m = anchor.getMonth() + 1;

    const c = this.calIndex !== undefined ? this.calIndex : 1;
    const currDays = buildPeriodDays(calMode, anchorDate, trainedSet, selectedDate);
    const prevAnchor = shiftAnchorDate(calMode, anchorDate, todayStr, -1);
    const nextAnchor = shiftAnchorDate(calMode, anchorDate, todayStr, 1);
    const prevDays = buildPeriodDays(calMode, prevAnchor, trainedSet, prevAnchor);
    const nextDays = buildPeriodDays(calMode, nextAnchor, trainedSet, nextAnchor);

    const calSlides = [null, null, null];
    calSlides[c] = { idx: c, days: currDays };
    calSlides[(c + 2) % 3] = { idx: (c + 2) % 3, days: prevDays };
    calSlides[(c + 1) % 3] = { idx: (c + 1) % 3, days: nextDays };
    const calSwiperHeight = Math.max(1, Math.ceil(currDays.length / 7)) * 96;

    const exMap = storage.getExerciseMap();
    const rec = storage.getDayRecord(selectedDate);

    // 1. 当天的训练记录
    const sessionCards = rec.sessions.map((ses) => {
      const sum = storage.summarizeSession(ses, exMap);
      const live = storage.isActive(ses);

      const parts = [];
      if (live) {
        parts.push('进行中', `${sum.doneSets}/${sum.totalSets} 组`);
        const remMin = storage.estimateRemainingMinutes(ses, exMap);
        if (remMin > 0) parts.push(`大约还剩 ${remMin} 分钟`);
      } else {
        if (ses.durationSec >= 60) parts.push(`${Math.round(ses.durationSec / 60)} 分钟`);
        parts.push(`${sum.doneSets} 组`);
        if (sum.volume > 0) parts.push(`${sum.volume} kg`);
      }

      const items = (ses.exercises || []).map((entry, idx) => {
        const meta = exMap[entry.exerciseId];
        const unit = meta && isTimedCat(meta.cat) ? timedUnit(meta.cat) : null;
        const sets = entry.sets || [];
        const doneList = sets.filter((st) => st.done);
        let right = storage.formatSetsSummary(sets, unit);
        if (doneList.length > 0) {
          right =
            live && doneList.length < sets.length
              ? `${doneList.length}/${sets.length} 组`
              : storage.formatSetsSummary(doneList, unit);
        }
        return {
          key: `${ses.id}_${idx}`,
          name: meta ? meta.name : '已删除的动作',
          part: getPartIcon(meta),
          done: doneList.length > 0,
          right,
        };
      });

      return {
        id: ses.id,
        title: ses.title || '自由训练',
        metaText: parts.join(' · '),
        items,
      };
    });

    const extraRows = (rec.extraLogs || []).map((ext) => ({
      id: ext.id,
      title: ext.title,
      meta: ext.note || '',
      side: `${ext.minutes} 分钟`,
    }));

    // 2. 没有记录时：今天和以后看计划，过去只提示没有记录
    let planPreview = null;
    let emptyText = '';
    let nextText = '';
    const hasRecords = sessionCards.length > 0 || extraRows.length > 0;
    const isToday = selectedDate === todayStr;
    const hasAnyPlan = storage.getTemplates().length > 0;

    if (!hasRecords) {
      const plannedTpl = selectedDate >= todayStr ? storage.getPlannedTemplateForDate(selectedDate) : null;
      if (plannedTpl) {
        let totalSets = 0;
        const items = (plannedTpl.items || [])
          .filter((it) => exMap[it.exerciseId])
          .map((it, idx) => {
            const sets = Math.max(1, Number(it.sets) || 3);
            totalSets += sets;
            return {
              key: `${plannedTpl.id}_${idx}`,
              name: exMap[it.exerciseId].name,
              part: getPartIcon(exMap[it.exerciseId]),
              right: storage.formatPlanItem(it, exMap[it.exerciseId]),
            };
          });
        planPreview = {
          tplId: plannedTpl.id,
          name: plannedTpl.name,
          metaText: `${totalSets} 组 · 约 ${storage.estimateTemplateMinutes(plannedTpl, exMap)} 分钟`,
          items,
        };
      } else if (selectedDate >= todayStr) {
        if (!hasAnyPlan) {
          emptyText = '还没有训练计划';
        } else {
          emptyText = isToday ? '今天休息' : '休息日';
          const next = storage.getNextPlannedInfo(selectedDate);
          if (next) nextText = `下次训练：${next.dayLabel} ${next.tpl.name}`;
        }
      } else {
        emptyText = '这天没有记录';
      }
    }

    // 本周进度：选中的是本周某天时显示在日期旁边
    let weekText = '';
    const monday = getMonday(todayStr);
    if (selectedDate >= monday && selectedDate <= addDays(monday, 6)) {
      let done = 0;
      trainedSet.forEach((ds) => {
        if (ds >= monday && ds <= addDays(monday, 6)) done += 1;
      });
      const planned = new Set(storage.getTemplates().filter((t) => t.weekday).map((t) => t.weekday)).size;
      weekText = planned > 0 ? `本周 ${done} / ${planned} 次` : done > 0 ? `本周 ${done} 次` : '';
    }

    // 3. 底部按钮
    let dockMode = '';
    if (storage.getActiveSession()) dockMode = 'resume';
    else if (isToday) dockMode = planPreview ? 'plan' : hasRecords ? 'again' : 'start';
    else if (selectedDate < todayStr) dockMode = 'past';

    this.setData({
      ...extra,
      calTitle: `${y}年${m}月`,
      calCurrent: c,
      calSlides,
      calSwiperHeight,
      dayTitle: formatDayTitle(selectedDate),
      sessionCards,
      extraRows,
      planPreview,
      emptyText,
      nextText,
      weekText,
      hasAnyPlan,
      dockMode,
    });
  },

  // ---------- 日历 ----------

  nextAnimCls(dir) {
    this._animFlip = !this._animFlip;
    const suffix = this._animFlip ? 'a' : 'b';
    return dir > 0 ? `cal-slide-next-${suffix}` : `cal-slide-prev-${suffix}`;
  },

  toggleCalMode() {
    const nextMode = this.data.calMode === 'week' ? 'month' : 'week';
    this.refresh({ calMode: nextMode, calAnimCls: '' });
  },

  onCalSwiperChange(e) {
    if (!e.detail || e.detail.source !== 'touch') return;
    const prevIdx = this.calIndex !== undefined ? this.calIndex : 1;
    const nextIdx = e.detail.current;
    if (nextIdx === prevIdx) return;
    const dir = (nextIdx - prevIdx + 3) % 3 === 1 ? 1 : -1;
    this.calIndex = nextIdx;
    const { calMode, anchorDate, todayStr } = this.data;
    const next = shiftAnchorDate(calMode, anchorDate, todayStr, dir);
    this.refresh({ anchorDate: next, selectedDate: next, calAnimCls: '' });
  },

  shiftPeriod(dir) {
    const { calMode, anchorDate, todayStr } = this.data;
    const next = shiftAnchorDate(calMode, anchorDate, todayStr, dir);
    this.refresh({
      anchorDate: next,
      selectedDate: next,
      calAnimCls: this.nextAnimCls(dir),
    });
  },

  onCalTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
  },

  // 标题与星期栏也支持左右滑翻页
  onCalTouchEnd(e) {
    const t = e.changedTouches && e.changedTouches[0];
    if (!t || this.touchStartX === undefined) return;
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;
    this.touchStartX = undefined;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.shiftPeriod(dx < 0 ? 1 : -1);
    }
  },

  prevPeriod() {
    this.shiftPeriod(-1);
  },

  nextPeriod() {
    this.shiftPeriod(1);
  },

  goToday() {
    const { todayStr, anchorDate } = this.data;
    let calAnimCls = '';
    if (anchorDate && anchorDate !== todayStr) {
      calAnimCls = this.nextAnimCls(todayStr > anchorDate ? 1 : -1);
    }
    this.refresh({ anchorDate: todayStr, selectedDate: todayStr, calAnimCls });
  },

  selectDate(e) {
    const ds = e.currentTarget.dataset.date;
    const { calMode, anchorDate } = this.data;
    let calAnimCls = '';
    if (calMode === 'month' && ds.slice(0, 7) !== anchorDate.slice(0, 7)) {
      calAnimCls = this.nextAnimCls(ds > anchorDate ? 1 : -1);
    }
    this.refresh({ selectedDate: ds, anchorDate: ds, calAnimCls });
  },

  // ---------- 列表点击：只查看，不开始 ----------

  onCardTap(e) {
    this.openSession(this.data.selectedDate, e.currentTarget.dataset.id);
  },

  onPreviewTap() {
    const { planPreview } = this.data;
    if (!planPreview) return;
    wx.navigateTo({ url: `/pages/template-edit/index?id=${planPreview.tplId}` });
  },

  onExtraTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['删除记录'],
      success: () => {
        storage.deleteExtraLog(this.data.selectedDate, id);
        this.refresh();
      },
    });
  },

  openSession(dateStr, id) {
    if (this.navigating) return;
    this.navigating = true;
    wx.navigateTo({ url: `/pages/session/index?date=${dateStr}&id=${id}` });
  },

  // ---------- 开始 / 继续 / 补记 ----------

  onResume() {
    const active = storage.getActiveSession();
    if (active) this.openSession(active.dateStr, active.session.id);
    else this.refresh();
  },

  startTodayPlan() {
    const { planPreview } = this.data;
    if (planPreview) this.startWithTemplate(planPreview.tplId);
  },

  startWithTemplate(tplId) {
    if (this.navigating) return;
    const tpl = tplId ? storage.getTemplateById(tplId) : null;
    const { dateStr, session } = storage.startSession(this.data.selectedDate, tpl);
    this.setData({ showStart: false });
    this.openSession(dateStr, session.id);
  },

  openStartSheet() {
    const { selectedDate, todayStr } = this.data;
    const exMap = storage.getExerciseMap();
    const dow = getIsoWeekday(selectedDate);
    const list = storage.getTemplates().slice();
    // 排在这一天的计划放最前
    list.sort((a, b) => (b.weekday === dow ? 1 : 0) - (a.weekday === dow ? 1 : 0));

    const templates = list.map((tpl) => {
      const validCount = (tpl.items || []).filter((it) => exMap[it.exerciseId]).length;
      const parts = [];
      if (tpl.weekday) parts.push(storage.DOW_LABELS[tpl.weekday]);
      parts.push(`${validCount} 个动作`, `约 ${storage.estimateTemplateMinutes(tpl, exMap)} 分钟`);
      return { id: tpl.id, name: tpl.name, sub: parts.join(' · ') };
    });

    this.setData({
      sheetTitle: selectedDate < todayStr ? '补记训练' : '开始训练',
      showStart: true,
      templates,
    });
  },

  onStart(e) {
    this.startWithTemplate(e.currentTarget.dataset.id);
  },

  closeStart() {
    closeSheet(this, { showStart: false });
  },

  // ---------- 云同步首次选择 & 定制计划引导 ----------

  async chooseSync(e) {
    const on = !!e.currentTarget.dataset.on;
    // 收起动画播完再弹下一个面板，避免两个面板叠在一起
    await new Promise((resolve) => closeSheet(this, { showSync: false }, resolve));
    if (on) {
      wx.showLoading({ title: '同步中' });
      await storage.setSyncEnabled(true);
      wx.hideLoading();
    } else {
      storage.setSyncEnabled(false);
    }
    this.refresh();
    if (storage.shouldPromptPlan()) {
      this.setData({ showPlanPrompt: true });
    }
  },

  skipPlanPrompt() {
    storage.markPlanPrompted();
    closeSheet(this, { showPlanPrompt: false });
    toast('稍后可在「我的-我的计划-定制训练计划」中设置', 2600);
  },

  goPlanWizard() {
    storage.markPlanPrompted();
    this.setData({ showPlanPrompt: false, showStart: false });
    wx.navigateTo({ url: '/pages/plan-wizard/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  noop() {},
});
