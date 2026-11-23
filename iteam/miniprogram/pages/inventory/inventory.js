// pages/inventory/inventory.js —— 库存总览 UI-015
var store = require('../../utils/store.js');

Page({
  data: {
    list: [], lowCount: 0,
    // 库存筛选（交互说明书 V1.2 §6）：口径按数据模型 trackingMode，不臆造"易耗品/长期用品"枚举
    filters: [
      { key: 'all', name: '全部' },
      { key: 'inventory', name: '只记库存' },
      { key: 'hybrid', name: '位置+库存' }
    ],
    filterKey: 'all'
  },
  onShow: function () { this.load(); },
  load: function () {
    var fk = this.data.filterKey;
    var list = store.listInventory().map(function (iv) {
      var it = store.getItem(iv.itemId) || {};
      // 进度条：以阈值为基准，余额/阈值越大越满；无阈值视为充足
      var pct = iv.threshold > 0 ? Math.min(100, Math.round(iv.balance / iv.threshold * 100)) : 100;
      return {
        id: iv.id, itemId: iv.itemId, name: iv.name, category: iv.category,
        balance: iv.balance, unit: iv.unit, threshold: iv.threshold, low: iv.low,
        trackingMode: it.trackingMode || '', pct: pct
      };
    });
    if (fk !== 'all') list = list.filter(function (iv) { return iv.trackingMode === fk; });
    this.setData({ list: list, lowCount: store.listAlerts().length });
  },
  onFilter: function (e) { this.setData({ filterKey: e.currentTarget.dataset.key }, this.load); },
  openDetail: function (e) { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + e.currentTarget.dataset.id }); },
  goAlerts: function () { wx.navigateTo({ url: '/pages/alerts/alerts' }); },
  addInventoryItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit' }); }
});
