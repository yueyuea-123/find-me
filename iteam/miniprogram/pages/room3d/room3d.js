// pages/room3d/room3d.js —— 三维房间页 UI-006（内嵌三维视图窗口 + 列表降级）
// 交互基准：《客厅三维空间交互与开发设计规范 V1.3》A 方案（简化操作）+《A 方案交互状态图》：
//   默认不直接拖动家具；点选家具后通过明确按钮小步调整；编辑先进本地待保存状态，保存后提交。
// 三维渲染来自 package3d 分包（Three.js r108 + GLB 资产），按需引入；业务写仍落 store。
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');
var rendererFactory = null;
function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// 尺寸展示：保留两位小数并去掉无意义的尾随 0，避免缩放后出现长串小数
function fmtNum(v) { return String(Math.round((Number(v) || 0) * 100) / 100); }
// V1.3 §5.1/§5.2：首版步长固定 5cm、旋转 15°（90° 快捷）
var MOVE_STEP_M = 0.05;   // 5cm，米
var GRID_M = 0.05;        // 拖动落盘网格吸附步长 5cm，与按钮步进一致
var ROT_STEP_DEG = 15;    // 度
var ROT_QUICK_DEG = 90;   // 快捷旋转

// 高保真资产映射：交付稿 assets/ 的缩略图与家具/物品 ID 关联（视觉规范 §6）。
// 图片仅用于列表缩略，三维模型仍由 package3d 按 category 加载，二者不互相替代。
var HIFI_ROOT = '/images/hifi/';
// 阶段三：6 件样板家具的真实渲染缩略图（与 package3d 彩色模型一一对应）。
// 图片只用于列表/卡片缩略，三维模型仍由 package3d 按 key 加载，二者不互相替代。
var FURN_ROOT = '/images/furniture/';
function furnitureThumb(f) {
  var n = (f.name || '') + ' ' + (f.category || '');
  // 有专属真实缩略图的类别优先命中；注意「床头柜」含「床」，须先于「床」判断。
  if (/床头柜/.test(n)) return '';
  if (/沙发|sofa/i.test(n)) return FURN_ROOT + 'sofa.jpg';
  if (/床|bed/i.test(n)) return FURN_ROOT + 'bed.jpg';
  if (/书桌|餐桌|桌|table/i.test(n)) return FURN_ROOT + 'table.jpg';
  if (/茶几|coffee/i.test(n)) return FURN_ROOT + 'coffee.jpg';
  if (/衣柜|wardrobe/i.test(n)) return FURN_ROOT + 'wardrobe.jpg';
  if (/置物架|书架|书柜|shelf/i.test(n)) return FURN_ROOT + 'shelf.jpg';
  // 其余类别沿用原交付稿缩略图；无图时返回空串，由页面用 icon 占位，
  // 不回落到整屋图 home_isometric.jpg（那会让「双人床/落地窗」显示成整套房效果）。
  if (/躺椅/i.test(n)) return HIFI_ROOT + 'sofa.jpg';
  if (/电视|tv|影音/i.test(n)) return HIFI_ROOT + 'tv_console.jpg';
  if (/绿植|植物|plant/i.test(n)) return HIFI_ROOT + 'plant.jpg';
  return '';
}
function itemThumb(it) {
  var n = it.name || '';
  if (/保温杯|水壶|瓶|bottle/i.test(n)) return HIFI_ROOT + 'bottle.jpg';
  if (/马克杯|杯子|mug|cup/i.test(n)) return HIFI_ROOT + 'mug.jpg';
  if (/耳机|headphone/i.test(n)) return HIFI_ROOT + 'headphones.jpg';
  if (/笔记本|书|note|book/i.test(n)) return HIFI_ROOT + 'notebook.jpg';
  if (/绿植|植物|plant/i.test(n)) return HIFI_ROOT + 'plant.jpg';
  if (/纸巾|纸|tissue/i.test(n)) return HIFI_ROOT + 'tissue.jpg';
  if (/洗衣液|清洁|detergent/i.test(n)) return HIFI_ROOT + 'detergent.jpg';
  if (/电池|battery/i.test(n)) return HIFI_ROOT + 'battery.jpg';
  return '/images/default-goods-image.png';
}

