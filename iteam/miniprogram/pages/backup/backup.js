// pages/backup/backup.js —— 本地备份与恢复（纯本地存储，无云端）
var store = require('../../utils/store.js');

var BACKUPS_KEY = 'home3d_local_backups';

function getBackups() {
  try { return wx.getStorageSync(BACKUPS_KEY) || []; } catch (e) { return []; }
}
function saveBackups(list) {
  try { wx.setStorageSync(BACKUPS_KEY, list); } catch (e) {}
}
function formatTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch (e) { return ''; }
}

Page({
  data: { list: [], loading: false },

  onShow: function () { this.load(); },

  load: function () {
    var list = getBackups().map(function (b) {
      return {
        id: b.id, note: b.note, recordCount: b.recordCount || 0,
        time: formatTime(b.createdAt), filePath: b.filePath
      };
    });
    this.setData({ list: list });
  },

  createBackup: function () {
    var self = this;
    wx.showModal({
      title: '创建本地备份',
      content: '将当前本机全部数据保存为备份文件，可随时恢复。继续？',
      success: function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '备份中' });
        try {
          var snapshot = store.exportSnapshot();
          var json = JSON.stringify({ version: 1, createdAt: Date.now(), data: snapshot });
          var fs = wx.getFileSystemManager();
          var filePath = `${wx.env.USER_DATA_PATH}/backup_${Date.now()}.json`;
          fs.writeFileSync(filePath, json, 'utf8');
          var count = 0;
          Object.keys(snapshot).forEach(function (k) { if (Array.isArray(snapshot[k])) count += snapshot[k].length; });
          var backups = getBackups();
          backups.unshift({
            id: 'bk_' + Date.now(),
            note: '手动备份',
            recordCount: count,
            createdAt: Date.now(),
            filePath: filePath
          });
          // 最多保留 10 份本地备份
          if (backups.length > 10) backups = backups.slice(0, 10);
          saveBackups(backups);
          wx.hideLoading();
          wx.showToast({ title: '备份完成', icon: 'success' });
          self.load();
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '备份失败：' + (e.message || '未知'), icon: 'none' });
        }
      }
    });
  },

  restore: function (e) {
    var id = e.currentTarget.dataset.id;
    var self = this;
    var backups = getBackups();
    var target = backups.find(function (b) { return b.id === id; });
    if (!target) { wx.showToast({ title: '备份不存在', icon: 'none' }); return; }
    wx.showModal({
      title: '恢复备份',
      content: '将用该备份覆盖当前本机数据，此操作不可撤销。确定恢复？',
      success: function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: '恢复中' });
        try {
          var fs = wx.getFileSystemManager();
          var json = fs.readFileSync(target.filePath, 'utf8');
          var obj = JSON.parse(json);
          if (!obj || !obj.data) throw new Error('备份文件无效');
          var applied = store.applySnapshot(obj.data);
          wx.hideLoading();
          if (applied && applied.ok) {
            wx.showToast({ title: '恢复完成', icon: 'success' });
          } else {
            wx.showToast({ title: '恢复失败：' + ((applied && applied.error) || '未知'), icon: 'none' });
          }
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: '恢复失败：' + (e.message || '未知'), icon: 'none' });
        }
      }
    });
  },

  exportFile: function (e) {
    // 将备份文件复制到可分享位置（通过 wx.saveFile 或 openDocument 预览）
    var id = e.currentTarget.dataset.id;
    var backups = getBackups();
    var target = backups.find(function (b) { return b.id === id; });
    if (!target) return;
    wx.openDocument({
      filePath: target.filePath,
      showMenu: true,
      fail: function () {
        wx.showToast({ title: '请使用「恢复」功能还原', icon: 'none' });
      }
    });
  }
});
