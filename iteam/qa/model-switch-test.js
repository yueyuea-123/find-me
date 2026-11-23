/**
 * 三维页换模型 + 家具缩略图修复验证（纯 Node）
 * 覆盖本轮两项修复：
 *   A. room3d 页换模型入口：changeModel 方法 / ActionSheet / store 落库 / BR-009 解耦 / 渲染签名含 model
 *   B. 家具缩略图映射：无专属图的家具不再错误回落整屋图，改由 icon 占位
 * 用法: node qa/model-switch-test.js
 */
const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..', 'miniprogram');
const storage = {};
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  showToast() {}, showLoading() {}, hideLoading() {}, showModal() {},
  showActionSheet: o => { if (o && o.success) o.success({ tapIndex: 1 }); },
  navigateTo() {}, switchTab() {}, redirectTo() {}, reLaunch() {}, navigateBack() {},
  canIUse: () => false, getSystemInfoSync: () => ({ windowWidth: 375 }),
  getLogManager: () => ({ error() {} })
};
const store = require(path.join(MP, 'utils', 'store.js'));
const C = require(path.join(MP, 'utils', 'constants.js'));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}
const read = rel => fs.readFileSync(path.join(MP, rel), 'utf-8');

// ========== A1. 页面入口接线 ==========
const js = read('pages/room3d/room3d.js');
const wxml = read('pages/room3d/room3d.wxml');
ok(js.indexOf('changeModel: function') >= 0, 'room3d 实现 changeModel 方法');
ok(wxml.indexOf('bindtap="changeModel"') >= 0, '操作面板「换模型」按钮已接线');
ok(js.indexOf('wx.showActionSheet') >= 0 && js.indexOf('.vars') >= 0,
  '换模型用 ActionSheet 展示 FURNITURE_LIB.vars 变体');
ok(js.indexOf('store.updateFurniture(f.id, { model: model })') >= 0, '选变体后调用 updateFurniture 落库');

// ========== A2. 数据层落库 + BR-009 解耦 ==========
store.clearAll();
const sp = store.addSpace('测试空间').data;
const room = store.addRoom(sp.id, '测试房间').data;
const fu = store.addFurniture(room.id, { category: '床', name: '测试床' }).data;
const rootNode = store.listNodes(room.id).filter(n => n.furnitureId === fu.id)[0];
const drawer = store.addNode(room.id, rootNode.id, '抽屉', '收纳盒').data;
const item = store.addItem({ name: '放在床里的物品', currentNodeId: drawer.id }).data;
const countBefore = store.bindingsOfFurniture(fu.id).items.length;

const vars = C.FURNITURE_LIB['床'].vars; // ['米色床品','灰色床品']
const newModel = vars.filter(m => m !== fu.model)[0] || vars[0];
const r = store.updateFurniture(fu.id, { model: newModel });
ok(r.ok && store.getFurniture(fu.id).model === newModel, 'updateFurniture 写入新外观模型');
const countAfter = store.bindingsOfFurniture(fu.id).items.length;
ok(countBefore === countAfter && countAfter === 1, '换模型后绑定物品数不变（BR-009 解耦）');
ok(store.getItem(item.id).currentNodeId === drawer.id, '换模型后物品收纳位置不变');

// ========== A3. 渲染器签名含 model（换模型触发三维重建） ==========
const renderer = read('package3d/renderer.js');
ok(renderer.indexOf("(f.model || '')") >= 0, '渲染器 signature 纳入 model 字段（换模型会重建）');
ok(renderer.indexOf('function variantColor') >= 0 && renderer.indexOf('MODEL_VARIANT_COLORS') >= 0,
  '渲染器实现外观变体着色');
ok(renderer.indexOf('isTintable') >= 0 && renderer.indexOf('o.material = o.material.clone()') >= 0,
  '变体着色 clone 材质，不污染共享 GLB 模板');
ok(renderer.indexOf('if (idx <= 0) return null') >= 0, '首个变体保持原色，不覆写 GLB 原生材质');

// ========== B. 缩略图映射 ==========
// 抽取 furnitureThumb 函数体做行为验证（避免整文件 require 依赖 THREE/wx 渲染）
const m = js.match(/function furnitureThumb\(f\) \{[\s\S]*?\n\}/);
ok(!!m, '能定位 furnitureThumb 函数');
if (m) {
  const fnSrc = m[0];
  const codeLines = fnSrc.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n');
  ok(codeLines.indexOf('home_isometric.jpg') < 0, 'furnitureThumb 不再回落整屋图 home_isometric.jpg');
  // 注入 HIFI_ROOT 常量后在隔离作用域执行
  const HIFI_ROOT = '/images/hifi/';
  const furnitureThumb = new Function('HIFI_ROOT', 'return (' + fnSrc.replace('function furnitureThumb', 'function') + ')')(HIFI_ROOT);
  ok(furnitureThumb({ name: '双人床', category: '床' }) === '', '双人床返回空（走 icon 占位）');
  ok(furnitureThumb({ name: '落地窗', category: '窗帘' }) === '', '落地窗返回空（走 icon 占位）');
  ok(furnitureThumb({ name: '床头柜', category: '床头柜' }) === '', '床头柜返回空（不再误匹配书柜图）');
  ok(/sofa\.jpg/.test(furnitureThumb({ name: '三人沙发', category: '沙发' })), '沙发仍用专属缩略图');
  ok(/tv_console\.jpg/.test(furnitureThumb({ name: '电视柜', category: '电视柜' })), '电视柜仍用专属缩略图');
}
ok(wxml.indexOf('hifi-card-icon') >= 0 && wxml.indexOf('{{item.icon}}') >= 0,
  'WXML 用 icon 占位替代错误缩略图');

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
