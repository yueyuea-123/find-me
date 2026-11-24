// pages/room3d/room3d.js —— 三维房间页 UI-006（内嵌三维视图窗口 + 列表降级）
// 交互基准：《客厅三维空间交互与开发设计规范 V1.4》（现行唯一基准）：直接拖拽、抬手落盘
//   （5cm 网格吸附）、双指旋转缩放、按钮微调为辅；短按弹底部抽屉。
// 三维渲染来自 package3d 分包（Three.js r108 + GLB 资产），按需引入；业务写仍落 store。
// 阶段2c 七块划分全部迁完（模块化路线 V1.0，八·补9~14）：GLLLifecycle（./gl-lifecycle.js）、
//   BadgeSync（./badges-sync.js）、SheetController（./sheet-controller.js）、
//   SelectionController（./selection-controller.js）、SceneStateStore（./scene-state-store.js）、
//   SceneCanvas（./scene-canvas.js）、TransformController（./transform-controller.js）均以
//   mixin 合并进 Page（this 语义不变）；页面基底保留生命周期、视图/导航/房间管理等页面级职责，
//   共享助手 _withGL/_safeRender（_safeGL 仅 qa 探针用）单点留在本文件。
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');
var glLifecycle = require('./gl-lifecycle.js');
var badgesSync = require('./badges-sync.js');
var sheetController = require('./sheet-controller.js');
var selectionController = require('./selection-controller.js');
var sceneStateStore = require('./scene-state-store.js');
var sceneCanvas = require('./scene-canvas.js');
var transformController = require('./transform-controller.js');


