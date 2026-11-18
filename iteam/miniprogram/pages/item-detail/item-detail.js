// pages/item-detail/item-detail.js —— 物品详情 UI-012
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: { item: null, inv: null },
  onLoad: function (q) { this._id = q.id || ''; },
  onShow: function () { this.load(); },

  load: function () {
    var it = store.getItem(this._id);
    if (!it) { wx.showToast({ title: '物品不存在', icon: 'none' }); return; }
    var stMap = { at_home: '在家', unknown: '位置未知', out: '外出', borrowed: '借出' };
    var modeMap = { location: '只记位置', inventory: '只记库存', hybrid: '位置+库存' };
    var iv = store.findInventoryByItem(it.id);
    var inv = null;
    if (iv && it.trackingMode !== 'location') {
      inv = { balance: iv.balance, unit: iv.unit, threshold: iv.threshold, low: iv.threshold > 0 && iv.balance <= iv.threshold };
    }
    this.setData({
      item: {
        id: it.id, name: it.name, completed: it.completed,
        catText: it.category || '未分类', modeText: modeMap[it.trackingMode] || '',
        locText: stMap[it.locationStatus] || it.locationStatus,
        locClass: it.locationStatus === 'at_home' ? 'green' : 'orange',
        locPath: it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (stMap[it.locationStatus] || '未设置'),
        note: it.note, photo: it.photoPath,
        trackingMode: it.trackingMode,
        mgmt: it.managementStatus,
        mgmtText: it.managementStatus === 'ended' ? '已结束管理' : '日常管理',
        mgmtClass: it.managementStatus === 'ended' ? 'gray' : 'green'
      },
      inv: inv
    });
  },

  editItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit?id=' + this._id }); },
  moveItem: function () { wx.navigateTo({ url: '/pages/move/move?id=' + this._id }); },
  goHistory: function () { wx.navigateTo({ url: '/pages/history/history?id=' + this._id }); },
  goInventory: function () { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + this._id }); },
  goTx: function () { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + this._id + '&tab=tx' }); },
  previewPhoto: function () {
    var p = this.data.item && this.data.item.photo;
    if (!p) return;
    wx.previewImage({ current: p, urls: [p] });
  },

  endManage: function () {
    var self = this;
    wx.showModal({
      title: '结束管理',
      content: '档案与历史会长期保留，但退出日常列表（可搜索、可恢复）。若有剩余库存需先明确去向。',
      success: function (res) {
        if (!res.confirm) return;
        var r = store.endManagement(self._id, '手动结束管理');
        if (!r.ok) {
          if (r.error === 'NEED_DISPOSAL') {
            wx.showModal({
              title: '尚有剩余库存',
              content: '该物品库存为 ' + r.balance + '，请先通过「入库/消耗/调整」处理剩余库存，或在下方填写处置说明。',
              editable: true, placeholderText: '如：已赠送 / 已丢弃',
              success: function (r2) {
                if (!r2.confirm || !(r2.content || '').trim()) return;
                var r3 = store.endManagement(self._id, r2.content.trim());
                if (r3.ok) { wx.showToast({ title: '已结束管理', icon: 'success' }); self.load(); }
              }
            });
          } else wx.showToast({ title: '操作失败：' + r.error, icon: 'none' });
          return;
        }
        wx.showToast({ title: '已结束管理', icon: 'success' }); self.load();
      }
    });
  },
  restore: function () {
    var self = this;
    wx.showModal({
      title: '恢复日常管理', content: '将该物品重新纳入日常列表？',
      success: function (res) {
        if (res.confirm && store.restoreItem(self._id).ok) { wx.showToast({ title: '已恢复', icon: 'success' }); self.load(); }
      }
    });
  }
});
