const {
  APP_NAME,
  KF_URL,
  KF_CORP_ID,
  THEMES,
  getThemeConfig,
  getThemeStyle,
  applyTabBarTheme,
} = require('../../utils/config');
const storage = require('../../utils/storage');
const { confirm, toast, closeSheet } = require('../../utils/ui');

Page({
  data: {
    themeStyle: '',
    themes: THEMES,
    currentTheme: THEMES[0],
    showThemeSheet: false,
    hasCloudSync: storage.isCloudConfigured(),
    hasWeComKf: Boolean(KF_URL && KF_CORP_ID),

    counts: { totalDays: 0, weekDays: 0, monthDays: 0 },
    weightText: '',
    templateCount: 0,
    profileText: '',
    syncText: '',
  },

  onShow() {
    this.refresh();
  },

  onShareAppMessage() {
    return { title: APP_NAME, path: '/pages/train/index' };
  },

  refresh() {
    const profile = storage.getProfile();
    const theme = getThemeConfig(profile.theme);
    applyTabBarTheme(theme.key);

    const logs = storage.getWeightLogs();
    const tags = [profile.gender === 'female' ? '女' : '男'];
    if (profile.age) tags.push(`${profile.age} 岁`);
    if (profile.heightCm) tags.push(`${profile.heightCm} cm`);

    this.setData({
      themeStyle: getThemeStyle(theme.key),
      currentTheme: theme,
      hasCloudSync: storage.isCloudConfigured(),
      counts: storage.getOverviewCounts(),
      weightText: logs.length > 0 ? `${logs[0].weightKg.toFixed(1)} kg` : '',
      templateCount: storage.getTemplates().length,
      profileText: tags.join(' · '),
      syncText: storage.getSyncStatus().text,
    });
  },

  goSummary() {
    wx.navigateTo({ url: '/pages/summary/index' });
  },

  goWeight() {
    wx.navigateTo({ url: '/pages/weight/index' });
  },

  goTemplates() {
    wx.navigateTo({ url: '/pages/templates/index' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  // 训练和体重记录导出成 CSV，发到聊天里（文件传输助手）再用 Excel 打开
  exportData() {
    const csv = storage.buildExportCsv();
    if (csv.split('\n').filter(Boolean).length <= 1) {
      toast('还没有记录');
      return;
    }
    if (!wx.shareFileMessage) {
      toast('当前微信版本不支持文件导出');
      return;
    }
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const safeTitle = (APP_NAME || 'FitLog').replace(/[\\/:*?"<>|\s]+/g, '-');
    const fileName = `${safeTitle}-${stamp}.csv`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    try {
      wx.getFileSystemManager().writeFileSync(filePath, csv, 'utf8');
    } catch (e) {
      toast('导出失败，请稍后重试');
      return;
    }
    wx.shareFileMessage({
      filePath,
      fileName,
      fail: (err) => {
        if (!/cancel/.test((err && err.errMsg) || '')) toast('导出失败，请稍后重试');
      },
    });
  },

  openCustomerService() {
    if (!KF_URL || !KF_CORP_ID) return;
    wx.openCustomerServiceChat({
      extInfo: { url: KF_URL },
      corpId: KF_CORP_ID,
      fail: () => {
        toast('暂时无法打开客服，请稍后再试');
      },
    });
  },

  // ---------- 主题 ----------

  openThemeSheet() {
    this.setData({ showThemeSheet: true });
  },

  closeThemeSheet() {
    closeSheet(this, { showThemeSheet: false });
  },

  // 选中即生效并收起；停一下让勾号先落到新颜色上，免得像没点中
  selectTheme(e) {
    if (this.themeClosing) return;
    const theme = getThemeConfig(e.currentTarget.dataset.key);
    if (theme.key !== this.data.currentTheme.key) {
      storage.updateProfile({ theme: theme.key });
      applyTabBarTheme(theme.key);
      this.setData({ themeStyle: getThemeStyle(theme.key), currentTheme: theme });
    }
    this.themeClosing = true;
    setTimeout(() => {
      this.themeClosing = false;
      this.closeThemeSheet();
    }, 160);
  },

  // ---------- 云同步 ----------

  openSyncMenu() {
    const enabled = storage.getSyncStatus().enabled;
    const actions = enabled
      ? [
          { text: '立即同步', run: () => this.syncNow() },
          { text: '关闭同步', run: () => this.setSync(false) },
          { text: '关闭并删除云端数据', run: () => this.deleteCloud() },
        ]
      : [{ text: '开启同步', run: () => this.setSync(true) }];
    wx.showActionSheet({
      itemList: actions.map((a) => a.text),
      success: (res) => actions[res.tapIndex].run(),
    });
  },

  async syncNow() {
    wx.showLoading({ title: '同步中' });
    const ok = await storage.syncNow();
    wx.hideLoading();
    toast(ok ? '已同步' : '同步失败，请检查网络');
    this.refresh();
  },

  async setSync(on) {
    if (!on) {
      storage.setSyncEnabled(false);
      this.refresh();
      return;
    }
    wx.showLoading({ title: '同步中' });
    const ok = await storage.setSyncEnabled(true);
    wx.hideLoading();
    toast(ok ? '已开启' : '已开启，联网后自动同步');
    this.refresh();
  },

  async deleteCloud() {
    const ok = await confirm({
      title: '删除云端数据？',
      content: '将清空服务器上的备份并关闭同步，本机记录不受影响。',
      confirmText: '删除',
    });
    if (!ok) return;
    wx.showLoading({ title: '删除中' });
    const done = await storage.deleteCloudData();
    wx.hideLoading();
    toast(done ? '云端数据已删除' : '删除失败，请检查网络');
    this.refresh();
  },

  noop() {},
});
