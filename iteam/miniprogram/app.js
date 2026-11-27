// app.js —— 居所收纳 MVP（纯本地存储：wx.Storage 为唯一数据源）
var store = require('./utils/store.js');

// 全局错误兜底：只记录到本地日志，不上报任何云端（家庭数据不出端）
// 生命周期钩子的可用性以微信官方文档为准；低版本不识别的钩子会被框架忽略，不影响主流程
function safeLog(tag, err) {
  try {
    var msg = (err && (err.message || err.errMsg)) ? (err.message || err.errMsg) : String(err);
    var logger = null;
    try { if (wx.getLogManager) logger = wx.getLogManager({ level: 0 }); } catch (e) {}
    if (logger && logger.error) logger.error('[home3d][' + tag + '] ' + msg);
    else console.error('[home3d][' + tag + '] ' + msg);
  } catch (e) {}
}

App({
  globalData: {
    // 纯本地存储：wx.Storage 为唯一数据源，页面层调用 store 的同步 API
    lastError: ''
  },
  onLaunch: function () {
    // 首次启动填充演示数据（可通过「我的-清空数据」重置）
    try { store.seedDemo(); } catch (e) { safeLog('seedDemo', e); }
  },

  // 未捕获的 JS 异常：记录后由页面自身的降级分支接管，避免白屏
  onError: function (err) {
    try {
      var msg = (err && (err.message || err.errMsg)) ? (err.message || err.errMsg) : String(err);
      this.globalData.lastError = msg;
      safeLog('onError', err);
    } catch (e) {}
  },

  // 页面不存在（如旧版本残留路由）：静默回退首页，不暴露系统错误页
  onPageNotFound: function (res) {
    try {
      safeLog('onPageNotFound', res && res.path ? res.path : 'unknown');
      if (wx.reLaunch) wx.reLaunch({ url: '/pages/index/index' });
    } catch (e) {}
  },

  // 未处理的 Promise 拒绝：仅本地记录，不打断当前交互
  onUnhandledRejection: function (res) {
    try { safeLog('onUnhandledRejection', res && res.reason ? res.reason : res); } catch (e) {}
  }
});
