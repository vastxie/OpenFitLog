const {
  APP_NAME,
  CATEGORIES,
  getMediaUrls,
  getPartIcon,
  getThemeStyle,
  applyTabBarTheme,
  modalColors,
} = require('../../utils/config');
const storage = require('../../utils/storage');

Page({
  data: {
    themeStyle: '',
    categories: CATEGORIES,
    cat: 'chest',
    keyword: '',
    groups: [],
    emptyText: '',
    scrollTop: 0,
  },

  onShow() {
    const prof = storage.getProfile();
    applyTabBarTheme(prof.theme);
    this.setData({ themeStyle: getThemeStyle(prof.theme) });
    this.refresh();
  },

  onShareAppMessage() {
    return { title: `${APP_NAME} · 动作库`, path: '/pages/exercises/index' };
  },

  refresh() {
    const { cat, keyword } = this.data;
    const gender = storage.getProfile().gender;
    const favSet = new Set(storage.getFavorites());
    const kw = keyword.trim().toLowerCase();

    const matched = storage.getAllExercises().filter((ex) => {
      if (kw) {
        return (
          ex.name.toLowerCase().includes(kw) ||
          (ex.en || '').toLowerCase().includes(kw) ||
          (ex.target || '').toLowerCase().includes(kw)
        );
      }
      if (cat === 'fav') return favSet.has(ex.id);
      if (cat === 'custom') return !!ex.isCustom;
      return ex.cat === cat;
    });

    // 按器材分组
    const groups = [];
    const byEquip = {};
    matched.forEach((ex) => {
      const equip = ex.equip || '其他';
      if (!byEquip[equip]) {
        byEquip[equip] = { equip, list: [] };
        groups.push(byEquip[equip]);
      }
      byEquip[equip].list.push({
        id: ex.id,
        name: ex.name,
        part: getPartIcon(ex),
        posterUrl: getMediaUrls(ex, gender).posterUrl,
        isFav: favSet.has(ex.id),
      });
    });

    let emptyText = '没有动作';
    if (kw) emptyText = '没有找到';
    else if (cat === 'fav') emptyText = '还没有收藏的动作';
    else if (cat === 'custom') emptyText = '';

    this.setData({ groups, emptyText });
  },

  onCat(e) {
    // scrollTop 需要变化才会生效，交替赋 0 和 0.1
    this.setData(
      { cat: e.currentTarget.dataset.cat, scrollTop: this.data.scrollTop === 0 ? 0.1 : 0 },
      () => this.refresh()
    );
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.refresh());
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.refresh());
  },

  toggleFav(e) {
    storage.toggleFavorite(e.currentTarget.dataset.id);
    this.refresh();
  },

  openDetail(e) {
    wx.navigateTo({ url: `/pages/exercise-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  onPosterErr(e) {
    const { g, i } = e.currentTarget.dataset;
    if (g !== undefined && i !== undefined) {
      this.setData({ [`groups[${g}].list[${i}].posterUrl`]: '' });
    }
  },

  createCustom() {
    wx.showModal({
      title: '新建动作',
      editable: true,
      placeholderText: '动作名称',
      confirmColor: modalColors().confirmColor,
      success: (res) => {
        if (res.confirm && storage.addCustomExercise(res.content)) this.refresh();
      },
    });
  },
});
