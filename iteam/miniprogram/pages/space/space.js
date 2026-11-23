// pages/space/space.js —— 空间列表 UI-002
var store = require('../../utils/store.js');

Page({
  data: { spaces: [], activeId: '', showEditor: false, editing: false, editingId: '', formName: '', formError: '' },
  onShow: function () { this.load(); },

  load: function () {
    var active = store.getActiveSpace();
    var spaces = store.listSpaces().map(function (s) {
      return {
        id: s.id, name: s.name,
        roomCount: store.listRooms(s.id).length,
        time: store.fmtTime(s.createdAt).slice(0, 10)
      };
    });
    this.setData({ spaces: spaces, activeId: active ? active.id : '' });
  },

  choose: function (e) {
    var id = e.currentTarget.dataset.id;
    var r = store.setActiveSpace(id);
    if (r.ok) { wx.showToast({ title: '已切换', icon: 'success' }); this.load(); }
  },

  openCreate: function () {
    this.setData({ showEditor: true, editing: false, editingId: '', formName: '', formError: '' });
  },
  rename: function (e) {
    var d = e.currentTarget.dataset;
    this.setData({ showEditor: true, editing: true, editingId: d.id, formName: d.name, formError: '' });
  },
  closeEditor: function () { this.setData({ showEditor: false }); },
  onName: function (e) { this.setData({ formName: e.detail.value, formError: '' }); },
  save: function () {
    var name = (this.data.formName || '').trim();
    if (!name) { this.setData({ formError: '请输入名称' }); return; }
    var r = this.data.editing
      ? store.updateSpace(this.data.editingId, name)
      : store.addSpace(name);
    if (!r.ok) { this.setData({ formError: '保存失败：' + r.error }); return; }
    if (!this.data.editing && r.data) store.setActiveSpace(r.data.id);
    this.setData({ showEditor: false });
    wx.showToast({ title: this.data.editing ? '已保存' : '空间已创建', icon: 'success' });
    this.load();
  },
  archive: function (e) {
    var d = e.currentTarget.dataset;
    var self = this;
    wx.showModal({
      title: '归档空间',
      content: '归档「' + d.name + '」及其下所有房间？数据会保留但退出日常列表，可在「我的-数据管理」中查看。',
      success: function (res) {
        if (!res.confirm) return;
        var r = store.archiveSpace(d.id);
        if (r.ok) { wx.showToast({ title: '已归档', icon: 'success' }); self.load(); }
      }
    });
  }
});
