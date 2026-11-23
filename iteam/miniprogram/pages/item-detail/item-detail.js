// pages/item-detail/item-detail.js —— 物品详情 UI-012
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: { item: null, inv: null, justCreated: false, nextHint: '', nextBtn: '', nextPage: '' },
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
    // 建档后的下一步引导：无位置/位置未知 → 去定位；余额为 0 → 去入库；其余 → 去完善
    var needPos = !it.currentNodeId || it.locationStatus === 'unknown';
    var needStock = !!inv && inv.balance === 0;
    var next = needPos
      ? { hint: '补充位置，初始存放信息不记为一次移动', page: 'move', btn: '去定位' }
      : needStock
        ? { hint: '记录初始库存，后续变更走库存交易', page: 'inventoryDetail', btn: '去入库' }
        : { hint: '继续完善分类、备注等信息', page: 'itemEdit', btn: '去完善' };
    this.setData({
      nextHint: next.hint, nextBtn: next.btn, nextPage: next.page,
      item: {
        id: it.id, name: it.name, completed: it.completed,
        catText: it.category || '未分类', tags: it.tags || [], modeText: modeMap[it.trackingMode] || '',
        locationKey: it.locationStatus, updatedText: updated,
        locText: it.locationStatus === 'at_home' && it.currentNodeId ? '已定位' : (stMap[it.locationStatus] || it.locationStatus),
        locClass: it.locationStatus === 'at_home' ? 'green' : 'orange',
        locPath: it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (stMap[it.locationStatus] || '未设置'),
        // P1-4 常驻位置：外出/借出时 currentNodeId 为空，但仍在家里有固定位置
        homePath: it.homeNodeId ? store.nodePath(it.homeNodeId).join(' / ') : '',
        note: it.note, photo: it.photoPath,
        trackingMode: it.trackingMode,
        mgmt: it.managementStatus,
        mgmtText: it.managementStatus === 'ended' ? '已结束管理' : '日常管理',
        mgmtClass: it.managementStatus === 'ended' ? 'gray' : 'green',
        disposalText: it.disposalType ? (dMap[it.disposalType] || it.disposalType) : '',
        favorite: !!it.favorite,
        borrowTo: it.borrowTo || '', dueDate: it.dueDate || ''
      },
      inv: inv
    });
  },

  // 收藏星标切换（交互说明书 V1.2 §5）
  toggleFavorite: function () {
    var r = store.toggleFavorite(this._id);
    if (!r.ok) { wx.showToast({ title: '操作失败', icon: 'none' }); return; }
    this.setData({ 'item.favorite': r.data.favorite });
    wx.showToast({ title: r.data.favorite ? '已收藏' : '已取消收藏', icon: 'none' });
  },
  editItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit?id=' + this._id }); },
  moveItem: function () { wx.navigateTo({ url: '/pages/move/move?id=' + this._id }); },
  goHistory: function () { wx.navigateTo({ url: '/pages/history/history?id=' + this._id }); },
  goInventory: function () { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + this._id }); },
  goNext: function () {
    var page = this.data.nextPage;
    if (!page) return;
    var routes = { move: '/pages/move/move?id=', inventoryDetail: '/pages/inventory-detail/inventory-detail?id=', itemEdit: '/pages/item-edit/item-edit?id=' };
    if (routes[page]) wx.navigateTo({ url: routes[page] + this._id });
  },
  goBackList: function () { wx.redirectTo({ url: '/pages/item-list/item-list' }); },
  goTx: function () { wx.navigateTo({ url: '/pages/inventory-detail/inventory-detail?id=' + this._id + '&tab=tx' }); },
  previewPhoto: function () {
    var p = this.data.item && this.data.item.photo;
    if (!p) return;
    wx.previewImage({ current: p, urls: [p] });
  },

  endManage: function () {
    var self = this;
    // 演示口径：有余额时先阻断，必须先明确处置方式（以处置结存留痕，不伪装成消耗）
    var iv = store.findInventoryByItem(this._id);
    if (iv && iv.balance > 0) {
      wx.showModal({
        title: '无法结束管理',
        content: '剩余 ' + iv.balance + ' ' + iv.unit + ' 库存，须先明确处置方式。',
        cancelText: '稍后处理', confirmText: '选择处置方式',
        success: function (res) { if (res.confirm) self._chooseDisposal(); }
      });
      return;
    }
    this._chooseDisposal();
  },
  _chooseDisposal: function () {
    var self = this;
    var types = (C.DISPOSAL_TYPES || []).map(function (d) { return d.name; });
    wx.showActionSheet({
      itemList: types,
      success: function (res) {
        var idx = res.tapIndex;
        if (idx === undefined || idx < 0 || idx >= types.length) return;
        var dtype = C.DISPOSAL_TYPES[idx].key;
        wx.showModal({
          title: '结束管理',
          content: '档案与历史会长期保留；若有剩余库存，将按「处置结存」记一笔交易并清零（不伪装成消耗）。',
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
