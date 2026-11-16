// 统一的确认弹窗
const { modalColors } = require('./config');

function confirm({ title, content = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText,
      ...modalColors(),
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    });
  });
}

function toast(title, duration = 1800) {
  wx.showToast({ title, icon: 'none', duration });
}

// 关闭底部面板：先给 .sheet-mask 加 out 播放收起动画，播完再真正移除
// patch 是关闭时要一起 setData 的字段（如 { showStart: false }），done 在移除后执行
const SHEET_OUT_MS = 200;

function closeSheet(page, patch, done) {
  if (page._sheetClosing) return;
  page._sheetClosing = true;
  page.setData({ sheetOut: true });
  setTimeout(() => {
    page._sheetClosing = false;
    page.setData(Object.assign({ sheetOut: false }, patch), done);
  }, SHEET_OUT_MS);
}

module.exports = { confirm, toast, closeSheet };
