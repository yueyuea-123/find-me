// pages/alerts/alerts.js —— 提醒页 UI-017
var store = require('../../utils/store.js');

Page({
  data: {
    alerts: [],
    tabs: [
      { key: 'pending', name: '待处理' },
      { key: 'ignored', name: '已忽略' },
      { key: 'recovered', name: '已恢复' }
    ],
    tabKey: 'pending'
  },
  onShow: function () {
    var key = this.data.tabKey;
    var list = store.listAlerts({ includeRecovered: true }).filter(function (a) { return a.status === key; });
    this.setData({ alerts: list.map(function (a) {
      return {
        id: a.id, itemId: a.itemId, name: a.name, status: a.status,
        balance: a.balance, threshold: a.threshold, unit: a.unit,
        time: store.fmtTime(a.createdAt)
      };
    }) });
  },
  switchTab: function (e) { this.setData({ tabKey: e.currentTarget.dataset.key }, this.onShow); },
  goDetail: function (e) { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + e.currentTarget.dataset.id }); },
  ignore: function (e) {
    if (store.ignoreAlert(e.currentTarget.dataset.id).ok) {
      wx.showToast({ title: '已忽略本次', icon: 'success' });
      this.onShow();
    }
  }
});
