// pages/backup/backup.js —— 备份与恢复 PRD-032
var Sync = require('../../utils/cloud-sync.js');

Page({
  data: { list: [], loading: false, page: 1 },

  onShow: function () { this.load(); },

  load: function () {
    var self = this;
    this.setData({ loading: true });
    Sync.backup('list', { page: 1, size: 20 }).then(function (r) {
      self.setData({ loading: false });
      if (r && r.ok) {
        var list = (r.data.list || []).map(function (b) {
          return {
            id: b._id, type: b.type, note: b.note, recordCount: b.recordCount,
            time: b.createdAt ? new Date(b.createdAt.$date || b.createdAt).toLocaleString() : ''
          };
        });
        self.setData({ list: list });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    });
  },

  createBackup: function () {
    var self = this;
    wx.showModal({
      title: '创建备份',
      content: '将当前云端全部数据保存为一个快照，可随时恢复。继续？',
      success: function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '备份中' });
        Sync.backup('create', { type: 'manual', note: '手动备份' }).then(function (r) {
          wx.hideLoading();
          if (r && r.ok) { wx.showToast({ title: '备份完成', icon: 'success' }); self.load(); }
          else wx.showToast({ title: '备份失败', icon: 'none' });
        });
      }
    });
  },

  restore: function (e) {
    var id = e.currentTarget.dataset.id;
    var self = this;
    wx.showModal({
      title: '恢复备份',
      content: '将用该备份覆盖当前云端数据。恢复前系统会自动备份当前状态，可再次回滚。确定恢复？',
      success: function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '恢复中' });
        Sync.backup('restore', { backupId: id }).then(function (r) {
          wx.hideLoading();
          if (r && r.ok) {
            wx.showToast({ title: '恢复完成', icon: 'success' });
            // 恢复后重新拉取云端快照到本地
            Sync.pull().then(function (p) {
              if (p && p.ok && p.snapshot) require('../../utils/store.js').applySnapshot(p.snapshot);
            });
            self.load();
          } else wx.showToast({ title: '恢复失败：' + ((r && r.error) || '未知'), icon: 'none' });
        });
      }
    });
  }
});
