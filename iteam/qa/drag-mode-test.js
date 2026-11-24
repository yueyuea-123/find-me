/**
 * 三维房间交互回归（纯 Node，不依赖微信开发者工具）
 * 基准：《三维空间视图与模型管理交互设计规范 V1.0》的通用部分 +《客厅三维空间交互与开发设计规范 V1.3》A 方案。
 *   V1.3 已确认变更（详见 qa/v13-state-machine-test.js）：
 *   - 默认不直接拖动家具；改为点选后 MOVE 方向按钮 5cm 步进
 *   - 空白单指拖动改为旋转相机（原 V1.0 固定视角不再适用）
 *   - 家具旋转改为 ROTATE 子模式按钮 15°/90°（原直接旋转 90° 不再适用）
 *   本文件保留跨版本通用的断言（选中/双指缩放尺寸不变/添加物品/删除保护/家具库/画布拦截），
 *   交互状态机的完整验证以 v13-state-machine-test.js 为准。
 *
 * 用法: node qa/drag-mode-test.js
 */
const fs = require('fs');
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');

// ---------------------------------------------------------------- 运行时 mock
const storage = {};
const pageDefs = {};
let currentRoute = '';
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: 0, limitSize: 10240 }),
  showToast: o => { global.__toasts = global.__toasts || []; global.__toasts.push(o && o.title); },
  showLoading: () => {}, hideLoading: () => {},
  showModal: o => { if (o && o.success) o.success({ confirm: true }); },
  showActionSheet: o => { global.__lastSheet = o && o.itemList; if (o && o.success) o.success({ tapIndex: global.__sheetIndex || 0 }); },
  navigateTo: o => { global.__lastNav = o && o.url; }, switchTab: () => {}, redirectTo: () => {}, reLaunch: () => {}, navigateBack: () => {},
  chooseMedia: () => {}, previewImage: () => {},
  createSelectorQuery: () => ({
    in() { return this; }, select() { return this; }, fields() { return this; },
    boundingClientRect() { return this; },
    exec(cb) { if (typeof cb === 'function') cb([{ node: {}, width: 300, height: 200 }]); }
  }),
  createCanvasContext: () => ({}),
  getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.0.0', windowWidth: 375 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
  canIUse: () => true,
  setNavigationBarTitle: () => {}, stopPullDownRefresh: () => {},
  startPullDownRefresh: () => {}, vibrateShort: () => {},
  setClipboardData: () => {}, getClipboardData: () => {},
  loadSubpackage: () => {}, getFileSystemManager: () => ({ readFileSync: () => '' })
};
global.App = o => { global.__APP = o; };
global.Page = o => { pageDefs[currentRoute] = o; };
global.Component = o => { pageDefs[currentRoute] = o; };
global.Behavior = () => ({});
global.getApp = () => global.__APP || {};
global.getCurrentPages = () => [];

// ---------------------------------------------------------------- 断言框架
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

// ---------------------------------------------------------------- 载入页面
currentRoute = '__app__';
require(path.join(MP, 'app.js'));
if (global.__APP && global.__APP.onLaunch) global.__APP.onLaunch();
currentRoute = 'pages/room3d/room3d';
require(path.join(MP, 'pages/room3d/room3d.js'));
const def = pageDefs['pages/room3d/room3d'];
if (!def) { console.error('页面定义未找到'); process.exit(1); }

const store = require(path.join(MP, 'utils/store.js'));
const rooms = store.listRooms();
if (!rooms.length) { console.error('演示房间未初始化'); process.exit(1); }
const roomId = rooms[0].id;
const roomFurniture = store.listFurniture(roomId);
if (!roomFurniture.length) { console.error('演示家具未初始化'); process.exit(1); }
const fid = roomFurniture[0].id;

