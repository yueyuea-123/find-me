// pages/room3d/scene-canvas.js —— SceneCanvas 块（模块化阶段2c 第五迁，八·补9 七块划分）
// GL 初始化与相机控制：canvas 节点获取与重试、package3d 分包异步加载、渲染器创建与挂载、
//   canvas 视口 rect 缓存（分段页滚动补偿）、触摸坐标换算、视角复位/适配/预设、切视图释放。
// 三把渲染锁一律经 gl-lifecycle.js 原语变更（禁令由 qa/renderer-signature-contract-test.js 聚合把关）；
// rendererFactory（package3d/renderer.js 工厂）为本模块单例，随 _load3D 异步赋值。
var glLifecycle = require('./gl-lifecycle.js');

var rendererFactory = null;

var sceneCanvas = {
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
      glLifecycle.beginInit(self); // 加锁：分包异步加载期间不让第二个调用进来
      var canvas = res[0].node;
      glLifecycle.setCanvas(self, canvas);
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
    glLifecycle.attachRenderer(this, r);
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
    glLifecycle.reset(this);
  }
};

module.exports = sceneCanvas;
