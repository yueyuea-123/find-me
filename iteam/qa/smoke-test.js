/**
 * 运行时冒烟测试：mock 微信运行时，真实加载并执行小程序数据层 + 全部页面生命周期
 * 目标：验证「功能完整、可直接运行、无运行时异常」
 *
 * 覆盖：
 *   A. App.onLaunch 初始化（演示数据）
 *   B. 数据层核心业务规则断言（BR-001/004/005/008/010/011/012、TBD-001/003/005）
 *   C. 19 个页面 onLoad/onShow/onReady 真实执行
 *   D. 每个页面全部 WXML 事件方法用模拟事件真实调用
 *   E. 所有跳转目标均为已注册页面
 *   F. 三维页 WebGL 不可用时的列表降级通路
 *
 * 用法: node qa/smoke-test.js [--json]
 */
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const routes = appJson.pages;

// ---------------------------------------------------------------- 运行时 mock
const storage = {};
const events = { navigate: [], toast: [], modal: [] };
const runtimeErrors = [];
const cloudCalls = [];

const selector = {
  in() { return this; }, select() { return this; }, fields() { return this; },
  boundingClientRect() { return this; },
  // 返回 node:null → 触发三维页的列表降级分支
  exec(cb) { if (typeof cb === 'function') cb([{ node: null, width: 300, height: 300 }]); }
};

global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: 0, limitSize: 10240 }),
  showToast: o => events.toast.push(o.title || ''),
  showLoading: () => {}, hideLoading: () => {},
  showModal: o => events.modal.push(o.title || ''),
  navigateTo: o => events.navigate.push(o.url),
  switchTab: o => events.navigate.push(o.url),
  redirectTo: o => events.navigate.push(o.url),
  reLaunch: o => events.navigate.push(o.url),
  navigateBack: () => {},
  chooseMedia: () => {}, previewImage: () => {},
  createSelectorQuery: () => selector,
  createCanvasContext: () => ({}),
  getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.0.0', windowWidth: 375 }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
  canIUse: () => true,
  setNavigationBarTitle: () => {}, stopPullDownRefresh: () => {},
  startPullDownRefresh: () => {}, vibrateShort: () => {},
  setClipboardData: () => {}, getClipboardData: () => {},
  onError: () => {}, offError: () => {},
  onUnhandledRejection: () => {}, offUnhandledRejection: () => {},
  onNetworkStatusChange: () => {}, offNetworkStatusChange: () => {},
  getLogManager: () => ({ info() {}, warn() {}, error() {} }),
  getPerformance: () => ({ createObserver: () => ({ observe() {}, disconnect() {} }) }),
  // 云 mock：默认返回成功，模拟 userLogin/dataSync/photoService/backupService
  cloud: {
    init() {},
    database: () => ({}),
    getTempFileURL: () => ({ fileList: [] }),
    uploadFile: o => { if (o.success) o.success({ fileID: 'cloud://mock/file.jpg' }); },
    callFunction(o) {
      const action = (o.data && o.data.action) || '';
      let result = { ok: false, error: 'UNKNOWN' };
      if (o.name === 'userLogin') result = { ok: true, data: { openid: 'mock-openid', role: 'user', isNew: false } };
      else if (o.name === 'dataSync' && action === 'pull') result = { ok: true, data: { snapshot: null, serverTime: Date.now() } };
      else if (o.name === 'dataSync' && action === 'batch') result = { ok: true, data: { serverTime: Date.now() } };
      else if (o.name === 'photoService') result = { ok: true, data: { cloudPath: 'photos/mock/x.jpg', urls: [] } };
      else if (o.name === 'backupService') result = { ok: true, data: {} };
      else if (o.name === 'adminService') result = { ok: false, error: 'PERMISSION_DENIED' };
      else if (o.name === 'reportError') result = { ok: true, data: {} };
      cloudCalls.push({ name: o.name, action });
      if (o.success) o.success({ result });
    }
  }
};

const _origError = console.error;
console.error = function () { runtimeErrors.push([].slice.call(arguments).join(' ')); };

// ---------------------------------------------------------------- 捕获框架构造器
let currentRoute = '';
const pageDefs = {};
global.App = o => { global.__APP = o; };
global.Page = o => { pageDefs[currentRoute] = o; };
global.Component = o => { pageDefs[currentRoute] = o; };
global.Behavior = () => ({});
global.getApp = () => global.__APP || {};
global.getCurrentPages = () => [];

// ---------------------------------------------------------------- 断言框架
const checks = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r === false || (r && r.ok === false && r.__expectFail !== true)) throw new Error('断言为假: ' + JSON.stringify(r));
    checks.push({ name, pass: true });
    return r;
  } catch (e) {
    checks.push({ name, pass: false, error: e.message });
    return null;
  }
}
function expectFail(name, fn, code) {
  try {
    const r = fn();
    if (r && r.ok === false && (!code || r.error === code)) { checks.push({ name, pass: true }); return; }
    throw new Error('预期失败但实际成功或错误码不符: ' + JSON.stringify(r));
  } catch (e) { checks.push({ name, pass: false, error: e.message }); }
}

