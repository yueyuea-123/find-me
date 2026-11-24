// pages/room3d/sheet-controller.js —— SheetController 模块（阶段2c 第二迁块，模块化路线 V1.0 阶段2b 七块划分）
// 职责：底部抽屉与绑定选择——抽屉视图（_sheetNodes/_refreshSheet/openSheet/closeSheet/
//       toggleSheet/chooseNode/openNodeItem）、添加物品入口与绑定面板（chooseAddItem/
//       addItemAtFurniture/addItemAtActiveNode/_targetNodeId/openBindPicker/closeBindPicker/
//       addItemFromPicker/bindExistingItem）、家具模型库（toggleLib/addFromLib）。
// 边界微调（八·补9 允许按职责微调）：_rootNodeId/_targetNodeId 原划 SceneStateStore，
//       但仅被本模块方法族使用，随 SheetController 迁出以保内聚。
// 边界：只读写 sheetNodes/activeNodeId/nodeItems/bindableItems/showBindPicker/showLib 等
//       抽屉态字段；openBindPicker/closeBindPicker 涉及 canvas 销毁重建，经 glLifecycle
//       管理器操作渲染锁；业务写一律落 store。迁移方式为 mixin 合并进 Page，this 语义不变。
var store = require('../../utils/store.js');
var glLifecycle = require('./gl-lifecycle.js');

