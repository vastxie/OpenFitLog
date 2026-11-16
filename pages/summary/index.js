const { getPalette, getThemeStyle } = require('../../utils/config');
const { getTodayStr, addDays, parseDate, formatDate, formatMonthDay, formatThousands } = require('../../utils/date');
const storage = require('../../utils/storage');
const { toast } = require('../../utils/ui');

Page({
  data: {
    themeStyle: '',
    heatColors: ['#ededf0', '#b7ebd2', '#64d19f', '#1fb574', '#0f7f4f'],
    mode: 'week', // 'week' | 'month' | 'year'
    anchorDate: '',
    stats: {},
    yearHeat: null,
    monthHeat: [],
    focusColId: '',
  },

  onLoad(options) {
    const initMode = options && ['week', 'month', 'year'].includes(options.mode) ? options.mode : 'week';
    this.setData({ mode: initMode, anchorDate: getTodayStr() });
  },

  onShow() {
    const prof = storage.getProfile();
    this.palette = getPalette(prof.theme);
    this.setData(
      {
        themeStyle: getThemeStyle(prof.theme),
        heatColors: this.palette.heat,
      },
      () => this.refresh()
    );
  },

  // 系统切换深浅色：热力图和柱状图要换色
  onThemeChanged() {
    this.onShow();
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.m, anchorDate: getTodayStr() }, () => this.refresh());
  },

  shiftRange(dir) {
    const { mode, anchorDate } = this.data;
    let next;
    if (mode === 'week') {
      next = addDays(anchorDate, dir * 7);
    } else {
      const dt = parseDate(anchorDate);
      next =
        mode === 'month'
          ? formatDate(new Date(dt.getFullYear(), dt.getMonth() + dir, 1))
          : formatDate(new Date(dt.getFullYear() + dir, 0, 1));
    }
    this.setData({ anchorDate: next }, () => this.refresh());
  },

  prevRange() {
    this.shiftRange(-1);
  },

  nextRange() {
    this.shiftRange(1);
  },

  onTapHeatDay(e) {
    const { date, min } = e.currentTarget.dataset;
    if (!date) return;
    const md = formatMonthDay(date);
    toast(min > 0 ? `${md} · ${min} 分钟` : `${md} · 休息`);
  },

  refresh() {
    const { mode, anchorDate } = this.data;
    const stats = storage.getSummaryStats(mode, anchorDate);
    stats.minutesText = formatThousands(stats.totalMinutes);
    stats.volumeText = formatThousands(stats.totalVolume);
    const maxSets = stats.parts.length > 0 ? stats.parts[0].sets : 1;
    stats.parts.forEach((p) => {
      p.pct = Math.max(2, Math.round((p.sets / maxSets) * 100));
    });
    const dt = parseDate(anchorDate);
    const y = dt.getFullYear();
    const m = dt.getMonth() + 1;

    let yearHeat = null;
    let monthHeat = [];
    let focusColId = '';

    if (mode === 'year') {
      yearHeat = storage.getYearHeatmap(y);
      const todayYear = new Date().getFullYear();
      if (y === todayYear && yearHeat.weeks.length > 20) {
        const curMonth = new Date().getMonth() + 1;
        const targetCol = Math.max(0, Math.floor(((curMonth - 1) / 12) * yearHeat.weeks.length) - 4);
        focusColId = `hm_col_${targetCol}`;
      }
    } else if (mode === 'month') {
      monthHeat = storage.getMonthHeatmap(y, m);
    }

    this.setData({ stats, yearHeat, monthHeat, focusColId }, () => this.drawChart());
  },

  drawChart() {
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

        const buckets = this.data.stats.buckets || [];
        if (buckets.length === 0) return;

        const maxRaw = Math.max(...buckets.map((b) => b.minutes), 0);
        const step = maxRaw <= 60 ? 20 : Math.ceil(maxRaw / 3 / 30) * 30;
        const yMax = step * 3;

        const padL = 30;
        const padT = 8;
        const padB = 24;
        const plotW = W - padL;
        const plotH = H - padT - padB;

        ctx.font = '11px sans-serif';
        ctx.lineWidth = 1;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        for (let i = 0; i <= 3; i += 1) {
          const y = Math.round(padT + (plotH * i) / 3) + 0.5;
          ctx.strokeStyle = C.line;
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(W, y);
          ctx.stroke();
          ctx.fillStyle = C.ink3;
          ctx.fillText(`${step * (3 - i)}`, 0, y);
        }

        const slot = plotW / buckets.length;
        const barW = Math.max(3, Math.min(22, slot * 0.58));
        const barColor = C.primary;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        buckets.forEach((b, idx) => {
          const cx = padL + slot * (idx + 0.5);
          if (b.minutes > 0) {
            const h = Math.max(3, (b.minutes / yMax) * plotH);
            const x = cx - barW / 2;
            const y = padT + plotH - h;
            const r = Math.min(2, barW / 2, h / 2);
            ctx.fillStyle = barColor;
            ctx.beginPath();
            ctx.moveTo(x, y + h);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.lineTo(x + barW - r, y);
            ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
            ctx.lineTo(x + barW, y + h);
            ctx.closePath();
            ctx.fill();
          }
          if (b.label) {
            ctx.fillStyle = C.ink3;
            ctx.fillText(b.label, cx, padT + plotH + 8);
          }
        });
      });
  },

  noop() {},
});