function makePage(hitIndex) {
  const p = Object.assign({}, def);
  p.data = Object.assign({}, def.data, { view: '3d', mode: undefined, glError: '' });
  p.setData = function (o) { Object.assign(this.data, o); };
  p.onLoad({ id: roomId });
  p.loadData();
  const calls = { orbit: 0, pan: 0, zoom: 0, previewMove: 0 };
  p._glRenderer = {
    pick: () => hitIndex,
    dragDelta: () => ({ dx: 0.6, dz: 0.4 }),
    previewMove: (idx, x, z) => { calls.previewMove++; return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }; },
    setSelected: () => {}, render: () => {},
    orbit: () => { calls.orbit++; }, pan: () => { calls.pan++; }, zoom: () => { calls.zoom++; },
    reset: () => {}, resize: () => {}
  };
  p._calls = calls;
  return p;
}
function drag(p) {
  const a = { x: 100, y: 100, clientX: 100, clientY: 100 };
  const b = { x: 160, y: 140, clientX: 160, clientY: 140 };
  p.onTouchStart({ touches: [a], changedTouches: [a] });
  p.onTouchMove({ touches: [b], changedTouches: [b] });
  const mid = { px: p.data.selected && p.data.selected.px };
  p.onTouchEnd({ touches: [], changedTouches: [b] });
  p.loadData();
  return mid;
}
function tap(p) {
  global.__lastNav = '';
  const t = { x: 100, y: 100, clientX: 100, clientY: 100 };
  p.onTouchStart({ touches: [t], changedTouches: [t] });
  p.onTouchEnd({ touches: [], changedTouches: [t] });
  return global.__lastNav || '';
}

// ---- 1. V1.3：拖空白旋转相机，不移动家具、不平移场景 ----
const pBlank = makePage(-1);
const posBefore = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
drag(pBlank);
const posAfter = store.getFurniture(fid).position;
ok('V1.3 拖空白调用 orbit 转视角', pBlank._calls.orbit > 0, 'orbit=' + pBlank._calls.orbit);
ok('V1.3 拖空白不调用 pan', pBlank._calls.pan === 0, 'pan=' + pBlank._calls.pan);
ok('V1.3 拖空白不移动家具', posBefore.x === posAfter.x && posBefore.z === posAfter.z);

// ---- 2. 阶段二：恢复直接拖拽（推翻 A 方案「命中即锁死为点击」）----
const pDrag = makePage(0);
const dBefore = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
drag(pDrag);
const dAfter = store.getFurniture(fid).position;
ok('直接拖拽：家具上拖动会移动家具', Math.abs(dAfter.x - dBefore.x) > 0.001 || Math.abs(dAfter.z - dBefore.z) > 0.001,
  dBefore.x + '/' + dBefore.z + ' -> ' + dAfter.x + '/' + dAfter.z);
ok('直接拖拽：家具上拖动不转成相机拖动', pDrag._calls.orbit === 0, 'orbit=' + pDrag._calls.orbit);
ok('直接拖拽：拖动调用 previewMove 预览', pDrag._calls.previewMove > 0, 'previewMove=' + pDrag._calls.previewMove);
ok('直接拖拽：抬手落盘后标脏待保存', pDrag.data.isDirty === true);
ok('V1.3 状态机使用 sceneMode 字段', def.data.sceneMode === 'loading');

// ---- 3. 短按家具=选中，不跳建档（规范 §5.2 由卡片发起添加） ----
const pTap = makePage(0);
const tapNav = tap(pTap);
ok('短按家具仅选中不跳页', tapNav === '' && !!pTap.data.selected, 'nav=' + (tapNav || '无') + ' sel=' + (pTap.data.selected || {}).name);
ok('选中卡展示已绑定数量', typeof pTap.data.selected.bindCount === 'number', 'bindCount=' + pTap.data.selected.bindCount);
ok('选中卡关联汇总可读', !!(pTap.data.bindings && Array.isArray(pTap.data.bindings.items)));

// ---- 4. 双指只缩放视图，不改家具尺寸 ----
const pPinch = makePage(0);
const sz0 = pPinch.data.selected.sz;
const V = (x, y) => ({ x, y, clientX: x, clientY: y });
pPinch.onTouchStart({ touches: [V(150, 100), V(250, 100)], changedTouches: [] });
pPinch.onTouchMove({ touches: [V(80, 100), V(320, 100)], changedTouches: [] });
pPinch.onTouchEnd({ touches: [], changedTouches: [] });
ok('双指张开缩放视图', pPinch._calls.zoom > 0, 'zoom=' + pPinch._calls.zoom);
ok('双指不改变家具尺寸规格', pPinch.data.selected.sz === sz0, sz0 + ' -> ' + pPinch.data.selected.sz);

