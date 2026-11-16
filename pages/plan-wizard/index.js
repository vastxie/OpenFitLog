const { DOW_LABELS, getSplitSpec, buildWeeklyPlan, normalizePrefs } = require('../../data/default-templates');
const { getThemeStyle, getPartIcon } = require('../../utils/config');
const storage = require('../../utils/storage');
const { toast } = require('../../utils/ui');

// 第 1、2 步的数字项：用内置数字键盘输入，确定时校验范围；清空表示不填
const EDIT_FIELDS = {
  age: { label: '年龄', unit: '岁', min: 10, max: 95, decimals: 0 },
  heightCm: { label: '身高', unit: 'cm', min: 100, max: 230, decimals: 1 },
  weightKg: { label: '体重', unit: 'kg', min: 25, max: 250, decimals: 1 },
  targetWeightKg: { label: '目标体重', unit: 'kg', min: 25, max: 250, decimals: 1 },
};

const DAY_ITEMS = [
  { dow: 1, label: '一' },
  { dow: 2, label: '二' },
  { dow: 3, label: '三' },
  { dow: 4, label: '四' },
  { dow: 5, label: '五' },
  { dow: 6, label: '六' },
  { dow: 7, label: '日' },
];

const GOALS = [
  { key: 'hypertrophy', name: '增肌', desc: '每组 8–12 次，提升肌肉围度' },
  { key: 'strength', name: '力量', desc: '每组 6–8 次为主，组间多歇一会儿' },
  { key: 'fat_loss', name: '减脂', desc: '每组 12–15 次，节奏更紧凑' },
  { key: 'posture', name: '改善体态', desc: '侧重背部和肩后束，缓解久坐圆肩' },
];

const EXPERIENCES = [
  { key: 'beginner', name: '新手', desc: '刚开始练，或不到 3 个月' },
  { key: 'intermediate', name: '有基础', desc: '断断续续或规律练过 3–12 个月' },
  { key: 'advanced', name: '常练', desc: '规律训练 1 年以上' },
];

const PUSHUPS = [
  { key: '0_5', name: '0–5 个' },
  { key: '6_15', name: '6–15 个' },
  { key: '16_30', name: '16–30 个' },
  { key: '30_plus', name: '30 个以上' },
];

const PLACES = [
  { key: 'gym', name: '健身房', desc: '固定器械、绳索、哑铃杠铃都有' },
  { key: 'home', name: '居家器械', desc: '家里有哑铃、杠铃或弹力带等' },
  { key: 'bodyweight', name: '徒手训练', desc: '不用器械，在家或出差都能练' },
];

const HOME_EQUIPS = [
  { key: 'dumbbell', name: '哑铃' },
  { key: 'barbell', name: '杠铃' },
  { key: 'bench', name: '健身椅' },
  { key: 'pullup', name: '单杠' },
  { key: 'band', name: '弹力带' },
];

const FOCUSES = [
  { key: 'balanced', name: '全身均衡' },
  { key: 'upper', name: '胸肩手臂' },
  { key: 'back_posture', name: '背部' },
  { key: 'lower', name: '臀腿' },
];

const DURATIONS = [
  { key: 'short', name: '30 分钟' },
  { key: 'normal', name: '45 分钟' },
  { key: 'long', name: '60 分钟' },
];

const GEN_STAGES = ['安排训练日', '挑选动作和组数', '估算起始重量'];

const TOTAL_STEPS = 7;
const GEN_DURATION_MS = 2400;