module.exports = {
  // 家具下全部收纳节点（含家具根节点），按父子层级平铺；计数只统计当前有效物品
  _sheetNodes: function (furnitureId) {
    if (!furnitureId) return [];
    var all = store.listNodes(this.data.roomId).filter(function (n) {
      return n.furnitureId === furnitureId;
    });
    var out = [];
    var walk = function (parentId, depth) {
      var level = all.filter(function (n) { return (n.parentId || '') === parentId; })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      level.forEach(function (n) {
        out.push({
          id: n.id, name: n.name, type: n.type, depth: depth,
          path: store.nodePath(n.id).join(' / '),
          itemCount: store.itemsInNode(n.id).length
        });
        walk(n.id, depth + 1);
      });
    };
    walk('', 0);
    return out;
  },

  // 抽屉内容随选中家具/节点同步；节点物品只看直接关联的物品（规则 §4.1）
  _refreshSheet: function (furnitureId) {
    var nodes = this._sheetNodes(furnitureId);
    var active = this.data.activeNodeId;
    if (!nodes.some(function (n) { return n.id === active; })) active = nodes.length ? nodes[0].id : '';
    var items = active ? store.itemsInNode(active).slice(0, 5).map(function (it) {
      return { id: it.id, name: it.name, locationStatus: it.locationStatus || '' };
    }) : [];
    this.setData({
      sheetNodes: nodes, activeNodeId: active,
      activeNodePath: active ? store.nodePath(active).join(' / ') : '',
      nodeItems: items
    });
  },

  openSheet: function () {
    if (!this.data.selected) return;
    this._refreshSheet(this.data.selected.id);
    this.setData({ sheetOpen: true, sheetCollapsed: false });
  },
  closeSheet: function () { this.setData({ sheetOpen: false, sheetCollapsed: false }); },
  toggleSheet: function () {
    if (!this.data.sheetOpen) { this.openSheet(); return; }
    this.setData({ sheetCollapsed: !this.data.sheetCollapsed });
  },
  chooseNode: function (e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ activeNodeId: id });
    this._refreshSheet(this.data.selected && this.data.selected.id);
  },
  openNodeItem: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + id });
  },

  // 家具根收纳节点：物品绑定到家具即写入该节点（规范 §5.1 家具作为存放位置入口）
  _rootNodeId: function (fid) {
    var nodes = store.listNodes(this.data.roomId).filter(function (n) {
      return n.furnitureId === fid && !n.parentId;
    });
    return nodes.length ? nodes[0].id : '';
  },

  // 添加物品入口：从已有物品中选择 / 新建物品（规范 §5.2）
  chooseAddItem: function () {
    if (!this.data.selected) { wx.showToast({ title: '请先点选家具', icon: 'none' }); return; }
    var self = this;
    wx.showActionSheet({
      itemList: ['从已有物品中选择', '新建物品'],
      success: function (res) {
        if (res.tapIndex === 0) self.openBindPicker();
        else if (res.tapIndex === 1) self.addItemAtFurniture(self.data.selected.id, self.data.activeNodeId);
      }
    });
  },

  // 新建物品：进入建档页并预选当前家具/当前收纳节点（规则 §3.2、§3.3）
  addItemAtFurniture: function (furnitureId, nodeId) {
    // 兼容旧调用传入的家具 id；按钮 bindtap 传事件对象，此时回退到选中家具
    var fid = (typeof furnitureId === 'string' && furnitureId) || (this.data.selected && this.data.selected.id);
    if (!fid) { wx.showToast({ title: '请先选中家具', icon: 'none' }); return; }
    var target = (typeof nodeId === 'string' && nodeId)
      || this.data.activeNodeId
      || this._rootNodeId(fid);
    wx.navigateTo({ url: '/pages/item-edit/item-edit?nodeId=' + target });
  },
  // 抽屉「添加物品」按钮：默认继承当前选中节点
  addItemAtActiveNode: function () {
    this.addItemAtFurniture('', this.data.activeNodeId);
  },

  // 当前家具下的有效目标节点：抽屉里选中了节点则用它，否则回退家具根节点
  _targetNodeId: function (fid) {
    var active = this.data.activeNodeId;
    var nodes = store.listNodes(this.data.roomId).filter(function (n) { return n.furnitureId === fid; });
    if (active && nodes.some(function (n) { return n.id === active; })) return active;
    return this._rootNodeId(fid);
  },

  // 从已有物品中选择：列出未结束档案，点选即绑定/改存放家具（规范 §5.2、§9.7、§9.9）
  openBindPicker: function () {
    var sel = this.data.selected;
    if (!sel) return;
    if (!this._targetNodeId(sel.id)) { wx.showToast({ title: '该家具暂无收纳节点', icon: 'none' }); return; }
    // 绑定面板用 wx:if 替换三维块，canvas 将被销毁：释放引用便于返回时重建
    glLifecycle.reset(this);
    var fid = sel.id;
    var statusText = { at_home: '在家·位置未知', unknown: '位置未知', out: '外出', borrowed: '借出' };
    var list = store.listItems().map(function (it) {
      var node = it.currentNodeId ? store.getNode(it.currentNodeId) : null;
      var owner = node && node.furnitureId ? store.getFurniture(node.furnitureId) : null;
      return {
        id: it.id, name: it.name,
        locText: it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (statusText[it.locationStatus] || '未设置'),
        here: !!owner && owner.id === fid
      };
    });
    this.setData({ bindableItems: list, bindTargetName: sel.name, showBindPicker: true });
  },
  closeBindPicker: function () {
    var self = this;
    this.setData({ showBindPicker: false, bindableItems: [] }, function () {
      // canvas 随 wx:if 重建，重新初始化渲染器；失败会自动降级列表
      glLifecycle.unlockInit(self);
      setTimeout(function () { self._initGL(); }, 60);
    });
  },
  // 绑定面板内直接新建物品：进入建档页并预选当前收纳节点
  addItemFromPicker: function () {
    var sel = this.data.selected;
    if (!sel) return;
    this.addItemAtFurniture(sel.id, this._targetNodeId(sel.id));
  },
  bindExistingItem: function (e) {
    var id = e.currentTarget.dataset.id;
    var sel = this.data.selected;
    if (!id || !sel) return;
    var nodeId = this._targetNodeId(sel.id);
    if (!nodeId) return;
    var r = store.moveItem(id, { locationStatus: 'at_home', currentNodeId: nodeId });
    if (!r.ok) { wx.showToast({ title: '绑定失败：' + r.error, icon: 'none' }); return; }
    wx.showToast({ title: r.unchanged ? '已在该位置' : '已绑定到「' + sel.name + '」', icon: 'none' });
    this.closeBindPicker();
    this._syncSceneToGL(); this.loadData();
  },

  // 家具模型库：按需展开为抽屉，点选即添加占位家具（规范 §3.1、§4.1）
  toggleLib: function () { this.setData({ showLib: !this.data.showLib }); },
  addFromLib: function (e) {
    var cat = e.currentTarget.dataset.cat;
    if (!cat) return;
    if (!store.getRoom(this.data.roomId)) { wx.showToast({ title: '请先创建房间', icon: 'none' }); return; }
    var count = store.listFurniture(this.data.roomId).filter(function (f) { return f.category === cat; }).length;
    var r = store.addFurniture(this.data.roomId, { category: cat, name: count ? cat + ' ' + (count + 1) : cat });
    if (!r.ok) { wx.showToast({ title: '添加失败：' + r.error, icon: 'none' }); return; }
    this.setData({ showLib: false });
    wx.showToast({ title: '已添加，选中后可用按钮微调', icon: 'success' });
    this.loadData();
  }
};
