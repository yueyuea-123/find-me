// pages/room3d/gl-lifecycle.js —— GLLifecycle 渲染锁管理器（模块化阶段2d，评估报告 3D-03）
// 三把锁：_glRenderer（渲染器实例）/ _glCanvas（canvas 节点）/ _glInitStarted（初始化互斥）。
// 历史缺陷（项目档案 §八·补5）：canvas 位于 wx:if 三维块内，切物品视图/绑定面板/列表时被销毁，
// 若只清部分锁，返回时 _initGL 被旧锁挡住不重建 → 三维空白、触摸选中失效、无法编辑/添加家具。
// 立法：room3d 页禁止直接赋值三把锁，一切变更必须经本模块；后续七模块拆分时本文件即 GLLifecycle 模块。
var glLifecycle = {
  // 全量复位（三锁齐清）：canvas 即将销毁（切列表/物品视图/绑定面板）或页面卸载或渲染异常降级时调用；
  // 返回三维后由 _initGL 按锁重建。
  reset: function (page) {
    page._glRenderer = null;
    page._glCanvas = null;
    page._glInitStarted = false;
  },
  // 仅解锁初始化互斥：canvas 重建回调（closeBindPicker）里调用，随后 _initGL 重新进入
  unlockInit: function (page) { page._glInitStarted = false; },
  // 分包异步加载前加初始化互斥锁（防止 onReady/onShow 双重初始化）
  beginInit: function (page) { page._glInitStarted = true; },
  // 记录 canvas 节点（selectorQuery 取得后）
  setCanvas: function (page, canvas) { page._glCanvas = canvas; },
  // 渲染器就绪挂载（createRoomRenderer 成功后）
  attachRenderer: function (page, renderer) { page._glRenderer = renderer; }
};
module.exports = glLifecycle;
