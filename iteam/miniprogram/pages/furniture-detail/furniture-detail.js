// pages/furniture-detail/furniture-detail.js —— 家具详情 UI-008
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: { furniture: null, nodes: [], roomName: '', furnitureList: [] },

  onLoad: function (q) {
    this._id = q.id || '';
    this._roomId = q.roomId || '';
  },
  onShow: function () { this.load(); },

  load: function () {
    if (this._id) {
      var f = store.getFurniture(this._id);
      if (!f) return;
      var lib = C.FURNITURE_LIB[f.category] || {};
      // 该家具为根节点的节点树（平铺，带路径）
      var all = store.listNodes(f.roomId);
      var root = all.filter(function (n) { return n.furnitureId === f.id && n.type === '家具'; })[0];
      var selfId = root ? root.id : '';
      var nodes = all.filter(function (n) { return n.furnitureId === f.id; }).map(function (n) {
        return {
          id: n.id, name: n.name, type: n.type,
          path: store.nodePath(n.id).join(' / '),
          itemCount: store.itemsInNode(n.id).length
        };
      });
      this.setData({
        furniture: {
          id: f.id, name: f.name, category: f.category, model: f.model,
          status: f.status, icon: lib.icon || '▣'
        },
        nodes: nodes
      });
    } else if (this._roomId) {
      var room = store.getRoom(this._roomId);
      var list = store.listFurniture(this._roomId).map(function (x) {
        var l = C.FURNITURE_LIB[x.category] || {};
        return {
          id: x.id, name: x.name, model: x.model, status: x.status, icon: l.icon || '▣',
          nodeCount: store.listNodes(x.roomId).filter(function (n) { return n.furnitureId === x.id && n.type !== '家具'; }).length
        };
      });
      this.setData({ roomName: room ? room.name : '', furnitureList: list });
    }
  },

  editFurniture: function () {
    if (!this.data.furniture) return;
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?id=' + this.data.furniture.id });
  },
  addFurniture: function () { wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?roomId=' + this._roomId }); },
  openFurniture: function (e) { wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + e.currentTarget.dataset.id }); },
  openNode: function (e) { wx.navigateTo({ url: '/pages/node/node?id=' + e.currentTarget.dataset.id }); },

  addNode: function () {
    var self = this, f = this.data.furniture;
    wx.showModal({
      title: '新增收纳节点',
      content: '请输入节点名称（如：上层抽屉 / 收纳盒 A）',
      editable: true, placeholderText: '节点名称',
      success: function (res) {
        if (!res.confirm || !(res.content || '').trim()) return;
        // 挂在该家具的"家具根节点"下
        var all = store.listNodes(self._roomId);
        var root = all.filter(function (n) { return n.furnitureId === f.id && n.type === '家具'; })[0];
        var r = store.addNode(self._roomId, root ? root.id : '', res.content.trim(), '抽屉/隔层');
        if (r.ok) { wx.showToast({ title: '已添加', icon: 'success' }); self.load(); }
        else wx.showToast({ title: '添加失败', icon: 'none' });
      }
    });
  }
});
