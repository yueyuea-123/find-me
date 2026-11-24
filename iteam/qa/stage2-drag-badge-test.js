/**
 * 阶段二回归：恢复直接拖拽 + 家具数量角标（纯 Node，无需开发者工具）
 * 覆盖：
 *   1. 命中家具单指拖动 → previewMove 预览 + 抬手 transformFurniture 落盘
 *   2. 落盘带 5cm 网格吸附；位置写为世界坐标
 *   3. 短按家具仍=选中并打开底部抽屉（找物主路径不变）
 *   4. 双指缩放调用 zoom、双指旋转调用 previewRotate 且抬手落盘
 *   5. 数量角标：bindCount 来自有效物品数；projectAll 坐标投影；0 件不显示
 *   6. BR-009：拖动/旋转后物品与收纳节点绑定零丢失
 *   7. 撤销：拖动后可回到拖动前位置
 * 用法: node qa/stage2-drag-badge-test.js
 */
const fs = require('fs');
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');

// ---------------------------------------------------------------- runtime mock
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
  showActionSheet: o => { if (o && o.success) o.success({ tapIndex: 0 }); },
  navigateTo: o => { global.__lastNav = o && o.url; }, switchTab: () => {}, redirectTo: () => {}, reLaunch: () => {}, navigateBack: () => {},
  chooseMedia: () => {}, previewImage: () => {},
  createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, fields() { return this; },
    boundingClientRect() { return this; }, exec(cb) { if (cb) cb([{ node: {}, width: 300, height: 200 }]); } }),
  createCanvasContext: () => ({}),
  getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.0.0', windowWidth: 375 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
  canIUse: () => true, setNavigationBarTitle: () => {}, stopPullDownRefresh: () => {},
  startPullDownRefresh: () => {}, vibrateShort: () => {}, setClipboardData: () => {},
  getClipboardData: () => {}, loadSubpackage: () => {},
  getFileSystemManager: () => ({ readFileSync: () => '' })
};
global.App = o => { global.__APP = o; };
global.Page = o => { pageDefs[currentRoute] = o; };
global.Component = o => { pageDefs[currentRoute] = o; };
global.Behavior = () => ({});
global.getApp = () => global.__APP || {};
global.getCurrentPages = () => [];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

currentRoute = '__app__';
require(path.join(MP, 'app.js'));
if (global.__APP && global.__APP.onLaunch) global.__APP.onLaunch();
currentRoute = 'pages/room3d/room3d';
require(path.join(MP, 'pages/room3d/room3d.js'));
const def = pageDefs['pages/room3d/room3d'];
if (!def) { console.error('页面定义未找到'); process.exit(1); }
const store = require(path.join(MP, 'utils/store.js'));
const rooms = store.listRooms();
const roomId = rooms[0].id;
// 选一件有关联物品的家具做 BR-009 验证，没有则取第一件
const withItems = store.listFurniture(roomId).find(f => store.bindingsOfFurniture(f.id).items.length > 0);
const fid = (withItems || store.listFurniture(roomId)[0]).id;

function makePage(hitIdx) {
  const p = Object.assign({}, def);
  p.data = Object.assign({}, JSON.parse(JSON.stringify(def.data)), { view: '3d', glError: '', sceneMode: 'view' });
  p.setData = o => { Object.assign(p.data, o); };
  p.onLoad({ id: roomId });
  p.loadData();
  p.data.sceneMode = 'view';
  // 保证命中目标家具在列表首位
  const idx = p._furniture.findIndex(r => r.id === fid);
  const hit = (typeof hitIdx === 'number') ? hitIdx : Math.max(0, idx);
  const calls = { orbit: 0, zoom: 0, previewMove: 0, previewRotate: 0, setSelected: 0, projectAll: 0 };
  p._glRenderer = {
    pick: () => hit,
    dragDelta: () => ({ dx: 0.63, dz: 0.42 }),   // 非 5cm 倍数，验证吸附
    previewMove: (i, x, z) => { calls.previewMove++; return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }; },
    previewRotate: (i, r) => { calls.previewRotate++; return { rotation: r }; },
    setSelected: () => { calls.setSelected++; }, render: () => {},
    orbit: () => { calls.orbit++; }, pan: () => {}, zoom: () => { calls.zoom++; },
    reset: () => {}, fit: () => {}, setPreset: () => {}, resize: () => {},
    projectAll: () => {
      calls.projectAll++;
      return p._furniture.map((r, i) => ({ index: i, x: 100 + i * 40, y: 80, visible: true }));
    }
  };
  p._calls = calls;
  p.loadData();
  return p;
}
const TP = (x, y) => ({ x, y, clientX: x, clientY: y });
function drag(p, from, to) {
  p.onTouchStart({ touches: [from], changedTouches: [from] });
  p.onTouchMove({ touches: [to], changedTouches: [to] });
  p.onTouchEnd({ touches: [], changedTouches: [to] });
}
function snapFurniture(p) { return p._furniture.find(r => r.id === fid); }

// ---- 1. 直接拖拽落盘 + 吸附 ----
const pDrag = makePage();
const before = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
drag(pDrag, TP(100, 100), TP(168, 142));
const after = store.getFurniture(fid).position;
ok('拖拽调用 previewMove 实时预览', pDrag._calls.previewMove > 0, 'n=' + pDrag._calls.previewMove);
ok('拖拽抬手后家具位置已落盘', before.x !== after.x || before.z !== after.z,
  `${before.x}/${before.z} -> ${after.x}/${after.z}`);
