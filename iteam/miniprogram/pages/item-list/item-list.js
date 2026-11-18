// pages/item-list/item-list.js —— 物品列表 UI-010（搜索与组合筛选 TBD-008）
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    items: [], keyword: '', loading: false, hasFilter: false, includeEnded: false,
    statusOptions: [{ key: '', name: '全部状态' }, { key: 'active', name: '日常管理' }, { key: 'ended', name: '已结束管理' }],
    stIndex: 0,
    catOptions: ['全部分类'].concat(C.ITEM_CATEGORIES), catIndex: 0,
    locOptions: [{ key: '', name: '全部位置' }].concat(C.LOCATION_STATUS), locIndex: 0
  },
  onLoad: function (q) { if (q && q.ended) this.setData({ includeEnded: true, stIndex: 2 }); },
  onShow: function () { this.load(); },

  load: function () {
    var d = this.data;
    var filters = { keyword: d.keyword, includeEnded: d.includeEnded };
    var st = d.statusOptions[d.stIndex].key;
    if (st) filters.managementStatus = st;
    if (d.catIndex > 0) filters.category = d.catOptions[d.catIndex];
    var loc = d.locOptions[d.locIndex].key;
    if (loc) filters.locationStatus = loc;
    var hasFilter = !!(d.keyword || st || d.catIndex > 0 || loc || d.includeEnded);

    var list = store.listItems(filters).map(function (it) {
      var stMap = { at_home: '在家', unknown: '位置未知', out: '外出', borrowed: '借出' };
      var modeMap = { location: '只记位置', inventory: '只记库存', hybrid: '位置+库存' };
      var path = it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (stMap[it.locationStatus] || '未设置');
      return {
        id: it.id, name: it.name, completed: it.completed,
        catText: it.category || '未分类', modeText: modeMap[it.trackingMode] || '',
        locText: stMap[it.locationStatus] || it.locationStatus,
        locClass: it.locationStatus === 'at_home' ? 'green' : 'orange',
        mgmtText: it.managementStatus === 'ended' ? '已结束' : '',
        mgmtClass: it.managementStatus === 'ended' ? 'gray' : 'green',
        locPath: path
      };
    });
    this.setData({ items: list, hasFilter: hasFilter, loading: false });
  },

  onKeyword: function (e) { this.setData({ keyword: e.detail.value }, this.load); },
  onStatus: function (e) { this.setData({ stIndex: Number(e.detail.value) }, this.load); },
  onCat: function (e) { this.setData({ catIndex: Number(e.detail.value) }, this.load); },
  onLoc: function (e) { this.setData({ locIndex: Number(e.detail.value) }, this.load); },
  toggleEnded: function () { this.setData({ includeEnded: !this.data.includeEnded }, this.load); },
  openItem: function (e) { wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.currentTarget.dataset.id }); },
  addItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit' }); }
});