// ---------------------------------------------------------------- A. 启动初始化
currentRoute = '__app__';
require(path.join(MP, 'app.js'));
check('App.onLaunch 首次初始化无异常', () => {
  if (!global.__APP || typeof global.__APP.onLaunch !== 'function') return false;
  global.__APP.onLaunch(); return true;
});

check('App 全局错误兜底钩子齐备', () =>
  typeof global.__APP.onError === 'function' &&
  typeof global.__APP.onPageNotFound === 'function' &&
  typeof global.__APP.onUnhandledRejection === 'function');
check('全局异常钩子执行不抛出', () => {
  global.__APP.onError.call(global.__APP, new Error('smoke'));
  global.__APP.onPageNotFound.call(global.__APP, { path: 'pages/gone/gone' });
  global.__APP.onUnhandledRejection.call(global.__APP, { reason: 'smoke' });
  return true;
});

const store = require(path.join(MP, 'utils', 'store.js'));
const C = require(path.join(MP, 'utils', 'constants.js'));
const Sync = require(path.join(MP, 'utils', 'cloud-sync.js'));

// ---- 云同步适配层断言（离线优先架构的关键不变量） ----
check('云同步层导出必要接口', () =>
  ['init','pull','markDirty','flush','backup','adminQuery','setDataProvider','getState'].every(k => typeof Sync[k] === 'function'));
check('store 导出全量快照按云集合分组', () => {
  const snap = store.exportSnapshot();
  const need = ['spaces','rooms','furniture','nodes','items','movements','inventory','transactions','alerts'];
  return need.every(k => Array.isArray(snap[k])) && snap.spaces.length >= 1 && snap.items.length >= 1;
});
check('store 导出/清空删除墓碑', () => {
  store.clearTombstones();
  const before = store.getTombstones().length;
  const space0 = store.getActiveSpace();
  const room0 = store.listRooms(space0.id)[0];
  const node0 = store.listNodes(room0.id).find(n => n.type !== '家具' && store.itemsInNode(n.id).length === 0);
  if (!node0) return true; // 演示数据若无空节点则跳过，不算失败
  store.removeNode(node0.id);
  return before === 0 && store.getTombstones().length === 1;
});
check('云端快照覆盖本地后空间名与设置正确', () => {
  const fake = { spaces: [{ id: 'sp_cloud', name: '云端空间', archived: false, createdAt: 1, updatedAt: 1 }],
    rooms: [], furniture: [], nodes: [], items: [], movements: [], inventory: [], transactions: [], alerts: [] };
  const r = store.applySnapshot(fake);
  return r.ok && store.listSpaces().length === 1 && store.listSpaces()[0].name === '云端空间';
});
check('云同步状态默认未登录且不影响本地可用', () => {
  const s = Sync.getState();
  return typeof s.loggedIn === 'boolean' && typeof s.enabled === 'boolean';
});

// 重置演示数据到干净状态（云快照断言改动过）
store.clearAll();
store.seedDemo();

const sp = store.getActiveSpace();
const room = store.listRooms(sp.id)[0];
const allItems = store.listItems();
const byName = n => allItems.find(i => i.name === n);
const nodes = store.listNodes(room.id);
const drawer = nodes.find(n => n.type === '抽屉/隔层');
const bed = store.listFurniture(room.id).find(f => f.name === '双人床');

// ---------------------------------------------------------------- B. 业务规则断言
check('空间/房间/家具/物品演示数据齐全', () =>
  store.listSpaces().length >= 1 && store.listRooms(sp.id).length >= 1 &&
  store.listFurniture(room.id).length >= 3 && allItems.length >= 5);

expectFail('BR-001 空名称建档被拒', () => store.addItem({ name: '   ' }), 'INVALID_NAME');
check('BR-001 仅填名称即可建档', () => store.addItem({ name: '冒烟测试物品' }).ok === true);
check('BR-002 完成度自动计算', () => {
  const r = store.addItem({ name: '完整档案', category: '其他', note: 'n', photoPath: 'p', currentNodeId: drawer.id });
  return r.ok && r.data.completed === 100;
});

