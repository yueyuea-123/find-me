// app.js —— 居所收纳 MVP（离线优先：本地为主，云端持久化）
var store = require('./utils/store.js');
var Sync = require('./utils/cloud-sync.js');

// 全局错误兜底：只记录到本地日志，不上报第三方（家庭数据不出端）
// 生命周期钩子的可用性以微信官方文档为准；低版本不识别的钩子会被框架忽略，不影响主流程
function safeLog(tag, err) {
  try {
    var msg = (err && (err.message || err.errMsg)) ? (err.message || err.errMsg) : String(err);
    var logger = null;
    try { if (wx.getLogManager) logger = wx.getLogManager({ level: 0 }); } catch (e) {}
    if (logger && logger.error) logger.error('[home3d][' + tag + '] ' + msg);
    else console.error('[home3d][' + tag + '] ' + msg);
    // 同步层就绪后，错误上报走云函数 sys_logs（不含照片内容）
    try { Sync.reportError({ message: tag + ': ' + msg, page: '' }); } catch (e) {}
  } catch (e) {}
}

// 云同步启动流程：登录 → 注入数据提供者 → 拉取快照覆盖本地 → 启动自动同步
function bootstrapCloud() {
  Sync.setDataProvider({
    getSnapshot: function () { return store.exportSnapshot(); },
    getTombstones: function () { return store.getTombstones(); },
    clearTombstones: function () { store.clearTombstones(); }
  });
  Sync.init().then(function (r) {
    if (!r || !r.ok) { safeLog('cloudInit', new Error(r && r.error || 'unknown')); return; }
    return Sync.pull().then(function (p) {
      if (p && p.ok && p.snapshot) {
        var applied = store.applySnapshot(p.snapshot);
        if (!applied.ok) safeLog('applySnapshot', new Error(applied.error));
      }
    });
  }).catch(function (e) { safeLog('bootstrapCloud', e); });
}

App({
  globalData: {
    // 离线优先：本地存储为主数据源，云端做持久化与隔离
    // 页面层继续调用 store 的同步 API，零改动
    lastError: ''
  },
  onLaunch: function () {
    // 首次启动填充演示数据（可通过「我的-清空数据」重置）
    try { store.seedDemo(); } catch (e) { safeLog('seedDemo', e); }
    // 云同步异步启动，不阻塞首屏
    try { bootstrapCloud(); Sync.startAutoSync(); } catch (e) { safeLog('syncStart', e); }
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
  },

  onHide: function () {
    // 切后台时尝试推送未同步变更
    try { Sync.flush(); } catch (e) {}
  },
  onShow: function () {
    // 回前台时若登录有效，尝试推送
    try { Sync.flush(); } catch (e) {}
  }
});
