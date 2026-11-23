// pages/move/move.js —— 移动物品 UI-013（事务一致 BR-005 / 首次确认 TBD-001）
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    itemName: '', currentLocText: '', currentLocClass: '', currentPath: '', targetPath: '未选择',
    statusList: C.LOCATION_STATUS, statusKey: 'at_home',
    nodeOptions: [{ id: '', label: '请选择具体位置' }], nodeIndex: 0, note: '', borrowTo: '', dueDate: ''
  },
  onLoad: function (q) {
    this._id = q.id || '';
    var opts = [{ id: '', label: '请选择具体位置' }];
    // 跨空间列出节点（空间 → 房间 → 收纳节点），与演示目标位置树一致
    store.listSpaces().forEach(function (sp) {
      store.listRooms(sp.id).forEach(function (rm) {
        store.listNodes(rm.id).forEach(function (n) {
          opts.push({ id: n.id, label: sp.name + ' / ' + rm.name + ' / ' + store.nodePath(n.id).join(' / ') });
        });
      });
    });
    this.setData({ nodeOptions: opts });
  },
  onShow: function () {
    var it = store.getItem(this._id);
    if (!it) { wx.showToast({ title: '物品不存在', icon: 'none' }); return; }
    var stMap = { at_home: '在家', unknown: '位置未知', out: '外出携带', borrowed: '借出' };
    this.setData({
      itemName: it.name,
      currentLocText: stMap[it.locationStatus] || it.locationStatus,
      currentLocClass: it.locationStatus === 'at_home' ? 'green' : 'orange',
      currentPath: it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (stMap[it.locationStatus] || '未设置'),
      targetPath: it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : '未选择',
      statusKey: it.locationStatus,
      borrowTo: it.borrowTo || '', dueDate: it.dueDate || ''
    });
  },
  chooseStatus: function (e) {
    var key = e.currentTarget.dataset.key;
    // 非在家状态清空已选节点，避免把节点位置带进外出/借出记录
    this.setData({ statusKey: key, nodeIndex: key === 'at_home' ? this.data.nodeIndex : 0,
      targetPath: key === 'at_home' ? this.data.targetPath : '未选择' });
  },
  onNode: function (e) {
    var i = Number(e.detail.value);
    var opt = this.data.nodeOptions[i] || {};
    // 选择具体节点即视为「在家」，并回显完整路径
    this.setData({ nodeIndex: i, statusKey: 'at_home', targetPath: opt.id ? opt.label : '未选择' });
  },
  onNote: function (e) { this.setData({ note: e.detail.value }); },
  onBorrowTo: function (e) { this.setData({ borrowTo: e.detail.value }); },
  onDueDate: function (e) { this.setData({ dueDate: e.detail.value }); },
  confirm: function () {
    var d = this.data, self = this;
    if (this._submitting) return;
    var nodeId = d.statusKey === 'at_home' ? d.nodeOptions[d.nodeIndex].id : '';
    // demo 对齐：选择「在家」必须同时选定具体收纳节点；位置未知走独立状态入口
    if (d.statusKey === 'at_home' && !nodeId) {
      wx.showToast({ title: '选择「在家」需同时选定具体位置', icon: 'none' }); return;
    }
    var status = d.statusKey;
    var requestId = store.uid('req');
    wx.showModal({
      title: '确认移动',
      content: '确认后当前位置与历史记录会同步更新（同一事务，不会出现半成功状态）。',
      success: function (res) {
        if (!res.confirm) return;
        self._submitting = true;
        var r = store.moveItem(self._id, {
          locationStatus: status, currentNodeId: nodeId, note: d.note,
          borrowTo: d.borrowTo, dueDate: d.dueDate, requestId: requestId
        });
        self._submitting = false;
        if (!r.ok) { wx.showToast({ title: '失败：' + r.error, icon: 'none' }); return; }
        var typeName = {
          first_confirm: '首次位置确认', move: '移动', out: '外出/借出', return: '带回/归还', end: '结束管理'
        }[r.eventType] || '已更新';
        wx.showToast({ title: '已确认：' + typeName + '，历史 +1', icon: 'success' });
        setTimeout(function () { wx.navigateBack(); }, 600);
      }
    });
  }
});
