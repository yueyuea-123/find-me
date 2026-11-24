// pages/room3d/selection-controller.js —— SelectionController 模块（阶段2c 第三迁块，模块化路线 V1.0 阶段2b 七块划分）
// 职责：选中态单点——选中高亮与卡片同步（selectIndex/selectFromList/_syncSelectionToGL/
//       _findIndexById）、取消选中（clearSel）、更换外观模型（changeModel，UF-002/BR-009）、
//       进入家具编辑（editFurniture）。
// 边界：读写 selected/bindings/sceneMode 选中态字段；渲染高亮一律经页面 _withGL；
//       选中卡内容装配依赖页面基底 _selectedCard/_decorateBindings（SceneStateStore 块），
//       抽屉刷新依赖 SheetController 的 _refreshSheet——全部经 this 调用，mixin 合并进 Page。
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

module.exports = {
  // 同步选中态到渲染器：高亮环与卡片选中态一致
  _syncSelectionToGL: function () {
    var sel = this.data.selected;
    // 编辑子模式下仅保留该家具选中；VIEW 模式不主动高亮（进入 selected 才显示）
    if (!sel || !this._glRenderer || this.data.sceneMode === 'view' || this.data.sceneMode === 'loading') return;
    for (var i = 0; i < this._furniture.length; i++) {
      if (this._furniture[i].id === sel.id) { this._withGL(function (gl) { return gl.setSelected(i); }); return; }
    }
  },

  _findIndexById: function (id) {
    for (var i = 0; i < this._furniture.length; i++) if (this._furniture[i].id === id) return i;
    return -1;
  },

  selectIndex: function (idx) {
    var f = this._furniture[idx];
    if (!f) return;
    this._withGL(function (gl) { return gl.setSelected(idx); });
    this.setData({
      selected: this._selectedCard(f),
      bindings: this._decorateBindings(f.id),
      sceneMode: (this.data.sceneMode === 'loading' || this.data.sceneMode === 'view') ? 'selected' : this.data.sceneMode
    });
    this._refreshSheet(f.id);
  },
  selectFromList: function (e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + id });
  },
  // 更换外观模型（UF-002 / BR-009）：从该家具类别的模型变体中选一个，
  // 只改 furniture.model，不动逻辑节点与物品关联；渲染器 signature 含 model，会自动重建外观。
  changeModel: function () {
    var sel = this.data.selected;
    if (!sel || !sel.id) { wx.showToast({ title: '请先选择一件家具', icon: 'none' }); return; }
    var f = store.getFurniture(sel.id);
    if (!f) { wx.showToast({ title: '家具不存在', icon: 'none' }); return; }
    var vars = (C.FURNITURE_LIB[f.category] || {}).vars || [];
    if (!vars.length) { wx.showToast({ title: '该家具暂无可选外观', icon: 'none' }); return; }
    var self = this;
    wx.showActionSheet({
      itemList: vars.slice(0, 6),
      success: function (res) {
        var model = vars[res.tapIndex];
        if (!model || model === f.model) return;
        var r = store.updateFurniture(f.id, { model: model });
        if (!r.ok) { wx.showToast({ title: '更换失败', icon: 'none' }); return; }
        self.loadData();               // 刷新 _furniture 与 selected（_raw.model 更新）
        self._withGL(function (gl) { return gl.setSelected(self._findIndexById(f.id)); });
        self._safeRender();            // signature 变化 → 重建模型，外观可见
        wx.showToast({ title: '已换为「' + model + '」，关联不变', icon: 'none' });
      }
    });
  },
  clearSel: function () {
    if (this.data.sceneMode !== 'selected' && this.data.sceneMode !== 'view') return;
    this._withGL(function (gl) { return gl.setSelected(-1); });
    this.setData({ selected: null, bindings: null, sheetOpen: false, sheetCollapsed: false, sceneMode: 'view' });
    this._safeRender();
  },

  editFurniture: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?id=' + this.data.selected.id });
  }
};
