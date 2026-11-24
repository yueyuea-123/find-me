// pages/room3d/transform-controller.js —— TransformController 块（模块化阶段2c 第六迁/最后一块，八·补9 七块划分）
// 编辑状态机、手势与落盘：V1.3 §5 编辑子模式（移动 5cm/旋转 15°/尺寸 10–1200cm）+ §6 状态机工具
//   + §7 保存/撤销/离开 + §4.5 删除确认；手势状态机 onTouchStart/onTouchMove/onTouchEnd
//   （V1.4：直接拖拽跟手预览、抬手落盘、5cm 网格吸附、双指缩放旋转、短按选中开抽屉）。
// _editBase/_editChanged/_undoStack/_dragBase/_hitIdx/_pinch 等编辑与手势状态仍挂在页面实例（this）上；
// 渲染器调用一律走页面基底 _withGL（显式引用，qa/renderer-signature-contract-test.js 聚合把关）；
// 共享纯函数 clampNum/fmtNum 走 ./helpers.js。
var store = require('../../utils/store.js');
var helpers = require('./helpers.js');
var clampNum = helpers.clampNum;
var fmtNum = helpers.fmtNum;

// V1.3 §5.1/§5.2：首版步长固定 5cm、旋转 15°（90° 快捷）
var MOVE_STEP_M = 0.05;   // 5cm，米
var GRID_M = 0.05;        // 拖动落盘网格吸附步长 5cm，与按钮步进一致
var ROT_STEP_DEG = 15;    // 度
var ROT_QUICK_DEG = 90;   // 快捷旋转

var transformController = {
  // 常量随导出对象附在 Page 上（页面 data.rotStepDeg 引用）
  MOVE_STEP_M: MOVE_STEP_M,
  GRID_M: GRID_M,
  ROT_STEP_DEG: ROT_STEP_DEG,
  ROT_QUICK_DEG: ROT_QUICK_DEG,

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

  // 双指间距（px），用于缩放手势
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

  // ---- 编辑入口与删除（V1.3 §0/§4 管理；§4.5 删除确认物品去向）----
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
  }
};

module.exports = transformController;