ok('落盘坐标吸附到 5cm 网格', Math.abs(after.x * 100 % 5) < 0.001 && Math.abs(after.z * 100 % 5) < 0.001,
  `${after.x}/${after.z}`);
ok('拖拽不转成相机旋转', pDrag._calls.orbit === 0, 'orbit=' + pDrag._calls.orbit);
ok('拖拽后标脏待保存', pDrag.data.isDirty === true);

// ---- 2. 短按仍选中并弹面板（找物主路径）----
const pTap = makePage();
pTap.onTouchStart({ touches: [TP(100, 100)], changedTouches: [TP(100, 100)] });
pTap.onTouchEnd({ touches: [], changedTouches: [TP(100, 100)] });
ok('短按家具进入选中态', !!pTap.data.selected && pTap.data.selected.id === fid);
ok('短按家具打开底部抽屉', pTap.data.sheetOpen === true);

// ---- 3. 双指缩放与旋转 ----
const pPinch = makePage();
pPinch.onTouchStart({ touches: [TP(100, 100)], changedTouches: [TP(100, 100)] });
pPinch.onTouchEnd({ touches: [], changedTouches: [TP(100, 100)] }); // 先选中
const rotBefore = store.getFurniture(fid).rotation || 0;
pPinch.onTouchStart({ touches: [TP(140, 120), TP(240, 120)], changedTouches: [] });
pPinch.onTouchMove({ touches: [TP(120, 80), TP(260, 160)], changedTouches: [] }); // 距离变大+连线旋转
pPinch.onTouchEnd({ touches: [], changedTouches: [] });
ok('双指缩放调用 zoom', pPinch._calls.zoom > 0, 'zoom=' + pPinch._calls.zoom);
ok('双指旋转调用 previewRotate', pPinch._calls.previewRotate > 0, 'rotate=' + pPinch._calls.previewRotate);
ok('双指旋转抬手后落盘', Math.abs((store.getFurniture(fid).rotation || 0) - rotBefore) > 0.001,
  `${rotBefore.toFixed(3)} -> ${(store.getFurniture(fid).rotation || 0).toFixed(3)}`);

// ---- 4. 数量角标 ----
const pBadge = makePage();
const row = snapFurniture(pBadge);
const expectN = store.bindingsOfFurniture(fid).items.length;
ok('家具卡片带有效物品数 bindCount', typeof row.bindCount === 'number' && row.bindCount === expectN,
  'bindCount=' + row.bindCount + ' expect=' + expectN);
ok('三维角标坐标来自 projectAll', pBadge._calls.projectAll > 0 && Array.isArray(pBadge.data.furnitureBadges),
  'projectAll=' + pBadge._calls.projectAll);
const badgeForF = pBadge.data.furnitureBadges.find(b => b.id === fid);
if (expectN > 0) {
  ok('有物品的家具显示数量角标', !!badgeForF && badgeForF.n === expectN, JSON.stringify(badgeForF));
} else {
  ok('无物品的家具不显示角标', !badgeForF);
}
ok('角标只含数量不含物品模型', pBadge.data.furnitureBadges.every(b => typeof b.n === 'number' && !('item' in b)));

// ---- 5. BR-009：拖拽/旋转后物品绑定零丢失 ----
if (withItems) {
  const boundIds = store.bindingsOfFurniture(fid).items.map(i => i.id);
  const pBr = makePage();
  drag(pBr, TP(100, 100), TP(150, 140));
  const stillBound = boundIds.every(id => {
    const it = store.getItem(id);
    const nodes = store.listNodes(roomId).filter(n => n.furnitureId === fid).map(n => n.id);
    return it && nodes.indexOf(it.currentNodeId) >= 0;
  });
  ok('BR-009 拖拽后物品绑定零丢失', stillBound, 'items=' + boundIds.length);
} else {
  ok('BR-009 演示数据含可验证的绑定家具', false, '未找到有关联物品的家具');
}

// ---- 6. 撤销回滚 ----
const pUndo = makePage();
const posPre = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
drag(pUndo, TP(100, 100), TP(168, 142)); // 用与用例1相同的位移，确保确实发生移动
const posMoved = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
pUndo.undoScene();
const posUndo = store.getFurniture(fid).position;
ok('撤销前家具确有移动', posMoved.x !== posPre.x || posMoved.z !== posPre.z,
  `${posPre.x}/${posPre.z} -> ${posMoved.x}/${posMoved.z}`);
ok('撤销回到拖动前位置', Math.abs(posUndo.x - posPre.x) < 0.001 && Math.abs(posUndo.z - posPre.z) < 0.001,
  `${posPre.x}/${posPre.z} -> ${posUndo.x}/${posUndo.z}`);

// ---- 7. 静态口径 ----
const jsSrc = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.js'), 'utf8');
const wxml = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.wxml'), 'utf8');
const rend = fs.readFileSync(path.join(MP, 'package3d/renderer.js'), 'utf8');
ok('页面调用 dragDelta/previewMove 实现直接拖拽', /'dragDelta'/.test(jsSrc) && /'previewMove'/.test(jsSrc));
ok('页面调用 previewRotate 实现双指旋转', /'previewRotate'/.test(jsSrc));
ok('页面含网格吸附 GRID_M', /GRID_M/.test(jsSrc));
ok('渲染器提供 projectAll 投影接口', /projectAll: function/.test(rend));
ok('WXML 含三维数量角标层', /furn-badge/.test(wxml) && /furnitureBadges/.test(wxml));
ok('WXML 含家具卡片数量角标', /hifi-card-count/.test(wxml));

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