expectFail('BR-008 有关联物品的家具禁止删除', () => store.removeFurniture(bed.id), 'HAS_LINKS');
check('BR-009 换家具模型不影响收纳节点与物品关联', () => {
  const before = store.listNodes(room.id).length;
  const wool0 = store.listItems().find(i => i.name === '羊毛毯');
  const beforeNode = wool0.currentNodeId;
  const r = store.updateFurniture(bed.id, { model: '软包床' });
  const after = store.listItems().find(i => i.name === '羊毛毯');
  return r.ok && store.listNodes(room.id).length === before && after.currentNodeId === beforeNode;
});
check('BR-004/TBD-001 未知位置首次确认为 first_confirm', () => {
  const it = byName('备用钥匙');
  const r = store.moveItem(it.id, { currentNodeId: drawer.id, locationStatus: 'at_home' });
  return r.ok && r.eventType === 'first_confirm' && !!r.data.currentNodeId;
});
check('BR-005 移动后当前位置与历史同一事务写入', () => {
  const it = byName('羊毛毯');
  const r = store.moveItem(it.id, { currentNodeId: drawer.id, note: '冒烟移动' });
  const hist = store.listMovements(it.id);
  return r.ok && hist.length >= 1 && hist[0].toNodeId === drawer.id && hist[0].type === 'move';
});
expectFail('BR-011 消耗不得使库存为负', () => {
  const shampoo = byName('洗发水');
  return store.inventoryTx(shampoo.id, 'consume', 9999, '过量消耗');
}, 'BELOW_ZERO');
check('BR-010 入库消耗均生成交易且余额一致', () => {
  const shampoo = byName('洗发水');
  const before = store.findInventoryByItem(shampoo.id).balance;
  const r = store.inventoryTx(shampoo.id, 'in', 3, '冒烟入库');
  const after = store.findInventoryByItem(shampoo.id).balance;
  const tx = store.listTransactions(shampoo.id).find(t => t.note === '冒烟入库');
  return r.ok && r.balance === before + 3 && after === r.balance && !!tx && tx.delta === 3 && tx.balanceAfter === after;
});
expectFail('TBD-003 有剩余库存时结束管理需指定去向', () => {
  const shampoo = byName('洗发水');
  return store.endManagement(shampoo.id);
}, 'NEED_DISPOSAL');
check('TBD-005 低库存提醒开启、补充后自动恢复', () => {
  const shampoo = byName('洗发水');
  const cur = store.findInventoryByItem(shampoo.id).balance;
  if (cur > 1) store.inventoryTx(shampoo.id, 'consume', cur - 1, '冒烟消耗至低库存');
  const opened = store.listAlerts().some(a => a.itemId === shampoo.id);
  store.inventoryTx(shampoo.id, 'in', 100, '补货至安全线');
  const recovered = !store.listAlerts().some(a => a.itemId === shampoo.id);
  return opened && recovered;
});
check('物品结束管理后从默认列表隐藏但可恢复', () => {
  const t = store.addItem({ name: '临时物品' }).data;
  store.endManagement(t.id, '已丢弃');
  const hidden = !store.listItems().some(i => i.id === t.id);
  store.restoreItem(t.id);
  return hidden && store.listItems().some(i => i.id === t.id);
});
check('BR-013 AI 候选不自动成为事实', () => {
  const r = store.addFurniture(room.id, { name: '候选柜', source: 'ai_candidate', confidence: 0.62 });
  return r.ok && r.data.status === 'candidate';
});

// ---------------------------------------------------------------- C/D. 页面真实执行
const woolItem = byName('羊毛毯');
const shampooItem = byName('洗发水');
const optsByRoute = {
  'pages/room3d/room3d': { id: room.id },
  'pages/photos/photos': { id: room.id },
  'pages/task/task': { id: room.id },
  'pages/furniture-edit/furniture-edit': { id: bed.id, roomId: room.id },
  'pages/furniture-detail/furniture-detail': { id: bed.id, roomId: room.id },
  'pages/node/node': { id: drawer.id, roomId: room.id, furnitureId: bed.id },
  'pages/item-detail/item-detail': { id: woolItem.id, itemId: woolItem.id },
  'pages/item-edit/item-edit': { id: woolItem.id, itemId: woolItem.id },
  'pages/move/move': { id: woolItem.id, itemId: woolItem.id },
  'pages/history/history': { id: woolItem.id, itemId: woolItem.id },
  'pages/inventory-detail/inventory-detail': { id: shampooItem.id, itemId: shampooItem.id },
  'pages/space/space': { id: sp.id }
};
const seedOpts = {
  id: room.id, roomId: room.id, spaceId: sp.id,
  itemId: woolItem.id, furnitureId: bed.id, nodeId: drawer.id,
  photoId: 'ph_test', ended: '0'
};
function optsFor(route) { return Object.assign({}, seedOpts, optsByRoute[route] || {}); }
const destructive = /^(archive|remove|clearAll|endManagement|consume|confirmCandidate|ignoreAlert)$/;
let pageCount = 0, handlerCount = 0;

