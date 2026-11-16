const { getThemeStyle } = require('../../utils/config');
const { DOW_LABELS, getSplitSpec } = require('../../data/default-templates');
const storage = require('../../utils/storage');

Page({
  data: {
    themeStyle: '',
    planSummary: '',
    list: [],
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const prof = storage.getProfile();
    const exMap = storage.getExerciseMap();
    // 排了训练日的在前（周一到周日），没排的在后
    const sorted = storage
      .getTemplates()
      .slice()
      .sort((a, b) => (a.weekday || 99) - (b.weekday || 99));

    this.setData({
      themeStyle: getThemeStyle(prof.theme),
      planSummary: storage.isAssessed() ? getSplitSpec(storage.getPlanPrefs().weekdays.length).summary : '',
      list: sorted.map((tpl) => {
        const validCount = (tpl.items || []).filter((it) => exMap[it.exerciseId]).length;
        const parts = [];
        if (tpl.weekday) parts.push(DOW_LABELS[tpl.weekday]);
        parts.push(`${validCount} 个动作`, `约 ${storage.estimateTemplateMinutes(tpl, exMap)} 分钟`);
        return { id: tpl.id, name: tpl.name, sub: parts.join(' · ') };
      }),
    });
  },

  edit(e) {
    wx.navigateTo({ url: `/pages/template-edit/index?id=${e.currentTarget.dataset.id}` });
  },

  create() {
    wx.navigateTo({ url: '/pages/template-edit/index' });
  },

  openWizard() {
    wx.navigateTo({ url: '/pages/plan-wizard/index' });
  },
});
