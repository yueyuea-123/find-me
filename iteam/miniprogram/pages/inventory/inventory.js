// pages/inventory/inventory.js —— 库存总览 UI-015
var store = require('../../utils/store.js');

Page({
  data: { list: [], lowCount: 0 },
  onShow: function () {
    var list = store.listInventory();
    this.setData({ list: list, lowCount: store.listAlerts().length });
  },
  openDetail: function (e) { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + e.currentTarget.dataset.id }); },
  goAlerts: function () { wx.navigateTo({ url: '/pages/alerts/alerts' }); },
  addInventoryItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit' }); }
});
