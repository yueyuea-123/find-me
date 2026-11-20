// pages/furniture-edit/furniture-edit.js —— 家具编辑页 UI-007
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

var cats = Object.keys(C.FURNITURE_LIB);

Page({
  data: {
    editing: false, id: '', roomId: '', formError: '',
    categories: cats, catIndex: 0, models: [], modelIndex: 0,
    formName: '', fw: '', fh: '', fd: '', px: '', pz: '', rotDeg: '0'
  },

  onLoad: function (q) {
    q = q || {};
    var models0 = (C.FURNITURE_LIB[cats[0]] || {}).vars || [];
    this.setData({ roomId: q.roomId || '', models: models0 });
    if (q.id) {
      var f = store.getFurniture(q.id);
      if (!f) { wx.showToast({ title: '家具不存在', icon: 'none' }); return; }
      var ci = Math.max(0, cats.indexOf(f.category));
      var mv = (C.FURNITURE_LIB[f.category] || {}).vars || [];
      this.setData({
        editing: true, id: q.id, roomId: f.roomId, catIndex: ci,
        models: mv, modelIndex: Math.max(0, mv.indexOf(f.model)),
        formName: f.name,
        fw: String(f.size.w), fh: String(f.size.h), fd: String(f.size.d),
        px: String(f.position.x || 0), pz: String(f.position.z || 0),
        rotDeg: String(Math.round((f.rotation || 0) * 180 / Math.PI))
      });
    }
  },

  onCat: function (e) {
    var i = Number(e.detail.value);
    var mv = (C.FURNITURE_LIB[cats[i]] || {}).vars || [];
    this.setData({ catIndex: i, models: mv, modelIndex: 0 });
  },
  onModel: function (e) { this.setData({ modelIndex: Number(e.detail.value) }); },
  onName: function (e) { this.setData({ formName: e.detail.value, formError: '' }); },
  onW: function (e) { this.setData({ fw: e.detail.value }); },
  onH: function (e) { this.setData({ fh: e.detail.value }); },
  onD: function (e) { this.setData({ fd: e.detail.value }); },
  onX: function (e) { this.setData({ px: e.detail.value }); },
  onZ: function (e) { this.setData({ pz: e.detail.value }); },
  onRot: function (e) { this.setData({ rotDeg: e.detail.value }); },

  save: function () {
    var d = this.data;
    if (!d.roomId) { this.setData({ formError: '缺少房间，请从房间页进入' }); return; }
    var name = (d.formName || '').trim() || cats[d.catIndex];
    var size = { w: Number(d.fw) || 0.5, h: Number(d.fh) || 0.5, d: Number(d.fd) || 0.5 };
    var pos = { x: Number(d.px) || 0, y: 0, z: Number(d.pz) || 0 };
    // UI-007：旋转输入（角度→弧度），归一化到 [0, 2π)
    var rot = (Number(d.rotDeg) || 0) * Math.PI / 180;
    rot = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    var r;
    if (d.editing) {
      r = store.updateFurniture(d.id, { name: name, model: d.models[d.modelIndex], size: size, position: pos, rotation: rot });
    } else {
      r = store.addFurniture(d.roomId, {
        category: cats[d.catIndex], name: name, model: d.models[d.modelIndex],
        size: size, position: pos, rotation: rot, source: 'manual'
      });
    }
    if (!r.ok) { this.setData({ formError: '保存失败：' + r.error }); return; }
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(function () { wx.navigateBack(); }, 500);
  },

  remove: function () {
    var self = this;
    wx.showModal({
      title: '删除家具',
      content: '若该家具下还有收纳节点或关联物品，将无法删除，需先迁移。',
      success: function (res) {
        if (!res.confirm) return;
        var r = store.removeFurniture(self.data.id); // BR-008 关联保护
        if (!r.ok) {
          wx.showModal({ title: '无法删除', content: r.error === 'HAS_LINKS'
            ? ('该家具下有 ' + r.childNodes + ' 个子节点、' + r.items + ' 件关联物品，请先处理关联数据。')
            : ('删除失败：' + r.error), showCancel: false });
          return;
        }
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(function () { wx.navigateBack(); }, 500);
      }
    });
  }
});