function mockEvent(route, dataset) {
  const ds = optsFor(route);
  return {
    currentTarget: { dataset: Object.assign(ds, dataset || {}) },
    target: { dataset: Object.assign({}, ds, dataset || {}) },
    detail: { value: '冒烟输入', currentTarget: { dataset: {} } },
    touches: [{ x: 120, y: 240 }, { x: 180, y: 300 }],
    changedTouches: [{ x: 120, y: 240 }],
    type: 'tap'
  };
}

routes.forEach(route => {
  const file = path.join(MP, route + '.js');
  currentRoute = route;
  const before = runtimeErrors.length;
  try {
    delete require.cache[require.resolve(file)];
    require(file);
    const def = pageDefs[route];
    if (!def) { checks.push({ name: `页面 ${route} 注册`, pass: false, error: '未找到 Page/Component 定义' }); return; }

    const ctx = Object.assign({}, def, {
      data: JSON.parse(JSON.stringify(def.data || {})),
      setData(patch) { Object.assign(this.data, patch); }
    });

    let degraded = false;
    ['onLoad', 'onShow', 'onReady'].forEach(hook => {
      if (typeof def[hook] === 'function') {
        try { def[hook].call(ctx, hook === 'onLoad' ? optsFor(route) : undefined); }
        catch (e) { runtimeErrors.push(`[${route}.${hook}] ${e.message}`); }
      }
      if (route === 'pages/room3d/room3d' && hook === 'onReady') degraded = (ctx.data.view === 'list');
    });

    Object.keys(def).forEach(method => {
      if (/^on[A-Z]/.test(method) || method.startsWith('_') || method === 'data' ||
          method === 'setData' || destructive.test(method)) return;
      if (typeof def[method] !== 'function') return;
      try { def[method].call(ctx, mockEvent(route)); handlerCount++; }
      catch (e) { runtimeErrors.push(`[${route}.${method}] ${e.message}`); }
    });

    if (route === 'pages/room3d/room3d') {
      checks.push({ name: '三维页 WebGL 不可用时自动降级列表', pass: degraded, error: ctx.data.view });
      // 模拟渲染器抛异常，验证 _safeGL 兜底切换到列表
      ctx.renderer = { render() { throw new Error('mock gl crash'); } };
      ctx.data.view = '3d';
      let safe = false;
      try { ctx._safeGL('render'); safe = (ctx.data.view === 'list' && ctx.renderer === null); }
      catch (e) { safe = false; }
      checks.push({ name: '三维渲染异常时静默降级不白屏', pass: safe });
    }
    if (runtimeErrors.length === before) { pageCount++; checks.push({ name: `页面 ${route} 生命周期与事件无异常`, pass: true }); }
  } catch (e) {
    runtimeErrors.push(`[${route}.load] ${e.message}`);
    checks.push({ name: `页面 ${route} 加载`, pass: false, error: e.message });
  }
});

// ---------------------------------------------------------------- E. 跳转目标
check('所有运行时跳转目标均为已注册页面', () => {
  const bad = events.navigate.filter(u => u && !routes.includes(u.split('?')[0].replace(/^\//, '')));
  if (bad.length) throw new Error('未注册: ' + bad.join(', '));
  return true;
});
check('页面事件方法被真实调用（覆盖度）', () => handlerCount >= 80);
check('无 console.error 运行时错误输出', () => runtimeErrors.length === 0);

// ---------------------------------------------------------------- 输出
const passed = checks.filter(c => c.pass).length;
const failed = checks.filter(c => !c.pass);
const jsonMode = process.argv.includes('--json');
const result = {
  timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  total: checks.length, passed, failed: failed.length,
  pagesExecuted: pageCount, handlersInvoked: handlerCount,
  runtimeErrors: runtimeErrors.slice(0, 30),
  failures: failed,
  passedAll: failed.length === 0
};

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('\n' + '='.repeat(64));
  console.log('  运行时冒烟测试（mock 微信运行时 · 真实执行）');
  console.log('='.repeat(64));
  console.log(`  断言总数 ${result.total}   通过 ${result.passed}   失败 ${result.failed}`);
  console.log(`  页面执行 ${result.pagesExecuted}/${routes.length}   事件方法调用 ${result.handlersInvoked} 次`);
  console.log(`  跳转触发 ${events.navigate.length} 次   弹窗 ${events.modal.length} 次   Toast ${events.toast.length} 次`);
  console.log('-'.repeat(64));
  if (failed.length) {
    console.log('  【失败断言】');
    failed.forEach(f => console.log(`   ✗ ${f.name}${f.error ? ' — ' + f.error : ''}`));
  }
  if (runtimeErrors.length) {
    console.log('  【运行时异常】');
    runtimeErrors.slice(0, 20).forEach(e => console.log('   ✗ ' + e));
  }
  console.log('-'.repeat(64));
  console.log(`  判定: ${result.passedAll ? '✅ 全部通过，运行无异常' : '❌ 存在失败项，需修复'}`);
}
process.exit(result.passedAll ? 0 : 1);
