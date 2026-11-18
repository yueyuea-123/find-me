// pages/index/index.js —— 首页 UI-001
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    stats: { spaceName: '', spaceCount: 0, roomCount: 0, itemCount: 0, inventoryCount: 0, lowCount: 0, unknownCount: 0 },
    alerts: [],
    recent: []
  },

  onShow: function () { this.refresh(); },

  refresh: function () {
    var stats = store.getStats();
    var alerts = store.listAlerts();
    // 最近变动：合并位置历史与库存交易，按时间倒序取前 5
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
    this.setData({ stats: stats, alerts: alerts, recent: rec.slice(0, 5) });
  },

  goSpaces: function () { wx.navigateTo({ url: '/pages/space/space' }); },
  goRooms: function () { wx.switchTab({ url: '/pages/room/room' }); },
  goItems: function () { wx.switchTab({ url: '/pages/item-list/item-list' }); },
  goInventory: function () { wx.switchTab({ url: '/pages/inventory/inventory' }); },
  goAlerts: function () { wx.navigateTo({ url: '/pages/alerts/alerts' }); },
  goAddItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit' }); },
  goAddRoom: function () { wx.navigateTo({ url: '/pages/room/room?create=1' }); },
  goSearch: function () { wx.switchTab({ url: '/pages/item-list/item-list' }); },
  goItemDetail: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + id });
  }
});
