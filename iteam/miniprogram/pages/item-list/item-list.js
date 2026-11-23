// pages/item-list/item-list.js —— 物品列表 UI-010（搜索与组合筛选 TBD-008）
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    items: [], count: 0, keyword: '', quickFilter: 'all', loading: false, hasFilter: false, includeEnded: false,
    statusOptions: [{ key: '', name: '全部状态' }, { key: 'active', name: '日常管理' }, { key: 'ended', name: '已结束管理' }],
    stIndex: 0,
    catOptions: ['全部分类'].concat(C.ITEM_CATEGORIES), catIndex: 0,
    tagOptions: ['全部标签'], tagIndex: 0,
    quickOptions: [{ key: 'all', name: '全部' }, { key: 'unknown', name: '位置未知' }, { key: 'low', name: '低库存' }],
    locOptions: [{ key: '', name: '全部位置' }].concat(C.LOCATION_STATUS), locIndex: 0,
    spaceOptions: [], spaceIndex: 0,
    roomOptions: [], roomIndex: 0,
    nodeOptions: [], nodeIndex: 0
  },
  onLoad: function (q) { if (q && q.ended) this.setData({ includeEnded: true, stIndex: 2 }); },
  onShow: function () { this.loadFilterOptions(); this.load(); },

  loadFilterOptions: function () {
    var spaces = [{ id: '', name: '全部空间' }].concat(store.listAllSpaces());
    var rooms = [{ id: '', name: '全部房间' }];
    store.listAllSpaces().forEach(function (sp) {
      store.listRooms(sp.id).forEach(function (rm) { rooms.push({ id: rm.id, name: sp.name + ' / ' + rm.name }); });
    });
    var nodes = [{ id: '', label: '全部当前位置' }];
    store.listAllSpaces().forEach(function (sp) {
      store.listRooms(sp.id).forEach(function (rm) {
        store.listNodes(rm.id).forEach(function (n) { nodes.push({ id: n.id, label: store.nodePath(n.id).join(' / ') }); });
      });
    });
    // 兼容旧档案：历史分类追加到筛选项，避免筛选不到旧数据
    var cats = ['全部分类'].concat(C.ITEM_CATEGORIES);
    store.listItems({ includeEnded: true }).forEach(function (it) {
      if (it.category && cats.indexOf(it.category) < 0) cats.push(it.category);
    });
    // P1-5 标签筛选项：全库在用标签
    var tags = ['全部标签'].concat(store.allTags());
    this.setData({ spaceOptions: spaces, roomOptions: rooms, nodeOptions: nodes, catOptions: cats, tagOptions: tags });
  },

  load: function () {
    var d = this.data;
    var filters = { keyword: d.keyword, includeEnded: d.includeEnded };
    if (d.quickFilter === 'unknown') filters.locationStatus = 'unknown';
    var st = d.statusOptions[d.stIndex].key;
    if (st) filters.managementStatus = st;
    if (d.catIndex > 0) filters.category = d.catOptions[d.catIndex];
    if (d.tagIndex > 0) filters.tag = d.tagOptions[d.tagIndex];
    var loc = d.locOptions[d.locIndex].key;
    if (loc) filters.locationStatus = loc;
    var sp = d.spaceOptions[d.spaceIndex];
    if (sp && sp.id) filters.spaceId = sp.id;
    var rm = d.roomOptions[d.roomIndex];
    if (rm && rm.id) filters.roomId = rm.id;
    var nd = d.nodeOptions[d.nodeIndex];
    if (nd && nd.id) filters.currentNodeId = nd.id;
    var hasFilter = !!(d.keyword || d.quickFilter !== 'all' || st || d.catIndex > 0 || d.tagIndex > 0 || loc || d.includeEnded ||
      (sp && sp.id) || (rm && rm.id) || (nd && nd.id));

    var list = store.listItems(filters);
    if (d.quickFilter === 'low') {
      list = list.filter(function (it) {
        var iv = store.findInventoryByItem(it.id);
        return !!iv && iv.threshold > 0 && iv.balance <= iv.threshold;
      });
    }
    list = list.map(function (it) {
      var stMap = { at_home: '在家', unknown: '位置未知', out: '外出', borrowed: '借出' };
      var modeMap = { location: '只记位置', inventory: '只记库存', hybrid: '位置+库存' };
      var path = it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (stMap[it.locationStatus] || '未设置');
      return {
        id: it.id, name: it.name, completed: it.completed,
        catText: it.category || '未分类', tags: it.tags || [], modeText: modeMap[it.trackingMode] || '',
        locText: stMap[it.locationStatus] || it.locationStatus,
        locClass: it.locationStatus === 'at_home' ? 'green' : 'orange',
        mgmtText: it.managementStatus === 'ended' ? '已结束' : '',
        mgmtClass: it.managementStatus === 'ended' ? 'gray' : 'green',
        disposalText: it.disposalType ? (C.DISPOSAL_TYPES.filter(function (x) { return x.key === it.disposalType; })[0] || {}).name || it.disposalType : '',
        locPath: path
      };
    });
    this.setData({ items: list, count: list.length, hasFilter: hasFilter, loading: false });
  },

  // 清空全部筛选条件并重载（交互说明书 V1.2 §4：搜索无结果可清空重搜）
  clearFilters: function () {
    this.setData({
      keyword: '', quickFilter: 'all', stIndex: 0, catIndex: 0, tagIndex: 0, locIndex: 0,
      spaceIndex: 0, roomIndex: 0, nodeIndex: 0, includeEnded: false
    }, this.load);
  },
  onQuickFilter: function (e) { this.setData({ quickFilter: e.currentTarget.dataset.key || 'all' }, this.load); },
  onKeyword: function (e) { this.setData({ keyword: e.detail.value }, this.load); },
  onStatus: function (e) { this.setData({ stIndex: Number(e.detail.value) }, this.load); },
  onCat: function (e) { this.setData({ catIndex: Number(e.detail.value) }, this.load); },
  onTag: function (e) { this.setData({ tagIndex: Number(e.detail.value) }, this.load); },
  onLoc: function (e) { this.setData({ locIndex: Number(e.detail.value) }, this.load); },
  onSpace: function (e) { this.setData({ spaceIndex: Number(e.detail.value), roomIndex: 0, roomOptions: this._roomsFor(this.data.spaceOptions[Number(e.detail.value)].id) }, this.load); },
  _roomsFor: function (spaceId) {
    var rooms = [{ id: '', name: '全部房间' }];
    (spaceId ? [spaceId] : store.listAllSpaces().map(function (s) { return s.id; })).forEach(function (sid) {
      store.listRooms(sid).forEach(function (rm) {
        var sp = store.listAllSpaces().filter(function (x) { return x.id === sid; })[0];
        rooms.push({ id: rm.id, name: (sp ? sp.name + ' / ' : '') + rm.name });
      });
    });
    return rooms;
  },
  onRoom: function (e) { this.setData({ roomIndex: Number(e.detail.value) }, this.load); },
  onNode: function (e) { this.setData({ nodeIndex: Number(e.detail.value) }, this.load); },
  toggleEnded: function () { this.setData({ includeEnded: !this.data.includeEnded }, this.load); },
  openItem: function (e) { wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + e.currentTarget.dataset.id }); },
  addItem: function () { wx.navigateTo({ url: '/pages/item-edit/item-edit' }); }
});
