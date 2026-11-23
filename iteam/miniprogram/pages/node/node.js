// pages/node/node.js —— 收纳节点页 UI-009
var store = require('../../utils/store.js');

Page({
  data: { node: null, pathText: '', subNodes: [], items: [] },
  onLoad: function (q) { this._id = q.id || ''; },
  onShow: function () { this.load(); },

  load: function () {
    var n = store.getNode(this._id);
    if (!n) { wx.showToast({ title: '节点不存在', icon: 'none' }); return; }
    var subs = store.childrenOf(this._id).map(function (x) { return { id: x.id, name: x.name, type: x.type }; });
    var items = store.itemsInNode(this._id).map(function (it) {
      var stMap = { at_home: '在家', unknown: '位置未知', out: '外出', borrowed: '借出' };
      var modeMap = { location: '只记位置', inventory: '只记库存', hybrid: '位置+库存' };
      return {
        id: it.id, name: it.name, completed: it.completed,
        statusText: stMap[it.locationStatus] || it.locationStatus,
        statusClass: it.locationStatus === 'at_home' ? 'green' : 'orange',
        modeText: modeMap[it.trackingMode] || it.trackingMode
      };
    });
    this.setData({
      node: { id: n.id, name: n.name, type: n.type, roomId: n.roomId },
      pathText: store.nodePath(this._id).join(' / '),
      subNodes: subs, items: items
    });
  },

  rename: function () {
    if (!this.data.node) return;
    var self = this;
    wx.showModal({
      title: '重命名节点', content: this.data.node.name, editable: true,
      placeholderText: this.data.node.name, confirmText: '保存',
      success: function (res) {
        if (!res.confirm) return;
        if (!(res.content || '').trim()) { wx.showToast({ title: '请输入名称', icon: 'none' }); return; }
        if (store.updateNode(self._id, { name: res.content.trim() }).ok) { wx.showToast({ title: '已保存', icon: 'success' }); self.load(); }
      }
    });
  },

  addSubNode: function () {
    var self = this, node = this.data.node;
    wx.showModal({
      title: '新增下级位置', content: '例如：收纳盒 A / 第二层隔板', editable: true, placeholderText: '节点名称',
      success: function (res) {
        if (!res.confirm || !(res.content || '').trim()) return;
        var r = store.addNode(node.roomId, self._id, res.content.trim(), '抽屉/隔层');
        if (r.ok) { wx.showToast({ title: '已添加', icon: 'success' }); self.load(); }
        else wx.showToast({ title: '添加失败：' + r.error, icon: 'none' });
      }
    });
  },

  openSub: function (e) { wx.navigateTo({ url: '/pages/node/node?id=' + e.currentTarget.dataset.id }); },
  openItem: function (e) { wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.currentTarget.dataset.id }); },
  addItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit?nodeId=' + this._id }); },

  moveUp: function () { store.reorderNode(this._id, -1); this.load(); },
  moveDown: function () { store.reorderNode(this._id, 1); this.load(); },

  remove: function () {
    var self = this;
    wx.showModal({
      title: '删除节点', content: '若节点下有子节点或关联物品，将无法删除（关联保护）。',
      success: function (res) {
        if (!res.confirm) return;
        var r = store.removeNode(self._id);
        if (!r.ok) {
          wx.showModal({ title: '无法删除', content: r.error === 'HAS_LINKS'
            ? ('含 ' + r.children + ' 个下级节点 / ' + r.items + ' 件物品，禁止删除') : ('删除失败：' + r.error), showCancel: false });
          return;
        }
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(function () { wx.navigateBack(); }, 500);
      }
    });
  }
});
