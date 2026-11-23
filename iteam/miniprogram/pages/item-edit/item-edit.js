// pages/item-edit/item-edit.js —— 物品添加/编辑 UI-011
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    editing: false, id: '', continuous: false, formError: '', nameError: false,
    saving: false, dirty: false,
    formName: '', categories: ['未分类'].concat(C.ITEM_CATEGORIES), catIndex: 0,
    modes: C.TRACK_MODES, modeIndex: 0, needInventory: false,
    balance: '', units: C.UNITS, unitIndex: 0, threshold: '',
    nodeOptions: [{ id: '', label: '位置未知 / 暂不指定' }], nodeIndex: 0, hasNode: false,
    locStatus: C.LOCATION_STATUS, locIndex: 1, note: '', photoPath: '',
    // P1-5 标签：候选来自全库在用标签 + 预置分类，.selected 标记是否已选中
    tagChoices: [], selectedTags: [], customTag: ''
  },

  onLoad: function (q) {
    q = q || {};
    // 位置选项：房间 → 节点路径
    var opts = [{ id: '', label: '位置未知 / 暂不指定' }];
    // 跨空间列出所有节点完整路径（与演示一致）
    store.listSpaces().forEach(function (sp) {
      store.listRooms(sp.id).forEach(function (rm) {
        store.listNodes(rm.id).forEach(function (n) {
          opts.push({ id: n.id, label: store.nodePath(n.id).join(' / ') });
        });
      });
    });
    // P1-5 标签候选：全库在用标签并入当前档案已选标签（编辑态在下方补齐）
    var choices = store.allTags().slice();
    this.setData({ nodeOptions: opts, tagChoices: choices });

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
      var categories = ['未分类'].concat(C.withCurrent(C.ITEM_CATEGORIES, it.category));
      var units = C.withCurrent(C.UNITS, iv.unit);
      var catI = Math.max(0, categories.indexOf(it.category || '未分类'));
      var modeI = Math.max(0, C.TRACK_MODES.map(function (m) { return m.key; }).indexOf(it.trackingMode));
      var unitI = Math.max(0, units.indexOf(iv.unit || units[0]));
      var locI = Math.max(0, C.LOCATION_STATUS.map(function (s) { return s.key; }).indexOf(it.locationStatus));
      var nI = 0, hasN = !!it.currentNodeId;
      if (hasN) for (var j = 0; j < opts.length; j++) if (opts[j].id === it.currentNodeId) { nI = j; break; }
      var need = it.trackingMode === 'inventory' || it.trackingMode === 'hybrid';
      // P1-5 已选标签并入候选
      var selected = (it.tags || []).slice();
      selected.forEach(function (t) { if (choices.indexOf(t) < 0) choices.push(t); });
      this.setData({
        editing: true, id: q.id, formName: it.name, categories: categories, catIndex: catI,
        modeIndex: modeI, needInventory: need,
        balance: iv.balance !== undefined ? String(iv.balance) : '',
        units: units, unitIndex: unitI, threshold: iv.threshold ? String(iv.threshold) : '',
        nodeIndex: nI, hasNode: hasN, locIndex: locI, note: it.note || '',
        photoPath: it.photoPath || '',
        tagChoices: choices, selectedTags: selected
      });
    }
    // 记录进入时的表单快照，用于返回时判断是否存在未保存修改
    this._initial = this._snap();
  },

  // 表单关键字段快照（用于 dirty 判定）
  _snap: function () {
    var d = this.data;
    return [d.formName, d.catIndex, d.modeIndex, d.balance, d.unitIndex, d.threshold,
      d.nodeIndex, d.locIndex, d.note, d.photoPath, (d.selectedTags || []).join(',')].join('\u0001');
  },
  _markDirty: function () {
    if (!this.data.dirty && this._initial !== undefined && this._snap() !== this._initial) {
      this.setData({ dirty: true });
    }
  },

  onName: function (e) { this.setData({ formName: e.detail.value, formError: '', nameError: false }, this._markDirty); },
  onCat: function (e) { this.setData({ catIndex: Number(e.detail.value) }, this._markDirty); },
  onMode: function (e) {
    var i = Number(e.detail.value);
    var key = C.TRACK_MODES[i].key;
    this.setData({ modeIndex: i, needInventory: key === 'inventory' || key === 'hybrid' }, this._markDirty);
  },
  onBalance: function (e) { this.setData({ balance: e.detail.value }, this._markDirty); },
  onUnit: function (e) { this.setData({ unitIndex: Number(e.detail.value) }, this._markDirty); },
  onThreshold: function (e) { this.setData({ threshold: e.detail.value }, this._markDirty); },
  onNode: function (e) {
    var i = Number(e.detail.value);
    this.setData({ nodeIndex: i, hasNode: !!this.data.nodeOptions[i].id }, this._markDirty);
  },
  onLoc: function (e) { this.setData({ locIndex: Number(e.detail.value) }, this._markDirty); },
  onNote: function (e) { this.setData({ note: e.detail.value }, this._markDirty); },
  // P1-5 标签交互
  toggleTag: function (e) {
    var t = e.currentTarget.dataset.tag, sel = this.data.selectedTags.slice(), i = sel.indexOf(t);
    if (i >= 0) sel.splice(i, 1);
    else { if (sel.length >= 8) { wx.showToast({ title: '最多 8 个标签', icon: 'none' }); return; } sel.push(t); }
    this.setData({ selectedTags: sel }, this._markDirty);
  },
  onCustomTag: function (e) { this.setData({ customTag: e.detail.value }); },
  addCustomTag: function () {
    var t = (this.data.customTag || '').trim().slice(0, 12), sel = this.data.selectedTags.slice(), choices = this.data.tagChoices.slice();
    if (!t) return;
    if (choices.indexOf(t) < 0) choices.push(t);
    if (sel.indexOf(t) < 0) { if (sel.length >= 8) { wx.showToast({ title: '最多 8 个标签', icon: 'none' }); return; } sel.push(t); }
    this.setData({ tagChoices: choices, selectedTags: sel, customTag: '' }, this._markDirty);
  },
  choosePhoto: function () {
    var self = this;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: function (res) {
        var f = res && res.tempFiles && res.tempFiles[0];
        if (f && f.tempFilePath) self.setData({ photoPath: f.tempFilePath }, self._markDirty);
      }
    });
  },
  clearPhoto: function () { this.setData({ photoPath: '' }, this._markDirty); },

  buildOpts: function () {
    var d = this.data;
    var nodeId = d.nodeOptions[d.nodeIndex].id;
    var opts = {
      name: (d.formName || '').trim(),
      category: d.categories[d.catIndex] === '未分类' ? '' : d.categories[d.catIndex],
      tags: d.selectedTags.slice(),
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
    if (!(d.formName || '').trim()) { this.setData({ formError: '名称为必填项', nameError: true }); return false; }
    if (this.data.needInventory && Number(this.data.balance) < 0) {
      this.setData({ formError: '数量不能为负' }); return false;
    }
    return true;
  },

  save: function () { if (this.validate()) this.doSave(false); },
  saveContinue: function () { if (this.validate()) this.doSave(true); },

  // 返回：存在未保存修改时二次确认（交互说明书 V1.2 §3）
  onBack: function () {
    var self = this;
    if (this.data.dirty) {
      wx.showModal({
        title: '放弃修改', content: '当前修改尚未保存，确定放弃并返回吗？',
        confirmText: '放弃修改', cancelText: '继续编辑', confirmColor: '#D65A50',
        success: function (res) { if (res.confirm) wx.navigateBack(); }
      });
    } else {
      wx.navigateBack();
    }
  },

  doSave: function (cont) {
    if (this.data.saving) return; // 防重复提交
    this.setData({ saving: true });
    var opts = this.buildOpts(), self = this;
    var r;
    if (this.data.editing) {
      // 编辑：只更新基础字段；跟踪模式/库存单独处理
      r = store.updateItem(this.data.id, {
        name: opts.name, category: opts.category, tags: opts.tags, note: opts.note,
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
    if (!r.ok) { this.setData({ formError: '保存失败：' + r.error, saving: false }); return; }
    if (cont) {
      // 连续添加：重置表单与 dirty，恢复可提交
      this.setData({ continuous: true, formName: '', note: '', formError: '', selectedTags: [], customTag: '', saving: false, dirty: false });
      this._initial = this._snap();
      wx.showToast({ title: '已保存，继续添加', icon: 'success' });
    } else {
      // 建档后进入详情页，并给出「档案已建立」引导；保留 saving 直到跳走，避免重复提交
      this.setData({ dirty: false });
      var targetId = this.data.editing ? this.data.id : (r.data && r.data.id);
      var url = targetId
        ? ('/pages/item-detail/item-detail?id=' + targetId + (this.data.editing ? '' : '&justCreated=1'))
        : '/pages/item-list/item-list';
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(function () { wx.navigateTo({ url: url }); }, 500);
    }
  }
});
