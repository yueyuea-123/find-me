// pages/profile/profile.js —— 我的：账户 / 云同步 / 备份 / 管理后台入口
var store = require('../../utils/store.js');
var Sync = require('../../utils/cloud-sync.js');
var CLOUD_ENV = 'kkkyuer-d4g5w54lpb6ac6517';

Page({
  data: {
    cloudOn: false, loggedIn: false, role: 'user', openidMask: '',
    dirty: false, syncText: '', backupCount: 0, isAdmin: false
  },

  onLoad: function () {
    try { Sync.setEnv(CLOUD_ENV); } catch (e) {}
  },

  onShow: function () { this.refresh(); },

  refresh: function () {
    var s = Sync.getState();
    var mask = '';
    if (s.openid) mask = s.openid.slice(0, 6) + '****' + s.openid.slice(-4);
    var syncText = !s.enabled ? '云能力不可用（本地模式）'
      : !s.loggedIn ? '未登录（本地模式）'
      : s.dirty ? '有变更待同步' : '已同步';
    this.setData({
      cloudOn: s.enabled, loggedIn: s.loggedIn, role: s.role,
      openidMask: mask, dirty: s.dirty, syncText: syncText,
      isAdmin: s.role === 'admin'
    });
    // 登录后拉取备份列表条数
    if (s.loggedIn) {
      var self = this;
      Sync.backup('list', { page: 1, size: 1 }).then(function (r) {
        if (r && r.ok) self.setData({ backupCount: r.data.total || 0 });
      });
    }
  },

  syncNow: function () {
    var self = this;
    if (!this.data.loggedIn) { wx.showToast({ title: '未登录，当前为本地模式', icon: 'none' }); return; }
    wx.showLoading({ title: '同步中' });
    Sync.flush().then(function (r) {
      wx.hideLoading();
      wx.showToast({ title: r.ok ? '同步完成' : ('同步失败：' + (r.error || '未知')), icon: r.ok ? 'success' : 'none' });
      self.refresh();
    });
  },

  goBackup: function () {
    if (!this.data.loggedIn) { wx.showToast({ title: '请先登录云同步', icon: 'none' }); return; }
    wx.navigateTo({ url: '/pages/backup/backup' });
  },
  goAdmin: function () {
    if (!this.data.isAdmin) { wx.showToast({ title: '仅管理员可用', icon: 'none' }); return; }
    wx.navigateTo({ url: '/pages/admin/admin' });
  },
  goSpaces: function () { wx.navigateTo({ url: '/pages/space/space' }); },
  goHistory: function () { wx.navigateTo({ url: '/pages/history/history' }); },
  goAlerts: function () { wx.navigateTo({ url: '/pages/alerts/alerts' }); },
  goEnded: function () { wx.navigateTo({ url: '/pages/item-list/item-list?ended=1' }); },
  goPrivacy: function () { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  resetDemo: function () {
    wx.showModal({
      title: '重置演示数据',
      content: '将在清空当前数据后载入一套演示空间/房间/家具/物品。确定继续？',
      success: function (res) {
        if (!res.confirm) return;
        store.clearAll(); store.seedDemo();
        wx.showToast({ title: '演示数据已重置', icon: 'success' });
      }
    });
  },

  clearData: function () {
    wx.showModal({
      title: '清空所有数据',
      content: '此操作将删除本机所有空间、房间、家具、物品与库存数据，云端数据需另行恢复备份。确定继续？',
      success: function (res) {
        if (!res.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '真的要清空全部本地数据吗？',
          success: function (r2) {
            if (!r2.confirm) return;
            store.clearAll();
            wx.showToast({ title: '已清空本地数据', icon: 'success' });
          }
        });
      }
    });
  }
});
