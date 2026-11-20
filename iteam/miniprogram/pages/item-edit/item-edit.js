// pages/item-edit/item-edit.js —— 物品添加/编辑 UI-011
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    editing: false, id: '', continuous: false, formError: '',
    formName: '', categories: C.ITEM_CATEGORIES, catIndex: 0,
    modes: C.TRACK_MODES, modeIndex: 0, needInventory: false,
    balance: '', units: C.UNITS, unitIndex: 0, threshold: '',
    nodeOptions: [{ id: '', label: '位置未知 / 暂不指定' }], nodeIndex: 0, hasNode: false,
    locStatus: C.LOCATION_STATUS, locIndex: 1, note: '', photoPath: ''
  },

  onLoad: function (q) {
    q = q || {};
    // 位置选项：房间 → 节点路径
    var opts = [{ id: '', label: '位置未知 / 暂不指定' }];
    var active = store.getActiveSpace();
    store.listRooms(active ? active.id : '').forEach(function (rm) {
      store.listNodes(rm.id).forEach(function (n) {
        opts.push({ id: n.id, label: store.nodePath(n.id).join(' / ') });
      });
    });
    this.setData({ nodeOptions: opts });

    var nodeId = q.nodeId || '';
    if (nodeId) {
      for (var i = 0; i < opts.length; i++) if (opts[i].id === nodeId) {
        this.setData({ nodeIndex: i, hasNode: true });
        break;
      }
    }
    if (q.id) {
      var it = store.getItem(q.id);
      if (!it) { wx.showToast({ title: '物品不存在', icon: 'none' }); return; }
      var iv = store.findInventoryByItem(it.id) || {};
      var catI = Math.max(0, C.ITEM_CATEGORIES.indexOf(it.category));
      var modeI = Math.max(0, C.TRACK_MODES.map(function (m) { return m.key; }).indexOf(it.trackingMode));
      var unitI = Math.max(0, C.UNITS.indexOf(iv.unit || C.UNITS[0]));
      var locI = Math.max(0, C.LOCATION_STATUS.map(function (s) { return s.key; }).indexOf(it.locationStatus));
      var nI = 0, hasN = !!it.currentNodeId;
      if (hasN) for (var j = 0; j < opts.length; j++) if (opts[j].id === it.currentNodeId) { nI = j; break; }
      var need = it.trackingMode === 'inventory' || it.trackingMode === 'hybrid';
      this.setData({
        editing: true, id: q.id, formName: it.name, catIndex: catI,
        modeIndex: modeI, needInventory: need,
        balance: iv.balance !== undefined ? String(iv.balance) : '',
        unitIndex: unitI, threshold: iv.threshold ? String(iv.threshold) : '',
        nodeIndex: nI, hasNode: hasN, locIndex: locI, note: it.note || '',
        photoPath: it.photoPath || ''
      });
    }
  },

  onName: function (e) { this.setData({ formName: e.detail.value, formError: '' }); },
  onCat: function (e) { this.setData({ catIndex: Number(e.detail.value) }); },
  onMode: function (e) {
    var i = Number(e.detail.value);
    var key = C.TRACK_MODES[i].key;
    this.setData({ modeIndex: i, needInventory: key === 'inventory' || key === 'hybrid' });
  },
  onBalance: function (e) { this.setData({ balance: e.detail.value }); },
  onUnit: function (e) { this.setData({ unitIndex: Number(e.detail.value) }); },
  onThreshold: function (e) { this.setData({ threshold: e.detail.value }); },
  onNode: function (e) {
    var i = Number(e.detail.value);
    this.setData({ nodeIndex: i, hasNode: !!this.data.nodeOptions[i].id });
  },
  onLoc: function (e) { this.setData({ locIndex: Number(e.detail.value) }); },
  onNote: function (e) { this.setData({ note: e.detail.value }); },
  choosePhoto: function () {
    var self = this;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: function (res) {
        var f = res && res.tempFiles && res.tempFiles[0];
        if (f && f.tempFilePath) self.setData({ photoPath: f.tempFilePath });
      }
    });
  },
  clearPhoto: function () { this.setData({ photoPath: '' }); },

  buildOpts: function () {
    var d = this.data;
    var nodeId = d.nodeOptions[d.nodeIndex].id;
    var opts = {
      name: (d.formName || '').trim(),
      category: d.categories[d.catIndex],
      note: d.note, photoPath: d.photoPath,
      trackingMode: C.TRACK_MODES[d.modeIndex].key,
      currentNodeId: nodeId,
      locationStatus: nodeId ? 'at_home' : C.LOCATION_STATUS[d.locIndex].key
    };
    if (opts.trackingMode === 'inventory' || opts.trackingMode === 'hybrid') {
      opts.balance = Number(d.balance) || 0;
      opts.unit = d.units[d.unitIndex];
      opts.threshold = Number(d.threshold) || 0;
    }
    return opts;
  },

  validate: function () {
    var d = this.data;
    if (!(d.formName || '').trim()) { this.setData({ formError: '请输入物品名称' }); return false; }
    if (this.data.needInventory && Number(this.data.balance) < 0) {
      this.setData({ formError: '数量不能为负' }); return false;
    }
    return true;
  },

  save: function () { if (this.validate()) this.doSave(false); },
  saveContinue: function () { if (this.validate()) this.doSave(true); },

  doSave: function (cont) {
    var opts = this.buildOpts(), self = this;
    var r;
    if (this.data.editing) {
      // 编辑：只更新基础字段；跟踪模式/库存单独处理
      r = store.updateItem(this.data.id, {
        name: opts.name, category: opts.category, note: opts.note,
        photoPath: opts.photoPath, locationStatus: opts.locationStatus
      });
      if (r.ok && this.data.needInventory) {
        store.updateInventory(this.data.id, { unit: opts.unit, threshold: opts.threshold });
      }
    } else {
      r = store.addItem(opts);
      if (r.ok && opts.trackingMode !== 'location' && r.data) {
        store.setItemTrackingMode(r.data.id, opts.trackingMode);
      }
    }
    if (!r.ok) { this.setData({ formError: '保存失败：' + r.error }); return; }
    if (cont) this.setData({ continuous: true }); // UI-011 连续添加态标识
    wx.showToast({ title: cont ? '已保存，继续添加' : '已保存', icon: 'success' });
    if (cont) {
      this.setData({ formName: '', note: '', formError: '' });
    } else {
      setTimeout(function () { wx.navigateBack(); }, 500);
    }
  }
});