Page({
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
    rotStepDeg: ROT_STEP_DEG,
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
  onUnload: function () { this._clearLongPress(); this._glRenderer = null; this._glInitStarted = false; },
  // 分段页面可滚动：canvas 位置随滚动变化，重新取 rect 供触摸坐标换算
  onPageScroll: function () { this._syncCanvasRect(); },

  // ---------- V1.3 状态机工具 ----------
  // 编辑子模式（move/rotate/dimension）禁止相机与场景手势；只有 view/selected 可转视角。
  _editing: function () {
    var m = this.data.sceneMode;
    return m === 'move' || m === 'rotate' || m === 'dimension' || m === 'saving' || m === 'saveError';
  },
  // 进入子模式前记录基线，供「取消」回滚本次编辑（V1.3 §5.x）
  _beginEdit: function (mode) {
    var sel = this.data.selected;
    if (!sel) { wx.showToast({ title: '请先点选家具', icon: 'none' }); return; }
    var f = store.getFurniture(sel.id);
    if (!f) return;
    this._editBase = {
      id: sel.id,
      position: JSON.parse(JSON.stringify(f.position || { x: 0, y: 0, z: 0 })),
      rotation: f.rotation || 0,
      size: JSON.parse(JSON.stringify(f.size || { w: 0.6, d: 0.6, h: 0.6 }))
    };
    this._editChanged = false; // 未实际修改不标 dirty（V1.3 §7）
    var patch = { sceneMode: mode };
    if (mode === 'rotate') patch.curAngle = this._normDeg(Math.round((f.rotation || 0) * 180 / Math.PI));
    if (mode === 'dimension') {
      var s = f.size || {};
      patch.dimL = fmtNum((s.w || 0) * 100);
      patch.dimW = fmtNum((s.d || 0) * 100);
      patch.dimH = fmtNum((s.h || 0) * 100);
    }
    this.setData(patch);
    this._withGL(function (gl) { return gl.setSelected(this._findIndexById(sel.id)); });
    this._safeRender();
  },
  // 「取消」：回滚本次编辑到基线，回到 selected，不改 dirty 之外的历史
  cancelEdit: function () {
    var b = this._editBase;
    if (b) {
      var f = store.getFurniture(b.id);
      if (f) {
        store.updateFurniture(b.id, { position: b.position, rotation: b.rotation, size: b.size });
        // 撤销栈中由本次编辑产生的记录一并丢弃
        this._undoStack = (this._undoStack || []).filter(function (e) { return e.id !== b.id; });
      }
    }
    this._editBase = null; this._editChanged = false;
    this._syncSceneToGL(); this.loadData();
    this.setData({ sceneMode: 'selected' });
    this._safeRender();
    wx.showToast({ title: '已取消本次修改', icon: 'none' });
  },
  // 「完成」：保留待保存改动，回到 selected（V1.3 §6 MOVE/ROTATE/DIMENSION --完成--> SELECTED）
  finishEdit: function () {
    if (this._editBase && this._editChanged) {
      this._undoStack = this._undoStack || [];
      this._undoStack.push(JSON.parse(JSON.stringify(this._editBase))); // 供「撤销」回退最近一次
    }
    this._editBase = null; this._editChanged = false;
    this.setData({ sceneMode: 'selected', isDirty: (this._undoStack || []).length > 0 });
    this._safeRender();
  },
  // 角度归一化到 [0,360)
  _normDeg: function (d) { d = Math.round(d) % 360; return d < 0 ? d + 360 : d; },

  _selectedCard: function (row) {
    return {
      id: row.id, name: row.name, px: row.px, pz: row.pz,
      rot: row.rot, sz: row.sz, status: row.status,
      bindCount: store.bindingsOfFurniture(row.id).items.length
    };
  },

  // 绑定汇总补展示名（store 只回 items，展示用 itemNames 在此组装，不改数据层）
  _decorateBindings: function (furnitureId) {
    if (!furnitureId) return null;
    var b = store.bindingsOfFurniture(furnitureId);
    b.itemNames = (b.items || []).map(function (it) { return it.name; }).join('、');
    return b;
  },

  // 家具下全部收纳节点（含家具根节点），按父子层级平铺；计数只统计当前有效物品
  _sheetNodes: function (furnitureId) {
    if (!furnitureId) return [];
    var all = store.listNodes(this.data.roomId).filter(function (n) {
      return n.furnitureId === furnitureId;
    });
    var out = [];
    var walk = function (parentId, depth) {
      var level = all.filter(function (n) { return (n.parentId || '') === parentId; })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      level.forEach(function (n) {
        out.push({
          id: n.id, name: n.name, type: n.type, depth: depth,
          path: store.nodePath(n.id).join(' / '),
          itemCount: store.itemsInNode(n.id).length
        });
        walk(n.id, depth + 1);
      });
    };
    walk('', 0);
    return out;
  },

  // 抽屉内容随选中家具/节点同步；节点物品只看直接关联的物品（规则 §4.1）
  _refreshSheet: function (furnitureId) {
    var nodes = this._sheetNodes(furnitureId);
    var active = this.data.activeNodeId;
    if (!nodes.some(function (n) { return n.id === active; })) active = nodes.length ? nodes[0].id : '';
    var items = active ? store.itemsInNode(active).slice(0, 5).map(function (it) {
      return { id: it.id, name: it.name, locationStatus: it.locationStatus || '' };
    }) : [];
    this.setData({
      sheetNodes: nodes, activeNodeId: active,
      activeNodePath: active ? store.nodePath(active).join(' / ') : '',
      nodeItems: items
    });
  },

  openSheet: function () {
    if (!this.data.selected) return;
    this._refreshSheet(this.data.selected.id);
    this.setData({ sheetOpen: true, sheetCollapsed: false });
  },
  closeSheet: function () { this.setData({ sheetOpen: false, sheetCollapsed: false }); },
  toggleSheet: function () {
    if (!this.data.sheetOpen) { this.openSheet(); return; }
    this.setData({ sheetCollapsed: !this.data.sheetCollapsed });
  },
  chooseNode: function (e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ activeNodeId: id });
    this._refreshSheet(this.data.selected && this.data.selected.id);
  },
  openNodeItem: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + id });
  },

  loadData: function () {
    var room = store.getRoom(this.data.roomId);
    if (!room) { wx.showToast({ title: '房间不存在', icon: 'none' }); return; }
    var list = store.listFurniture(this.data.roomId).map(function (f) {
      var lib = C.FURNITURE_LIB[f.category] || {};
      return {
        id: f.id, name: f.name, category: f.category, icon: lib.icon || '▣',
        thumb: furnitureThumb(f),
        model: f.model, status: f.status, confidence: f.confidence,
        px: (f.position.x || 0).toFixed(2), pz: (f.position.z || 0).toFixed(2),
        rot: Math.round((f.rotation || 0) * 180 / Math.PI),
        sz: fmtNum(f.size && f.size.w) + '×' + fmtNum(f.size && f.size.d) + '×' + fmtNum(f.size && f.size.h),
        bindCount: store.bindingsOfFurniture(f.id).items.length,
        _raw: f
      };
    });
    this._room = room;
    this._furniture = list;
    // 选中态：优先保持当前选中；否则保持规范 V1.0 兼容（默认第一件，demo 对齐依赖此串）
    var selected = this.data.selected, selRow = null;
    if (selected) {
      for (var si = 0; si < list.length; si++) if (list[si].id === selected.id) { selRow = list[si]; break; }
    }
    if (!selRow && list.length) selRow = list[0];
    var dim = room.calibrated ? (room.width + '×' + room.depth + '×' + room.height + ' m') : '尺寸未定标（相对估算）';
    this.setData({
      roomName: room.name, dimText: dim, furniture: list,
      selected: selRow ? this._selectedCard(selRow) : null,
      bindings: this._decorateBindings(selRow ? selRow.id : '')
    });
    // 底部 dock 的「物品（N）」徽标需要实时数量；只加载数据，不切换视图/状态
    this._loadSpaceItems();
    // 抽屉内容跟随选中家具刷新；打开状态由用户点击控制，loadData 不擅自弹面板
    this._refreshSheet(selRow ? selRow.id : '');
    // 同步选中态到渲染器：高亮环与卡片选中态一致
    this._syncSelectionToGL();
    this._safeRender();
  },

  _syncSelectionToGL: function () {
    var sel = this.data.selected;
    // 编辑子模式下仅保留该家具选中；VIEW 模式不主动高亮（进入 selected 才显示）
    if (!sel || !this._glRenderer || this.data.sceneMode === 'view' || this.data.sceneMode === 'loading') return;
    for (var i = 0; i < this._furniture.length; i++) {
      if (this._furniture[i].id === sel.id) { this._withGL(function (gl) { return gl.setSelected(i); }); return; }
    }
  },

  // 显式引用调用渲染器（阶段2a，评估 3D-02）：方法名写死在调用点，改名可被
  // qa/renderer-signature-contract-test.js 静态发现；catch 兜底真实 WebGL 异常并整体降级列表。
  _withGL: function (fn, fallback) {
    var gl = this._glRenderer;
    if (!gl) return fallback === undefined ? null : fallback;
    try { return fn.call(this, gl); }
    catch (e) {
      this._glRenderer = null;
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
  // 数量角标：把每件家具的有效物品数投到其模型顶部的屏幕位置。
  // 只提示数量，不把物品画成三维模型；坐标随拖动/转视角/缩放实时更新。
  _syncBadges: function () {
    if (!this._glRenderer || typeof this._glRenderer.projectAll !== 'function') return;
    var pts = this._withGL(function (gl) { return gl.projectAll(); }) || [];
    var self = this;
    var badges = [];
    pts.forEach(function (p) {
      var row = self._furniture && self._furniture[p.index];
      if (!row || !p.visible) return;
      // 只显示有物品的家具；数量为 0 不显示，避免画面杂乱
      if (!(row.bindCount > 0)) return;
      badges.push({ id: row.id, x: p.x, y: p.y, n: row.bindCount });
    });
    this.setData({ furnitureBadges: badges });
  },

  // 缓存 canvas 在视口中的位置：内嵌窗口不再从屏幕左上角开始，pick 需减去此偏移
  _syncCanvasRect: function () {
    var self = this;
    wx.createSelectorQuery().in(this).select('#gl').boundingClientRect(function (rect) {
      if (rect) self._glRect = rect;
    }).exec();
  },

  onReady: function () { this._initGL(); },

  // 取 canvas 节点并初始化渲染器；canvas 在 wx:if 块内，onReady 时可能尚未挂载，需重试
  _initGL: function (retry) {
    var self = this;
    if (this._glRenderer || this._glInitStarted) return; // 防止 onReady/onShow 双重初始化
    wx.createSelectorQuery().in(this).select('#gl').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) {
        if ((retry || 0) < 10) {
          setTimeout(function () { self._initGL((retry || 0) + 1); }, 80);
          return;
        }
        self.setData({ glError: '无法获取 canvas 节点，请使用基础库 2.9+', view: 'list' });
        return;
      }
      self._glInitStarted = true; // 加锁：分包异步加载期间不让第二个调用进来
      var canvas = res[0].node;
      self._glCanvas = canvas;
      self._glRect = { left: 0, top: 0, width: res[0].width, height: res[0].height };
      self._load3D(canvas, res[0]);
    });
  },

  _load3D: function (canvas, sizeInfo) {
    var self = this;
    var fail = function (e) {
      self.setData({ glError: '三维模块加载失败：' + ((e && (e.errMsg || e.message)) || e), view: 'list' });
    };
    var boot = function () {
      try {
        require('../../package3d/renderer.js', function (mod) {
          rendererFactory = mod;
          self._initRenderer(canvas, sizeInfo);
        }, fail);
      } catch (e) { fail(e); }
    };
    try {
      wx.loadSubpackage({ name: 'package3d', success: boot, fail: boot });
    } catch (e) { boot(); }
  },

  _initRenderer: function (canvas, sizeInfo) {
    var self = this;
    var getScene = function () {
      return {
        room: self._room ? { width: self._room.width, depth: self._room.depth, height: self._room.height } : null,
        furniture: (self._furniture || []).map(function (x) { return x._raw; })
      };
    };
    if (!rendererFactory || typeof rendererFactory.createRoomRenderer !== 'function') {
      this.setData({ glError: '三维模块不可用', view: 'list' });
      return;
    }
    var r = rendererFactory.createRoomRenderer(canvas, getScene, {
      onAssetError: function (info) {
        if (info.code === 'ASSETS_READY') return;
        self.setData({ assetError: info.code + '：' + info.detail });
        wx.showModal({
          title: '三维模型资源不可用',
          content: '模型文件未能加载（' + info.code + '）。请切换列表视图继续管理家具；若刚更新过版本，可删除小程序后重新进入以刷新资源包。',
          showCancel: false, confirmText: '我知道了'
        });
      }
    });
    if (!r.ok) {
      this.setData({ glError: r.error === 'WEBGL_UNAVAILABLE' ? '设备不支持 WebGL' : ('三维初始化失败：' + r.message), view: 'list' });
      return;
    }
    canvas.width = Math.max(1, Math.floor(sizeInfo.width));
    canvas.height = Math.max(1, Math.floor(sizeInfo.height));
    r.resize(canvas.width, canvas.height);
    this._glRenderer = r;
    this._syncCanvasRect();
    this._syncSelectionToGL();
    this._safeRender();
  },

  // 触摸点统一换算为 canvas 内坐标。真机 x/y 已是画布内坐标；仅旧环境用视口坐标兜底。
  _touchPoint: function (t) {
    if (typeof t.x === 'number' && typeof t.y === 'number' && isFinite(t.x) && isFinite(t.y)) {
      return { x: t.x, y: t.y };
    }
    var rect = this._glRect || { left: 0, top: 0 };
    var cx = (t.clientX !== undefined ? t.clientX : t.pageX);
    var cy = (t.clientY !== undefined ? t.clientY : t.pageY);
    return { x: (Number(cx) || 0) - (rect.left || 0), y: (Number(cy) || 0) - (rect.top || 0) };
  },
  _canvasXY: function (touch) { return this._touchPoint(touch); },

  // ---- 交互手势（阶段二重做，推翻 V1.3 A 方案「命中即锁死为点击」）----
  //   单指：命中家具→直接拖动（跟手，抬手落盘）；空白→旋转相机。
  //   双指：张开/捏合缩放视图，旋转手势旋转选中家具；方向按钮降为精确微调备选。
  //   短按家具仍=选中并打开底部抽屉（找物主路径不变）。编辑子模式下手势禁用，只能用按钮。
  //   网格吸附 GRID_M：抬手落盘时按 5cm 对齐，拖动过程保持平滑不吸附。
  onTouchStart: function (e) {
    if (!this._glRenderer || this.data.view !== '3d' || this.data.glError || this._editing()) return;
    this._syncCanvasRect();
    var ts = e.touches;
    if (ts.length === 1) {
      var p = this._canvasXY(ts[0]);
      var idx = this._withGL(function (gl) { return gl.pick(p.x, p.y); });
      this._sx = p.x; this._sy = p.y;
      this._moved = false;
      this._hitIdx = (idx !== null && idx >= 0 && this._furniture[idx]) ? idx : -1;
      // 命中家具：记录当前世界坐标为拖动基线；空白：相机拖动待命
      if (this._hitIdx >= 0) {
        var row = this._furniture[this._hitIdx];
        var raw = row._raw || store.getFurniture(row.id) || {};
        var pos = raw.position || { x: 0, y: 0, z: 0 };
        this._dragBase = { x: pos.x || 0, z: pos.z || 0 };
        // 操作前完整快照，供抬手落盘后写入撤销栈
        this._dragBefore = {
          position: JSON.parse(JSON.stringify(pos)),
          rotation: raw.rotation || 0,
          size: JSON.parse(JSON.stringify(raw.size || { w: 0.6, d: 0.6, h: 0.6 }))
        };
        this._withGL(function (gl) { return gl.setSelected(this._hitIdx); });
      } else {
        this._dragBase = null; this._dragBefore = null;
      }
    } else if (ts.length === 2) {
      // 双指：缩放视图 + 记录旋转基线；本手势不再当作家具点击/拖动
      this._pinch = this._dist(ts);
      this._pinchAngle = this._angle(ts);
      this._moved = true;
      this._hitIdx = -1;
      this._dragBase = null;
      var srow = this.data.selected;
      if (srow) {
        var sraw = store.getFurniture(srow.id) || {};
        this._spinBefore = {
          position: JSON.parse(JSON.stringify(sraw.position || { x: 0, y: 0, z: 0 })),
          rotation: sraw.rotation || 0,
          size: JSON.parse(JSON.stringify(sraw.size || { w: 0.6, d: 0.6, h: 0.6 }))
        };
      } else this._spinBefore = null;
    }
  },
  _clearLongPress: function () { if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; } },
  _findIndexById: function (id) {
    for (var i = 0; i < this._furniture.length; i++) if (this._furniture[i].id === id) return i;
    return -1;
  },

  onTouchMove: function (e) {
    if (!this._glRenderer || this.data.view !== '3d' || this.data.glError || this._editing()) return;
    var ts = e.touches;
    if (ts.length === 1 && this._sx !== undefined) {
      var p = this._touchPoint(ts[0]);
      var dx = p.x - this._sx, dy = p.y - this._sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) this._moved = true;
      if (this._moved) {
        if (this._hitIdx >= 0 && this._dragBase) {
          // 命中家具且已拖动：屏幕位移换算为地面世界位移，实时预览（只在内存改模型）
          var d = this._withGL(function (gl) { return gl.dragDelta(dx, dy); }) || { dx: 0, dz: 0 };
          var target = {
            x: this._dragBase.x + d.dx,
            z: this._dragBase.z + d.dz
          };
          var moved = this._withGL(function (gl) { return gl.previewMove(this._hitIdx, target.x, target.z); });
          if (moved) {
            this._dragTo = moved; // 记录最终坐标，抬手落盘
            var row = this._furniture[this._hitIdx];
            if (row) { row.px = moved.x.toFixed(2); row.pz = moved.z.toFixed(2); }
            this.setData({ selected: this._selectedCard(row) });
          }
        } else if (this._hitIdx < 0) {
          // 空白拖动：旋转相机
          this._withGL(function (gl) { return gl.orbit(dx, dy); });
        }
      }
      this._sx = p.x; this._sy = p.y;
      this._safeRender();
    } else if (ts.length === 2 && this._pinch) {
      var d2 = this._dist(ts);
      // 双指张开→放大视图，捏合→缩小视图（不写家具数据）
      this._withGL(function (gl) { return gl.zoom(this._pinch - d2); });
      this._pinch = d2;
      // 双指旋转：有选中家具时旋转它（增量=本帧角度差），只做内存预览，抬手落盘
      var ang = this._angle(ts);
      if (this.data.selected && this._pinchAngle !== undefined) {
        var da = ang - this._pinchAngle;
        // 角度跨越 ±π 时取最短路径，避免跳变
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        var rotIdx = this._findIndexById(this.data.selected.id);
        if (rotIdx >= 0) {
          this._spinTo = (this._spinTo || 0) + da; // 累计旋转弧度，抬手落盘
          this._withGL(function (gl) { return gl.previewRotate(rotIdx, this._spinTo); });
          this._moved = true;
        }
      }
      this._pinchAngle = ang;
      this._safeRender();
    }
  },

  onTouchEnd: function () {
    if (!this._glRenderer || this.data.view !== '3d' || this.data.glError || this._editing()) return;
    if (!this._moved) {
      // 短按家具：选中并打开底部抽屉（业务规则 §3.2）；短按空白：取消选中
      if (this._hitIdx >= 0) { this.selectIndex(this._hitIdx); this.openSheet(); }
      else this.clearSel();
    } else {
      // 拖动/旋转抬手：一次性落盘，写入撤销栈，保持「拖动中不写数据」
      var changed = false;
      if (this._dragTo && this._hitIdx >= 0) {
        var row = this._furniture[this._hitIdx];
        if (row) {
          var gx = Math.round(this._dragTo.x / GRID_M) * GRID_M; // 网格吸附 5cm
          var gz = Math.round(this._dragTo.z / GRID_M) * GRID_M;
          var base = this._dragBase || { x: 0, z: 0 };
          var r = store.transformFurniture(row.id, { type: 'move', dx: gx - base.x, dz: gz - base.z });
          if (r.ok) {
            this._pushUndo(row.id, this._dragBefore); // 撤销栈：回退到本次拖动前
            changed = true;
          }
        }
      }
      if (this._spinTo && this.data.selected) {
        var sr = store.transformFurniture(this.data.selected.id, { type: 'rotate', dr: this._spinTo });
        if (sr.ok) { this._pushUndo(this.data.selected.id, this._spinBefore); changed = true; }
      }
      if (changed) {
        this._syncSceneToGL();
        this.loadData();
      }
    }
    this._sx = this._sy = undefined;
    this._pinch = null; this._pinchAngle = undefined;
    this._hitIdx = -1; this._moved = false;
    this._dragBase = null; this._dragTo = null; this._dragBefore = null;
    this._spinTo = 0; this._spinBefore = null;
  },

  // 撤销栈：记录本次操作前的状态，结构与 undoScene/onBack 一致（id/position/rotation/size）
  _pushUndo: function (id, before) {
    this._undoStack = this._undoStack || [];
    this._undoStack.push({
      id: id,
      position: JSON.parse(JSON.stringify((before && before.position) || { x: 0, y: 0, z: 0 })),
      rotation: (before && before.rotation) || 0,
      size: JSON.parse(JSON.stringify((before && before.size) || { w: 0.6, d: 0.6, h: 0.6 }))
    });
    this.setData({ isDirty: true });
  },

  // ---- V1.3 §5.1 移动：方向按钮，固定步长 5cm，不直接拖动 ----
  moveStep: function (e) {
    var sel = this.data.selected;
    if (!sel || this.data.sceneMode !== 'move') return;
    var dir = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.dir) || '';
    var f = store.getFurniture(sel.id);
    if (!f) return;
    var pos = f.position || { x: 0, y: 0, z: 0 };
    var nx = pos.x || 0, nz = pos.z || 0;
    if (dir === 'left') nx -= MOVE_STEP_M;
    else if (dir === 'right') nx += MOVE_STEP_M;
    else if (dir === 'front') nz -= MOVE_STEP_M;
    else if (dir === 'back') nz += MOVE_STEP_M;
    else return;
    // 地面平面移动，钳制在房间边界内（保留半个家具尺寸，规则同 transformFurniture）
    var room = this._room || {}, halfW = (room.width || 20) / 2, halfD = (room.depth || 20) / 2;
    var sz = f.size || {};
    nx = clampNum(nx, -halfW + (sz.w || 0) / 2, halfW - (sz.w || 0) / 2);
    nz = clampNum(nz, -halfD + (sz.d || 0) / 2, halfD - (sz.d || 0) / 2);
    var r = store.updateFurniture(sel.id, {
      position: { x: Math.round(nx * 100) / 100, y: pos.y || 0, z: Math.round(nz * 100) / 100 }
    });
    if (!r.ok) return;
    this._editChanged = true;
    this._syncSceneToGL();
    this.loadData();
    this._safeRender();
  },

  // ---- V1.3 §5.2 旋转：逆时针 / 顺时针按钮，15° 步长，90° 快捷 ----
  rotateStep: function (e) {
    var sel = this.data.selected;
    if (!sel || this.data.sceneMode !== 'rotate') return;
    var ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    var dir = Number(ds.dir || 0);
    var quick = !!ds.quick;
    if (!dir) return;
    var f = store.getFurniture(sel.id);
    if (!f) return;
    var deg = (f.rotation || 0) * 180 / Math.PI + dir * (quick ? ROT_QUICK_DEG : ROT_STEP_DEG);
    deg = this._normDeg(deg);
    var rad = Math.round((deg * Math.PI / 180) * 10000) / 10000;
    var r = store.updateFurniture(sel.id, { rotation: rad });
    if (!r.ok) return;
    this._editChanged = true;
    this.setData({ curAngle: deg });
    this._syncSceneToGL();
    this.loadData();
    this._safeRender();
  },

  // ---- V1.3 §5.3 尺寸：长宽高输入（cm），应用后写入待保存状态 ----
  onDimInput: function (e) {
    var field = (e.currentTarget.dataset.field) || '';
    var val = e.detail.value;
    if (field === 'l' || field === 'w' || field === 'h') {
      var p = {}; p['dim' + field.toUpperCase()] = val; this.setData(p);
    }
  },
  applyDimension: function () {
    var sel = this.data.selected;
    if (!sel || this.data.sceneMode !== 'dimension') return;
    var l = Number(this.data.dimL), w = Number(this.data.dimW), h = Number(this.data.dimH);
    if (!(l > 0 && w > 0 && h > 0)) {
      wx.showToast({ title: '长宽高须大于 0', icon: 'none' }); return;
    }
    // 产品/技术配置边界：0.1m ~ 12m（与 store.js SIZE_MIN/SIZE_MAX 一致），避免静默变形
    var maxCm = 1200, minCm = 10;
    if (Math.max(l, w, h) > maxCm || Math.min(l, w, h) < minCm) {
      wx.showToast({ title: '尺寸须在 10–1200 cm', icon: 'none' }); return;
    }
    var f = store.getFurniture(sel.id);
    if (!f) return;
    var pos = f.position || { x: 0, y: 0, z: 0 };
    // 底部中心锚点不变：只改 size，position 保持（V1.3 §5.3）
    var r = store.updateFurniture(sel.id, {
      size: {
        w: Math.round(l) / 100, d: Math.round(w) / 100, h: Math.round(h) / 100
      }
    });
    if (!r.ok) return;
    this._editChanged = true;
    this._syncSceneToGL();
    this.loadData();
    this.finishEdit(); // 尺寸「应用」即完成编辑，进入待保存（状态图 DIMENSION --应用尺寸--> 保存/撤销）
    wx.showToast({ title: '尺寸已更新，待保存', icon: 'none' });
  },

  // ---- V1.3 §7 保存 / 撤销 / 离开 ----
  saveScene: function () {
    var self = this;
    if (!this.data.isDirty) { wx.showToast({ title: '暂无待保存修改', icon: 'none' }); return; }
    this.setData({ sceneMode: 'saving' });
    try {
      // 场景编辑已在 store 内存生效；提交即触发落盘（store.updateFurniture 每次改动已 commit，
      // 此处以一次显式保存动作清空 dirty 并更新版本号口径）。
      var ok = true;
      (this._undoStack || []).forEach(function (e) {
        var f = store.getFurniture(e.id);
        if (!f) return;
        var rr = store.updateFurniture(e.id, { position: f.position, rotation: f.rotation, size: f.size });
        if (!rr.ok) ok = false;
      });
      if (!ok) throw new Error('PERSIST_FAILED');
      this._undoStack = [];
      this.setData({ sceneMode: 'selected', isDirty: false });
      this.loadData();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      // 保存失败保留本地草稿，进入 SAVE_ERROR，可重试（V1.3 §7）
      this.setData({ sceneMode: 'saveError' });
      wx.showModal({ title: '保存失败', content: '本地修改已保留，可重试保存或继续编辑。', showCancel: false });
    }
    self._safeRender();
  },
  // 撤销最近一次已完成的家具变更（V1.3 §7：仅撤销最近一次，不做多级时间线）
  undoScene: function () {
    var st = this._undoStack || [];
    if (!st.length) { wx.showToast({ title: '没有可撤销的修改', icon: 'none' }); return; }
    var last = st[st.length - 1];
    var f = store.getFurniture(last.id);
    if (f) store.updateFurniture(last.id, { position: last.position, rotation: last.rotation, size: last.size });
    st.pop();
    this._undoStack = st;
    this._syncSceneToGL(); this.loadData();
    this.setData({ isDirty: st.length > 0 });
    this._safeRender();
    wx.showToast({ title: '已撤销上一次修改', icon: 'none' });
  },
  // dirty 状态离开页面二次确认（V1.3 §7）
  // 由页面导航/返回入口调用；onUnload 无法拦截系统返回，故在离开入口与 onHide 兜底提示。
  onBack: function () {
    var self = this;
    if (!this.data.isDirty) { wx.navigateBack(); return; }
    wx.showModal({
      title: '有未保存的修改', content: '是否保存本次场景修改？',
      confirmText: '保存并离开', cancelText: '放弃修改',
      success: function (res) {
        if (res.confirm) {
          self._undoStack = [];
          self.setData({ isDirty: false });
          wx.navigateBack();
        } else {
          var st = self._undoStack || [];
          if (st.length) {
            var first = st[0], f = store.getFurniture(first.id);
            if (f) store.updateFurniture(first.id, { position: first.position, rotation: first.rotation, size: first.size });
          }
          self._undoStack = [];
          self.setData({ isDirty: false });
          wx.navigateBack();
        }
      }
    });
  },

  // ---- V1.3 §3.1 相机：复位 / 适配 / 视角预设；相机变化不标 dirty ----
  resetView: function () { this._withGL(function (gl) { return gl.reset(); }); this.setData({ cameraPreset: 'isometric' }); this._safeRender(); },
  fitView: function () { this._withGL(function (gl) { return gl.fit(); }); this._safeRender(); },
  setPreset: function (e) {
    var name = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.preset) || 'isometric';
    this._withGL(function (gl) { return gl.setPreset(name); });
    this.setData({ cameraPreset: name });
    this._safeRender();
  },
  // ---- V1.3 §8 家具视图 / 物品视图切换（不改变数据）----
  // canvas 位于 wx:if 块内：切到物品视图会被销毁。必须同步清空渲染器与初始化锁，
  // 否则返回时 _initGL 被 _glRenderer/_glInitStarted 挡住不重建 → 三维空白、触摸选中失效、无法编辑/添加家具。
  _resetGLForHidden: function () {
    this._glRenderer = null;
    this._glCanvas = null;
    this._glInitStarted = false;
  },
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
  _loadSpaceItems: function () {
    // 已进入具体房间，只展示该房间的物品（按 nodes.roomId 聚合），不再混入同空间其他房间/未定位物品。
    // 用户反馈：进主卧却看到客厅/未定位的物品，属口径错误；改为房间级过滤。
    var rid = this.data.roomId || (this._room && this._room.id);
    var list = store.listItems({ roomId: rid }).map(function (it) {
      var node = it.currentNodeId ? store.getNode(it.currentNodeId) : null;
      var owner = node && node.furnitureId ? store.getFurniture(node.furnitureId) : null;
      var iv = store.findInventoryByItem(it.id);
      return {
        id: it.id, name: it.name, photoPath: it.photoPath || '', category: it.category || '',
        thumb: it.photoPath || itemThumb(it),
        qty: iv ? fmtNum(iv.balance) + (iv.unit || '') : '',
        furnitureName: owner ? owner.name : '',
        locText: node ? store.nodePath(it.currentNodeId).join(' / ') : '未设置位置'
      };
    });
    this.setData({ spaceItems: list });
  },
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

  // 拖动后把最新 raw 同步给渲染器（getData 返回 _raw 引用，updateFurniture 已落盘）
  _syncSceneToGL: function () {
    for (var i = 0; i < this._furniture.length; i++) {
      var f = store.getFurniture(this._furniture[i].id);
      if (f) this._furniture[i]._raw = f;
    }
  },

  // 家具根收纳节点：物品绑定到家具即写入该节点（规范 §5.1 家具作为存放位置入口）
  _rootNodeId: function (fid) {
    var nodes = store.listNodes(this.data.roomId).filter(function (n) {
      return n.furnitureId === fid && !n.parentId;
    });
    return nodes.length ? nodes[0].id : '';
  },

  // 添加物品入口：从已有物品中选择 / 新建物品（规范 §5.2）
  chooseAddItem: function () {
    if (!this.data.selected) { wx.showToast({ title: '请先点选家具', icon: 'none' }); return; }
    var self = this;
    wx.showActionSheet({
      itemList: ['从已有物品中选择', '新建物品'],
      success: function (res) {
        if (res.tapIndex === 0) self.openBindPicker();
        else if (res.tapIndex === 1) self.addItemAtFurniture(self.data.selected.id, self.data.activeNodeId);
      }
    });
  },

  // 新建物品：进入建档页并预选当前家具/当前收纳节点（规则 §3.2、§3.3）
  addItemAtFurniture: function (furnitureId, nodeId) {
    // 兼容旧调用传入的家具 id；按钮 bindtap 传事件对象，此时回退到选中家具
    var fid = (typeof furnitureId === 'string' && furnitureId) || (this.data.selected && this.data.selected.id);
    if (!fid) { wx.showToast({ title: '请先选中家具', icon: 'none' }); return; }
    var target = (typeof nodeId === 'string' && nodeId)
      || this.data.activeNodeId
      || this._rootNodeId(fid);
    wx.navigateTo({ url: '/pages/item-edit/item-edit?nodeId=' + target });
  },
  // 抽屉「添加物品」按钮：默认继承当前选中节点
  addItemAtActiveNode: function () {
    this.addItemAtFurniture('', this.data.activeNodeId);
  },

  // 当前家具下的有效目标节点：抽屉里选中了节点则用它，否则回退家具根节点
  _targetNodeId: function (fid) {
    var active = this.data.activeNodeId;
    var nodes = store.listNodes(this.data.roomId).filter(function (n) { return n.furnitureId === fid; });
    if (active && nodes.some(function (n) { return n.id === active; })) return active;
    return this._rootNodeId(fid);
  },

  // 从已有物品中选择：列出未结束档案，点选即绑定/改存放家具（规范 §5.2、§9.7、§9.9）
  openBindPicker: function () {
    var sel = this.data.selected;
    if (!sel) return;
    if (!this._targetNodeId(sel.id)) { wx.showToast({ title: '该家具暂无收纳节点', icon: 'none' }); return; }
    // 绑定面板用 wx:if 替换三维块，canvas 将被销毁：释放引用便于返回时重建
    this._glRenderer = null; this._glCanvas = null; this._glInitStarted = false;
    var fid = sel.id;
    var statusText = { at_home: '在家·位置未知', unknown: '位置未知', out: '外出', borrowed: '借出' };
    var list = store.listItems().map(function (it) {
      var node = it.currentNodeId ? store.getNode(it.currentNodeId) : null;
      var owner = node && node.furnitureId ? store.getFurniture(node.furnitureId) : null;
      return {
        id: it.id, name: it.name,
        locText: it.currentNodeId ? store.nodePath(it.currentNodeId).join(' / ') : (statusText[it.locationStatus] || '未设置'),
        here: !!owner && owner.id === fid
      };
    });
    this.setData({ bindableItems: list, bindTargetName: sel.name, showBindPicker: true });
  },
  closeBindPicker: function () {
    var self = this;
    this.setData({ showBindPicker: false, bindableItems: [] }, function () {
      // canvas 随 wx:if 重建，重新初始化渲染器；失败会自动降级列表
      self._glInitStarted = false;
      setTimeout(function () { self._initGL(); }, 60);
    });
  },
  // 绑定面板内直接新建物品：进入建档页并预选当前收纳节点
  addItemFromPicker: function () {
    var sel = this.data.selected;
    if (!sel) return;
    this.addItemAtFurniture(sel.id, this._targetNodeId(sel.id));
  },
  bindExistingItem: function (e) {
    var id = e.currentTarget.dataset.id;
    var sel = this.data.selected;
    if (!id || !sel) return;
    var nodeId = this._targetNodeId(sel.id);
    if (!nodeId) return;
    var r = store.moveItem(id, { locationStatus: 'at_home', currentNodeId: nodeId });
    if (!r.ok) { wx.showToast({ title: '绑定失败：' + r.error, icon: 'none' }); return; }
    wx.showToast({ title: r.unchanged ? '已在该位置' : '已绑定到「' + sel.name + '」', icon: 'none' });
    this.closeBindPicker();
    this._syncSceneToGL(); this.loadData();
  },

  // 家具模型库：按需展开为抽屉，点选即添加占位家具（规范 §3.1、§4.1）
  toggleLib: function () { this.setData({ showLib: !this.data.showLib }); },
  addFromLib: function (e) {
    var cat = e.currentTarget.dataset.cat;
    if (!cat) return;
    if (!store.getRoom(this.data.roomId)) { wx.showToast({ title: '请先创建房间', icon: 'none' }); return; }
    var count = store.listFurniture(this.data.roomId).filter(function (f) { return f.category === cat; }).length;
    var r = store.addFurniture(this.data.roomId, { category: cat, name: count ? cat + ' ' + (count + 1) : cat });
    if (!r.ok) { wx.showToast({ title: '添加失败：' + r.error, icon: 'none' }); return; }
    this.setData({ showLib: false });
    wx.showToast({ title: '已添加，选中后可用按钮微调', icon: 'success' });
    this.loadData();
  },

  // ---- V1.3 §0/§4「管理」入口：选中后点明确按钮进入家具管理，不用双击 ----
  openManage: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + this.data.selected.id });
  },
  enterMove: function () { this._beginEdit('move'); },
  enterRotate: function () { this._beginEdit('rotate'); },
  enterDimension: function () { this._beginEdit('dimension'); },

  _doRemoveFurniture: function (id) {
    var r = store.removeFurniture(id);
    if (!r.ok) {
      wx.showToast({ title: '删除失败：' + (r.error || '未知'), icon: 'none' });
      return;
    }
    var tip = r.migratedItems > 0 ? ('家具已删除，' + r.migratedItems + ' 件物品转入未放置') : '家具已删除';
    wx.showToast({ title: tip, icon: 'success' });
    if (this.data.selected && this.data.selected.id === id) this.setData({ selected: null, bindings: null });
    this.loadData();
  },
  removeSelected: function () {
    if (!this.data.selected) return;
    this.confirmRemove(this.data.selected.id);
  },
  // 删除确认：明确物品归属不被静默丢失（规范 §4.5）
  confirmRemove: function (id) {
    if (!id) return;
    var self = this;
    var f = store.getFurniture(id);
    var b = store.bindingsOfFurniture(id);
    wx.showModal({
      title: '删除家具',
      content: '确认删除「' + ((f && f.name) || '该家具') + '」？'
        + (b.items.length ? '该家具关联 ' + b.items.length + ' 件物品，删除后这些物品将转入该空间「未放置」区（不会丢失），稍后需你重新指定家具或改为空间直挂。' : '删除后不可恢复。'),
      confirmText: '删除', confirmColor: '#BE5F44',
      success: function (res) { if (res.confirm) self._doRemoveFurniture(id); }
    });
  },

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

  _dist: function (ts) {
    var a = this._touchPoint(ts[0]), b = this._touchPoint(ts[1]);
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  },
  // 双指连线角度（弧度），用于旋转手势；与 _dist 同一对触点
  _angle: function (ts) {
    var a = this._touchPoint(ts[0]), b = this._touchPoint(ts[1]);
    return Math.atan2(b.y - a.y, b.x - a.x);
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

  setView: function (e) {
    var v = e.currentTarget.dataset.v;
    if (v === this.data.view) return;
    if (v === 'list') {
      this._glRenderer = null; this._glCanvas = null; this._glInitStarted = false;
      this.setData({ view: 'list' });
    } else {
      this.setData({ view: '3d' }, this._initGL.bind(this));
    }
  },

  editFurniture: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?id=' + this.data.selected.id });
  },
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
      itemList: ['房间照片', '家具管理', '重命名房间', '归档房间', '删除房间'],
      success: function (res) {
        var i = res.tapIndex;
        if (i === 0) wx.navigateTo({ url: '/pages/photos/photos?id=' + self.data.roomId });
        else if (i === 1) wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?roomId=' + self.data.roomId });
        else if (i === 2) self.renameRoom();
        else if (i === 3) self.archiveRoom();
        else if (i === 4) self.destroyRoom();
      }
    });
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
});
