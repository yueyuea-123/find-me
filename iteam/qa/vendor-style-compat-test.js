// 适配库 canvas.style 兼容性回归测试（纯 Node，无需开发者工具）
// 背景：真机调试出现「三维初始化失败：Cannot redefine property: style」，
// 根因是 threejs-miniprogram 适配库在 createScopedThreejs(canvas) 内对
// canvas.style / clientHeight / clientWidth 强定义属性；真机 canvas 已有
// 不可配置的 style，导致 defineProperty 抛错、渲染器初始化失败。
// 本用例构造与真机一致的 canvas 对象，验证修复后不再抛错。
const path = require('path');
const adapt = require(path.join(__dirname, '..', 'miniprogram', 'package3d', 'vendor', 'threejs-miniprogram.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + ' -> ' + e.message); fail++; }
}
function realDeviceCanvas() {
  const c = { width: 300, height: 200 };
  // 复现真机：style 已存在且不可配置
  Object.defineProperty(c, 'style', { configurable: false, value: {} });
  return c;
}

t('真机条件: 不可配置 style 不抛错', function () {
  const T = adapt.createScopedThreejs(realDeviceCanvas());
  if (!T || typeof T.WebGLRenderer !== 'function') throw new Error('THREE 未正确返回');
});
t('真机条件: style+clientHeight+clientWidth 均不可配置不抛错', function () {
  const c = realDeviceCanvas();
  Object.defineProperty(c, 'clientHeight', { configurable: false, value: 200 });
  Object.defineProperty(c, 'clientWidth', { configurable: false, value: 300 });
  const T = adapt.createScopedThreejs(c);
  if (!T || typeof T.WebGLRenderer !== 'function') throw new Error('THREE 未正确返回');
});
t('重复初始化同一 canvas 不抛错', function () {
  const c = realDeviceCanvas();
  adapt.createScopedThreejs(c);
  adapt.createScopedThreejs(c);
});
t('正常 canvas 仍按预期定义 style', function () {
  const c = { width: 300, height: 200 };
  const T = adapt.createScopedThreejs(c);
  if (typeof c.style.width !== 'string') throw new Error('style 未按预期定义: ' + JSON.stringify(c.style));
  if (!T || typeof T.Scene !== 'function') throw new Error('THREE 缺 Scene');
});

console.log('结果 ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
