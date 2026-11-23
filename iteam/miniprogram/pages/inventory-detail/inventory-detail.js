// pages/inventory-detail/inventory-detail.js —— 库存详情 UI-016
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    name: '', balance: 0, unit: '个', threshold: 0, low: false, progress: 0,
    units: C.UNITS.slice(), unitIndex: 0,
    txTypes: C.INVENTORY_TX_TYPES, txType: 'in',
    amount: '', txNote: '', txs: []
  },
  onLoad: function (q) { this._id = q.id || ''; },
  onShow: function () {
    var it = store.getItem(this._id);
    var iv = store.findInventoryByItem(this._id);
    if (!iv) { wx.showToast({ title: '该物品未启用库存跟踪', icon: 'none' }); return; }
    this.setData({
      name: it ? it.name : '', balance: iv.balance, unit: iv.unit,
      threshold: iv.threshold, low: iv.threshold > 0 && iv.balance <= iv.threshold,
      progress: Math.min(100, Math.max(0, Math.round(iv.balance / Math.max(1, (iv.threshold || 0) * 2) * 100))),
      units: C.withCurrent(C.UNITS, iv.unit), unitIndex: Math.max(0, C.withCurrent(C.UNITS, iv.unit).indexOf(iv.unit)),
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
  // demo 对齐：入库 / 消耗 / 调整 三个直接动作
  quickTx: function (e) {
    var self = this;
    this.setData({ txType: e.currentTarget.dataset.key }, function () { self.submitTx(); });
  },
  onAmount: function (e) { this.setData({ amount: e.detail.value }); },
  onTxNote: function (e) { this.setData({ txNote: e.detail.value }); },
  onThreshold: function (e) { this.setData({ threshold: e.detail.value }); },
  onUnit: function (e) { this.setData({ unitIndex: Number(e.detail.value) }); },

  submitTx: function () {
    var d = this.data;
    var amount = Number(d.amount);
    if (!(amount > 0)) { wx.showToast({ title: '数量必须为正数', icon: 'none' }); return; }
    if (d.txType === 'adjust' && !(d.txNote || '').trim()) {
      wx.showToast({ title: '请填写调整原因', icon: 'none' }); return;
    }
    if (this._submitting) return;
    this._submitting = true;
    var r = store.inventoryTx(this._id, d.txType, amount, d.txNote, {
      reason: d.txType === 'adjust' ? (d.txNote || '').trim() : '',
      requestId: store.uid('req')
    });
    this._submitting = false;
    if (!r.ok) {
      wx.showToast({ title: r.error === 'BELOW_ZERO'
        ? ('库存不足：当前仅 ' + r.balance + ' ' + d.unit + '；纠错请走「调整」')
        : (r.error === 'REASON_REQUIRED' ? '请填写调整原因' : '操作失败：' + r.error), icon: 'none' });
      return;
    }
    this.setData({ amount: '', txNote: '' });
    var typeName = (C.INVENTORY_TX_TYPES.filter(function (t) { return t.key === d.txType; })[0] || {}).name || '库存';
    wx.showToast({ title: typeName + '成功，余额 ' + r.balance, icon: 'success' });
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
