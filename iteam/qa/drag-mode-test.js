/**
 * 三维房间触摸模式回归（纯 Node，不依赖微信开发者工具）
 * 背景：真机反馈"只能旋转，拖不动家具"——浏览模式原仅旋转视角，
 * 而提示语承诺"可拖动摆放"。现改为浏览模式按住家具直接拖动并自动切编辑模式。
 *
 * 覆盖：
 *   1. 浏览模式拖家具 → 位置落盘变化 + 自动切编辑模式
 *   2. 浏览模式拖空白 → 仍为 orbit 旋转，家具不动
 *   3. 收纳模式拖家具 → 不移动（模式分权保留）
 *   4. canvas 使用 catchtouch* 阻止页面滚动抢手势
 *
 * 用法: node qa/drag-mode-test.js
 */
const fs = require('fs');
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');

// ---------------------------------------------------------------- 运行时 mock
const storage = {};
let currentRoute = '';
const pageDefs = {};
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: 0, limitSize: 10240 }),
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: o => { if (o && o.success) o.success({ confirm: true }); },
  showActionSheet: o => { if (o && o.success) o.success({ tapIndex: 0 }); },
  navigateTo: () => {}, switchTab: () => {}, redirectTo: () => {}, reLaunch: () => {}, navigateBack: () => {},
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

function makePage(mode, hitIndex) {
  const p = Object.assign({}, def);
  p.data = Object.assign({}, def.data, { view: '3d', mode, glError: '' });
  p.setData = function (o) { Object.assign(this.data, o); };
  p.onLoad({ id: roomId });
  p.loadData();
  // 打桩渲染器：命中第 hitIndex 件（传 -1 表示空白）
  const orbits = [];
  p._glRenderer = {
    pick: () => hitIndex,
    dragDelta: () => ({ dx: 0.6, dz: 0.4 }),
    previewMove: (idx, x, z) => ({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 }),
    setSelected: () => {}, render: () => {},
    orbit: (dx, dy) => orbits.push([dx, dy]),
    resize: () => {}
  };
  p._orbits = orbits;
  return p;
}
function drag(p) {
  const a = { x: 100, y: 100, clientX: 100, clientY: 100 };
  const b = { x: 160, y: 140, clientX: 160, clientY: 140 };
  p.onTouchStart({ touches: [a], changedTouches: [a] });
  p.onTouchMove({ touches: [b], changedTouches: [b] });
  const mid = { mode: p.data.mode, px: p.data.selected && p.data.selected.px };
  p.onTouchEnd({ touches: [], changedTouches: [b] });
  p.loadData();
  return mid;
}

// 1. 浏览模式拖家具
const before = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
const p1 = makePage('browse', 0);
const m1 = drag(p1);
const after = store.getFurniture(fid).position;
ok('浏览-拖家具位置落盘变化', Math.abs(after.x - before.x) > 0.01 || Math.abs(after.z - before.z) > 0.01,
  before.x + '/' + before.z + ' -> ' + after.x + '/' + after.z);
ok('浏览-拖家具自动切编辑模式', m1.mode === 'edit', 'mode=' + m1.mode);

// 2. 浏览模式拖空白仍旋转
const p2 = makePage('browse', -1);
const pos2 = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
const m2 = drag(p2);
const pos2After = store.getFurniture(fid).position;
ok('浏览-拖空白仍旋转视角', p2._orbits.length > 0, 'orbit次数=' + p2._orbits.length);
ok('浏览-拖空白不移动家具', pos2.x === pos2After.x && pos2.z === pos2After.z, m2.mode);
ok('浏览-拖空白不切模式', m2.mode === 'browse', 'mode=' + m2.mode);

// 3. 收纳模式拖家具不移动
const p3 = makePage('store', 0);
const pos3 = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
drag(p3);
const pos3After = store.getFurniture(fid).position;
ok('收纳-拖家具不移动', pos3.x === pos3After.x && pos3.z === pos3After.z);

// 4. canvas 阻止页面滚动抢手势
const wxml = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.wxml'), 'utf8');
ok('canvas 使用 catchtouchmove 阻止页面滚动', /catchtouchmove\s*=\s*"onTouchMove"/.test(wxml));
ok('canvas 使用 catchtouchstart', /catchtouchstart\s*=\s*"onTouchStart"/.test(wxml));

// 5. 点击按钮旋转：每次90°、可逆，双指扭转状态已移除
const p5 = makePage('browse', 0);
const rot0 = Number(p5.data.selected.rot) || 0;
p5.rotateFurniture({ currentTarget: { dataset: { dir: 1 } } });
const rot1 = Number(p5.data.selected.rot);
p5.rotateFurniture({ currentTarget: { dataset: { dir: -1 } } });
const rot2 = Number(p5.data.selected.rot);
ok('点击按钮顺时针旋转90°', ((rot1 - rot0) + 360) % 360 === 90, rot0 + '° -> ' + rot1 + '°');
ok('点击按钮逆时针旋转可逆', rot2 === rot0, rot1 + '° -> ' + rot2 + '°');
ok('旋转由按钮提供（浏览模式可见）', /data-dir="-1" bindtap="rotateFurniture"/.test(wxml));
const jsSrc = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.js'), 'utf8');
ok('双指扭转已移除（无 previewRotate 调用）', !/safeGL\('previewRotate'/.test(jsSrc));
ok('提示文案不再宣称扭转旋转', !/扭转旋转/.test(jsSrc) && !/扭转旋转/.test(wxml));

// 6. 双指缩放方向：张开变大、捏合变小
const p6 = makePage('edit', 0);
const w0 = parseFloat(p6.data.selected.sz.split('×')[0]);
const V = (x, y) => ({ x, y, clientX: x, clientY: y });
p6.onTouchStart({ touches: [V(150, 100), V(250, 100)], changedTouches: [] });
p6.onTouchMove({ touches: [V(80, 100), V(320, 100)], changedTouches: [] });
const wOpen = parseFloat(p6.data.selected.sz.split('×')[0]);
p6.onTouchEnd({ touches: [], changedTouches: [] });
p6.onTouchStart({ touches: [V(80, 100), V(320, 100)], changedTouches: [] });
p6.onTouchMove({ touches: [V(150, 100), V(250, 100)], changedTouches: [] });
const wPinch = parseFloat(p6.data.selected.sz.split('×')[0]);
p6.onTouchEnd({ touches: [], changedTouches: [] });
ok('双指张开家具变大', wOpen > w0, w0 + ' -> ' + wOpen);
ok('双指捏合家具变小', wPinch < wOpen, wOpen + ' -> ' + wPinch);

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
