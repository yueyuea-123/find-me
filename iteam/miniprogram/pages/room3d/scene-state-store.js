// pages/room3d/scene-state-store.js —— SceneStateStore 模块（阶段2c 第四迁块，模块化路线 V1.0 阶段2b 七块划分）
// 职责：页面数据装配——store 事实到页面渲染模型的单一通道：
//       loadData（房间/家具列表装配与选中态保持）、_selectedCard（选中卡内容）、
//       _decorateBindings（绑定汇总补展示名）、_loadSpaceItems（物品视图房间级过滤列表）、
//       _syncSceneToGL（拖动落盘后把最新 _raw 同步给渲染器）。
// 边界：只做 store→页面 的只读装配与 _raw 引用刷新，写操作一律经各交互模块落 store；
//       _rootNodeId/_targetNodeId 已随职责微调迁入 SheetController（八·补10）；
//       渲染刷新经页面基底 _safeRender/_syncSelectionToGL，mixin 合并进 Page，this 语义不变。
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');
var helpers = require('./helpers.js');
var clampNum = helpers.clampNum;
var fmtNum = helpers.fmtNum;
var furnitureThumb = helpers.furnitureThumb;
var itemThumb = helpers.itemThumb;

module.exports = {
  loadData: function () {
    var room = store.getRoom(this.data.roomId);
    if (!room) { wx.showToast({ title: '房间不存在', icon: 'none' }); return; }
    var list = store.listFurniture(this.data.roomId).map(function (f) {
      var lib = C.FURNITURE_LIB[f.category] || {};
      return {
        id: f.id, name: f.name, category: f.category, icon: lib.icon || '▣',
        thumb: furnitureThumb(f),
        model: f.model, status: f.status, confidence: f.confidence,
        px: (f.position.x || 0).toFixed(2), pz: (f.position.z || 0).toFixed(2),
        rot: Math.round((f.rotation || 0) * 180 / Math.PI),
        sz: fmtNum(f.size && f.size.w) + '×' + fmtNum(f.size && f.size.d) + '×' + fmtNum(f.size && f.size.h),
        bindCount: store.bindingsOfFurniture(f.id).items.length,
        _raw: f
      };
    });
    this._room = room;
    this._furniture = list;
    // 选中态：优先保持当前选中；否则保持规范 V1.0 兼容（默认第一件，demo 对齐依赖此串）
    var selected = this.data.selected, selRow = null;
    if (selected) {
      for (var si = 0; si < list.length; si++) if (list[si].id === selected.id) { selRow = list[si]; break; }
    }
    if (!selRow && list.length) selRow = list[0];
    var dim = room.calibrated ? (room.width + '×' + room.depth + '×' + room.height + ' m') : '尺寸未定标（相对估算）';
    this.setData({
      roomName: room.name, dimText: dim, furniture: list,
      selected: selRow ? this._selectedCard(selRow) : null,
      bindings: this._decorateBindings(selRow ? selRow.id : '')
    });
    // 底部 dock 的「物品（N）」徽标需要实时数量；只加载数据，不切换视图/状态
    this._loadSpaceItems();
    // 抽屉内容跟随选中家具刷新；打开状态由用户点击控制，loadData 不擅自弹面板
    this._refreshSheet(selRow ? selRow.id : '');
    // 同步选中态到渲染器：高亮环与卡片选中态一致
    this._syncSelectionToGL();
    this._safeRender();
  },

  _selectedCard: function (row) {
    return {
      id: row.id, name: row.name, px: row.px, pz: row.pz,
      rot: row.rot, sz: row.sz, status: row.status,
      bindCount: store.bindingsOfFurniture(row.id).items.length
    };
  },

  // 绑定汇总补展示名（store 只回 items，展示用 itemNames 在此组装，不改数据层）
  _decorateBindings: function (furnitureId) {
    if (!furnitureId) return null;
    var b = store.bindingsOfFurniture(furnitureId);
    b.itemNames = (b.items || []).map(function (it) { return it.name; }).join('、');
    return b;
  },

  _loadSpaceItems: function () {
    // 已进入具体房间，只展示该房间的物品（按 nodes.roomId 聚合），不再混入同空间其他房间/未定位物品。
    // 用户反馈：进主卧却看到客厅/未定位的物品，属口径错误；改为房间级过滤。
    var rid = this.data.roomId || (this._room && this._room.id);
    var list = store.listItems({ roomId: rid }).map(function (it) {
      var node = it.currentNodeId ? store.getNode(it.currentNodeId) : null;
      var owner = node && node.furnitureId ? store.getFurniture(node.furnitureId) : null;
      var iv = store.findInventoryByItem(it.id);
      return {
        id: it.id, name: it.name, photoPath: it.photoPath || '', category: it.category || '',
        thumb: it.photoPath || itemThumb(it),
        qty: iv ? fmtNum(iv.balance) + (iv.unit || '') : '',
        furnitureName: owner ? owner.name : '',
        locText: node ? store.nodePath(it.currentNodeId).join(' / ') : '未设置位置'
      };
    });
    this.setData({ spaceItems: list });
  },

  // 拖动后把最新 raw 同步给渲染器（getData 返回 _raw 引用，updateFurniture 已落盘）
  _syncSceneToGL: function () {
    for (var i = 0; i < this._furniture.length; i++) {
      var f = store.getFurniture(this._furniture[i].id);
      if (f) this._furniture[i]._raw = f;
    }
  }
};
