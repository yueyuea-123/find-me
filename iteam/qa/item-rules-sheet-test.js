/**
 * 物品添加与管理业务规则 V1.0 回归（纯 Node，不依赖微信开发者工具）
 * 覆盖 §3.2 底部抽屉：点击家具展开、节点列表与计数、节点物品列表、
 * 添加物品继承当前节点、收起/关闭不改业务数据、切换家具同步、归档不计入默认数量。
 *
 * 用法: node qa/item-rules-sheet-test.js
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
    exec(cb) { if (typeof cb === 'function') cb([{ node: {}, width: 300, height: 400 }]); }
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

// ---------------------------------------------------------------- 页面与数据
currentRoute = '__app__';
require(path.join(MP, 'app.js'));
if (global.__APP && global.__APP.onLaunch) global.__APP.onLaunch();
currentRoute = 'pages/room3d/room3d';
require(path.join(MP, 'pages/room3d/room3d.js'));
const def = pageDefs['pages/room3d/room3d'];
if (!def) { console.error('页面定义未找到'); process.exit(1); }

const store = require(path.join(MP, 'utils/store.js'));
store.clearAll();
store.seedDemo();
const roomId = store.listRooms()[0].id;
const furnitures = store.listFurniture(roomId);
const fid = furnitures[0].id;

function makePage() {
  const p = Object.assign({}, def);
  p.data = Object.assign({}, def.data, { view: '3d', glError: '' });
  p.setData = function (o) { Object.assign(this.data, o); };
  p.onLoad({ id: roomId });
  p.loadData();
  p._glRenderer = {
    pick: () => 0, dragDelta: () => ({ dx: 0, dz: 0 }),
    previewMove: (i, x, z) => ({ x, z }), setSelected: () => {}, render: () => {},
    reset: () => {}, resize: () => {}, zoom: () => {}
  };
  return p;
}
function tapFurniture(p) {
  const t = { x: 50, y: 50, clientX: 50, clientY: 50 };
  p.onTouchStart({ touches: [t], changedTouches: [t] });
  p.onTouchEnd({ touches: [], changedTouches: [t] });
}

// ---- 1. 点击家具打开底部抽屉，三维视图仍在 3d 状态 ----
const p = makePage();
tapFurniture(p);
ok('点击家具打开底部抽屉', p.data.sheetOpen === true && p.data.sheetCollapsed === false);
ok('抽屉打开不改变三维视图', p.data.view === '3d' && !!p._glRenderer);

// ---- 2. 节点列表含家具根节点及子节点，计数只算有效物品 ----
const nodes = store.listNodes(roomId).filter(n => n.furnitureId === fid);
ok('抽屉节点覆盖该家具全部收纳节点', p.data.sheetNodes.length === nodes.length,
  p.data.sheetNodes.length + '/' + nodes.length);
const countsOk = p.data.sheetNodes.every(n =>
  n.itemCount === store.itemsInNode(n.id).length);
ok('节点物品数按有效档案统计', countsOk);

// ---- 3. 选中节点后只展示该节点直接关联的物品 ----
let picked = p.data.sheetNodes.filter(n => store.itemsInNode(n.id).length > 0)[0];
if (!picked) {
  const add = store.addItem({ name: '抽屉规则测试物', currentNodeId: p.data.sheetNodes[0].id });
  ok('测试物品建档成功', add.ok);
  picked = p.data.sheetNodes[0];
}
p.chooseNode({ currentTarget: { dataset: { id: picked.id } } });
const expected = store.itemsInNode(picked.id).slice(0, 5).map(it => it.id);
ok('切换节点刷新节点物品列表', p.data.activeNodeId === picked.id &&
  JSON.stringify(p.data.nodeItems.map(it => it.id)) === JSON.stringify(expected),
  p.data.activeNodePath);

// ---- 4. 建档入口继承当前节点 ----
global.__lastNav = '';
p.addItemAtActiveNode();
ok('添加物品继承当前节点', /^\/pages\/item-edit\/item-edit\?nodeId=/.test(global.__lastNav) &&
  global.__lastNav.indexOf('nodeId=' + picked.id) >= 0, global.__lastNav || '(无跳转)');

// ---- 5. 收起/关闭只改视图状态，不改业务数据 ----
const snapshot = JSON.stringify(store.exportSnapshot());
p.toggleSheet();
ok('抽屉可收起', p.data.sheetCollapsed === true);
p.toggleSheet();
ok('抽屉可再次展开', p.data.sheetCollapsed === false);
p.closeSheet();
ok('关闭抽屉不改业务数据', p.data.sheetOpen === false &&
  JSON.stringify(store.exportSnapshot()) === snapshot);

// ---- 6. 切换选中家具，抽屉内容同步 ----
const other = furnitures[1] || furnitures[0];
p.openSheet();
p.selectIndex(store.listFurniture(roomId).findIndex(f => f.id === other.id));
const otherNodes = store.listNodes(roomId).filter(n => n.furnitureId === other.id);
ok('切换家具同步抽屉节点', p.data.sheetNodes.length === otherNodes.length &&
  p.data.sheetNodes.every(n => n.name), other.name + ' nodes=' + p.data.sheetNodes.length);

// ---- 7. 归档物品不计入抽屉节点数量 ----
const targetNode = p.data.activeNodeId || otherNodes[0].id;
const created = store.addItem({ name: '归档计数测试物', currentNodeId: targetNode });
if (created.ok) {
  const before = store.itemsInNode(targetNode).length;
  store.endManagement(created.data.id, '已丢弃');
  const after = store.itemsInNode(targetNode).length;
  p._refreshSheet(other.id);
  const shown = (p.data.sheetNodes.filter(n => n.id === targetNode)[0] || {}).itemCount;
  ok('归档物品不计入默认节点数量', after === before - 1 && shown === after,
    before + ' -> ' + after + ' / shown=' + shown);
}

// ---- 8. 静态口径：抽屉是三维覆盖层，入口齐全 ----
const wxml = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.wxml'), 'utf8');
ok('抽屉覆盖层使用 cover-view', /<cover-view class="bsheet/.test(wxml));
ok('抽屉保留查看与添加入口', /bindtap="goNodes"/.test(wxml) && /bindtap="addItemAtActiveNode"/.test(wxml));
ok('抽屉支持收起与关闭', /bindtap="toggleSheet"/.test(wxml) && /bindtap="closeSheet"/.test(wxml));

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
