// pages/room3d/room3d.js —— 三维房间页 UI-006（内嵌三维视图窗口 + 列表降级）
// 布局对齐 demo pRoom3d：segbar → 三维视图窗口（红框）→ 选中家具卡 → 家具模型库
// 三维渲染来自 package3d 分包（Three.js r108 + GLB 资产），按需引入
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');
var rendererFactory = null;
function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// 尺寸展示：保留两位小数并去掉无意义的尾随 0，避免缩放后出现长串小数
function fmtNum(v) { return String(Math.round((Number(v) || 0) * 100) / 100); }

Page({
  data: {
    roomId: '', roomName: '', dimText: '', mode: 'browse', view: '3d',
    furniture: [], selected: null, glError: '',
    bindings: null, // CR-001 F-03：当前选中模型的关联物品汇总
    // 模式1：浏览/编辑/收纳严格分权，提示随模式切换
    hint: '点选查看家具 · 拖动空白旋转视角 · 双指缩放',
    // 说明：编辑模式手势见 HINTS.edit —— 单指拖动移动、双指捏合缩放、双指扭转旋转、长按删除
    lib: (C.FURNITURE_CATEGORIES || []).map(function (k) {
      return { key: k, icon: (C.FURNITURE_LIB[k] || {}).icon || '▣' };
    })
  },

  // 三种模式的窗口内提示（模式1）
  HINTS: {
    browse: '点选查看家具 · 拖动空白旋转视角 · 双指缩放',
    edit: '单指拖动移动 · 双指捏合缩放 / 扭转旋转 · 长按删除',
    store: '点家具进入收纳节点，拖动空白旋转视角'
  },

  onLoad: function (q) { this.setData({ roomId: q.id || '' }); },
  onShow: function () {
    this.loadData();
    // canvas 位于 wx:if 块内，onReady 时可能未挂载；onShow 后补一次初始化（带重试）
    var self = this;
    setTimeout(function () { self._initGL(); }, 60);
  },
  onUnload: function () { this._clearLongPress(); this._glRenderer = null; this._glInitStarted = false; },
  // 分段页面可滚动：canvas 位置随滚动变化，重新取 rect 供触摸坐标换算
  onPageScroll: function () { this._syncCanvasRect(); },

  // 绑定汇总补展示名（store 只回 items，展示用 itemNames 在此组装，不改数据层）
  _decorateBindings: function (furnitureId) {
    if (!furnitureId) return null;
    var b = store.bindingsOfFurniture(furnitureId);
    b.itemNames = (b.items || []).map(function (it) { return it.name; }).join('、');
    return b;
  },

  loadData: function () {
    var room = store.getRoom(this.data.roomId);
    if (!room) { wx.showToast({ title: '房间不存在', icon: 'none' }); return; }
    var list = store.listFurniture(this.data.roomId).map(function (f) {
      var lib = C.FURNITURE_LIB[f.category] || {};
      return {
        id: f.id, name: f.name, category: f.category, icon: lib.icon || '▣',
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
    // 选中态默认第一件家具；短按建档后仍保持选中
    var selected = this.data.selected, selRow = null;
    if (selected) {
      for (var si = 0; si < list.length; si++) if (list[si].id === selected.id) { selRow = list[si]; break; }
    }
    if (!selRow && list.length) selRow = list[0];
    var dim = room.calibrated ? (room.width + '×' + room.depth + '×' + room.height + ' m') : '尺寸未定标（相对估算）';
    this.setData({
      roomName: room.name, dimText: dim, furniture: list,
      selected: selRow ? {
        id: selRow.id, name: selRow.name, px: selRow.px, pz: selRow.pz,
        rot: selRow.rot, sz: selRow.sz, status: selRow.status
      } : null,
      bindings: this._decorateBindings(selRow ? selRow.id : '')
    });
    // 同步选中态到渲染器：高亮环与卡片选中态一致
    this._syncSelectionToGL();
    this._safeRender();
  },

  _syncSelectionToGL: function () {
    var sel = this.data.selected;
    if (!sel || !this._glRenderer) return;
    for (var i = 0; i < this._furniture.length; i++) {
      if (this._furniture[i].id === sel.id) { this._safeGL('setSelected', [i]); return; }
    }
  },

  _safeGL: function (fn, args) {
    if (!this._glRenderer || typeof this._glRenderer[fn] !== 'function') return null;
    try { return this._glRenderer[fn].apply(this._glRenderer, args || []); }
    catch (e) {
      this._glRenderer = null;
      this.setData({ glError: '三维渲染异常，已切换列表', view: 'list' });
      return null;
    }
  },
  _safeRender: function () { if (this.data.view === '3d' && !this.data.glError) this._safeGL('render'); },

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
        // 节点还没渲染出来（wx:if 延迟）：短暂重试，不急着降级
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
    var r = rendererFactory.createRoomRenderer(canvas, getScene);
    if (!r.ok) {
      this.setData({ glError: r.error === 'WEBGL_UNAVAILABLE' ? '设备不支持 WebGL' : ('三维初始化失败：' + r.message), view: 'list' });
      return;
    }
    canvas.width = Math.max(1, Math.floor(sizeInfo.width));
    canvas.height = Math.max(1, Math.floor(sizeInfo.height));
    r.resize(canvas.width, canvas.height);
    this._glRenderer = r;
    // 渲染器就绪后立刻取真实窗口偏移，保证首屏首次拾取/拖动也准确
    this._syncCanvasRect();
    this._syncSelectionToGL();
    this._safeRender();
  },

  // 触摸坐标 → canvas 内坐标（减去窗口偏移）
  _canvasXY: function (touch) {
    var rect = this._glRect || { left: 0, top: 0 };
    return { x: touch.x - rect.left, y: touch.y - rect.top };
  },

  // 模式1：浏览/编辑/收纳严格分权
  //  浏览：点选家具=选中；拖空白=旋转视角；双指=缩放视角
  //  编辑：单指拖家具=移动（跟手预览、抬手落盘）；双指捏合=缩放家具；双指扭转=旋转家具；长按家具=删除确认
  //  收纳：点家具=进入该家具收纳节点；拖空白=旋转视角
  onTouchStart: function (e) {
    if (!this._glRenderer || this.data.view !== '3d' || this.data.glError) return;
    this._syncCanvasRect();
    var ts = e.touches, self = this;
    if (ts.length === 1) {
      var p = this._canvasXY(ts[0]);
      var idx = this._safeGL('pick', [p.x, p.y]);
      var hit = (idx !== null && idx >= 0 && this._furniture[idx]);
      this._sx = ts[0].x; this._sy = ts[0].y;
      this._moved = false; this._lpFired = false;
      this._hitIdx = hit ? idx : -1;
      this._dragFid = hit ? this._furniture[idx].id : '';
      // 命中即选中（浏览/编辑）；收纳模式不强行改选中态
      if (hit && this.data.mode !== 'store' && (!this.data.selected || this.data.selected.id !== this._dragFid)) {
        this.selectIndex(idx);
      }
      // 仅编辑模式：长按家具 → 删除确认
      this._clearLongPress();
      if (hit && this.data.mode === 'edit') {
        this._lpTimer = setTimeout(function () {
          if (self._moved || !self._glRenderer || self.data.view !== '3d' || !self._dragFid) return;
          self._lpFired = true;
          self.confirmRemove(self._dragFid);
        }, 600);
      }
    } else if (ts.length === 2) {
      // 编辑模式：双指捏合缩放 + 扭转旋转选中家具；其他模式只缩放视角
      this._pinch = this._dist(ts);
      this._pinchAngle = this._angle(ts);
      if (this.data.mode === 'edit' && this.data.selected) {
        var rawSel = store.getFurniture(this.data.selected.id);
        this._scaleBase = this.data.selected;                       // 起始卡片尺寸（含 sz 文本）
        this._rotBase = rawSel ? (rawSel.rotation || 0) : 0;        // 起始朝向（弧度）
        this._sizeBase = rawSel && rawSel.size ? {
          w: rawSel.size.w, h: rawSel.size.h, d: rawSel.size.d
        } : null;
        this._twistFid = this.data.selected.id;
        this._twistIdx = this._findIndexById(this._twistFid);
      } else {
        this._scaleBase = null; this._sizeBase = null; this._twistFid = ''; this._twistIdx = -1;
      }
      this._moved = true; this._dragFid = '';
      this._clearLongPress();
    }
  },
  _clearLongPress: function () { if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; } },
  // 两指连线与屏幕 X 轴夹角（弧度）
  _angle: function (ts) { return Math.atan2(ts[1].y - ts[0].y, ts[1].x - ts[0].x); },
  _findIndexById: function (id) {
    for (var i = 0; i < this._furniture.length; i++) if (this._furniture[i].id === id) return i;
    return -1;
  },

  onTouchMove: function (e) {
    if (!this._glRenderer || this.data.view !== '3d' || this.data.glError) return;
    var ts = e.touches;
    if (ts.length === 1 && this._sx !== undefined) {
      var dx = ts[0].x - this._sx, dy = ts[0].y - this._sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) { this._moved = true; this._clearLongPress(); }
      if (this._moved && this._dragFid && this.data.mode === 'edit') {
        // 编辑模式拖家具：累计像素位移一次换算成地面世界位移，内存预览不落盘
        if (!this._dragPx) this._dragPx = { x: 0, y: 0 };
        this._dragPx.x += dx; this._dragPx.y += dy;
        var w = this._safeGL('dragDelta', [this._dragPx.x, this._dragPx.y]);
        var f = store.getFurniture(this._dragFid);
        if (w && f) {
          var target = {
            x: (f.position.x || 0) + w.dx,
            z: (f.position.z || 0) + w.dz
          };
          // previewMove 是基于 f 当前位置增量换算的，这里用世界位移直接落到目标
          var pos = this._safeGL('previewMove', [this._hitIdx, target.x, target.z]);
          if (pos) {
            this._previewPos = pos;
            // 浮标实时显示坐标（不写库）
            this.setData({
              selected: this.data.selected ? Object.assign({}, this.data.selected, {
                px: pos.x.toFixed(2), pz: pos.z.toFixed(2)
              }) : null
            });
          }
        }
      } else if (this.data.mode === 'edit' && this.data.selected) {
        // 编辑模式拖空白：平移视角
        this._safeGL('pan', [dx, dy]);
      } else {
        // 浏览/收纳：旋转视角
        this._safeGL('orbit', [dx, dy]);
      }
      this._sx = ts[0].x; this._sy = ts[0].y;
      this._safeRender();
    } else if (ts.length === 2 && this._pinch) {
      var d = this._dist(ts);
      var delta = this._pinch - d;
      if (this.data.mode === 'edit' && this._sizeBase && this._twistFid) {
        // 编辑双指：捏合按比例缩放 + 扭转改朝向，均只在内存预览，抬手一次性落盘
        var factor = clampNum(delta * 0.004, -0.5, 0.5);
        var size = {
          w: clampNum(this._sizeBase.w * (1 + factor), 0.2, 4),
          h: clampNum(this._sizeBase.h * (1 + factor), 0.2, 4),
          d: clampNum(this._sizeBase.d * (1 + factor), 0.2, 4)
        };
        var rot = this._rotBase + this._angleDelta(ts);
        // 预览尺寸：直接写 group.scale，不改 _raw（signature 不变 → 不重建实例）
        this._safeGL('previewScale', [this._twistIdx, size]);
        this._safeGL('previewRotate', [this._twistIdx, rot]);
        this._previewSize = size; this._previewRot = rot;
        // 卡片实时反映预览值
        this.setData({ selected: Object.assign({}, this.data.selected, {
          rot: Math.round(rot * 180 / Math.PI),
          sz: fmtNum(size.w) + '×' + fmtNum(size.d) + '×' + fmtNum(size.h)
        }) });
      } else {
        this._safeGL('zoom', [delta]);
      }
      this._pinch = d;
      this._safeRender();
    }
  },
  // 相对起始的扭转角（归一化到 -π ~ π，避免跨 ±π 跳变）
  _angleDelta: function (ts) {
    if (this._pinchAngle === undefined) return 0;
    var da = this._angle(ts) - this._pinchAngle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    return da;
  },

  onTouchEnd: function () {
    this._clearLongPress();
    if (!this._glRenderer || this.data.view !== '3d' || this.data.glError) return;
    if (this._moved && this._dragFid && this.data.mode === 'edit' && this._previewPos) {
      // 抬手一次性落盘：用预览得到的最终坐标作为绝对位置写入
      var f = store.getFurniture(this._dragFid);
      if (f) store.updateFurniture(this._dragFid, {
        position: { x: this._previewPos.x, y: f.position.y || 0, z: this._previewPos.z }
      });
      wx.showToast({ title: '位置已保存', icon: 'none' });
      this._syncSceneToGL(); this.loadData();
    } else if (this._previewSize || this._previewRot !== undefined) {
      // 双指捏合/扭转抬手：尺寸与朝向一次性落盘
      if (this._twistFid) {
        var patch = {};
        if (this._previewSize) patch.size = this._previewSize;
        if (this._previewRot !== undefined) patch.rotation = this._previewRot;
        if (patch.size || patch.rotation !== undefined) {
          store.updateFurniture(this._twistFid, patch);
          wx.showToast({ title: '已保存', icon: 'none' });
          this._syncSceneToGL(); this.loadData();
        }
      }
    } else if (!this._moved && !this._lpFired && this._sx !== undefined && this._hitIdx >= 0) {
      // 短按：浏览/编辑=仅选中（已在 touchstart 完成）；收纳=进入该家具收纳节点
      if (this.data.mode === 'store') this.goFurnitureNodes(this._furniture[this._hitIdx].id);
    }
    this._sx = this._sy = undefined;
    this._pinch = null; this._pinchAngle = undefined; this._lpFired = false; this._dragFid = '';
    this._hitIdx = -1; this._dragPx = null; this._previewPos = null;
    this._scaleBase = null; this._sizeBase = null; this._rotBase = 0;
    this._previewSize = null; this._previewRot = undefined; this._twistFid = ''; this._twistIdx = -1;
  },

  // 拖动后把最新 raw 同步给渲染器（getData 返回 _raw 引用，updateFurniture 已落盘）
  _syncSceneToGL: function () {
    for (var i = 0; i < this._furniture.length; i++) {
      var f = store.getFurniture(this._furniture[i].id);
      if (f) this._furniture[i]._raw = f;
    }
  },

  // 为当前选中家具建档物品：bindtap 传的是事件对象，家具以选中态为准，避免误用事件对象当 id
  addItemAtFurniture: function (furnitureId) {
    // 兼容短按旧调用传入的家具 id；按钮 bindtap 传事件对象，此时回退到选中家具
    var fid = (typeof furnitureId === 'string' && furnitureId) || (this.data.selected && this.data.selected.id);
    if (!fid) { wx.showToast({ title: '请先选中家具', icon: 'none' }); return; }
    if (!fid) { wx.showToast({ title: '请先选中家具', icon: 'none' }); return; }
    var nodes = store.listNodes(this.data.roomId).filter(function (n) {
      return n.furnitureId === fid && !n.parentId;
    });
    var nodeId = nodes.length ? nodes[0].id : '';
    wx.navigateTo({ url: '/pages/item-edit/item-edit?nodeId=' + nodeId });
  },

  _syncSelectedRaw: function () {
    var sel = this.data.selected;
    if (!sel) return;
    var f = store.getFurniture(sel.id);
    var row = null;
    for (var i = 0; i < this._furniture.length; i++) if (this._furniture[i].id === sel.id) { row = this._furniture[i]; break; }
    if (f && row) {
      row._raw = f;
      row.px = (f.position.x || 0).toFixed(2);
      row.pz = (f.position.z || 0).toFixed(2);
      row.rot = Math.round((f.rotation || 0) * 180 / Math.PI);
    }
  },
  _refreshSelectedCard: function () {
    var sel = this.data.selected, row = null;
    if (!sel) return;
    for (var i = 0; i < this._furniture.length; i++) if (this._furniture[i].id === sel.id) { row = this._furniture[i]; break; }
    if (row) this.setData({ selected: {
      id: row.id, name: row.name, px: row.px, pz: row.pz, rot: row.rot, sz: row.sz, status: row.status
    }, furniture: this._furniture });
  },

  addFromLib: function (e) {
    var cat = e.currentTarget.dataset.cat;
    if (!cat) return;
    if (!store.getRoom(this.data.roomId)) { wx.showToast({ title: '请先创建房间', icon: 'none' }); return; }
    var count = store.listFurniture(this.data.roomId).filter(function (f) { return f.category === cat; }).length;
    var r = store.addFurniture(this.data.roomId, { category: cat, name: count ? cat + ' ' + (count + 1) : cat });
    if (!r.ok) { wx.showToast({ title: '添加失败：' + r.error, icon: 'none' }); return; }
    wx.showToast({ title: '已添加，可拖动摆放', icon: 'success' });
    this.loadData();
  },

  _doRemoveFurniture: function (id) {
    var r = store.removeFurniture(id);
    if (!r.ok) {
      if (r.error === 'HAS_LINKS') {
        wx.showModal({ title: '无法删除', content: '已被关联：' + r.items
          + ' 件物品 / ' + r.childNodes + ' 个节点，须先迁移或归档', showCancel: false });
      } else wx.showToast({ title: '删除失败：' + r.error, icon: 'none' });
      return;
    }
    wx.showToast({ title: '家具已删除', icon: 'success' });
    if (this.data.selected && this.data.selected.id === id) this.setData({ selected: null, bindings: null });
    this.loadData();
  },
  removeSelected: function () {
    if (!this.data.selected) return;
    this.confirmRemove(this.data.selected.id);
  },
  // 长按/按钮删除统一走二次确认（关联保护仍由数据层负责）
  confirmRemove: function (id) {
    if (!id) return;
    var self = this;
    var f = store.getFurniture(id);
    wx.showModal({
      title: '删除家具',
      content: '确认删除「' + ((f && f.name) || '该家具') + '」？删除后不可恢复；已关联节点或物品时会被阻断。',
      confirmText: '删除', confirmColor: '#BE5F44',
      success: function (res) { if (res.confirm) self._doRemoveFurniture(id); }
    });
  },
  // 收纳模式：点家具直接进入其收纳节点详情
  goFurnitureNodes: function (furnitureId) {
    if (!furnitureId) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + furnitureId });
  },

  _dist: function (ts) {
    var dx = ts[0].x - ts[1].x, dy = ts[0].y - ts[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  selectIndex: function (idx) {
    var f = this._furniture[idx];
    if (!f) return;
    this._safeGL('setSelected', [idx]);
    this.setData({
      selected: { id: f.id, name: f.name, px: f.px, pz: f.pz, rot: f.rot, sz: f.sz, status: f.status },
      bindings: this._decorateBindings(f.id)
    });
  },
  selectFromList: function (e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + id });
  },
  clearSel: function () {
    this._safeGL('setSelected', [-1]);
    this.setData({ selected: null, bindings: null });
    this._safeRender();
  },

  setMode: function (e) {
    var m = e.currentTarget.dataset.m;
    this.setData({ mode: m, hint: this.HINTS[m] || this.HINTS.browse });
  },
  setView: function (e) {
    var v = e.currentTarget.dataset.v;
    if (v === this.data.view) return;
    if (v === 'list') {
      // canvas 将被 wx:if 销毁，释放旧渲染器引用；切回时重建
      this._glRenderer = null; this._glCanvas = null; this._glInitStarted = false;
      this.setData({ view: 'list' });
    } else {
      this.setData({ view: '3d' }, this._initGL.bind(this));
    }
  },
  resetView: function () { this._safeGL('reset'); this._safeRender(); },

  editFurniture: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-edit/furniture-edit?id=' + this.data.selected.id });
  },
  goNodes: function () {
    if (!this.data.selected) return;
    wx.navigateTo({ url: '/pages/furniture-detail/furniture-detail?id=' + this.data.selected.id });
  },
  goItemDetail: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/item-detail/item-detail?id=' + id });
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
