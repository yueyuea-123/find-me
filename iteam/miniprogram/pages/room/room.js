// pages/room/room.js —— 房间列表 UI-003
var store = require('../../utils/store.js');

Page({
  data: {
    spaceName: '', rooms: [], hasSpace: false,
    showEditor: false, editing: false, editingId: '',
    formName: '', formW: '', formD: '', formH: '', formError: '',
    // CR-001 F-07 典型场景起点：'' = 空白房间；否则为模板 key
    templates: [], startTemplate: ''
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
      var dim = r.calibrated ? (r.width + '×' + r.depth + '×' + r.height + ' m') : '尺寸未定标（相对估算）';
      return {
        id: r.id, name: r.name, dimText: dim,
        templateText: r.templateKey ? '场景模板' : '空白房间',
        furnitureCount: furn.length, itemCount: items.length
      };
    });
    this.setData({ spaceName: sp ? sp.name : '未设置空间', rooms: rooms, hasSpace: !!sp });
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
    this.setData({
      showEditor: true, editing: false, editingId: '', formName: '', formW: '', formD: '', formH: '', formError: '',
      templates: store.listRoomTemplates(), startTemplate: ''
    });
  },
  // CR-001 F-07：选择新建房间起点（'' 空白 / 模板 key）
  setStart: function (e) { this.setData({ startTemplate: e.currentTarget.dataset.key || '' }); },
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
    // 留空时由数据层写入默认 4×4×2.8m；填写时按布局输入使用
    var dims = { width: Number(f.formW) || 0, depth: Number(f.formD) || 0, height: Number(f.formH) || 0 };
    var r;
    if (f.editing) {
      r = store.updateRoom(f.editingId, { name: f.formName });
      if (r.ok) r = store.updateRoom(f.editingId, dims);
    } else {
      var sp = store.getActiveSpace();
      // 首次使用可能没有任何空间：自动建立默认空间，避免建房间被“请先创建一个空间”卡住
      if (!sp) {
        var sr = store.addSpace('我的空间');
        if (!sr.ok) { this.setData({ formError: '默认空间创建失败：' + sr.error }); return; }
        store.setActiveSpace(sr.data.id);
        sp = sr.data;
      }
      r = store.addRoom(sp.id, f.formName, dims);
    }
    if (!r.ok) {
      this.setData({ formError: r.error === 'ROOM_NAME_DUPLICATE'
        ? '当前空间已有同名房间，请换一个名称' : '保存失败：' + r.error });
      return;
    }
    // CR-001 F-07：新建且选了模板时应用预置家具；模板缺失则降级空白房间，不阻断建房
    var msg = f.editing ? '已保存' : '房间已创建';
    if (!f.editing && f.startTemplate) {
      var tr = store.applyRoomTemplate(r.data.id, f.startTemplate);
      msg = tr.ok ? '模板家具已预置' : '模板暂不可用，已建空白房间';
    }
    this.setData({ showEditor: false });
    wx.showToast({ title: msg, icon: 'success' });
    this.load();
  },

  // 演示口径：新建房间的两个明确起点（空白 / 卧室模板）
  createRoom: function (e) {
    var key = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.template) || '';
    var patch = { startTemplate: key };
    if (!key) patch.formW = patch.formD = patch.formH = '';
    var self = this;
    this.setData(patch, function () { self.save(); });
  },

  // 物理删除房间（用户确认口径）：不可恢复，须强提示；关联物品解绑置为位置未知
  destroy: function (e) {
    var d = e.currentTarget.dataset, self = this;
    var a = store.roomAssociations(d.id);
    var detail = '这将永久删除「' + d.name + '」及其全部家具、节点，操作不可恢复。';
    if (a.items > 0) detail += '\n其中 ' + a.items + ' 件物品不会被删除，但会变为「位置未知」。';
    wx.showModal({
      title: '永久删除房间',
      content: detail + '\n确认继续？',
      confirmText: '永久删除',
      confirmColor: '#BE5F44',
      success: function (res) {
        if (!res.confirm) return;
        var r = store.deleteRoom(d.id);
        if (!r.ok) { wx.showToast({ title: '删除失败：' + r.error, icon: 'none' }); return; }
        wx.showToast({ title: '已永久删除', icon: 'success' });
        self.load();
      }
    });
  },

  archive: function (e) {
    var d = e.currentTarget.dataset, self = this;
    // 业务规则第11章：删除/归档前检查家具、节点、物品关联，避免位置关系断裂
    var a = store.roomAssociations(d.id);
    var content = '归档「' + d.name + '」？数据保留但退出日常列表，历史可追溯。';
    if (a.total > 0) {
      content = '「' + d.name + '」下仍有 ' + a.furniture + ' 件家具、' + a.nodes + ' 个收纳节点、'
        + a.items + ' 件物品。归档后该房间不再作为新物品与家具的可选位置，历史记录仍可追溯。是否继续？';
    }
    wx.showModal({
      title: a.total > 0 ? '房间存在关联数据' : '删除房间',
      content: content,
      confirmText: a.total > 0 ? '仍要删除' : '删除',
      confirmColor: '#BE5F44',
      success: function (res) {
        if (res.confirm && store.archiveRoom(d.id).ok) {
          wx.showToast({ title: '已归档', icon: 'success' }); self.load();
        }
      }
    });
  }
});
