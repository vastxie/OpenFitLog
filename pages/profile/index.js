const { getThemeStyle } = require('../../utils/config');
const storage = require('../../utils/storage');

// 年龄、身高用内置数字键盘输入，范围在键盘里校验；清空表示不填
const EDIT_FIELDS = {
  age: { label: '年龄', unit: '岁', min: 10, max: 95, decimals: 0 },
  heightCm: { label: '身高', unit: 'cm', min: 100, max: 230, decimals: 1 },
};

Page({
  data: {
    themeStyle: '',
    gender: 'male',
    age: '',
    heightCm: '',
    edit: {},
    editing: false,
  },

  onLoad() {
    const p = storage.getProfile();
    this.setData({
      themeStyle: getThemeStyle(p.theme),
      gender: p.gender || 'male',
      age: p.age || '',
      heightCm: p.heightCm || '',
    });
  },

  // 每一项改完立即保存，不需要再点保存
  pickGender(e) {
    const g = e.currentTarget.dataset.g;
    if (g === this.data.gender) return;
    storage.updateProfile({ gender: g });
    this.setData({ gender: g });
  },

  openEdit(e) {
    const key = e.currentTarget.dataset.k;
    this.setData({ edit: Object.assign({ key, value: this.data[key] }, EDIT_FIELDS[key]), editing: true });
  },

  confirmEdit(e) {
    const key = this.data.edit.key;
    const value = e.detail.value;
    storage.updateProfile({ [key]: value });
    this.setData({ [key]: value, editing: false });
  },

  closeEdit() {
    this.setData({ editing: false });
  },
});
