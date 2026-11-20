// pages/move/move.js —— 移动物品 UI-013（事务一致 BR-005 / 首次确认 TBD-001）
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

Page({
  data: {
    itemName: '', currentLocText: '', currentLocClass: '', currentPath: '',
    statusList: C.LOCATION_STATUS, statusKey: 'at_home',
    nodeOptions: [], nodeIndex: 0, note: '', borrowTo: '', dueDate: ''
  },
  onLoad: function (q) {
    this._id = q.id || '';
    var opts = [{ id: '', label: '（在家，位置未知）' }];
    var active = store.getActiveSpace();
    store.listRooms(active ? active.id : '').forEach(function (rm) {
      store.listNodes(rm.id).forEach(function (n) {
        opts.push({ id: n.id, label: store.nodePath(n.id).join(' / ') });
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
      statusKey: it.locationStatus === 'at_home' ? 'at_home' : it.locationStatus,
      borrowTo: it.borrowTo || '', dueDate: it.dueDate || ''
    });
  },
  chooseStatus: function (e) { this.setData({ statusKey: e.currentTarget.dataset.key }); },
  onNode: function (e) { this.setData({ nodeIndex: Number(e.detail.value) }); },
  onNote: function (e) { this.setData({ note: e.detail.value }); },
  onBorrowTo: function (e) { this.setData({ borrowTo: e.detail.value }); },
  onDueDate: function (e) { this.setData({ dueDate: e.detail.value }); },
  confirm: function () {
    var d = this.data, self = this;
    if (this._submitting) return;
    var nodeId = d.statusKey === 'at_home' ? d.nodeOptions[d.nodeIndex].id : '';
    if (d.statusKey === 'at_home' && !nodeId && d.nodeIndex !== 0) {
      wx.showToast({ title: '请选择目标位置', icon: 'none' }); return;
    }
    // 返回时可选"在家，位置未知"：选索引 0 时按 unknown 状态处理，记为 return（TBD-002）
    var status = d.statusKey;
    if (status === 'at_home' && !nodeId) status = 'unknown';
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
          first_confirm: '首次位置确认', move: '移动', out: '记录外出',
          borrow: '记录借出', return: '记录归还'
        }[r.eventType] || (r.unchanged || r.idempotent ? '已更新' : '已更新');
        wx.showToast({ title: typeName, icon: 'success' });
        setTimeout(function () { wx.navigateBack(); }, 600);
      }
    });
  }
});
