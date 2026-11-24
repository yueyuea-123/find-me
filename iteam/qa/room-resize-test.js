/**
 * 房间长宽调整回归（纯 Node）
 * 覆盖评估报告 N-01 五处冲突的解法（菜单表单式，不做三维内拖墙手势）：
 *   1. store.updateRoom 尺寸变化 → layout 按新房尺寸重建（冲突⑤即期望行为）
 *   2. 房间缩小后越界家具自动钳回边界（D-04），家具大于房间时钳到中心
 *   3. 返回值携带 clampedFurniture 数量供页面提示；未越界家具位置不动
 *   4. 页面方法与 WXML 接线：roomMenu「调整长宽」/ openRoomSize / applyRoomSize 等
 *   5. 撤销口径：表单式立即生效，不进家具撤销栈（等同改名）
 * 用法: node qa/room-resize-test.js
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

// ========== 1. 静态接线：菜单项 / 方法 / WXML 绑定 ==========
const js = read('pages/room3d/room3d.js');
const wxml = read('pages/room3d/room3d.wxml');
ok(js.indexOf("'房间照片', '家具管理', '调整长宽', '重命名房间'") >= 0, 'roomMenu 含「调整长宽」项');
ok(js.indexOf('openRoomSize: function') >= 0, 'room3d 实现 openRoomSize 方法');
ok(js.indexOf('applyRoomSize: function') >= 0, 'room3d 实现 applyRoomSize 方法');
ok(js.indexOf('cancelRoomSize: function') >= 0, 'room3d 实现 cancelRoomSize 方法');
ok(js.indexOf('onRoomSizeInput: function') >= 0, 'room3d 实现 onRoomSizeInput 方法');
ok(wxml.indexOf('wx:if="{{showRoomSize}}"') >= 0, 'WXML 长宽面板（wx:if 链头）');
ok(wxml.indexOf('bindtap="applyRoomSize"') >= 0, '「应用」按钮已接线');
ok(wxml.indexOf('bindtap="cancelRoomSize"') >= 0, '「取消」按钮已接线');
ok(wxml.indexOf('bindinput="onRoomSizeInput"') >= 0, '长宽输入已接线');
ok(js.indexOf('pickWall') < 0 && js.indexOf('wallEdit') < 0 && js.indexOf('_syncSceneToGL();') >= 0,
  '页面只同步数据+重渲染（renderer 尺寸变化自动重建，无手势/墙编辑态残留）');
ok(js.indexOf('showRoomSize: false') >= 0, '面板默认关闭');
// 撤销口径：长宽调整不写 _undoStack / isDirty（表单式立即生效，等同改名）
ok(/applyRoomSize[\s\S]*?^  \}/m.test(js) && !/applyRoomSize[\s\S]*?_undoStack/m.test(js.split('cancelRoomSize: function')[0].split('openRoomSize: function')[1] || ''),
  'applyRoomSize 不触碰家具撤销栈');

// ========== 2. 真实数据层：钳制与 layout 重建 ==========
store.clearAll();
const sp = store.addSpace('测试空间').data;
const room = store.addRoom(sp.id, '客厅', { width: 5, depth: 5, height: 2.8 }).data;
// 三件家具：A 在房间中部（缩小后不越界）；B 在角落（5m 房间边缘，缩小到 2m 后越界需钳回）；C 尺寸大于房间（钳到中心）
const fA = store.addFurniture(room.id, { category: '床', name: '床A' }).data;
store.updateFurniture(fA.id, { position: { x: 0.5, y: 0, z: 0.5 }, size: { w: 1, d: 0.8, h: 0.5 } });
const fB = store.addFurniture(room.id, { category: '沙发', name: '沙发B' }).data;
store.updateFurniture(fB.id, { position: { x: 2.3, y: 0, z: 2.3 }, size: { w: 0.8, d: 0.8, h: 0.8 } }); // 紧贴 5m 房间墙角
const fC = store.addFurniture(room.id, { category: '衣柜', name: '大衣柜C' }).data;
store.updateFurniture(fC.id, { position: { x: 1, y: 0, z: 1 }, size: { w: 6, d: 6, h: 2 } }); // 6m 家具 > 2m 新房间

const r = store.updateRoom(room.id, { width: 2, depth: 2 });
ok(r.ok, 'updateRoom 缩小到 2×2m 成功');
ok(r.clampedFurniture === 2, '返回钳制数量 = 2（B 越界钳回 + C 钳中心）', r.clampedFurniture);

const gA = store.getFurniture(fA.id), gB = store.getFurniture(fB.id), gC = store.getFurniture(fC.id);
ok(gA.position.x === 0.5 && gA.position.z === 0.5, '未越界家具 A 位置不动', JSON.stringify(gA.position));
// B：新边界 halfW=1，钳到 |x| <= 1-0.4=0.6
ok(Math.abs(gB.position.x) <= 0.6 && Math.abs(gB.position.z) <= 0.6,
  '越界家具 B 钳回边界内（保留半个家具尺寸）', JSON.stringify(gB.position));
// C：6m 家具大于 2m 房间（lo>hi），clampCenter 固定到房间中心
ok(gC.position.x === 0 && gC.position.z === 0, '大于房间的家具 C 钳到中心', JSON.stringify(gC.position));
// layout 随新尺寸重建（冲突⑤：菜单表单方案下 layout 重建即期望行为）
const gRoom = store.getRoom(room.id);
ok(gRoom.layout && gRoom.layout.floor && gRoom.layout.floor.w === 2 && gRoom.layout.floor.d === 2,
  'layout 按新房尺寸重建', JSON.stringify(gRoom.layout && gRoom.layout.floor));
ok(gRoom.width === 2 && gRoom.depth === 2, '房间尺寸已落库');

// 放大回去：家具不被误移动（钳制只在越界时生效）
const before = JSON.stringify(gB.position);
const r2 = store.updateRoom(room.id, { width: 5, depth: 5 });
ok(r2.ok && r2.clampedFurniture === 0, '放大房间零钳制', r2.clampedFurniture);
ok(JSON.stringify(store.getFurniture(fB.id).position) === before, '放大后家具位置不变');

// 校验：非法尺寸被拒
ok(!store.updateRoom(room.id, { width: 0 }).ok, 'width=0 被拒（Number||0 后为 0，房间尺寸须为正）');
ok(store.getRoom(room.id).width === 5, '房间尺寸未被非法值破坏');

// ========== 3. 页面方法执行：面板回显与校验 ==========
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

const toasts = [];
function makePage() {
  const p = Object.assign({}, def);
  p.data = Object.assign({}, JSON.parse(JSON.stringify(def.data)));
  p.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
  p._initGL = function () {};
  p._withGL = function () { return null; };
  p._safeRender = function () {};
  p._syncSceneToGL = function () {};
  p.showToast = o => toasts.push(o.title);
  global.wx.showToast = o => toasts.push(o.title);
  p.onLoad({ id: room.id });
  p.loadData();
  return p;
}

const pSize = makePage();
pSize.openRoomSize();
ok(pSize.data.showRoomSize === true, 'openRoomSize 打开面板');
ok(pSize.data.roomSizeW === '500' && pSize.data.roomSizeD === '500',
  '回显当前尺寸 cm（5m → 500）', pSize.data.roomSizeW + '/' + pSize.data.roomSizeD);

// 非法输入：0
pSize.setData({ roomSizeW: '0', roomSizeD: '500' });
pSize.applyRoomSize();
ok(pSize.data.showRoomSize === true && toasts.some(t => /大于 0/.test(t)), '长宽为 0 被拒且面板不关');

// 超范围
pSize.setData({ roomSizeW: '6000', roomSizeD: '500' });
pSize.applyRoomSize();
ok(pSize.data.showRoomSize === true && toasts.some(t => /50–5000/.test(t)), '超出 50–5000cm 被拒');

// 合法修改：缩小到 2m，越界家具被钳（房间刚放大回 5m，家具在原位；再把 B 放回角落）
store.updateFurniture(fB.id, { position: { x: 2.3, y: 0, z: 2.3 } });
pSize.setData({ roomSizeW: '200', roomSizeD: '200' });
pSize.applyRoomSize();
ok(pSize.data.showRoomSize === false, '合法修改后关闭面板');
ok(store.getRoom(room.id).width === 2, '新尺寸落库');
ok(Math.abs(store.getFurniture(fB.id).position.x) <= 0.6, '页面路径下越界家具同样被钳回');
ok(toasts.some(t => /收回边界/.test(t)), 'toast 提示钳制数量');

// 取消
pSize.setData({ showRoomSize: false });
pSize.cancelRoomSize();
ok(pSize.data.showRoomSize === false, 'cancelRoomSize 关闭面板');

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
