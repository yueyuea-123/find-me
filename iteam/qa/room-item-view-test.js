/**
 * 三维房间「物品视图」口径与导航修复验证（纯 Node）
 * 覆盖本轮三项用户反馈修复：
 *   1. 进入房间后物品按「当前房间」展示（原按整个空间，混入其他房间/未定位物品）
 *   2. 物品视图补「返回房间」入口（原只能回主页，成死胡同）
 *   3. 物品视图补「添加家具」入口（原按钮在三维 dock，物品视图不可见，点了没反应）
 * 用法: node qa/room-item-view-test.js
 */
const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..', 'miniprogram');
const storage = {};
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: 0, limitSize: 10240 }),
  showToast() {}, showLoading() {}, hideLoading() {}, showModal() {}, showActionSheet() {},
  navigateTo() {}, switchTab() {}, redirectTo() {}, reLaunch() {}, navigateBack() {},
  createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, boundingClientRect() { return this; }, exec(cb) { cb && cb([{}]); } }),
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
// 阶段2c 起 room3d 页代码按块拆到同目录模块（mixin 合并进 Page）：
// 读 room3d 下任一 .js 时聚合该目录全部 .js，拆分不漏检。
const read = rel => {
  if (/^pages\/room3d\/[^/]+\.js$/.test(rel)) {
    const dir = path.join(MP, 'pages', 'room3d');
    return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()
      .map(f => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n');
  }
  return fs.readFileSync(path.join(MP, rel), 'utf-8');
};

// ========== 1. 静态接线：两个新入口 + 文案口径 ==========
const js = read('pages/room3d/room3d.js');
const wxml = read('pages/room3d/room3d.wxml');
const wxss = read('pages/room3d/room3d.wxss');
ok(js.indexOf('backToRoom: function') >= 0, 'room3d 实现 backToRoom 方法');
ok(js.indexOf('addFurnitureFromItemView: function') >= 0, 'room3d 实现 addFurnitureFromItemView 方法');
ok(wxml.indexOf('bindtap="backToRoom"') >= 0, '物品视图「返回房间」按钮已接线');
ok(wxml.indexOf('bindtap="addFurnitureFromItemView"') >= 0, '物品视图「添加家具」按钮已接线');
ok(wxml.indexOf('hifi-itemops') >= 0 && wxss.indexOf('.hifi-itemops') >= 0, '操作条结构 + 样式到位');
ok(wxml.indexOf('搜索当前空间物品') < 0, '搜索框文案不再写「当前空间」');
ok(js.indexOf("store.listItems({ roomId: rid })") >= 0, '_loadSpaceItems 改用 roomId 过滤');
ok(js.indexOf('_resetGLForHidden: function') >= 0, '存在 _resetGLForHidden 释放渲染器');
ok(js.indexOf('this._resetGLForHidden();') >= 0, '切物品视图时调用渲染器释放');
ok(js.indexOf("self.data.viewTab === 'furniture' && self.data.view === '3d'") >= 0,
  'onShow 仅在家具三维视图补初始化（防详情页返回降级 list）');

// ========== 2. 真实数据层：按房间 vs 按空间的差异 ==========
store.clearAll();
const sp = store.addSpace('测试空间').data;
const roomA = store.addRoom(sp.id, '主卧').data;
const roomB = store.addRoom(sp.id, '客厅').data;

// 主卧：床 + 抽屉节点 + 2 件物品
const bed = store.addFurniture(roomA.id, { category: '床', name: '双人床' }).data;
const bedRoot = store.listNodes(roomA.id).filter(n => n.furnitureId === bed.id)[0];
const drawer = store.addNode(roomA.id, bedRoot.id, '抽屉', '收纳盒').data;
const itemA1 = store.addItem({ name: '主卧物品1', currentNodeId: bedRoot.id }).data;
const itemA2 = store.addItem({ name: '主卧物品2', currentNodeId: drawer.id }).data;

// 客厅：沙发 + 1 件物品
const sofa = store.addFurniture(roomB.id, { category: '沙发', name: '沙发' }).data;
const sofaRoot = store.listNodes(roomB.id).filter(n => n.furnitureId === sofa.id)[0];
const itemB1 = store.addItem({ name: '客厅物品', currentNodeId: sofaRoot.id }).data;

// 未定位物品（无 currentNodeId）—— 原实现会被算进空间物品
const orphan = store.addItem({ name: '未定位物品' }).data;

const spaceList = store.listItems({ spaceId: sp.id });
const roomAList = store.listItems({ roomId: roomA.id });
ok(spaceList.length === 4, '空间口径含全部 4 件（含客厅/未定位）', '实际 ' + spaceList.length);
ok(roomAList.length === 2, '房间口径主卧仅 2 件', '实际 ' + roomAList.length);
ok(roomAList.every(it => it.currentNodeId && [bedRoot.id, drawer.id].indexOf(it.currentNodeId) >= 0),
  '房间口径结果都落在主卧的收纳节点上');
ok(!roomAList.some(it => it.id === itemB1.id), '房间口径排除其他房间物品');
ok(!roomAList.some(it => it.id === orphan.id), '房间口径排除未定位物品');

// ========== 3. 页面方法执行：切换视图状态正确 ==========
const def = (() => {
  let pageDef = null;
  const RealPage = global.Page;
  global.Page = o => { pageDef = o; };
  delete require.cache[require.resolve(path.join(MP, 'pages', 'room3d', 'room3d.js'))];
  require(path.join(MP, 'pages', 'room3d', 'room3d.js'));
  global.Page = RealPage;
  return pageDef;
})();
ok(!!def, 'room3d 页面定义可加载');

let initGLCalls = 0;
function makePage() {
  const p = Object.assign({}, def);
  p.data = Object.assign({}, JSON.parse(JSON.stringify(def.data)));
  p.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
  p._initGL = function () { initGLCalls++; };
  p.onLoad({ id: roomA.id });
  p.loadData();
  return p;
}

// 从家具视图切到物品视图：加载的是主卧物品
const p = makePage();
p.switchViewTab({ currentTarget: { dataset: { tab: 'item' } } });
ok(p.data.viewTab === 'item' && p.data.sceneMode === 'itemView', '切到物品视图');
ok(p.data.spaceItems.length === 2, '物品视图按房间加载 2 件', '实际 ' + p.data.spaceItems.length);
ok(p.data.spaceItems.every(it => [itemA1.id, itemA2.id].indexOf(it.id) >= 0), '物品视图不含客厅/未定位物品');

// ===== 渲染器锁：切物品视图释放，返回时重建（用户反馈返回后无三维/无法编辑的根因）=====
const pGL = makePage();
pGL._glRenderer = { render() {} };
pGL._glCanvas = {};
pGL._glInitStarted = true;
pGL.switchViewTab({ currentTarget: { dataset: { tab: 'item' } } });
ok(pGL._glRenderer === null && pGL._glCanvas === null && pGL._glInitStarted === false,
  '切到物品视图清空渲染器与初始化锁');
const beforeGL = initGLCalls;
pGL.backToRoom();
ok(pGL.data.viewTab === 'furniture' && initGLCalls === beforeGL + 1,
  '返回房间触发 _initGL 重建三维（锁已释放）');

// 返回房间：切回家具视图 + view=3d 由渲染重挂负责
p.backToRoom();
ok(p.data.viewTab === 'furniture' && p.data.sceneMode === 'view', '返回房间切回家具视图');

// 添加家具：切回家具视图并展开模型库
p.addFurnitureFromItemView();
ok(p.data.viewTab === 'furniture' && p.data.showLib === true, '添加家具入口展开模型库（而非无反应）');

// ========== 4. 家具类别齐全：15 种全部可选且渲染器/资产有映射 ==========
const cats = C.FURNITURE_CATEGORIES;
const libKeys = Object.keys(C.FURNITURE_LIB);
ok(cats.length === 15, '家具类别补齐为 15 种', '实际 ' + cats.length);
ok(libKeys.every(k => cats.indexOf(k) >= 0), 'FURNITURE_LIB 全部 15 种都进入可选类别');
['软包椅', '躺椅', '餐桌', '椅子'].forEach(k => {
  ok(cats.indexOf(k) >= 0, '新增可选类别：' + k);
});
ok(def.data.lib.length === 15, '页面模型库 lib 覆盖 15 种', '实际 ' + def.data.lib.length);
const rendererSrc = fs.readFileSync(path.join(MP, 'package3d', 'renderer.js'), 'utf-8');
const modeledCats = ['床', '床头柜', '软包椅', '躺椅', '沙发', '茶几', '电视柜', '衣柜', '餐桌', '椅子', '书架', '收纳盒', '抽屉'];
ok(modeledCats.every(k => rendererSrc.indexOf("'" + k + "'") >= 0), '可建模类别在渲染器均有 GLB 映射');

console.log('\n========== 汇总 ==========');
console.log(pass + '/' + (pass + fail) + ' passed');
if (fail > 0) process.exitCode = 1;
