// pages/task/task.js —— 建模任务页 UI-005
var store = require('../../utils/store.js');

var STATUS = {
  none: { icon: '◌', title: '尚未提交任务', desc: '上传房间照片后可提交建模任务', show: true },
  ready: { icon: '◑', title: '照片已就绪', desc: '照片已上传，可提交建模任务', show: true },
  processing: { icon: '◕', title: '处理中', desc: '任务排队/处理中；离开页面后状态保留，可再次查看', show: true },
  candidate_ready: { icon: '✓', title: '候选已生成', desc: '候选模型待你确认，确认前不作为事实', show: true },
  failed: { icon: '!', title: '建模失败', desc: '可重试，或走手动添加家具的降级路径', show: true }
};

Page({
  data: { roomId: '', roomName: '', status: 'none', statusIcon: '', statusTitle: '', statusDesc: '', showActions: true },
  onLoad: function (q) { this.setData({ roomId: q.id || '' }); },
  onShow: function () { this.load(); },

  load: function () {
    var r = store.getRoom(this.data.roomId);
    if (!r) { wx.showToast({ title: '房间不存在', icon: 'none' }); return; }
    var st = r.task.status || 'none';
    var s = STATUS[st] || STATUS.none;
    this.setData({
      roomName: r.name, status: st,
      statusIcon: s.icon, statusTitle: s.title, statusDesc: s.desc, showActions: s.show
    });
  },
  start: function () {
    var r = store.startTask(this.data.roomId);
    if (r.ok) { wx.showToast({ title: '已提交', icon: 'success' }); this.load(); }
    else wx.showToast({ title: r.error === 'NO_PHOTOS' ? '请先上传照片' : '提交失败', icon: 'none' });
  },
  markDone: function () {
    store.finishTask(this.data.roomId, true, '');
    wx.showToast({ title: '候选已生成', icon: 'success' }); this.load();
  },
  markFail: function () {
    store.finishTask(this.data.roomId, false, '本地演示：模拟建模失败');
    wx.showToast({ title: '已标记失败', icon: 'none' }); this.load();
  },
  go3d: function () { wx.navigateTo({ url: '/pages/room3d/room3d?id=' + this.data.roomId }); },
  goManual: function () {
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?roomId=' + this.data.roomId });
  }
});
