// pages/photos/photos.js —— 房间照片页 UI-004
var store = require('../../utils/store.js');

Page({
  data: { roomId: '', photos: [], width: '', depth: '', calText: '' },
  onLoad: function (q) { this.setData({ roomId: q.id || '' }); },
  onShow: function () { this.load(); },

  load: function () {
    var r = store.getRoom(this.data.roomId);
    if (!r) { wx.showToast({ title: '房间不存在', icon: 'none' }); return; }
    this.setData({
      photos: r.photos.map(function (p) { return { id: p.id, path: p.path }; }),
      width: r.width ? String(r.width) : '',
      depth: r.depth ? String(r.depth) : '',
      calText: r.calibrated ? '已按米定标（宽×深）' : '未定标：尺寸仅作相对估算'
    });
  },

  choosePhoto: function () {
    var self = this, rid = this.data.roomId;
    wx.chooseMedia({
      count: 6, mediaType: ['image'], sourceType: ['camera', 'album'],
      success: function (res) {
        var paths = res.tempFiles.map(function (f) { return f.tempFilePath; });
        var r = store.addPhotos(rid, paths);
        if (r.ok) { wx.showToast({ title: '已添加 ' + paths.length + ' 张', icon: 'success' }); self.load(); }
        else wx.showToast({ title: '添加失败', icon: 'none' });
      }
    });
  },
  preview: function (e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.photos.map(function (p) { return p.path; }) });
  },
  remove: function (e) {
    var self = this;
    wx.showModal({
      title: '删除照片', content: '确定删除这张照片？',
      success: function (res) {
        if (res.confirm && store.removePhoto(self.data.roomId, e.currentTarget.dataset.id).ok) self.load();
      }
    });
  },
  onW: function (e) { this.setData({ width: e.detail.value }); },
  onD: function (e) { this.setData({ depth: e.detail.value }); },
  saveDims: function () {
    var r = store.updateRoom(this.data.roomId, { width: Number(this.data.width) || 0, depth: Number(this.data.depth) || 0 });
    if (r.ok) { wx.showToast({ title: '已保存', icon: 'success' }); this.load(); }
  },
  goTask: function () { wx.navigateTo({ url: '/pages/task/task?id=' + this.data.roomId }); }
});
