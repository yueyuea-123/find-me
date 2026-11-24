/**
 * 阶段四回归：房间类型模板库扩充（纯 Node，无需开发者工具）
 * 覆盖：
 *   1. 模板库可列举，原有 3 个 + 新增 5 个共 8 类齐备
 *   2. 每个模板引用的家具品类都在 FURNITURE_LIB 中（不产生无模型家具）
 *   3. 应用新增模板能批量写家具 + 收纳节点，房间记 source=template
 *   4. 家具坐标按房间尺寸钳制，不越界
 *   5. 同一模板重复应用幂等（不重复追加）
 *   6. BR-009：模板家具下可正常绑定物品，背包/绑定关系不受影响
 *   7. room 页 setStart 同步中文名，wxml 保留既有模板按钮断言
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

// 1. 模板库完整性
const list = store.listRoomTemplates();
const allKeys = ['bedroom', 'living', 'bath', 'study', 'kitchen', 'dining', 'balcony', 'kids'];
ok('模板库可列举且 8 类齐备', Array.isArray(list) && allKeys.every(k => list.some(t => t.key === k)),
  '实际 ' + list.length + ' 类: ' + list.map(t => t.key).join(','));
ok('每类模板含名称与家具件数', list.every(t => t.name && t.count > 0));

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
ok('书房模板写入 5 件家具', furn.length === 5, '实际 ' + furn.length + ' 件');
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
ok('模板重复应用幂等（家具不重复追加）', again.ok && again.data.applied === false && furnAfter.length === 5,
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
page.setData = o => Object.assign(page.data, o);
page.setStart({ currentTarget: { dataset: { key: 'study' } } });
ok('setStart 同步模板 key', page.data.startTemplate === 'study');
ok('setStart 同步模板中文名', page.data.startTemplateName === '书房', page.data.startTemplateName);

const wxml = fs.readFileSync(path.join(MP, 'pages/room/room.wxml'), 'utf8');
ok('wxml 保留「创建空白房间」按钮', wxml.includes('创建空白房间'));
ok('wxml 保留「用卧室模板」按钮', wxml.includes('用卧室模板'));
ok('wxml 动态渲染模板列表', wxml.includes('wx:for="{{templates}}"') && wxml.includes('setStart'));

console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
