const { APP_NAME, CATEGORY_LABELS, getMediaUrls, getThemeStyle, getPalette } = require('../../utils/config');
const { parseDate } = require('../../utils/date');
const storage = require('../../utils/storage');
const { confirm, toast } = require('../../utils/ui');

function splitLines(str) {
  return (str || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

Page({
  data: {
    themeStyle: '',
    ex: null,
    facts: '',
    cueList: [],
    noteList: [],
    gender: 'male',
    hasBothModels: false,
    hasVideo: false,
    maleMedia: { posterUrl: '', videoUrl: '' },
    femaleMedia: { posterUrl: '', videoUrl: '' },
    preloadPoster: '',
    mounted: { male: false, female: false },
    ready: { male: false, female: false },
    isFav: false,
    history: { recent: [] },
    historySum: '',
    actionMode: 'start', // 'start' | 'append' | 'resume' | 'none'
  },

  onLoad(options) {
    const ex = storage.getExerciseById(options.id);
    if (!ex) {
      toast('动作已删除');
      wx.navigateBack();
      return;
    }
    const initMedia = getMediaUrls(ex, storage.getProfile().gender);
    const gender = initMedia.modelGender;
    const maleMedia = getMediaUrls(ex, 'male');
    const femaleMedia = getMediaUrls(ex, 'female');
    const hasBothModels = Boolean(maleMedia.videoUrl && femaleMedia.videoUrl);
    const preloadPoster = hasBothModels
      ? gender === 'male'
        ? femaleMedia.posterUrl
        : maleMedia.posterUrl
      : '';

    this.setData({
      ex,
      facts: [CATEGORY_LABELS[ex.cat], ex.equip, ex.target].filter(Boolean).join(' · '),
      cueList: splitLines(ex.cues),
      noteList: splitLines(ex.notes),
      gender,
      hasBothModels,
      hasVideo: Boolean(initMedia.videoUrl),
      maleMedia,
      femaleMedia,
      preloadPoster,
      mounted: {
        male: gender === 'male' && Boolean(maleMedia.videoUrl),
        female: gender === 'female' && Boolean(femaleMedia.videoUrl),
      },
      ready: { male: false, female: false },
      isFav: storage.getFavorites().includes(ex.id),
    });
  },

  onUnload() {
    clearTimeout(this._maleFallback);
    clearTimeout(this._femaleFallback);
  },

  onShareAppMessage() {
    const ex = this.data.ex;
    return {
      title: ex ? ex.name : APP_NAME,
      path: ex && !ex.isCustom ? `/pages/exercise-detail/index?id=${ex.id}` : '/pages/exercises/index',
    };
  },

  onShow() {
    this.navigating = false;
    const ex = this.data.ex;
    if (!ex) return;
    const prof = storage.getProfile();
    const history = storage.getExerciseHistory(ex.id);
    const thisYear = new Date().getFullYear();
    const dateText = (ds) => {
      const dt = parseDate(ds);
      const md = `${dt.getMonth() + 1}月${dt.getDate()}日`;
      return dt.getFullYear() === thisYear ? md : `${dt.getFullYear()}年${md}`;
    };
    history.recent.forEach((item) => {
      item.dateText = dateText(item.date);
    });
    history.trend.forEach((p) => {
      const dt = parseDate(p.date);
      p.label = `${dt.getMonth() + 1}/${dt.getDate()}`;
    });
    if (history.best) {
      history.best.text = `${history.best.weight} kg × ${history.best.reps}`;
      history.best.dateText = dateText(history.best.date);
    }
    const parts = [`累计 ${history.totalDoneSets} 组`];

    const active = storage.getActiveSession();
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const prevPage = pages.length >= 2 ? pages[pages.length - 2] : null;
    const fromSession = !!(prevPage && prevPage.route === 'pages/session/index');

    let actionMode = 'start';
    if (active) {
      const inActive = active.session.exercises.some((entry) => entry.exerciseId === ex.id);
      if (!inActive) actionMode = 'append';
      else actionMode = fromSession ? 'none' : 'resume';
    }

    this.palette = getPalette(prof.theme);
    this.setData(
      {
        themeStyle: getThemeStyle(prof.theme),
        history,
        historySum: parts.join(' · '),
        actionMode,
      },
      () => this.drawTrend()
    );
  },

  onThemeChanged() {
    this.onShow();
  },

  // 每次训练的最大重量（最近 12 次），和体重页同样的画法
  drawTrend() {
    const pts = this.data.history.trend || [];
    if (pts.length < 2) return;
    this.createSelectorQuery()
      .select('#trend')
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

        const vals = pts.map((p) => p.weight);
        let minV = Math.min(...vals);
        let maxV = Math.max(...vals);
        if (maxV - minV < 2) {
          minV -= 1;
          maxV += 1;
        }
        const span = maxV - minV;
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

        const xy = pts.map((p, idx) => ({
          x: padL + (plotW * idx) / (pts.length - 1),
          y: padT + plotH - ((p.weight - minV) / span) * plotH,
        }));
        ctx.beginPath();
        xy.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = C.primary;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.fillStyle = C.primary;
        xy.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.fillStyle = C.ink3;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(pts[0].label, xy[0].x, padT + plotH + 8);
        ctx.textAlign = 'right';
        ctx.fillText(pts[pts.length - 1].label, xy[xy.length - 1].x, padT + plotH + 8);
      });
  },

  // 临时切换查看男/女解剖演示，不改写用户个人资料里的性别
  switchGender(e) {
    const gender = e.currentTarget.dataset.g;
    if (gender === this.data.gender) return;
    const patch = { gender };
    if (gender === 'male' && !this.data.mounted.male) {
      patch['mounted.male'] = true;
    } else if (gender === 'female' && !this.data.mounted.female) {
      patch['mounted.female'] = true;
    }
    this.setData(patch);
  },

  onMaleLoaded() {
    this._maleLoaded = true;
    clearTimeout(this._maleFallback);
    this._maleFallback = setTimeout(() => {
      if (!this.data.ready.male) this.setData({ 'ready.male': true });
    }, 500);
  },

  onMaleTimeUpdate(e) {
    if (this.data.ready.male) return;
    if (this._maleLoaded || (e.detail && e.detail.currentTime > 0)) {
      clearTimeout(this._maleFallback);
      this.setData({ 'ready.male': true });
    }
  },

  onFemaleLoaded() {
    this._femaleLoaded = true;
    clearTimeout(this._femaleFallback);
    this._femaleFallback = setTimeout(() => {
      if (!this.data.ready.female) this.setData({ 'ready.female': true });
    }, 500);
  },

  onFemaleTimeUpdate(e) {
    if (this.data.ready.female) return;
    if (this._femaleLoaded || (e.detail && e.detail.currentTime > 0)) {
      clearTimeout(this._femaleFallback);
      this.setData({ 'ready.female': true });
    }
  },

  onMediaErr() {
    if (this.data.hasVideo || this.data.hasBothModels) {
      this.setData({ hasVideo: false, hasBothModels: false });
    }
  },

  toggleFav() {
    const favs = storage.toggleFavorite(this.data.ex.id);
    this.setData({ isFav: favs.includes(this.data.ex.id) });
  },

  // 底部按钮：无进行中训练时直接开启今天针对该动作的快速训练
  startQuick() {
    if (this.navigating) return;
    this.navigating = true;
    const { dateStr, session } = storage.startQuickSession(this.data.ex.id);
    wx.redirectTo({
      url: `/pages/session/index?date=${dateStr}&id=${session.id}`,
      fail: () => {
        this.navigating = false;
      },
    });
  },

  addToActive() {
    const active = storage.appendToActiveSession(this.data.ex.id);
    if (!active) {
      this.startQuick();
      return;
    }
    toast('已加入当前训练');
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const prevPage = pages.length >= 2 ? pages[pages.length - 2] : null;
    if (prevPage && prevPage.route === 'pages/session/index') {
      this.setData({ actionMode: 'none' });
    } else {
      this.setData({ actionMode: 'resume' });
    }
  },

  goActiveSession() {
    const active = storage.getActiveSession();
    if (!active) {
      this.startQuick();
      return;
    }
    if (this.navigating) return;
    this.navigating = true;
    wx.redirectTo({
      url: `/pages/session/index?date=${active.dateStr}&id=${active.session.id}`,
      fail: () => {
        this.navigating = false;
      },
    });
  },

  async removeCustom() {
    const ok = await confirm({
      title: '删除动作？',
      content: '之前的训练记录会保留，不再显示原动作名。',
      confirmText: '删除',
    });
    if (!ok) return;
    storage.deleteCustomExercise(this.data.ex.id);
    wx.navigateBack();
  },
});
