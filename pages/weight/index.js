const { getPalette, getThemeStyle } = require('../../utils/config');
const { getTodayStr, parseDate, formatMonthDay } = require('../../utils/date');
const storage = require('../../utils/storage');
const { toast } = require('../../utils/ui');

function dateText(dateStr) {
  const dt = parseDate(dateStr);
  const md = formatMonthDay(dateStr);
  return dt.getFullYear() === new Date().getFullYear() ? md : `${dt.getFullYear()}年${md}`;
}

// 中国成人 BMI 分级
function bmiText(weightKg, heightCm) {
  const w = Number(weightKg);
  const h = Number(heightCm);
  if (!w || !h || h < 100 || h > 230) return '';
  const bmi = w / Math.pow(h / 100, 2);
  let tag = '正常';
  if (bmi < 18.5) tag = '偏瘦';
  else if (bmi >= 28) tag = '肥胖';
  else if (bmi >= 24) tag = '超重';
  return `${bmi.toFixed(1)} · ${tag}`;
}

Page({
  data: {
    themeStyle: '',
    ranges: [
      { days: 30, name: '30 天' },
      { days: 90, name: '90 天' },
      { days: 365, name: '一年' },
      { days: 0, name: '全部' },
    ],
    rangeDays: 30,
    overview: { current: null, points: [] },
    subText: '',
    targetText: '',
    bmiText: '',
    logs: [],
    todayStr: '',
    sheet: '', // 'log' | 'target'：键盘面板的用途
    padOn: false,
    form: { date: '', weightKg: '' },
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const prof = storage.getProfile();
    this.palette = getPalette(prof.theme);
    this.targetW = prof.targetWeightKg ? Number(prof.targetWeightKg) : null;

    const overview = storage.getWeightOverview(this.data.rangeDays);
    let subText = '还没有记录';
    if (overview.current) {
      subText = dateText(overview.currentDate);
      if (overview.prevDiff !== null) {
        const d = overview.prevDiff;
        const diff = d === 0 ? '持平' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} kg`;
        subText = `${subText} · 较上次 ${diff}`;
      }
    }

    let targetText = '未设置';
    if (this.targetW) {
      targetText = `${this.targetW.toFixed(1)} kg`;
      if (overview.current) {
        const gap = Math.abs(overview.current - this.targetW);
        targetText += gap < 0.2 ? ' · 已达到' : ` · 还差 ${gap.toFixed(1)} kg`;
      }
    }

    this.setData(
      {
        themeStyle: getThemeStyle(prof.theme),
        overview: { current: overview.current ? overview.current.toFixed(1) : '', points: overview.points },
        subText,
        targetText,
        bmiText: bmiText(overview.current, prof.heightCm),
        logs: overview.logs.map((x) => ({ id: x.id, weightKg: x.weightKg.toFixed(1), dateText: dateText(x.date) })),
      },
      () => this.drawChart()
    );
  },

  // 系统切换深浅色：折线图要换色
  onThemeChanged() {
    this.refresh();
  },

  switchRange(e) {
    this.setData({ rangeDays: Number(e.currentTarget.dataset.d) }, () => this.refresh());
  },

  // ---------- 记录体重 / 目标体重 ----------

  openAdd() {
    const today = getTodayStr();
    this.setData({
      sheet: 'log',
      padOn: true,
      todayStr: today,
      form: { date: today, weightKg: this.data.overview.current || '' },
    });
  },

  openTarget() {
    this.setData({ sheet: 'target', padOn: true, form: { date: '', weightKg: this.targetW || '' } });
  },

  closeSheet() {
    this.setData({ padOn: false });
  },

  onDate(e) {
    this.setData({ 'form.date': e.detail.value });
  },

  // 数字键盘已校验 25–250；目标体重清空表示取消目标
  save(e) {
    const w = e.detail.value;
    this.setData({ padOn: false });
    if (this.data.sheet === 'target') {
      storage.updateProfile({ targetWeightKg: w === '' ? '' : Number(w.toFixed(1)) });
    } else if (!storage.addWeightLog({ date: this.data.form.date, weightKg: w })) {
      toast('没保存成功，再试一次');
      return;
    }
    this.refresh();
  },

  onLogTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['删除记录'],
      success: () => {
        storage.deleteWeightLog(id);
        this.refresh();
      },
    });
  },

  drawChart() {
    const pts = this.data.overview.points;
    if (pts.length < 2) return;
    this.createSelectorQuery()
      .select('#chart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio;
        const W = res[0].width;
        const H = res[0].height;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);
        const C = this.palette || getPalette(storage.getProfile().theme);

        const vals = pts.map((p) => p.value);
        if (this.targetW && Math.abs(this.targetW - vals[vals.length - 1]) <= 8) {
          vals.push(this.targetW);
        }
        const minV = Math.floor(Math.min(...vals) - 0.5);
        const maxV = Math.ceil(Math.max(...vals) + 0.5);
        const span = Math.max(1, maxV - minV);

        const padL = 34;
        const padR = 8;
        const padT = 10;
        const padB = 24;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        ctx.font = '11px sans-serif';
        ctx.lineWidth = 1;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 2; i += 1) {
          const y = Math.round(padT + (plotH * i) / 2) + 0.5;
          ctx.strokeStyle = C.line;
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(W, y);
          ctx.stroke();
          ctx.fillStyle = C.ink3;
          ctx.fillText(`${Math.round((maxV - (span * i) / 2) * 10) / 10}`, 0, y);
        }

        const lineColor = C.primary;

        // 若设置了目标体重且落在视野内，画一条虚线参考线
        if (this.targetW && this.targetW >= minV && this.targetW <= maxV) {
          const ty = padT + plotH - ((this.targetW - minV) / span) * plotH;
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = lineColor;
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.moveTo(padL, ty);
          ctx.lineTo(W - padR, ty);
          ctx.stroke();
          ctx.restore();
        }

        const xy = pts.map((p, idx) => ({
          x: padL + (plotW * idx) / (pts.length - 1),
          y: padT + plotH - ((p.value - minV) / span) * plotH,
        }));

        ctx.beginPath();
        xy.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        if (xy.length <= 31) {
          ctx.fillStyle = lineColor;
          xy.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
          });
        }

        ctx.fillStyle = C.ink3;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(pts[0].label, xy[0].x, padT + plotH + 8);
        ctx.textAlign = 'right';
        ctx.fillText(pts[pts.length - 1].label, xy[xy.length - 1].x, padT + plotH + 8);
      });
  },

  noop() {},
});
