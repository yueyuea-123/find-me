// pages/profile/profile.js —— 我的：本地数据管理入口（纯本地存储）
var store = require('../../utils/store.js');

Page({
  data: {
    backupCount: 0
  },

  onShow: function () { this.refresh(); },

  refresh: function () {
    // 本地备份条目数（如有本地备份记录）
    var count = 0;
    try {
      var backups = wx.getStorageSync('home3d_local_backups') || [];
      count = Array.isArray(backups) ? backups.length : 0;
    } catch (e) {}
    this.setData({ backupCount: count });
  },

  goBackup: function () {
    wx.navigateTo({ url: '/pages/backup/backup' });
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
      content: '此操作将删除本机所有空间、房间、家具、物品与库存数据，且不可恢复。确定继续？',
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
