// pages/admin/admin.js —— 基础管理后台 PRD-030（仅管理员）
var Sync = require('../../utils/cloud-sync.js');

Page({
  data: { tab: 'tasks', list: [], loading: false, stats: null },

  onShow: function () { this.load(); },

  switchTab: function (e) {
    this.setData({ tab: e.currentTarget.dataset.tab }, this.load);
  },

  load: function () {
    var self = this;
    this.setData({ loading: true });
    Sync.adminQuery(this.data.tab, { page: 1, size: 30 }).then(function (r) {
      self.setData({ loading: false });
      if (r && r.ok) {
        var list = (r.data.list || []).map(function (x) {
          return {
            id: x._id,
            title: x.status || x.level || x.role || '记录',
            detail: x.message || x.roomId || '',
            time: x.createdAt ? new Date(x.createdAt.$date || x.createdAt).toLocaleString() : (x.lastLoginAt ? '近期' : '')
          };
        });
        self.setData({ list: list, stats: { total: r.data.total || 0 } });
      } else {
        wx.showToast({ title: r && r.error === 'PERMISSION_DENIED' ? '无管理员权限' : '加载失败', icon: 'none' });
      }
    });
  }
});
