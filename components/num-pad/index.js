// 内置数字键盘：底部面板 + 大号数字 +（可选）快捷加减 + 3×4 键盘 + 确定
// 用法：<num-pad show="{{}}" title="身高" unit="cm" value="{{165}}" min="100" max="230" decimals="1" bind:confirm bind:close />
// confirm 返回 { value }：数字，或空字符串（allowEmpty 时清空表示不填）
// 快捷加减：steps="{{[0.5, 1, 2, 5]}}" 显示「−2 / 0.5 1 2 5 / +2」，只给一个步长时只显示 −/+；
// step-key 用来在本机记住上次选的步长（比如按器械分别记）
const { getThemeStyle } = require('../../utils/config');
const storage = require('../../utils/storage');

const MAX_INT_DIGITS = 3;

Component({
  options: {
    styleIsolation: 'apply-shared',
    multipleSlots: true,
  },

  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    unit: { type: String, value: '' },
    value: { type: null, value: '' },
    min: { type: Number, value: 0 },
    max: { type: Number, value: 999 },
    decimals: { type: Number, value: 0 }, // 允许的小数位：0 或 1
    allowEmpty: { type: Boolean, value: true },
    confirmText: { type: String, value: '确定' },
    steps: { type: Array, value: [] },
    step: { type: Number, value: 0 }, // 没记住过时默认的步长
    stepKey: { type: String, value: '' },
  },

  data: {
    themeStyle: '',
    text: '',
    hint: '',
    error: false,
    shake: false,
    fresh: false,
    out: false,
    keys: [],
    stepList: [],
    curStep: 0,
  },

  // 用 observers 而不是属性 observer：保证 value / min / max 等同一次传进来的属性都已更新
  observers: {
    show(show) {
      if (show && !this.isOpen) this.open();
      this.isOpen = show;
    },
  },

  methods: {
    open() {
      this.closing = false;
      const v = this.properties.value;
      const text = v === '' || v === null || v === undefined ? '' : `${v}`;
      // 打开时的旧值处于「选中」状态：直接按数字会整体替换，按退格才逐位删
      this.fresh = text !== '';
      const { steps, step, stepKey } = this.properties;
      let curStep = steps.indexOf(step) >= 0 ? step : steps[0] || 0;
      if (stepKey && steps.length > 1) {
        try {
          const saved = wx.getStorageSync(`fitlog_ui_step_${stepKey}`);
          if (steps.indexOf(saved) >= 0) curStep = saved;
        } catch (e) {
          // 读不到就用默认步长
        }
      }
      this.setData({
        stepList: steps.length > 1 ? steps : [],
        curStep,
        themeStyle: getThemeStyle(storage.getProfile().theme),
        text,
        hint: this.rangeHint(),
        error: false,
        shake: false,
        fresh: this.fresh,
        out: false,
        keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', this.properties.decimals > 0 ? '.' : '', '0', 'del'],
      });
    },

    rangeHint() {
      const { min, max, unit } = this.properties;
      return `${min}–${max}${unit ? ` ${unit}` : ''}`;
    },

    onKey(e) {
      const key = e.currentTarget.dataset.key;
      if (!key) return;
      // 有超范围提示时，按任何键都先恢复成范围说明
      if (this.data.error) this.setData({ error: false, shake: false, hint: this.rangeHint() });
      if (key === 'del') {
        this.backspace();
        return;
      }
      let text = this.fresh ? '' : this.data.text;
      this.fresh = false;
      const [intPart, decPart] = text.split('.');
      if (key === '.') {
        if (text.includes('.')) return;
        text = text === '' ? '0.' : `${text}.`;
      } else if (decPart !== undefined) {
        if (decPart.length >= this.properties.decimals) return;
        text += key;
      } else if (intPart === '0') {
        text = key;
      } else {
        if (intPart.length >= MAX_INT_DIGITS) return;
        text += key;
      }
      this.update(text);
    },

    // −/+：按当前步长加减，结果夹在范围内；之后再按数字会整体替换
    onAdjust(e) {
      const dir = Number(e.currentTarget.dataset.dir);
      const { min, max, decimals } = this.properties;
      const base = Number(this.data.text.replace(/\.$/, '')) || 0;
      const scale = 10 ** decimals;
      let next = Math.round((base + dir * this.data.curStep) * scale) / scale;
      next = Math.min(max, Math.max(min, next));
      this.fresh = true;
      this.setData({ text: `${next}`, fresh: true, error: false, shake: false, hint: this.rangeHint() });
    },

    onPickStep(e) {
      const curStep = Number(e.currentTarget.dataset.s);
      this.setData({ curStep });
      if (this.properties.stepKey) {
        try {
          wx.setStorageSync(`fitlog_ui_step_${this.properties.stepKey}`, curStep);
        } catch (err) {
          // 记不住也不影响这次使用
        }
      }
    },

    backspace() {
      this.fresh = false;
      this.update(this.data.text.slice(0, -1));
    },

    // 长按退格清空
    clearAll(e) {
      if (e.currentTarget.dataset.key !== 'del') return;
      this.fresh = false;
      this.update('');
    },

    update(text) {
      this.setData({ text, fresh: false, error: false, hint: this.rangeHint() });
    },

    onConfirm() {
      if (this.closing) return;
      const { min, max, unit, allowEmpty } = this.properties;
      const raw = this.data.text.replace(/\.$/, '');
      if (raw === '') {
        if (!allowEmpty) {
          this.fail(`请填 ${min}–${max}${unit ? ` ${unit}` : ''}`);
          return;
        }
        this.playOut(() => this.triggerEvent('confirm', { value: '' }));
        return;
      }
      const n = Number(raw);
      if (!(n >= min && n <= max)) {
        this.fail(`请填 ${min}–${max}${unit ? ` ${unit}` : ''}`);
        return;
      }
      this.playOut(() => this.triggerEvent('confirm', { value: n }));
    },

    // 超出范围：提示文字变深并轻轻晃一下，不关面板
    fail(msg) {
      this.setData({ hint: msg, error: true, shake: false });
      setTimeout(() => this.setData({ shake: true }), 30);
    },

    onClose() {
      this.playOut(() => this.triggerEvent('close'));
    },

    playOut(done) {
      if (this.closing) return;
      this.closing = true;
      this.setData({ out: true });
      setTimeout(done, 200);
    },

    noop() {},
  },
});
