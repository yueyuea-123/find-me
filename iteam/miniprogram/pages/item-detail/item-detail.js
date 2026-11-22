// pages/item-detail/item-detail.js —— 物品详情 UI-012
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: { item: null, inv: null, justCreated: false },
  onLoad: function (q) { this._id = q.id || ''; this.setData({ justCreated: !!(q && q.justCreated) }); },
  onShow: function () { this.load(); },

  load: function () {
    var it = store.getItem(this._id);
    if (!it) { wx.showToast({ title: '物品不存在', icon: 'none' }); return; }
    var stMap = { at_home: '在家', unknown: '位置未知', out: '外出', borrowed: '借出' };
    var modeMap = { location: '只记位置', inventory: '只记库存', hybrid: '位置+库存' };
    var dMap = {};
    (C.DISPOSAL_TYPES || []).forEach(function (d) { dMap[d.key] = d.name; });
    var iv = store.findInventoryByItem(it.id);
    var inv = null;
    if (iv && it.trackingMode !== 'location') {
      inv = { balance: iv.balance, unit: iv.unit, threshold: iv.threshold, low: iv.threshold > 0 && iv.balance <= iv.threshold };
    }
    // demo 对齐：最近确认时间；当天显示「今天 HH:MM」，跨天显示完整时间
    var updated = store.fmtTime(it.updatedAt || it.createdAt || Date.now());
    var today = store.fmtTime(Date.now()).slice(0, 10);
    if (updated.indexOf(today) === 0) updated = '今天 ' + updated.slice(11);
    this.setData({
      item: {
        id: it.id, name: it.name, completed: it.completed,
        catText: it.category || '未分类', modeText: modeMap[it.trackingMode] || '',
        locationKey: it.locationStatus, updatedText: updated,
        locText: stMap[it.locationStatus] || it.locationStatus,
        locClass: it.locationStatus === 'at_home' ? 'green' : 'orange',
        locPath: it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (stMap[it.locationStatus] || '未设置'),
        note: it.note, photo: it.photoPath,
        trackingMode: it.trackingMode,
        mgmt: it.managementStatus,
        mgmtText: it.managementStatus === 'ended' ? '已结束管理' : '日常管理',
        mgmtClass: it.managementStatus === 'ended' ? 'gray' : 'green',
        disposalText: it.disposalType ? (dMap[it.disposalType] || it.disposalType) : '',
        borrowTo: it.borrowTo || '', dueDate: it.dueDate || ''
      },
      inv: inv
    });
  },

  editItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit?id=' + this._id }); },
  moveItem: function () { wx.navigateTo({ url: '/pages/move/move?id=' + this._id }); },
  goHistory: function () { wx.navigateTo({ url: '/pages/history/history?id=' + this._id }); },
  goInventory: function () { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + this._id }); },
  goBackList: function () { wx.redirectTo({ url: '/pages/item-list/item-list' }); },
  goTx: function () { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + this._id + '&tab=tx' }); },
  previewPhoto: function () {
    var p = this.data.item && this.data.item.photo;
    if (!p) return;
    wx.previewImage({ current: p, urls: [p] });
  },

  endManage: function () {
    var self = this;
    // demo 对齐：仍有库存余额时先阻断，须在库存详情明确处置后再结束管理
    var iv = store.findInventoryByItem(this._id);
    if (iv && iv.balance > 0) {
      wx.showModal({
        title: '无法结束管理',
        content: '剩余 ' + iv.balance + ' ' + iv.unit + ' 库存，须先明确处置方式（可在库存详情记「处置结存」）。',
        showCancel: false
      });
      return;
    }
    var types = (C.DISPOSAL_TYPES || []).map(function (d) { return d.name; });
    wx.showActionSheet({
      itemList: types,
      success: function (res) {
        var idx = res.tapIndex;
        if (idx === undefined || idx < 0 || idx >= types.length) return;
        var dtype = C.DISPOSAL_TYPES[idx].key;
        wx.showModal({
          title: '结束管理',
          content: '档案与历史会长期保留，退出日常列表后仍可搜索与恢复。若有剩余库存，将按「处置结存」记一笔交易并清零（不伪装成消耗）。',
          editable: true, placeholderText: '处置说明（可选）',
          success: function (m) {
            if (!m.confirm) return;
            var r = store.endManagement(self._id, { type: dtype, note: (m.content || '').trim() });
            if (!r.ok) { wx.showToast({ title: '操作失败：' + r.error, icon: 'none' }); return; }
            wx.showToast({ title: '已结束管理', icon: 'success' }); self.load();
          }
        });
      }
    });
  },
  restore: function () {
    var self = this;
    wx.showModal({
      title: '恢复日常管理',
      content: '恢复后不会自动沿用旧位置，需重新确认现实状态与当前位置；确认后请到「移动 / 改状态」补充位置。',
      success: function (res) {
        if (!res.confirm) return;
        var r = store.restoreItem(self._id);
        if (!r.ok) { wx.showToast({ title: '恢复失败：' + r.error, icon: 'none' }); return; }
        wx.showToast({ title: '已恢复，请补充当前位置', icon: 'none' }); self.load();
      }
    });
  }
});
