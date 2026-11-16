const storage = require('./utils/storage');
const { applyTabBarTheme } = require('./utils/config');

App({
  onLaunch() {
    storage.getProfile();
    storage.initSync();

    // 系统切换深浅色：CSS 变量自动生效；tabBar 和 canvas 这些用 JS 取色的地方要重新设置
    if (wx.onThemeChange) {
      wx.onThemeChange(() => {
        applyTabBarTheme(storage.getProfile().theme);
        getCurrentPages().forEach((page) => {
          if (typeof page.onThemeChanged === 'function') page.onThemeChanged();
        });
      });
    }
  },

  onShow() {
    storage.syncNow();
  },

  onHide() {
    storage.flushSync();
  },
});
