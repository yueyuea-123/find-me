// pages/room/room.js —— 房间列表 UI-003
var store = require('../../utils/store.js');

Page({
  data: {
    spaceName: '', rooms: [],
    showEditor: false, editing: false, editingId: '',
    formName: '', formW: '', formD: '', formH: '', formError: ''
  },

  onLoad: function (q) { if (q && q.create) this.openCreate(); },
  onShow: function () { this.load(); },

  load: function () {
    var sp = store.getActiveSpace();
    var self = this;
    var rooms = store.listRooms(sp ? sp.id : '').map(function (r) {
      var furn = store.listFurniture(r.id);
      var roomNodeIds = store.listNodes(r.id).map(function (n) { return n.id; });
      var items = store.listItems({ roomId: r.id });
      var st = r.task.status;
      var statusText = '未建模', statusClass = '';
      if (st === 'processing') { statusText = '建模处理中'; statusClass = 'orange'; }
      else if (st === 'failed') { statusText = '建模失败·可手动'; statusClass = 'red'; }
      else if (st === 'candidate_ready') { statusText = '候选待确认'; statusClass = 'blue'; }
      else if (st === 'ready') { statusText = '照片已就绪'; statusClass = 'green'; }
      var dim = r.calibrated ? (r.width + '×' + r.depth + '×' + r.height + 'm') : '尺寸未定标（相对估算）';
      return {
        id: r.id, name: r.name, dimText: dim,
        furnitureCount: furn.length, itemCount: items.length,
        statusText: statusText, statusClass: statusClass
      };
    });
    this.setData({ spaceName: sp ? sp.name : '未设置空间', rooms: rooms });
  },

  enterRoom: function (e) {
    // 进入房间详情即三维页（含列表降级）
    wx.navigateTo({ url: '/pages/room3d/room3d?id=' + e.currentTarget.dataset.id });
  },
  enter3d: function (e) { wx.navigateTo({ url: '/pages/room3d/room3d?id=' + e.currentTarget.dataset.id }); },
  enterPhotos: function (e) { wx.navigateTo({ url: '/pages/photos/photos?id=' + e.currentTarget.dataset.id }); },
  enterFurniture: function (e) {
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?roomId=' + e.currentTarget.dataset.id });
  },
  goSpaces: function () { wx.navigateTo({ url: '/pages/space/space' }); },

  openCreate: function () {
    this.setData({ showEditor: true, editing: false, editingId: '', formName: '', formW: '', formD: '', formH: '', formError: '' });
  },
  rename: function (e) {
    var d = e.currentTarget.dataset;
    var r = store.getRoom(d.id);
    this.setData({
      showEditor: true, editing: true, editingId: d.id, formName: d.name,
      formW: r.width || '', formD: r.depth || '', formH: r.height || '', formError: ''
    });
  },
  closeEditor: function () { this.setData({ showEditor: false }); },
  onName: function (e) { this.setData({ formName: e.detail.value }); },
  onW: function (e) { this.setData({ formW: e.detail.value }); },
  onD: function (e) { this.setData({ formD: e.detail.value }); },
  onH: function (e) { this.setData({ formH: e.detail.value }); },

  save: function () {
    var f = this.data;
    if (!(f.formName || '').trim()) { this.setData({ formError: '请输入房间名称' }); return; }
    var dims = { width: Number(f.formW) || 0, depth: Number(f.formD) || 0, height: Number(f.formH) || 0 };
    var r;
    if (f.editing) {
      r = store.updateRoom(f.editingId, { name: f.formName });
      if (r.ok) r = store.updateRoom(f.editingId, dims);
    } else {
      var sp = store.getActiveSpace();
      if (!sp) { this.setData({ formError: '请先创建一个空间' }); return; }
      r = store.addRoom(sp.id, f.formName, dims);
    }
    if (!r.ok) { this.setData({ formError: '保存失败：' + r.error }); return; }
    this.setData({ showEditor: false });
    wx.showToast({ title: '已保存', icon: 'success' });
    this.load();
  },

  archive: function (e) {
    var d = e.currentTarget.dataset, self = this;
    wx.showModal({
      title: '归档房间',
      content: '归档「' + d.name + '」？数据保留但退出日常列表。',
      success: function (res) {
        if (res.confirm && store.archiveRoom(d.id).ok) {
          wx.showToast({ title: '已归档', icon: 'success' }); self.load();
        }
      }
    });
  }
});
