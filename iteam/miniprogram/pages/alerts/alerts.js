// pages/alerts/alerts.js —— 提醒页 UI-017
var store = require('../../utils/store.js');

Page({
  data: { alerts: [] },
  onShow: function () {
    this.setData({ alerts: store.listAlerts().map(function (a) {
      return {
        id: a.id, itemId: a.itemId, name: a.name, status: a.status,
        balance: a.balance, threshold: a.threshold, unit: a.unit,
        time: store.fmtTime(a.createdAt)
      };
    }) });
  },
  goDetail: function (e) { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + e.currentTarget.dataset.id }); },
  ignore: function (e) {
    if (store.ignoreAlert(e.currentTarget.dataset.id).ok) {
      wx.showToast({ title: '已忽略本次', icon: 'success' });
      this.onShow();
    }
  }
});