// ---- 5. V1.3：ROTATE 子模式按钮 15° / 90° 快捷 ----
const pRot = makePage(0);
tap(pRot); // 进入 SELECTED
pRot.enterRotate();
const r0 = Number(pRot.data.selected.rot) || 0;
pRot.rotateStep({ currentTarget: { dataset: { dir: 1 } } });
const r1 = Number(pRot.data.selected.rot);
pRot.rotateStep({ currentTarget: { dataset: { dir: -1, quick: 1 } } });
const r2 = Number(pRot.data.selected.rot);
ok('ROTATE 顺时针 15°', ((r1 - r0) + 360) % 360 === 15, r0 + '° -> ' + r1 + '°');
ok('ROTATE 逆时针快捷 90°', ((r2 - r1) + 360) % 360 === 270, r1 + '° -> ' + r2 + '°');
pRot.cancelEdit();

// ---- 6. 添加物品两条路径（规范 §5.2） ----
const pAdd = makePage(0);
global.__sheetIndex = 0; pAdd.chooseAddItem();
ok('添加物品入口给出两条路径', JSON.stringify(global.__lastSheet) === JSON.stringify(['从已有物品中选择', '新建物品']), JSON.stringify(global.__lastSheet));
ok('选「已有物品」打开绑定面板', pAdd.data.showBindPicker === true && pAdd.data.bindableItems.length > 0,
  'items=' + pAdd.data.bindableItems.length);
// 绑定到当前家具
const bindItem = pAdd.data.bindableItems[0];
pAdd.bindExistingItem({ currentTarget: { dataset: { id: bindItem.id } } });
const bound = store.getItem(bindItem.id);
const root = store.listNodes(roomId).filter(n => n.furnitureId === pAdd.data.selected.id && !n.parentId)[0];
ok('从已有物品选择写入存放关系', !!bound && !!root && bound.currentNodeId === root.id && bound.locationStatus === 'at_home',
  (bound && bound.currentNodeId || '') + ' / root=' + (root && root.id || ''));
ok('绑定后面板关闭', pAdd.data.showBindPicker === false);
// 新建物品路径
const pNew = makePage(0);
global.__lastNav = ''; global.__sheetIndex = 1; pNew.chooseAddItem();
ok('选「新建物品」进入建档页并预选节点', /^\/pages\/item-edit\/item-edit\?nodeId=/.test(global.__lastNav), global.__lastNav || '(无跳转)');

// ---- 7. 删除转未放置：物品记录不丢失、家具被删除、物品锚点转为 unplaced（基线 §2.3） ----
const pDel = makePage(0);
const linkedFurniture = store.listFurniture(roomId).filter(f => store.bindingsOfFurniture(f.id).items.length > 0)[0];
if (linkedFurniture) {
  const linkedIds = store.bindingsOfFurniture(linkedFurniture.id).items.map(i => i.id);
  pDel._doRemoveFurniture(linkedFurniture.id);
  const stillThere = linkedIds.every(id => !!store.getItem(id));
  const allUnplaced = linkedIds.every(id => (store.getItem(id) || {}).anchorType === 'unplaced');
  ok('删除有关联家具后物品不丢失且转入未放置', stillThere && allUnplaced && !store.getFurniture(linkedFurniture.id));
}

// ---- 8. 家具库按需展开 ----
const pLib = makePage(0);
ok('家具库默认收起', pLib.data.showLib === false);
pLib.toggleLib();
ok('点「＋ 家具」展开库', pLib.data.showLib === true);
pLib.toggleLib();
ok('再次点按收起库', pLib.data.showLib === false);

// ---- 9. 静态口径：canvas 手势拦截 + V1.3 相机/状态机入口 ----
const wxml = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.wxml'), 'utf8');
const jsSrc = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.js'), 'utf8');
ok('canvas 使用 catchtouchstart/move/end', /catchtouchstart="onTouchStart"/.test(wxml) && /catchtouchmove="onTouchMove"/.test(wxml) && /catchtouchend="onTouchEnd"/.test(wxml));
ok('V1.3 提示声明空白转视角', /空白处拖动转视角/.test(jsSrc));
ok('V1.3 页面调用 orbit 转视角、不调用 pan', /safeGL\('orbit'/.test(jsSrc) && !/safeGL\('pan'/.test(jsSrc));
ok('WXML 含查看物品与添加物品入口', /bindtap="goNodes"/.test(wxml) && /bindtap="chooseAddItem"/.test(wxml));

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
