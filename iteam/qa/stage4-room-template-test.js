/**
 * 阶段四回归：房间类型模板库（纯 Node，无需开发者工具）
 * 2026-11-24 空间模块收敛后口径：
 *   - 新建只开放 6 类模板 + 空白（文档 7 类中的「其他」）
 *   - dining/kids 保留定义仅兼容旧数据，不出现在新建列表
 * 覆盖：
 *   1. 新建可选类型收敛为 6 类，legacy 模板不出现
 *   2. 每个模板引用的家具品类都在 FURNITURE_LIB 中（替代模型也必须合法）
 *   3. 应用模板能批量写家具 + 收纳节点，房间记 source=template
 *   4. 家具坐标按房间尺寸钳制，不越界；模板可覆盖 size/model
 *   5. 同一模板重复应用幂等（不重复追加）
 *   6. BR-009：模板家具下可正常绑定物品，绑定关系不受影响
 *   7. room 页：默认房名、setStart 同步、建房后自动进三维、列表管理入口
 * 用法: node qa/stage4-room-template-test.js
 */
const fs = require('fs');
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');

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

currentRoute = '__app__';
require(path.join(MP, 'app.js'));
if (global.__APP && global.__APP.onLaunch) global.__APP.onLaunch();
const store = require(path.join(MP, 'utils/store.js'));
const C = require(path.join(MP, 'utils/constants.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n=== 阶段四：房间类型模板库 ===');

// 1. 模板库完整性（新建可选 6 类；legacy 兼容）
const list = store.listRoomTemplates();
const allKeys = ['bedroom', 'living', 'bath', 'study', 'kitchen', 'dining', 'balcony', 'kids'];
const creatable = C.CREATABLE_ROOM_TEMPLATES;
ok('新建可选类型收敛为 6 类', Array.isArray(list) && list.length === 6 &&
  creatable.every(k => list.some(t => t.key === k)),
  '实际 ' + list.length + ' 类: ' + list.map(t => t.key).join(','));
ok('legacy 餐厅/儿童房不再出现在新建列表',
  !list.some(t => t.key === 'dining' || t.key === 'kids'));
ok('每类模板含名称、默认房名与家具件数',
  list.every(t => t.name && t.defaultName && t.count > 0));

// 2. 品类合法性：所有模板家具 category 必须在 FURNITURE_LIB 中
const badRefs = [];
allKeys.forEach(k => {
  (C.ROOM_TEMPLATES[k].furniture || []).forEach(it => {
    if (!C.FURNITURE_LIB[it.category]) badRefs.push(k + ':' + it.category);
  });
});
ok('所有模板家具品类都有模型（FURNITURE_LIB）', badRefs.length === 0,
  badRefs.length ? '缺失: ' + badRefs.join(',') : '无缺失');

// 3-4. 应用新增模板 + 坐标钳制
const sp = store.getActiveSpace();
const r = store.addRoom(sp.id, '阶段四书房测试', { width: 3.0, depth: 2.6, height: 2.6 });
ok('测试房间创建成功', r.ok, r.error || r.data.id);
const applied = store.applyRoomTemplate(r.data.id, 'study');
ok('应用书房模板成功', applied.ok && applied.data.applied !== false);
const furn = store.listFurniture(r.data.id);
ok('书房模板写入 4 件家具', furn.length === 4, '实际 ' + furn.length + ' 件');
// 模板覆盖 size/model：书桌按模板尺寸落库，而非餐桌默认尺寸
const desk = furn.find(f => f.name === '书桌');
ok('模板可覆盖家具尺寸（书桌 1.2×0.75×0.6）',
  !!desk && desk.size.w === 1.2 && desk.size.h === 0.75 && desk.size.d === 0.6,
  desk ? JSON.stringify(desk.size) : '未找到书桌');
const rm = store.getRoom(r.data.id);
ok('房间记 source=template、templateKey=study', rm.source === 'template' && rm.templateKey === 'study');
const halfW = rm.width / 2, halfD = rm.depth / 2;
const inBounds = furn.every(f =>
  Math.abs(f.position.x) <= halfW + 0.01 && Math.abs(f.position.z) <= halfD + 0.01);
ok('模板家具坐标按房间尺寸钳制不越界', inBounds,
  '房间 ' + rm.width + 'x' + rm.depth + 'm');

// 5. 幂等
const again = store.applyRoomTemplate(r.data.id, 'study');
const furnAfter = store.listFurniture(r.data.id);
ok('模板重复应用幂等（家具不重复追加）', again.ok && again.data.applied === false && furnAfter.length === 4,
  '重复后仍 ' + furnAfter.length + ' 件');

// 6. BR-009：模板家具下绑定物品
const nodes = store.listNodes(r.data.id);
const targetNode = nodes.find(n => n.furnitureId && n.type === '家具');
ok('模板家具生成了收纳节点', !!targetNode, targetNode ? targetNode.name : '无');
if (targetNode) {
  const before = store.listItems({ spaceId: sp.id }).length;
  const it = store.addItem({ name: '模板绑定测试物', currentNodeId: targetNode.id, category: '其他' });
  const after = store.listItems({ spaceId: sp.id }).length;
  ok('物品可绑定到模板家具节点（BR-009）', it.ok && after === before + 1 && it.data.currentNodeId === targetNode.id,
    '物品 ' + before + ' -> ' + after);
  // 应用另一模板不影响既有绑定
  store.applyRoomTemplate(r.data.id, 'kids');
  const bound = store.listItems({ spaceId: sp.id }).find(x => x.id === it.data.id);
  ok('再应用其他模板不破坏既有物品绑定', !!bound && bound.currentNodeId === targetNode.id,
    bound ? bound.currentNodeId : '未找到物品');
}

// 7. room 页 setStart + wxml 断言
currentRoute = 'pages/room/room';
require(path.join(MP, 'pages/room/room.js'));
const def = pageDefs['pages/room/room'];
const page = Object.assign({}, def);
page.data = Object.assign({}, JSON.parse(JSON.stringify(def.data)), {
  templates: list, startTemplate: '', startTemplateName: ''
});
page.setData = (o, cb) => { Object.assign(page.data, o); if (cb) cb(); };
page.setStart({ currentTarget: { dataset: { key: 'study' } } });
ok('setStart 同步模板 key', page.data.startTemplate === 'study');
ok('setStart 同步模板中文名', page.data.startTemplateName === '书房', page.data.startTemplateName);
ok('setStart 自动填入默认房名', (page.data.formName || '').indexOf('书房') === 0, page.data.formName);

// 用户手输名称后切换模板，不覆盖用户名称
page.data.formName = '我的工作间'; page._autoName = '';
page.setStart({ currentTarget: { dataset: { key: 'living' } } });
ok('切换模板不覆盖用户手输名称', page.data.formName === '我的工作间', page.data.formName);

// 8. 建房流程：默认名 + 模板落库 + 自动进入三维
const beforeRooms = store.listRooms(sp.id).length;
page.data.formName = ''; page.data.startTemplate = ''; page._autoName = '';
page.data.showEditor = true;
page.createRoom({ currentTarget: { dataset: { template: 'bedroom' } } });
const afterRooms = store.listRooms(sp.id);
const created = afterRooms[afterRooms.length - 1];
ok('建房默认名按类型生成（主卧）', !!created && created.name.indexOf('主卧') === 0,
  created ? created.name : '未创建');
ok('建房后模板家具落库', !!created && store.listFurniture(created.id).length === 4,
  created ? store.listFurniture(created.id).length + ' 件' : '未创建');
ok('建房后自动进入该房间三维页',
  String(global.__lastNav || '').indexOf('/pages/room3d/room3d?id=' + (created && created.id)) === 0,
  global.__lastNav);
ok('房间总数 +1', afterRooms.length === beforeRooms + 1);

const wxml = fs.readFileSync(path.join(MP, 'pages/room/room.wxml'), 'utf8');
ok('wxml 保留「创建空白房间」按钮', wxml.includes('创建空白房间'));
ok('wxml 保留「用卧室模板」按钮', wxml.includes('用卧室模板'));
ok('wxml 动态渲染模板列表', wxml.includes('wx:for="{{templates}}"') && wxml.includes('setStart'));
ok('房间卡显示物品数', wxml.includes('{{item.itemCount}} 件物品'));
ok('房间卡提供列表内管理入口', wxml.includes('roomActions') && wxml.includes('room-more'));

console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
