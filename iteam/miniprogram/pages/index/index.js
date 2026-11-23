// pages/index/index.js —— 首页 UI-001（视觉方案 A「原木日常」，对齐 demo 截图）
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

var FLOOR_ROW_H = 96; // 每行高度（rpx），与 WXSS 行高一致

Page({
  data: {
    stats: { spaceName: '', spaceCount: 0, roomCount: 0, itemCount: 0, inventoryCount: 0, lowCount: 0, unknownCount: 0 },
    overview: { rooms: [], area: 0, rows: 1, cols: 6, maxRows: 8, spaceName: '' },
    alerts: [],
    recent: [],
    hourGreet: '上午好',
    editing: false,
    dragging: false,
    dragInvalid: false
  },

  onShow: function () {
    this.setData({ editing: false, dragging: false, dragInvalid: false });
    this.refresh();
  },

  refresh: function () {
    var hour = new Date().getHours();
    var greet = hour < 11 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    var stats = store.getStats();
    var overview = store.getHomeOverview();
    var alerts = store.listAlerts();
    // 最近变动：合并位置历史与库存交易，按时间倒序取前 2
    var rec = [];
    store.listMovements().forEach(function (m) {
      var it = store.getItem(m.itemId);
      rec.push({
        id: m.id, itemId: m.itemId, name: it ? it.name : '（已删除物品）',
        desc: (C.MOVEMENT_TYPES[m.type] || '位置变动'),
        ts: m.createdAt, time: store.fmtTime(m.createdAt)
      });
    });
    store.listTransactions().forEach(function (t) {
      var it = store.getItem(t.itemId);
      var tn = (C.INVENTORY_TX_TYPES.filter(function (x) { return x.key === t.type; })[0] || {}).name || '库存';
      rec.push({
        id: t.id, itemId: t.itemId, name: it ? it.name : '（已删除物品）',
        desc: tn + ' ' + (t.delta > 0 ? '+' : '') + t.delta + '，余额 ' + t.balanceAfter,
        ts: t.createdAt, time: store.fmtTime(t.createdAt)
      });
    });
    rec.sort(function (a, b) { return b.ts - a.ts; });
    // 刷新只更新数据；编辑态由 onShow / 切换按钮管理，避免连续拖动房间时中途退出编辑
    this.setData({
      stats: stats, overview: overview, alerts: alerts,
      recent: rec.slice(0, 2), hourGreet: greet,
      noRooms: overview.rooms.length === 0,
      dragging: false, dragInvalid: false
    });
  },

  // ---------- 导航 ----------
  goSpaces: function () { wx.navigateTo({ url: '/pages/space/space' }); },
  goRooms: function () { wx.switchTab({ url: '/pages/room/room' }); },
  // demo 对齐：首页快捷「三维」直接进入当前空间第一个房间的三维页
  go3d: function () {
    var rooms = this.data.overview && this.data.overview.rooms ? this.data.overview.rooms : [];
    if (rooms.length && rooms[0].id) wx.navigateTo({ url: '/pages/room3d/room3d?id=' + rooms[0].id });
    else wx.switchTab({ url: '/pages/room/room' });
  },
  goItems: function () { wx.switchTab({ url: '/pages/item-list/item-list' }); },
  goInventory: function () { wx.switchTab({ url: '/pages/inventory/inventory' }); },
  goAlerts: function () { wx.navigateTo({ url: '/pages/alerts/alerts' }); },
  goAddItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit' }); },
  goAddRoom: function () { wx.navigateTo({ url: '/pages/room/room?create=1' }); },
  goRoom3d: function (e) {
    var id = e.currentTarget.dataset.id;
    if (this.data.editing) return; // 编辑态下点击房间不跳转
    if (id) wx.navigateTo({ url: '/pages/room3d/room3d?id=' + id });
    else wx.switchTab({ url: '/pages/room/room' });
  },
  goItemDetail: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + id });
  },

  // ---------- 户型布局编辑 ----------
  toggleEdit: function () {
    var editing = !this.data.editing;
    this.setData({ editing: editing, dragging: false, dragInvalid: false });
    wx.showToast({ title: editing ? '编辑中：拖动房间移动、拖任意边/角把手调整宽高；越界自动钳制，重叠不可保存' : '布局已保存', icon: 'none' });
  },

  autoLayout: function () {
    var self = this;
    wx.showModal({
      title: '恢复自动排布',
      content: '清除手动调整的位置，按房间创建顺序重新排布？',
      success: function (res) {
        if (!res.confirm) return;
        var sp = store.getActiveSpace();
        if (!sp) return;
        var rooms = store.listRooms(sp.id);
        // 先全部清空 floor，再逐个用 autoFloorPlace 依创建顺序占空位
        rooms.forEach(function (r) { store.updateRoom(r.id, { floor: null }); });
        rooms.forEach(function (r) { store.updateRoom(r.id, { floor: store.autoFloorPlace(sp.id) }); });
        self.setData({ editing: false });
        self.refresh();
        wx.showToast({ title: '已恢复自动排布', icon: 'success' });
      }
    });
  },

  onRoomTouchStart: function (e) {
    if (!this.data.editing) return;
    var t = e.touches[0];
    var id = e.currentTarget.dataset.id;
    var handle = e.currentTarget.dataset.handle || '';
    var room = this.data.overview.rooms.filter(function (r) { return r.id === id; })[0];
    if (!room) return;
    this._drag = {
      id: id, handle: handle,
      startX: t.clientX, startY: t.clientY,
      base: { x: room.floor.x, y: room.floor.y, w: room.floor.w, h: room.floor.h }
    };
    this.setData({ dragging: true, dragInvalid: false });
  },

  onRoomTouchMove: function (e) {
    if (!this.data.editing || !this._drag) return;
    var t = e.touches[0];
    var d = this._drag;
    var sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
    var pxToRpx = sys && sys.windowWidth ? 750 / sys.windowWidth : 2;
    var cellW = (690 / this.data.overview.cols) * pxToRpx; // 容器宽 / 列数
    var cellH = FLOOR_ROW_H;
    var dx = Math.round((t.clientX - d.startX) * pxToRpx / cellW);
    var dy = Math.round((t.clientY - d.startY) * pxToRpx / cellH);
    var b = d.base, cand = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (!d.handle) {
      cand.x = b.x + dx; cand.y = b.y + dy;
    } else {
      if (d.handle.indexOf('w') >= 0) { cand.x = b.x + dx; cand.w = b.w - dx; }
      if (d.handle.indexOf('e') >= 0) { cand.w = b.w + dx; }
      if (d.handle.indexOf('n') >= 0) { cand.y = b.y + dy; cand.h = b.h - dy; }
      if (d.handle.indexOf('s') >= 0) { cand.h = b.h + dy; }
    }
    var others = this.data.overview.rooms.filter(function (r) { return r.id !== d.id; })
      .map(function (r) { return { id: r.id, floor: r.floor }; });
    var valid = store.floorValid(others, d.id, cand);
    d.cand = cand;
    // 即时预览（不落库），dragInvalid 控制红色描边
    var rooms = this.data.overview.rooms.slice();
    var idx = -1;
    for (var i = 0; i < rooms.length; i++) if (rooms[i].id === d.id) { idx = i; break; }
    if (idx >= 0) {
      var nr = {};
      for (var k in rooms[idx]) nr[k] = rooms[idx][k];
      nr.floor = cand;
      rooms[idx] = nr;
      this.setData({ overview: Object.assign({}, this.data.overview, { rooms: rooms }), dragInvalid: !valid });
    }
  },

  onRoomTouchEnd: function () {
    if (!this.data.editing || !this._drag) return;
    var d = this._drag;
    var cand = d.cand || d.base;
    var others = this.data.overview.rooms.filter(function (r) { return r.id !== d.id; })
      .map(function (r) { return { id: r.id, floor: r.floor }; });
    var valid = store.floorValid(others, d.id, cand);
    this._drag = null;
    if (valid) store.updateRoom(d.id, { floor: cand });
    this.refresh();
    if (!valid) wx.showToast({ title: '布局与其他房间重叠或越界，未保存', icon: 'none' });
  }
});
