// 选动作面板：搜索、按部位浏览、多选后一次确认
const { CATEGORIES, getMediaUrls, getPartIcon, exerciseSub, getThemeStyle } = require('../../utils/config');
const storage = require('../../utils/storage');

const MAX_ROWS = 80;

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(show) {
        if (show) this.open();
      },
    },
  },

  data: {
    themeStyle: '',
    categories: CATEGORIES,
    cat: 'fav',
    keyword: '',
    list: [],
    count: 0,
    creatable: false,
    out: false,
  },

  methods: {
    open() {
      this.picked = []; // 按选择顺序保存 id
      const hasFav = storage.getFavorites().length > 0;
      const prof = storage.getProfile();
      this.closing = false;
      this.setData(
        {
          out: false,
          themeStyle: getThemeStyle(prof.theme),
          cat: hasFav ? 'fav' : 'chest',
          keyword: '',
          count: 0,
        },
        () => this.refresh()
      );
    },

    refresh() {
      const { cat, keyword } = this.data;
      const gender = storage.getProfile().gender;
      const favSet = new Set(storage.getFavorites());
      const kw = keyword.trim().toLowerCase();
      const picked = new Set(this.picked);

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

      this.setData({
        list: matched.slice(0, MAX_ROWS).map((ex) => ({
          id: ex.id,
          name: ex.name,
          sub: exerciseSub(ex),
          part: getPartIcon(ex),
          posterUrl: getMediaUrls(ex, gender).posterUrl,
          checked: picked.has(ex.id),
        })),
        // 搜不到时可以直接用关键词新建；「自建」分类下始终可以新建
        creatable: kw ? matched.length === 0 : cat === 'custom',
      });
    },

    onSearch(e) {
      this.setData({ keyword: e.detail.value }, () => this.refresh());
    },

    onCat(e) {
      this.setData({ cat: e.currentTarget.dataset.cat }, () => this.refresh());
    },

    onPosterErr(e) {
      const index = e.currentTarget.dataset.index;
      if (index !== undefined) {
        this.setData({ [`list[${index}].posterUrl`]: '' });
      }
    },

    onToggle(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      const at = this.picked.indexOf(item.id);
      if (at >= 0) this.picked.splice(at, 1);
      else this.picked.push(item.id);
      this.setData({
        [`list[${index}].checked`]: at < 0,
        count: this.picked.length,
      });
    },

    onCreate() {
      const create = (name) => {
        const item = storage.addCustomExercise(name);
        if (!item) return;
        this.picked.push(item.id);
        this.setData({ keyword: '', cat: 'custom', count: this.picked.length }, () => this.refresh());
      };
      const kw = this.data.keyword.trim();
      if (kw) {
        create(kw);
        return;
      }
      wx.showModal({
        title: '新建动作',
        editable: true,
        placeholderText: '动作名称',
        success: (res) => {
          if (res.confirm) create(res.content);
        },
      });
    },

    onConfirm() {
      if (this.picked.length === 0) return;
      const ids = this.picked.slice();
      this.playOut(() => this.triggerEvent('confirm', { ids }));
    },

    onClose() {
      this.playOut(() => this.triggerEvent('close'));
    },

    // 先播收起动画，再通知页面把 show 置为 false
    playOut(done) {
      if (this.closing) return;
      this.closing = true;
      this.setData({ out: true });
      setTimeout(done, 200);
    },

    noop() {},
  },
});
