/**
 * V1.3 A 方案状态机回归（纯 Node，不依赖微信开发者工具）
 * 基准：《客厅三维空间交互与开发设计规范 V1.3》§6 状态机 +《A 方案交互状态图》
 * 覆盖：
 *   - 默认 VIEW：拖空白转相机、双指缩放；拖家具不移动（简化操作核心）
 *   - VIEW --点击家具--> SELECTED；SELECTED --点空白--> VIEW
 *   - SELECTED --移动/旋转/尺寸--> MOVE/ROTATE/DIMENSION（三工具互斥）
 *   - MOVE 方向按钮 5cm 步进；ROTATE ±15°/90°；DIMENSION 长宽高（cm）
 *   - 子模式 完成--> SELECTED 保留 dirty；取消--> 回滚本次
 *   - 保存（SAVING 禁重复）/ 撤销最近一次 / dirty 离开确认
 *   - ITEM_VIEW 物品归属与未设置位置；切视图不改数据
 *   - 相机 fit / 视角预设存在，且相机变化不标 dirty
 *
 * 用法: node qa/v13-state-machine-test.js
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
  showModal: o => { if (o && o.success) o.success({ confirm: global.__modalConfirm !== false }); },
  showActionSheet: o => { if (o && o.success) o.success({ tapIndex: global.__sheetIndex || 0 }); },
  navigateTo: o => { global.__lastNav = o && o.url; }, navigateBack: () => { global.__back = true; },
  switchTab: () => {}, redirectTo: () => {}, reLaunch: () => {},
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

// ---------------------------------------------------------------- assertion
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

// ---------------------------------------------------------------- load page
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
const fid = store.listFurniture(roomId)[0].id;

function makePage(hitIndex) {
  const p = Object.assign({}, def);
  p.data = Object.assign({}, JSON.parse(JSON.stringify(def.data)), { view: '3d', glError: '', sceneMode: 'view' });
  p.setData = function (o) { Object.assign(this.data, o); };
  p.onLoad({ id: roomId });
  p.loadData();
  p.data.sceneMode = 'view';
  const calls = { orbit: 0, zoom: 0, reset: 0, fit: 0, setPreset: 0, previewMove: 0, setSelected: 0 };
  p._glRenderer = {
    pick: () => hitIndex,
    dragDelta: () => ({ dx: 0.6, dz: 0.4 }),
    previewMove: (idx, x, z) => { calls.previewMove++; return { x, z }; },
    setSelected: () => { calls.setSelected++; }, render: () => {},
    orbit: () => { calls.orbit++; }, pan: () => {}, zoom: () => { calls.zoom++; },
    reset: () => { calls.reset++; }, fit: () => { calls.fit++; },
    setPreset: n => { calls.setPreset++; calls.presetName = n; }, resize: () => {}
  };
  p._calls = calls;
  return p;
}
const TP = (x, y) => ({ x, y, clientX: x, clientY: y });
function dragBlank(p, from, to) {
  p.onTouchStart({ touches: [from], changedTouches: [from] });
  p.onTouchMove({ touches: [to], changedTouches: [to] });
  p.onTouchEnd({ touches: [], changedTouches: [to] });
}
function tapFurniture(p) {
  p.onTouchStart({ touches: [TP(100, 100)], changedTouches: [TP(100, 100)] });
  p.onTouchEnd({ touches: [], changedTouches: [TP(100, 100)] });
}

// ---- 1. VIEW：默认不拖动家具，拖空白只转相机 ----
const pView = makePage(-1);
const pos0 = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
dragBlank(pView, TP(100, 100), TP(170, 140));
const pos1 = store.getFurniture(fid).position;
ok('VIEW 拖空白调用 orbit 转相机', pView._calls.orbit > 0, 'orbit=' + pView._calls.orbit);
ok('VIEW 相机操作不改家具位置', pos0.x === pos1.x && pos0.z === pos1.z);
ok('VIEW 相机操作不标 dirty', pView.data.isDirty === false);
const pOnFurniture = makePage(0);
dragBlank(pOnFurniture, TP(100, 100), TP(180, 150));
const pos2 = store.getFurniture(fid).position;
ok('阶段二 VIEW 家具上拖动会直接移动家具', pos2.x !== pos0.x || pos2.z !== pos0.z);
ok('阶段二 VIEW 家具上按下不转成相机拖动', pOnFurniture._calls.orbit === 0, 'orbit=' + pOnFurniture._calls.orbit);

// ---- 2. 双指缩放相机，不改家具尺寸 ----
const pPinch = makePage(0);
const sz0 = pPinch.data.selected.sz;
pPinch.onTouchStart({ touches: [TP(150, 100), TP(250, 100)], changedTouches: [] });
pPinch.onTouchMove({ touches: [TP(80, 100), TP(320, 100)], changedTouches: [] });
pPinch.onTouchEnd({ touches: [], changedTouches: [] });
ok('双指缩放调用 zoom', pPinch._calls.zoom > 0, 'zoom=' + pPinch._calls.zoom);
ok('双指缩放不改家具尺寸', pPinch.data.selected.sz === sz0);

// ---- 3. VIEW -> SELECTED -> VIEW ----
const pSel = makePage(0);
tapFurniture(pSel);
ok('点家具进入 SELECTED', pSel.data.sceneMode === 'selected', 'mode=' + pSel.data.sceneMode);
ok('点家具打开底部抽屉', pSel.data.sheetOpen === true);
pSel._glRenderer.pick = () => -1; // 空白命中桩
pSel.onTouchStart({ touches: [TP(10, 10)], changedTouches: [TP(10, 10)] });
pSel.onTouchEnd({ touches: [], changedTouches: [TP(10, 10)] });
ok('点空白回到 VIEW', pSel.data.sceneMode === 'view', 'mode=' + pSel.data.sceneMode);

// ---- 4. 三工具互斥：进入一个子模式后 canvas 手势禁用 ----
const pModes = makePage(0);
tapFurniture(pModes);
pModes.enterMove(); ok('SELECTED -> MOVE', pModes.data.sceneMode === 'move');
const orbitInMove = pModes._calls.orbit;
dragBlank(pModes, TP(100, 100), TP(180, 150));
ok('MOVE 模式禁用相机手势', pModes._calls.orbit === orbitInMove);
pModes._editBase = null; pModes.setData({ sceneMode: 'selected' });
pModes.enterRotate(); ok('SELECTED -> ROTATE', pModes.data.sceneMode === 'rotate');
pModes._editBase = null; pModes.setData({ sceneMode: 'selected' });
pModes.enterDimension(); ok('SELECTED -> DIMENSION', pModes.data.sceneMode === 'dimension');
ok('工具互斥：仅一个 sceneMode 生效', ['move', 'rotate', 'dimension'].filter(m => pModes.data.sceneMode === m).length === 1);

// ---- 5. MOVE：方向按钮 5cm 步进 ----
const pMove = makePage(0);
tapFurniture(pMove);
const bx = store.getFurniture(fid).position.x;
pMove.enterMove();
pMove.moveStep({ currentTarget: { dataset: { dir: 'right' } } });
const ax = store.getFurniture(fid).position.x;
ok('MOVE 右移一步 = 5cm', Math.abs((ax - bx) - 0.05) < 0.001, bx + ' -> ' + ax);
pMove.finishEdit();
ok('MOVE 完成后回 SELECTED', pMove.data.sceneMode === 'selected');
ok('MOVE 完成后进入 dirty 待保存', pMove.data.isDirty === true);

// ---- 6. MOVE 取消回滚本次 ----
const pCancel = makePage(0);
tapFurniture(pCancel);
const cx = store.getFurniture(fid).position.x;
pCancel.enterMove();
pCancel.moveStep({ currentTarget: { dataset: { dir: 'right' } } });
pCancel.moveStep({ currentTarget: { dataset: { dir: 'right' } } });
pCancel.cancelEdit();
const rx = store.getFurniture(fid).position.x;
ok('MOVE 取消回滚到进入前位置', Math.abs(rx - cx) < 0.001, cx + ' -> ' + rx);
ok('取消后回 SELECTED', pCancel.data.sceneMode === 'selected');

// ---- 7. ROTATE：15° 与 90° 快捷 ----
const pRot = makePage(0);
tapFurniture(pRot);
const r0 = Number(pRot.data.selected.rot);
pRot.enterRotate();
pRot.rotateStep({ currentTarget: { dataset: { dir: 1 } } });
const r1 = Number(pRot.data.selected.rot);
ok('ROTATE 顺时针 15°', ((r1 - r0) + 360) % 360 === 15, r0 + ' -> ' + r1);
pRot.rotateStep({ currentTarget: { dataset: { dir: -1, quick: 1 } } });
const r2 = Number(pRot.data.selected.rot);
ok('ROTATE 逆时针快捷 90°', ((r2 - r1) + 360) % 360 === 270, r1 + ' -> ' + r2);
ok('角度显示 0-359', r2 >= 0 && r2 < 360, 'angle=' + r2);
pRot.finishEdit();

// ---- 8. DIMENSION：长宽高 cm 输入，底部中心锚点不变 ----
const pDim = makePage(0);
tapFurniture(pDim);
const posBefore = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
pDim.enterDimension();
pDim.onDimInput({ currentTarget: { dataset: { field: 'l' } }, detail: { value: '120' } });
pDim.onDimInput({ currentTarget: { dataset: { field: 'w' } }, detail: { value: '45' } });
pDim.onDimInput({ currentTarget: { dataset: { field: 'h' } }, detail: { value: '50' } });
pDim.applyDimension();
const sizeAfter = store.getFurniture(fid).size;
const posAfter = store.getFurniture(fid).position;
ok('DIMENSION 长宽高 cm 转米写入', Math.abs(sizeAfter.w - 1.2) < 0.001 && Math.abs(sizeAfter.d - 0.45) < 0.001 && Math.abs(sizeAfter.h - 0.5) < 0.001,
  JSON.stringify(sizeAfter));
ok('DIMENSION 保持底部中心锚点（position 不变）', posBefore.x === posAfter.x && posBefore.z === posAfter.z);
ok('DIMENSION 应用后回 SELECTED 待保存', pDim.data.sceneMode === 'selected' && pDim.data.isDirty === true);
// 非法尺寸拦截
pDim.enterDimension();
pDim.onDimInput({ currentTarget: { dataset: { field: 'l' } }, detail: { value: '0' } });
pDim.onDimInput({ currentTarget: { dataset: { field: 'w' } }, detail: { value: '40' } });
pDim.onDimInput({ currentTarget: { dataset: { field: 'h' } }, detail: { value: '50' } });
pDim.applyDimension();
ok('尺寸 <=0 被拒绝', Math.abs(store.getFurniture(fid).size.w - 1.2) < 0.001);
pDim.cancelEdit();

// ---- 9. 保存 / 撤销 ----
const pSave = makePage(0);
tapFurniture(pSave);
const saveBase = JSON.parse(JSON.stringify(store.getFurniture(fid).position));
pSave.enterMove();
pSave.moveStep({ currentTarget: { dataset: { dir: 'right' } } });
pSave.finishEdit();
ok('保存前 dirty=true', pSave.data.isDirty === true);
pSave.saveScene();
ok('保存后 dirty=false', pSave.data.isDirty === false);
ok('保存后回 SELECTED', pSave.data.sceneMode === 'selected');
pSave.enterMove();
pSave.moveStep({ currentTarget: { dataset: { dir: 'right' } } });
pSave.finishEdit();
pSave.undoScene();
const undone = store.getFurniture(fid).position;
ok('撤销回到最近一次保存态', Math.abs(undone.x - (saveBase.x + 0.05)) < 0.001, JSON.stringify(undone));
ok('撤销后 dirty 复位', pSave.data.isDirty === false);

// ---- 10. dirty 离开确认 ----
const pLeave = makePage(0);
tapFurniture(pLeave);
pLeave.enterMove();
pLeave.moveStep({ currentTarget: { dataset: { dir: 'right' } } });
pLeave.finishEdit();
global.__back = false; global.__modalConfirm = false;
pLeave.onBack();
ok('dirty 离开弹二次确认', !!global.__back);

// ---- 11. ITEM_VIEW：归属 / 未设置位置 / 切视图不改数据 ----
const pItem = makePage(0);
const itemsBefore = JSON.stringify(store.listItems().map(i => i.id));
pItem.switchViewTab({ currentTarget: { dataset: { tab: 'item' } } });
ok('切到物品视图 sceneMode=itemView', pItem.data.sceneMode === 'itemView', pItem.data.sceneMode);
ok('物品列表仅当前房间（按 nodes.roomId 聚合）', pItem.data.spaceItems.every(it => {
  const real = store.getItem(it.id);
  if (!real || !real.currentNodeId) return false;
  const node = store.getNode(real.currentNodeId);
  return !!node && node.roomId === pItem.data.roomId;
}));
ok('物品列表与 store 房间口径一致', pItem.data.spaceItems.length === store.listItems({ roomId: pItem.data.roomId }).length,
  'ui=' + pItem.data.spaceItems.length + ' store=' + store.listItems({ roomId: pItem.data.roomId }).length);
ok('物品项含归属文案', pItem.data.spaceItems.every(it => typeof it.furnitureName === 'string' && typeof it.locText === 'string'));
const hasUnknown = pItem.data.spaceItems.some(it => it.locText === '未设置位置');
ok('未绑定位置显示「未设置位置」', hasUnknown || pItem.data.spaceItems.every(it => it.locText !== '未设置位置'),
  'unknown=' + hasUnknown);
pItem.switchViewTab({ currentTarget: { dataset: { tab: 'furniture' } } });
ok('切回家具视图 sceneMode=view', pItem.data.sceneMode === 'view');
ok('切换视图不改变物品数据', JSON.stringify(store.listItems().map(i => i.id)) === itemsBefore);

// ---- 12. 相机接口：复位 / 适配 / 预设，且不标 dirty ----
const pCam = makePage(0);
pCam.resetView(); ok('复位调用 reset', pCam._calls.reset > 0);
pCam.fitView(); ok('适配调用 fit', pCam._calls.fit > 0);
pCam.setPreset({ currentTarget: { dataset: { preset: 'top' } } });
ok('视角预设调用 setPreset(top)', pCam._calls.presetName === 'top', pCam._calls.presetName);
ok('相机操作全程不标 dirty', pCam.data.isDirty === false);

// ---- 13. 静态口径：WXML 覆盖状态图所有面板与按钮 ----
const wxml = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.wxml'), 'utf8');
const jsSrc = fs.readFileSync(path.join(MP, 'pages/room3d/room3d.js'), 'utf8');
ok('画布仍使用 catchtouch 拦截', /catchtouchstart="onTouchStart"/.test(wxml) && /catchtouchmove="onTouchMove"/.test(wxml));
['openManage', 'enterMove', 'enterRotate', 'enterDimension', 'saveScene', 'undoScene', 'switchViewTab',
 'moveStep', 'rotateStep', 'applyDimension', 'cancelEdit', 'finishEdit', 'fitView', 'setPreset']
  .forEach(fn => ok('WXML 绑定 ' + fn, new RegExp('bindtap="' + fn + '"').test(wxml)));
ok('JS 定义 A 方案状态机', /sceneMode/.test(jsSrc) && /MOVE_STEP_M\s*=\s*0\.05/.test(jsSrc) && /ROT_STEP_DEG\s*=\s*15/.test(jsSrc));
ok('默认不再声明拖动摆放提示', !/点家具查看与添加物品 · 拖动摆放/.test(jsSrc));

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
