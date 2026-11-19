// pages/room3d/room3d.js —— 三维房间页 UI-006（WebGL + 列表降级）
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');
var RR = require('../../utils/room-renderer.js');

Page({
  data: {
    roomId: '', roomName: '', dimText: '', mode: 'browse', view: '3d',
    furniture: [], selected: null, glError: '',
    bindings: null // CR-001 F-03：当前选中模型的关联物品汇总
  },

  onLoad: function (q) { this.setData({ roomId: q.id || '' }); },
  onShow: function () { this.loadData(); },
  onUnload: function () { this.renderer = null; },

  loadData: function () {
    var room = store.getRoom(this.data.roomId);
    if (!room) { wx.showToast({ title: '房间不存在', icon: 'none' }); return; }
    var list = store.listFurniture(this.data.roomId).map(function (f) {
      var lib = C.FURNITURE_LIB[f.category] || {};
      return {
        id: f.id, name: f.name, category: f.category, icon: lib.icon || '▣',
        model: f.model, status: f.status, confidence: f.confidence,
        px: (f.position.x || 0).toFixed(2), pz: (f.position.z || 0).toFixed(2),
        rot: Math.round((f.rotation || 0) * 180 / Math.PI),
        // 渲染用原始数据
        _raw: f
      };
    });
    this._room = room;
    this._furniture = list;
    var dim = room.calibrated ? (room.width + '×' + room.depth + '×' + room.height + ' m') : '尺寸未定标（相对估算）';
    this.setData({ roomName: room.name, dimText: dim, furniture: list });
    this._safeRender();
  },

  // WebGL 调用统一保护：任何渲染期异常都降级为列表，避免黑屏/白屏
  _safeGL: function (fn, args) {
    if (!this.renderer || typeof this.renderer[fn] !== 'function') return null;
    try { return this.renderer[fn].apply(this.renderer, args || []); }
    catch (e) {
      this.renderer = null;
      this.setData({ glError: '三维渲染异常，已切换列表', view: 'list' });
      return null;
    }
  },
  _safeRender: function () { if (this.data.view === '3d') this._safeGL('render'); },

  onReady: function () {
    var self = this;
    wx.createSelectorQuery().in(this).select('#gl').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) {
        self.setData({ glError: '无法获取 canvas 节点，请使用基础库 2.9+', view: 'list' });
        return;
      }
      var canvas = res[0].node;
      var r = RR.createRoomRenderer(canvas, function () {
        return {
          room: self._room ? { width: self._room.width, depth: self._room.depth, height: self._room.height } : null,
          furniture: (self._furniture || []).map(function (x) { return x._raw; })
        };
      });
      if (!r.ok) {
        self.setData({ glError: r.error === 'WEBGL_UNAVAILABLE' ? '设备不支持 WebGL' : ('着色器失败：' + r.message), view: 'list' });
        return;
      }
      canvas.width = Math.max(1, Math.floor(res[0].width));
      canvas.height = Math.max(1, Math.floor(res[0].height));
      r.resize(canvas.width, canvas.height);
      self.renderer = r;
      self._safeRender();
    });
  },

  // 触摸：CR-001 F-02——编辑模式且已选中模型时，单指移动模型/双指缩放模型；否则作用于相机
  _editingModel: function () {
    return this.data.mode === 'edit' && this.data.view === '3d' && !!this.data.selected;
  },
  onTouchStart: function (e) {
    if (!this.renderer) return;
    var ts = e.touches;
    if (ts.length === 1) { this._sx = ts[0].x; this._sy = ts[0].y; this._moved = false; }
    else if (ts.length === 2) { this._pinch = this._dist(ts); this._moved = true; }
  },
  onTouchMove: function (e) {
    if (!this.renderer) return;
    var ts = e.touches;
    if (ts.length === 1 && this._sx !== undefined) {
      var dx = ts[0].x - this._sx, dy = ts[0].y - this._sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) this._moved = true;
      if (this._editingModel()) {
        // 像素→世界：按相机距离近似换算，避免与视角缩放脱节
        var scale = Math.max(1, (this._room && Math.max(this._room.width, this._room.depth)) || 6) / 600;
        store.transformFurniture(this.data.selected.id, { type: 'move', dx: dx * scale, dz: dy * scale });
        this._syncSelectedRaw();
        this._refreshSelectedCard();
      } else if (this.data.mode === 'edit') this._safeGL('pan', [dx, dy]);
      else this._safeGL('orbit', [dx, dy]);
      this._sx = ts[0].x; this._sy = ts[0].y;
      this._safeRender();
    } else if (ts.length === 2 && this._pinch) {
      var d = this._dist(ts);
      if (this._editingModel()) {
        var delta = (this._pinch - d) / Math.max(1, this._pinch);
        if (Math.abs(delta) > 0.001) {
          store.transformFurniture(this.data.selected.id, { type: 'scale', factor: delta });
          this._syncSelectedRaw(); this._refreshSelectedCard();
        }
      } else this._safeGL('zoom', [this._pinch - d]);
      this._pinch = d;
      this._safeRender();
    }
  },
  onTouchEnd: function () {
    if (!this.renderer) return;
    if (!this._moved && this._sx !== undefined && this.data.view === '3d') {
      var idx = this._safeGL('pick', [this._sx, this._sy]);
      if (idx !== null && idx >= 0) this.selectIndex(idx);
    }
    this._sx = this._sy = undefined; this._pinch = null;
  },
  // 变换后：_raw 指向 store 内存对象，updateFurniture 已落盘；这里刷新列表展示值
  _syncSelectedRaw: function () {
    var sel = this.data.selected;
    if (!sel) return;
    var f = store.getFurniture(sel.id);
    var row = null;
    for (var i = 0; i < this._furniture.length; i++) if (this._furniture[i].id === sel.id) { row = this._furniture[i]; break; }
    if (f && row) {
      row._raw = f;
      row.px = (f.position.x || 0).toFixed(2);
      row.pz = (f.position.z || 0).toFixed(2);
      row.rot = Math.round((f.rotation || 0) * 180 / Math.PI);
    }
  },
  _refreshSelectedCard: function () {
    var sel = this.data.selected, row = null;
    if (!sel) return;
    for (var i = 0; i < this._furniture.length; i++) if (this._furniture[i].id === sel.id) { row = this._furniture[i]; break; }
    if (row) this.setData({ selected: {
      id: row.id, name: row.name, px: row.px, pz: row.pz, rot: row.rot, status: row.status
    }, furniture: this._furniture });
  },
  rotateSelected: function (e) {
    if (!this.data.selected) return;
    var deg = Number(e.currentTarget.dataset.deg) || 15;
    store.transformFurniture(this.data.selected.id, { type: 'rotate', dr: deg * Math.PI / 180 });
    this._syncSelectedRaw(); this._refreshSelectedCard(); this._safeRender();
  },
  _dist: function (ts) {
    var dx = ts[0].x - ts[1].x, dy = ts[0].y - ts[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  selectIndex: function (idx) {
    var f = this._furniture[idx];
    if (!f) return;
    this._safeGL('setSelected', [idx]);
    this.setData({
      selected: { id: f.id, name: f.name, px: f.px, pz: f.pz, rot: f.rot, status: f.status },
      // CR-001 F-03：点选模型即展示其关联物品（沿 nodes.furnitureId + items.currentNodeId 单源）
      bindings: store.bindingsOfFurniture(f.id)
    });
  },
  selectFromList: function (e) {
    var id = e.currentTarget.dataset.id;
    for (var i = 0; i < this._furniture.length; i++) {
      if (this._furniture[i].id === id) { this.selectIndex(i); break; }
    }
  },
  clearSel: function () {
    this._safeGL('setSelected', [-1]);
    this.setData({ selected: null, bindings: null });
    this._safeRender();
  },

  setMode: function (e) { this.setData({ mode: e.currentTarget.dataset.m }); },
  setView: function (e) {
    var v = e.currentTarget.dataset.v;
    this.setData({ view: v });
    if (v === '3d') this._safeRender();
  },
  resetView: function () { this._safeGL('reset'); this._safeRender(); },

  editFurniture: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?id=' + this.data.selected.id });
  },
  goNodes: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + this.data.selected.id });
  },
  // CR-001 F-04：从模型关联物品跳转到物品详情（物品侧可再移动，走 moveItem 单物件单位置）
  goItemDetail: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + id });
  },
  confirmCandidate: function () {
    var self = this;
    wx.showModal({
      title: '确认候选家具',
      content: '确认后该家具位置将作为事实保存，重新建模不会覆盖。',
      success: function (res) {
        if (!res.confirm || !self.data.selected) return;
        store.updateFurniture(self.data.selected.id, { status: 'confirmed' });
        wx.showToast({ title: '已确认', icon: 'success' });
        self.loadData();
      }
    });
  },
  addFurniture: function () {
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?roomId=' + this.data.roomId });
  }
});