Page({
  data: {
    themeStyle: '',
    phase: 'form', // 'form' | 'generating' | 'result'
    step: 1,
    totalSteps: TOTAL_STEPS,
    canSkip: true,
    edit: {}, // 正在输入的数字项
    editing: false,
    stepPct: 14,

    goals: GOALS,
    experiences: EXPERIENCES,
    pushupsList: PUSHUPS,
    places: PLACES,
    homeEquipList: [],
    dayItems: [],
    focuses: FOCUSES,
    durations: DURATIONS,

    form: {
      gender: 'male',
      age: '',
      heightCm: '',
      weightKg: '',
      targetWeightKg: '',
      goal: 'hypertrophy',
      experience: 'intermediate',
      pushups: '6_15',
      place: 'gym',
      homeEquip: ['dumbbell', 'bench'],
      weekdays: [1, 3, 5],
      focus: 'balanced',
      durationPref: 'normal',
      withStretch: true,
    },
    splitSummary: '',

    // 生成中的进度
    genPct: 0,
    genStageItems: [],

    // 生成结果预览
    previewDays: [],
    resultHeadline: '',
  },

  onLoad() {
    const profile = storage.getProfile();
    const prefs = storage.getPlanPrefs();
    const logs = storage.getWeightLogs();
    const curWeight = prefs.weightKg || (logs[0] ? logs[0].weightKg : '');

    const form = Object.assign({}, prefs, {
      gender: profile.gender || prefs.gender || 'male',
      age: profile.age || prefs.age || '',
      heightCm: profile.heightCm || prefs.heightCm || '',
      weightKg: curWeight || '',
      targetWeightKg: profile.targetWeightKg || prefs.targetWeightKg || '',
    });

    this.form = form;
    this.syncFormView({ themeStyle: getThemeStyle(profile.theme) });
  },

  onUnload() {
    if (this.genTimer) clearInterval(this.genTimer);
  },

  syncFormView(extra) {
    const f = this.form;
    const eqSet = new Set(f.homeEquip || []);
    const daySet = new Set(f.weekdays || [1, 3, 5]);
    const spec = getSplitSpec(daySet.size);

    this.setData(
      Object.assign(
        {
          form: Object.assign({}, f),
          homeEquipList: HOME_EQUIPS.map((e) => ({ key: e.key, name: e.name, on: eqSet.has(e.key) })),
          dayItems: DAY_ITEMS.map((d) => ({ dow: d.dow, label: d.label, on: daySet.has(d.dow) })),
          splitSummary: spec.summary,
          stepPct: Math.round((this.data.step / TOTAL_STEPS) * 100),
          canSkip: this.canSkip(),
        },
        extra || {}
      )
    );
  },

  // ---------- 表单交互 ----------

  pickOpt(e) {
    const { field, val } = e.currentTarget.dataset;
    this.form[field] = val;
    this.syncFormView();
  },

  // 「跳过」只在这一步的选填项都空着时出现，填了任何一项就只能点「下一步」
  canSkip() {
    const f = this.form;
    const step = this.data.step;
    if (step === 1) return !f.age;
    if (step === 2) return !f.heightCm && !f.weightKg && !f.targetWeightKg;
    return false;
  },

  openEdit(e) {
    const key = e.currentTarget.dataset.field;
    const conf = EDIT_FIELDS[key];
    if (!conf) return;
    this.setData({ edit: Object.assign({ key, value: this.form[key] || '' }, conf), editing: true });
  },

  // 数字键盘已校验过范围；空字符串表示不填
  confirmEdit(e) {
    this.form[this.data.edit.key] = e.detail.value;
    this.syncFormView({ editing: false });
  },

  closeEdit() {
    this.setData({ editing: false });
  },

  toggleHomeEquip(e) {
    const key = e.currentTarget.dataset.key;
    const list = (this.form.homeEquip || []).slice();
    const idx = list.indexOf(key);
    if (idx >= 0) {
      if (list.length <= 1) {
        toast('至少勾选一件器材，没器材可选「徒手训练」');
        return;
      }
      list.splice(idx, 1);
    } else {
      list.push(key);
    }
    this.form.homeEquip = list;
    this.syncFormView();
  },

  toggleDay(e) {
    const dow = Number(e.currentTarget.dataset.dow);
    const list = (this.form.weekdays || []).slice();
    const idx = list.indexOf(dow);
    if (idx >= 0) {
      if (list.length <= 1) {
        toast('至少选一天');
        return;
      }
      list.splice(idx, 1);
    } else {
      list.push(dow);
      list.sort((a, b) => a - b);
    }
    this.form.weekdays = list;
    this.syncFormView();
  },

  toggleStretch() {
    this.form.withStretch = !this.form.withStretch;
    this.syncFormView();
  },

  // ---------- 步骤导航 ----------

  prevStep() {
    if (this.data.step <= 1) return;
    this.setData({ step: this.data.step - 1 }, () => this.syncFormView());
  },

  skipStep() {
    if (!this.canSkip()) return;
    this.nextStep();
  },

  nextStep() {
    if (this.data.step < TOTAL_STEPS) {
      this.setData({ step: this.data.step + 1 }, () => this.syncFormView());
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      return;
    }
    this.startGenerating();
  },

  // ---------- 生成 ----------

  buildStageItems(stageIdx) {
    return GEN_STAGES.map((txt, idx) => ({
      txt,
      state: idx < stageIdx ? 'done' : idx === stageIdx ? 'doing' : 'todo',
    }));
  },

  startGenerating() {
    const startAt = Date.now();
    this.setData({
      phase: 'generating',
      genPct: 0,
      genStageItems: this.buildStageItems(0),
    });

    const exMap = storage.getExerciseMap();
    const cleanPrefs = normalizePrefs(this.form);
    const built = buildWeeklyPlan(cleanPrefs, exMap);

    if (this.genTimer) clearInterval(this.genTimer);
    this.genTimer = setInterval(() => {
      const elapsed = Date.now() - startAt;
      const ratio = Math.min(1, elapsed / GEN_DURATION_MS);
      const pct = Math.min(100, Math.round(ratio * 100));
      const stageIdx = Math.min(GEN_STAGES.length - 1, Math.floor(ratio * GEN_STAGES.length));

      this.setData({
        genPct: pct,
        genStageItems: this.buildStageItems(stageIdx),
      });

      if (elapsed >= GEN_DURATION_MS) {
        clearInterval(this.genTimer);
        this.genTimer = null;
        this.showResult(cleanPrefs, built, exMap);
      }
    }, 80);
  },

  showResult(prefs, built, exMap) {
    const previewDays = built.map((tpl) => {
      const samples = tpl.items.map((it, idx) => {
        const meta = exMap[it.exerciseId];
        return {
          key: `${tpl.id}_${idx}`,
          name: meta ? meta.name : '',
          part: getPartIcon(meta),
          detail: storage.formatPlanItem(it, meta),
        };
      });
      const parts = [];
      if (tpl.weekday) parts.push(DOW_LABELS[tpl.weekday]);
      parts.push(`约 ${storage.estimateTemplateMinutes(tpl, exMap)} 分钟`);
      return { id: tpl.id, name: tpl.name, metaText: parts.join(' · '), samples };
    });

    this.pendingPrefs = prefs;
    this.setData({
      phase: 'result',
      resultHeadline: getSplitSpec(prefs.weekdays.length).summary,
      previewDays,
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  confirmApply() {
    storage.applyGeneratedPlan(this.pendingPrefs || this.form);
    toast('计划已更新');
    setTimeout(() => {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: '/pages/train/index' }),
      });
    }, 300);
  },

  restartWizard() {
    this.setData({ phase: 'form', step: 1 }, () => this.syncFormView());
  },

  noop() {},
});
