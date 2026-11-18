// pages/inventory-detail/inventory-detail.js —— 库存详情 UI-016
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    name: '', balance: 0, unit: '个', threshold: 0, low: false,
    units: C.UNITS, unitIndex: 0,
    txTypes: C.INVENTORY_TX_TYPES, txType: 'in',
    amount: '', txNote: '', txs: []
  },
  onLoad: function (q) { this._id = q.id || ''; },
  onShow: function () {
    var it = store.getItem(this._id);
    var iv = store.findInventoryByItem(this._id);
    if (!iv) { wx.showToast({ title: '该物品未启用库存', icon: 'none' }); return; }
    this.setData({
      name: it ? it.name : '', balance: iv.balance, unit: iv.unit,
      threshold: iv.threshold, low: iv.threshold > 0 && iv.balance <= iv.threshold,
      unitIndex: Math.max(0, C.UNITS.indexOf(iv.unit)),
      txs: this.mapTx()
    });
  },
  mapTx: function () {
    var self = this;
    return store.listTransactions(this._id).map(function (t) {
      var tn = (C.INVENTORY_TX_TYPES.filter(function (x) { return x.key === t.type; })[0] || {}).name || t.type;
      return {
        id: t.id, typeText: tn,
        cls: t.type === 'in' ? 'green' : (t.type === 'consume' ? 'orange' : 'blue'),
        delta: t.delta, after: t.balanceAfter, note: t.note || '',
        time: store.fmtTime(t.createdAt)
      };
    });
  },
  chooseType: function (e) { this.setData({ txType: e.currentTarget.dataset.key }); },
  onAmount: function (e) { this.setData({ amount: e.detail.value }); },
  onTxNote: function (e) { this.setData({ txNote: e.detail.value }); },
  onThreshold: function (e) { this.setData({ threshold: e.detail.value }); },
  onUnit: function (e) { this.setData({ unitIndex: Number(e.detail.value) }); },

  submitTx: function () {
    var d = this.data;
    var amount = Number(d.amount);
    if (!(amount > 0)) { wx.showToast({ title: '请输入正数', icon: 'none' }); return; }
    var r = store.inventoryTx(this._id, d.txType, amount, d.txNote);
    if (!r.ok) {
      wx.showToast({ title: r.error === 'BELOW_ZERO' ? ('库存不足，当前 ' + r.balance) : '操作失败：' + r.error, icon: 'none' });
      return;
    }
    this.setData({ amount: '', txNote: '' });
    wx.showToast({ title: '已记录', icon: 'success' });
    this.onShow();
  },
  saveSettings: function () {
    var r = store.updateInventory(this._id, {
      threshold: Number(this.data.threshold) || 0,
      unit: this.data.units[this.data.unitIndex]
    });
    if (r.ok) { wx.showToast({ title: '已保存', icon: 'success' }); this.onShow(); }
    else wx.showToast({ title: '保存失败', icon: 'none' });
  }
});