Page(Object.assign({
  data: {
    roomId: '', roomName: '', dimText: '', view: '3d',
    furniture: [], selected: null, glError: '',
    furnitureBadges: [], // 三维家具数量角标 [{id,x,y,n}]，随重绘刷新
    bindings: null, // 当前选中模型关联物品汇总（名称在 _decorateBindings 组装）
    // ---- V1.3 场景状态机（sceneMode 为唯一状态源，见 §6 / 状态图）----
    // loading/view/selected/move/rotate/dimension/saving/saveError/itemView
    sceneMode: 'loading',
    viewTab: 'furniture',        // furniture | item（V1.3 §8 家具视图 / 物品视图）
    isDirty: false,              // V1.3 §7：有实际数据变化才置位
    cameraPreset: 'isometric',   // isometric | top | front
    // 编辑面板回显
    moveStepCm: 5,
    rotStepDeg: transformController.ROT_STEP_DEG,
    curAngle: 0,                 // 当前角度（0–359，V1.3 §5.2）
    dimL: '', dimW: '', dimH: '', // 尺寸面板长宽高输入（cm）
    spaceItems: [],              // 物品视图列表（仅当前空间）
    hint: '点家具选中 · 空白处拖动转视角 · 双指缩放 · 选中后按钮微调并保存',
    showLib: false,          // 家具模型库按需展开，不常驻占据屏幕
    showBindPicker: false,   // 「从已有物品中选择」面板
    bindableItems: [],
    bindTargetName: '',
    // 物品业务规则 V1.0 §3.2：点击家具打开底部抽屉，三维场景作为背景保持可见
    sheetOpen: false, sheetCollapsed: false,
    sheetNodes: [], activeNodeId: '', activeNodePath: '', nodeItems: [],
    // 房间长宽调整（房间管理菜单入口，二维表单式改尺寸，三维场景自动重建）
    showRoomSize: false,
    roomSizeW: '', roomSizeD: '', // 长/宽输入（cm）
    lib: (C.FURNITURE_CATEGORIES || []).map(function (k) {
      return { key: k, icon: (C.FURNITURE_LIB[k] || {}).icon || '▣' };
    })
  },

  HINT: '点家具选中 · 空白处拖动转视角 · 双指缩放 · 选中后按钮微调并保存',

  onLoad: function (q) { this.setData({ roomId: q.id || '', sceneMode: 'loading' }); },
  onShow: function () {
    this.loadData();
    // 从详情页返回时：仅当处于三维家具视图才补初始化。
    // 若停在物品视图，canvas 根本不存在，盲目 _initGL 会重试 10 次后把 view 降级成 list，
    // 导致返回房间后三维彻底消失（用户反馈「点物品再返回后无三维视图」的根因之一）。
    var self = this;
    setTimeout(function () {
      if (self.data.viewTab === 'furniture' && self.data.view === '3d' && !self.data.glError) self._initGL();
    }, 60);
  },
  onUnload: function () { this._clearLongPress(); glLifecycle.reset(this); },
  // 分段页面可滚动：canvas 位置随滚动变化，重新取 rect 供触摸坐标换算
  onPageScroll: function () { this._syncCanvasRect(); },

  // ---------- V1.3 编辑状态机与手势（TransformController 块第六迁，最后一块）----------
  // _editing/_beginEdit/cancelEdit/finishEdit/_normDeg/_pushUndo、手势状态机
  // onTouchStart/onTouchMove/onTouchEnd/_dist/_angle、按钮微调 moveStep/rotateStep/onDimInput/
  // applyDimension、保存/撤销/离开 saveScene/undoScene/onBack、编辑入口 enterMove/enterRotate/
  // enterDimension 与删除 _doRemoveFurniture/removeSelected/confirmRemove
  // 已迁移至 ./transform-controller.js（mixin 合并进 Page；步长常量随块迁并导出，
  // _editBase/_undoStack/_dragBase 等状态仍挂页面实例）

  // _selectedCard 已迁移至 ./scene-state-store.js（阶段2c SceneStateStore 块第四迁）

  // _decorateBindings 已迁移至 ./scene-state-store.js（阶段2c SceneStateStore 块第四迁）

  // _sheetNodes/_refreshSheet/openSheet/closeSheet/toggleSheet/chooseNode/openNodeItem
  // 已迁移至 ./sheet-controller.js（阶段2c SheetController 块第二迁，mixin 合并进 Page）

  // loadData 已迁移至 ./scene-state-store.js（阶段2c SceneStateStore 块第四迁，mixin 合并进 Page）

  // _syncSelectionToGL 已迁移至 ./selection-controller.js（阶段2c SelectionController 块第三迁）

  // 显式引用调用渲染器（阶段2a，评估 3D-02）：方法名写死在调用点，改名可被
  // qa/renderer-signature-contract-test.js 静态发现；catch 兜底真实 WebGL 异常并整体降级列表。
  _withGL: function (fn, fallback) {
    var gl = this._glRenderer;
    if (!gl) return fallback === undefined ? null : fallback;
    try { return fn.call(this, gl); }
    catch (e) {
      glLifecycle.reset(this);
      this.setData({ glError: '三维渲染异常，已切换列表', view: 'list' });
      return null;
    }
  },
  // ⚠ 已废弃（阶段2a）：页面代码一律走 _withGL 显式调用；仅保留给 qa 自动化探针使用
  _safeGL: function (fn, args) {
    return this._withGL(function (gl) { return gl[fn].apply(gl, args || []); });
  },
  _safeRender: function () {
    if (this.data.view === '3d' && !this.data.glError) {
      this._withGL(function (gl) { return gl.render(); });
      this._syncBadges();
    }
  },
  // _syncCanvasRect/onReady/_initGL/_load3D/_initRenderer/_touchPoint/_canvasXY/
  // resetView/fitView/setPreset/_resetGLForHidden 已迁移至 ./scene-canvas.js
  // （阶段2c SceneCanvas 块第五迁，mixin 合并进 Page；rendererFactory 随块迁为模块单例）

  // 数量角标：把每件家具的有效物品数投到其模型顶部的屏幕位置。
  // 只提示数量，不把物品画成三维模型；坐标随拖动/转视角/缩放实时更新。
  // _syncBadges 已迁移至 ./badges-sync.js（阶段2c BadgeSync 块首迁，mixin 合并进 Page）

  _clearLongPress: function () { if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; } },
  // _findIndexById 已迁移至 ./selection-controller.js（阶段2c SelectionController 块第三迁）

  // ---- V1.3 §8 家具视图 / 物品视图切换（不改变数据）----
  // resetView/fitView/setPreset/_resetGLForHidden 已迁移至 ./scene-canvas.js（第五迁）
  switchViewTab: function (e) {
    var tab = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'furniture';
    if (tab === this.data.viewTab) return;
    if (tab === 'item') {
      this._loadSpaceItems();
      this._resetGLForHidden();  // canvas 即将被 wx:if 销毁，释放渲染器
      this.setData({ viewTab: 'item', sceneMode: 'itemView' });
    } else {
      this.setData({ viewTab: 'furniture', sceneMode: 'view' }, this._initGL.bind(this));
    }
  },
  // _loadSpaceItems 已迁移至 ./scene-state-store.js（阶段2c SceneStateStore 块第四迁）
  openSpaceItem: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + id });
  },
  // 物品视图 → 返回三维房间：切回家具视图并重挂 canvas（用户反馈物品页只能回主页，无回房间入口）
  backToRoom: function () {
    this.setData({ viewTab: 'furniture', sceneMode: 'view' }, this._initGL.bind(this));
  },
  // 物品视图 → 添加家具：回家具视图并展开模型库，避免"点添加家具没反应"（原按钮在三维 dock，物品视图不可见）
  addFurnitureFromItemView: function () {
    this.setData({ viewTab: 'furniture', sceneMode: 'view', showLib: true }, this._initGL.bind(this));
  },

  // _syncSceneToGL 已迁移至 ./scene-state-store.js（阶段2c SceneStateStore 块第四迁）

  // chooseAddItem/addItemAtFurniture/_targetNodeId/_rootNodeId/openBindPicker/closeBindPicker/
  // addItemFromPicker/bindExistingItem/toggleLib/addFromLib 已迁移至 ./sheet-controller.js
  // （阶段2c SheetController 块第二迁，mixin 合并进 Page）

  // ---- V1.3 §0/§4「管理」入口：选中后点明确按钮进入家具管理，不用双击 ----
  openManage: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + this.data.selected.id });
  },
  // enterMove/enterRotate/enterDimension/_doRemoveFurniture/removeSelected/confirmRemove
  // 已迁移至 ./transform-controller.js（阶段2c TransformController 块第六迁）

  // 查看物品：进入家具详情（关联物品列表 + 逻辑收纳节点）
  goFurnitureNodes: function (furnitureId) {
    var fid = furnitureId || (this.data.selected && this.data.selected.id);
    if (!fid) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + fid });
  },
  goNodes: function () { this.goFurnitureNodes(); },
  // 抽屉内的次要操作折叠到一处，避免遮挡三维场景
  moreFurnitureOps: function () {
    if (!this.data.selected) return;
    var self = this;
    var candidate = this.data.selected.status === 'candidate';
    var items = ['编辑家具资料'];
    if (candidate) items.push('确认候选家具');
    items.push('删除家具');
    wx.showActionSheet({
      itemList: items,
      success: function (res) {
        var label = items[res.tapIndex];
        if (label === '编辑家具资料') self.editFurniture();
        else if (label === '确认候选家具') self.confirmCandidate();
        else if (label === '删除家具') self.removeSelected();
      }
    });
  },

  // _dist/_angle 已迁移至 ./transform-controller.js（阶段2c TransformController 块第六迁）

  // selectIndex/selectFromList/changeModel/clearSel 已迁移至 ./selection-controller.js
  // （阶段2c SelectionController 块第三迁，mixin 合并进 Page）

  setView: function (e) {
    var v = e.currentTarget.dataset.v;
    if (v === this.data.view) return;
    if (v === 'list') {
      glLifecycle.reset(this);
      this.setData({ view: 'list' });
    } else {
      this.setData({ view: '3d' }, this._initGL.bind(this));
    }
  },

  // editFurniture 已迁移至 ./selection-controller.js（阶段2c SelectionController 块第三迁）
  confirmCandidate: function () {
    var self = this;
    wx.showModal({
      title: '确认候选家具',
      content: '确认后该家具位置将作为事实保存，重新建模不会覆盖。',
      success: function (res) {
        if (!res.confirm || !self.data.selected) return;
        store.updateFurniture(self.data.selected.id, { status: 'confirmed' });
        wx.showToast({ title: '已确认', icon: 'success' });
        self.loadData();
      }
    });
  },
  addFurniture: function () {
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?roomId=' + this.data.roomId });
  },

  // ---- 房间管理入口（原 room 页卡片按钮迁入，功能不丢失） ----
  roomMenu: function () {
    var self = this;
    wx.showActionSheet({
      itemList: ['房间照片', '家具管理', '调整长宽', '重命名房间', '归档房间', '删除房间'],
      success: function (res) {
        var i = res.tapIndex;
        if (i === 0) wx.navigateTo({ url: '/pages/photos/photos?id=' + self.data.roomId });
        else if (i === 1) wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?roomId=' + self.data.roomId });
        else if (i === 2) self.openRoomSize();
        else if (i === 3) self.renameRoom();
        else if (i === 4) self.archiveRoom();
        else if (i === 5) self.destroyRoom();
      }
    });
  },
  // ---- 房间长宽调整（二维表单式：改数据即重建三维，不做三维内拖墙手势）----
  // 评估报告 N-01 五处冲突的解法：入口收进房间管理菜单后，①手势冻结/②pick 墙命中/
  // ③墙编辑态三处冲突自然消失；④撤销不入家具撤销栈（等同改名，立即生效）；
  // ⑤updateRoom 尺寸变化重建 layout 即期望行为。越界家具由 store 钳制（D-04）。
  openRoomSize: function () {
    var room = this._room || {};
    this.setData({
      showRoomSize: true,
      roomSizeW: String(Math.round((room.width || 4) * 100)),
      roomSizeD: String(Math.round((room.depth || 4) * 100))
    });
  },
  onRoomSizeInput: function (e) {
    var field = (e.currentTarget.dataset.field) || '';
    if (field === 'w' || field === 'd') {
      var p = {}; p['roomSize' + field.toUpperCase()] = e.detail.value; this.setData(p);
    }
  },
  cancelRoomSize: function () { this.setData({ showRoomSize: false }); },
  applyRoomSize: function () {
    var w = Number(this.data.roomSizeW), d = Number(this.data.roomSizeD);
    if (!(w > 0 && d > 0)) { wx.showToast({ title: '长宽须大于 0', icon: 'none' }); return; }
    // 边界：0.5m ~ 50m（米制渲染有效下限 0.5，见 renderer updateRoomGeometry）
    if (Math.max(w, d) > 5000 || Math.min(w, d) < 50) {
      wx.showToast({ title: '长宽须在 50–5000 cm', icon: 'none' }); return;
    }
    var r = store.updateRoom(this.data.roomId, {
      width: Math.round(w) / 100, depth: Math.round(d) / 100
    });
    if (!r.ok) { wx.showToast({ title: '保存失败：' + (r.error || '未知'), icon: 'none' }); return; }
    this.setData({ showRoomSize: false });
    this.loadData();            // 重新装配页面数据（含房间新尺寸回显）
    this._syncSceneToGL();      // 家具 _raw 同步；renderer.updateRoomGeometry 检测尺寸变化自动重建场景
    this._safeRender();
    var tip = r.clampedFurniture > 0
      ? ('房间已调整，' + r.clampedFurniture + ' 件家具已收回边界内')
      : '房间已调整';
    wx.showToast({ title: tip, icon: 'none' });
  },
  renameRoom: function () {
    var self = this;
    wx.showModal({
      title: '重命名房间', editable: true, placeholderText: '请输入房间名称', content: this.data.roomName,
      success: function (res) {
        if (!res.confirm || !(res.content || '').trim()) return;
        var r = store.updateRoom(self.data.roomId, { name: res.content.trim() });
        if (!r.ok) { wx.showToast({ title: '保存失败：' + r.error, icon: 'none' }); return; }
        wx.showToast({ title: '已重命名', icon: 'success' });
        self.loadData();
      }
    });
  },
  archiveRoom: function () {
    var self = this, d = this.data.roomId;
    var a = store.roomAssociations(d);
    var content = '归档后该房间退出日常列表，历史可追溯。';
    if (a.total > 0) content = '该房间仍有 ' + a.furniture + ' 件家具、' + a.nodes + ' 个节点、' + a.items + ' 件物品。归档后不再作为新物品与家具的可选位置，历史仍可追溯。是否继续？';
    wx.showModal({ title: '归档房间', content: content, confirmColor: '#BE5F44',
      success: function (res) {
        if (res.confirm && store.archiveRoom(d).ok) { wx.showToast({ title: '已归档', icon: 'success' }); wx.navigateBack(); }
      }
    });
  },
  destroyRoom: function () {
    var self = this, d = this.data.roomId;
    var a = store.roomAssociations(d);
    var detail = '这将永久删除该房间及其全部家具、节点，操作不可恢复。';
    if (a.items > 0) detail += '\n其中 ' + a.items + ' 件物品不会被删除，但会变为「位置未知」。';
    wx.showModal({ title: '永久删除房间', content: detail + '\n确认继续？', confirmText: '永久删除', confirmColor: '#BE5F44',
      success: function (res) {
        if (!res.confirm) return;
        var r = store.deleteRoom(d);
        if (!r.ok) { wx.showToast({ title: '删除失败：' + r.error, icon: 'none' }); return; }
        wx.showToast({ title: '已永久删除', icon: 'success' });
        wx.navigateBack();
      }
    });
  }
}, badgesSync, sheetController, selectionController, sceneStateStore, sceneCanvas, transformController));
