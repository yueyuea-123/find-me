/**
 * 用户旅程模拟测试（User Journey Simulation）——纯 Node，mock 微信运行时
 *
 * 与现有单元测试的区别：
 *   单元级（smoke / v12 / P1）测「某个函数对不对」；
 *   本脚本测「虚拟用户从全新状态连续操作，整条链路是否成立」——
 *   真实执行页面 onLoad/onShow/事件方法，让数据层与页面层在同一个连续会话中联动。
 *
 * 模拟旅程：
 *   序章 冷启动 → 第一幕 安家 → 第二幕 布置 → 第三幕 建档 → 第四幕 收藏
 *   → 第五幕 逛库存 → 第六幕 补货 → 第七幕 找东西 → 第八幕 整理
 *   → 第九幕 改主意（防重复/放弃确认）→ 第十幕 结束管理
 *
 * 覆盖本轮 V1.2 更新：首页空态、收藏星标、库存筛选+进度条、清空重搜、保存防重复、放弃修改确认。
 * 用法: node qa/user-journey-sim.js
 */
const path = require('path');

// ---------------------------------------------------------------- 微信运行时 mock
const storage = {};
const ui = { modals: [], toasts: [], nav: [] };
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: 0, limitSize: 10240 }),
  showToast: o => ui.toasts.push(o.title || ''),
  showLoading() {}, hideLoading() {},
  showModal: o => {
    ui.modals.push(o);
    if (o && o.success) o.success({ confirm: true, cancel: false });
  },
  showActionSheet: o => { ui.modals.push({ title: '操作菜单' }); if (o && o.success) o.success({ tapIndex: 0 }); },
  navigateTo: o => ui.nav.push(o.url),
  switchTab: o => ui.nav.push(o.url),
  redirectTo: o => ui.nav.push(o.url),
  reLaunch: o => ui.nav.push(o.url),
  navigateBack: () => ui.nav.push('BACK'),
  chooseMedia() {}, previewImage() {},
  canIUse: () => false,
  getSystemInfoSync: () => ({ windowWidth: 375, SDKVersion: '3.0.0', platform: 'devtools' }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
  getLogManager: () => ({ error() {}, info() {}, warn() {} }),
  createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, fields() { return this; }, exec(cb) { if (cb) cb([]); } }),
  createCanvasContext: () => ({}),
  setNavigationBarTitle() {}, stopPullDownRefresh() {}, vibrateShort() {}
};

const ROOT = path.join(__dirname, '..', 'miniprogram');
const store = require(path.join(ROOT, 'utils', 'store.js'));
const C = require(path.join(ROOT, 'utils', 'constants.js'));

let pass = 0, fail = 0;
function chapter(title) { console.log('\n【' + title + '】'); }
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}

/** 加载页面定义并构造可运行的页面实例（setData 支持 'item.favorite' 点路径） */
function makePage(rel) {
  let def = null;
  const prev = global.Page;
  global.Page = d => { def = d; };
  const full = path.join(ROOT, rel);
  delete require.cache[require.resolve(full)];
  try { require(full); } finally { global.Page = prev; }
  const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
  p.setData = function (patch, cb) {
    let data = typeof patch === 'function' ? (patch.call(this) || {}) : patch;
    Object.keys(data).forEach(key => {
      const parts = key.split('.');
      let cur = this.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = data[key];
    });
    if (typeof cb === 'function') cb.call(this);
  };
  return p;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ================================================================ 序章
chapter('序章 · 全新用户冷启动');
store.clearAll();
const stats0 = store.getStats();
ok(stats0.spaceCount === 0 && stats0.roomCount === 0 && stats0.itemCount === 0,
  '空数据：统计计数全为 0', JSON.stringify(stats0));
ok(store.getHomeOverview().rooms.length === 0, '空数据：首页户型总览无房间（触发空态）');
ok(store.listInventory().length === 0, '空数据：库存列表为空');
ok(store.listAlerts().length === 0, '空数据：无补货提醒');
ok(store.listItems().length === 0, '空数据：物品列表为空');

// ================================================================ 第一幕
chapter('第一幕 · 安家（空间 / 房间）');
const sp = store.addSpace('我的家').data;
ok(!!sp && sp.name === '我的家', '新建空间「我的家」成功');
const rm1 = store.addRoom(sp.id, '客厅', { width: 5, depth: 4, height: 2.8 }).data;
const rm2 = store.addRoom(sp.id, '主卧', { width: 4, depth: 3.5, height: 2.8 }).data;
ok(!!rm1 && !!rm2, '新建客厅与主卧两个房间');
const dup = store.addRoom(sp.id, '客厅', {});
ok(dup.ok === false && dup.error === 'ROOM_NAME_DUPLICATE', '同空间重名房间被拒绝（业务规则生效）');
ok(store.getStats().roomCount === 2 && store.getHomeOverview(sp.id).rooms.length === 2,
  '首页统计与户型总览房间数均更新为 2');

// ================================================================ 第二幕
chapter('第二幕 · 布置（家具 / 收纳位置 / 五层关联）');
const fu = store.addFurniture(rm1.id, { category: '电视柜', name: '客厅电视柜' }).data;
ok(!!fu && fu.name === '客厅电视柜', '在客厅添加电视柜');
// addFurniture 自动生成 type=家具 的根 node（furnitureId 指向家具）
const rootNodes = store.listNodes(rm1.id).filter(n => n.furnitureId === fu.id);
ok(rootNodes.length >= 1, '家具自动生成对应收纳根节点', 'node数=' + rootNodes.length);
const rootNode = rootNodes.filter(n => n.type === '家具')[0] || rootNodes[0];
const drawer = store.addNode(rm1.id, rootNode.id, '第一层抽屉', '收纳盒').data;
ok(!!drawer && drawer.furnitureId === fu.id, '子节点通过 parentId 继承家具绑定（单源关联）');
const bind = store.bindingsOfFurniture(fu.id);
ok(bind.nodeCount >= 2, '家具绑定根节点 + 抽屉，共 ' + bind.nodeCount + ' 个节点');
ok(store.nodePath(drawer.id).join('/').indexOf('客厅') >= 0, '收纳位置路径可追溯到房间');
ok(store.spaceIdOfNode(drawer.id) === sp.id, '收纳位置可追溯到空间（五层关联贯通）');

// ================================================================ 第三幕
chapter('第三幕 · 建档（三种跟踪模式）');
const cert = store.addItem({
  name: '身份证', category: '证件卡片', currentNodeId: drawer.id,
  tags: ['重要'], note: '随身证件'
}).data;
const paper = store.addItem({
  name: '抽纸', category: '卫浴清洁', trackingMode: 'inventory',
  balance: 2, threshold: 5, unit: '包'
}).data;
const detergent = store.addItem({
  name: '洗衣液', category: '卫浴清洁', trackingMode: 'hybrid',
  currentNodeId: drawer.id, balance: 10, threshold: 3, unit: '瓶'
}).data;
ok(!!cert && !!paper && !!detergent, '依次建档：只记位置 / 只记库存 / 位置+库存');
ok(cert.favorite === false && paper.favorite === false, '新档案默认未收藏');
ok(cert.spaceId === sp.id, '带位置建档的物品自动归属到节点所属空间（P1-6）');
ok(store.findInventoryByItem(paper.id) && store.findInventoryByItem(detergent.id),
  '库存模式物品自动生成库存记录');
ok(!store.findInventoryByItem(cert.id), '只记位置物品不生成库存记录');
const invIds = store.listInventory().map(x => x.itemId);
ok(invIds.indexOf(cert.id) < 0 && invIds.indexOf(paper.id) >= 0 && invIds.indexOf(detergent.id) >= 0,
  '库存列表只含 inventory / hybrid 两类');

// ================================================================ 第四幕
chapter('第四幕 · 收藏（详情页星标）');
const detail = makePage('pages/item-detail/item-detail.js');
detail.onLoad({ id: cert.id });
detail.onShow();
ok(detail.data.item && detail.data.item.favorite === false, '详情页载入：初始未收藏');
detail.toggleFavorite();
ok(detail.data.item.favorite === true && store.getItem(cert.id).favorite === true,
  '点击星标：UI 与数据层同步为已收藏');
ok(ui.toasts.indexOf('已收藏') >= 0, '收藏操作给出轻提示');
detail.toggleFavorite();
ok(detail.data.item.favorite === false && store.getItem(cert.id).favorite === false,
  '再次点击：取消收藏并持久化');

// ================================================================ 第五幕
chapter('第五幕 · 逛库存（筛选 + 进度条）');
const invPage = makePage('pages/inventory/inventory.js');
invPage.onShow();
ok(invPage.data.list.length === 2, '库存页列出 2 件库存物品');
const lowRow = invPage.data.list.filter(x => x.itemId === paper.id)[0];
ok(lowRow && lowRow.low === true && lowRow.pct === 40, '低库存：标记 low，进度条 2/5=40%');
const okRow = invPage.data.list.filter(x => x.itemId === detergent.id)[0];
ok(okRow && okRow.low === false && okRow.pct === 100, '充足库存：不告警，进度条封顶 100%');
invPage.onFilter({ currentTarget: { dataset: { key: 'inventory' } } });
ok(invPage.data.list.length === 1 && invPage.data.list[0].trackingMode === 'inventory',
  '筛选「只记库存」：只剩抽纸');
invPage.onFilter({ currentTarget: { dataset: { key: 'hybrid' } } });
ok(invPage.data.list.length === 1 && invPage.data.list[0].trackingMode === 'hybrid',
  '筛选「位置+库存」：只剩洗衣液');
invPage.onFilter({ currentTarget: { dataset: { key: 'all' } } });
ok(invPage.data.list.length === 2, '切回「全部」：恢复 2 件');

// ================================================================ 第六幕
chapter('第六幕 · 补货（库存交易 + 幂等）');
const reqId = 'SIM-REPLENISH-001';
const tx1 = store.inventoryTx(paper.id, 'in', 5, '模拟补货', { requestId: reqId });
ok(tx1.ok && tx1.balance === 7, '入库 5 包，余额由 2 变为 7');
const tx2 = store.inventoryTx(paper.id, 'in', 5, '重复提交', { requestId: reqId });
ok(tx2.ok && tx2.idempotent === true && store.findInventoryByItem(paper.id).balance === 7,
  '相同 requestId 重复提交：幂等不重复入账');
const txList = store.listTransactions(paper.id);
ok(txList.length === 1, '交易流水仅 1 条（BR-010 每次变更留痕、幂等不重复）');
invPage.onShow();
ok(invPage.data.list.filter(x => x.itemId === paper.id)[0].low === false, '补货后 low 告警解除');
const belowZero = store.inventoryTx(paper.id, 'consume', 999, '超量消耗');
ok(belowZero.ok === false && belowZero.error === 'BELOW_ZERO', '超量消耗被拒（BR-011 库存不为负）');

// ================================================================ 第七幕
chapter('第七幕 · 找东西（搜索 + 清空重搜）');
const listPage = makePage('pages/item-list/item-list.js');
listPage.onShow();
const totalItems = listPage.data.items.length;
ok(totalItems === 3, '物品列表载入全部 3 件档案');
listPage.onKeyword({ detail: { value: '绝对不存在的物品xyz' } });
ok(listPage.data.items.length === 0 && listPage.data.hasFilter === true,
  '搜索无结果：列表为空且标记处于筛选态（触发空态提示）');
listPage.clearFilters();
ok(listPage.data.items.length === totalItems && listPage.data.hasFilter === false,
  '点「清空筛选 / 重搜」：恢复全部物品');
listPage.onQuickFilter({ currentTarget: { dataset: { key: 'low' } } });
ok(listPage.data.items.length === 0, '补货后快捷筛选「低库存」为空（抽纸 7 > 阈值 5）');
listPage.clearFilters();
const consume = store.inventoryTx(paper.id, 'consume', 5, '模拟日常消耗');
ok(consume.ok && consume.balance === 2, '消耗 5 包，余额回到 2');
listPage.onShow();
listPage.onQuickFilter({ currentTarget: { dataset: { key: 'low' } } });
ok(listPage.data.items.length === 1 && listPage.data.items[0].name === '抽纸',
  '重新低库存后，快捷筛选命中抽纸（页面随数据层动态联动）');
listPage.clearFilters();

// ================================================================ 第八幕
chapter('第八幕 · 整理（移动物品 + 历史留痕）');
// 身份证建档时已在 drawer，直接移回同址会触发同址去抖（unchanged，不写历史）。
// 模拟真实的「外出 → 归还」才能真正验证移动历史与常驻位置回填。
const goOut = store.moveItem(cert.id, { currentNodeId: '', locationStatus: 'out', note: '外出携带' });
ok(goOut.ok === true && goOut.eventType === 'out', '身份证外出携带，记录 out 事件');
ok(store.getItem(cert.id).currentNodeId === '' && store.getItem(cert.id).homeNodeId === drawer.id,
  '外出清空当前位置，但保留常驻位置锚点');
const backHome = store.moveItem(cert.id, { locationStatus: 'at_home', note: '归还' });
ok(backHome.ok === true && backHome.autoBack === true, '归还时自动回填常驻位置');
ok(store.getItem(cert.id).currentNodeId === drawer.id, '归还后当前位置回到电视柜抽屉');
const moves = store.listMovements(cert.id);
ok(moves.length === 2, '外出与归还各留 1 条历史（BR-005 位置与历史同一事务写入）');
ok(store.getItem(cert.id).homeNodeId === drawer.id, '全程保留常驻位置锚点');

// ================================================================ 第九幕
chapter('第九幕 · 改主意（表单脏判定 / 放弃确认 / 防重复）');
const edit = makePage('pages/item-edit/item-edit.js');
edit.onLoad({});
ok(edit.data.dirty === false, '新建表单初始为未修改态');
edit.onName({ detail: { value: '临时改的名字' } });
ok(edit.data.dirty === true, '输入名称后标记为未保存修改');
ui.modals.length = 0;
edit.onBack();
ok(ui.modals.length === 1 && ui.modals[0].title === '放弃修改', '返回时弹出「放弃修改」二次确认');
ok(ui.nav.indexOf('BACK') >= 0, '确认放弃后返回上一页');

const edit2 = makePage('pages/item-edit/item-edit.js');
edit2.onLoad({});
edit2.onName({ detail: { value: '防重复测试件' } });
const countBefore = store.listItems().length;
edit2.save();
edit2.save();
const countAfter = store.listItems().length;
ok(countAfter - countBefore === 1, '连续两次保存只新增 1 条（saving 防重复生效）');
ok(edit2.data.saving === true, '建档保存后保持 saving 直到页面跳走');
// 跳转在 doSave 的 500ms 定时器后发生，该断言移到末尾汇总定时器内执行

// ================================================================ 第十幕
chapter('第十幕 · 结束管理（只读与收藏例外）');
const endR = store.endManagement(detergent.id, { type: 'discard', note: '模拟处置' });
ok(endR.ok === true, '结束管理洗衣液（软删除，保留档案）');
ok(store.getItem(detergent.id).managementStatus === 'ended', '管理状态变为「已结束管理」');
ok(store.updateItem(detergent.id, { name: '改名试探' }).ok === false,
  '已结束物品的资料编辑被拒绝（TBD-003 只读）');
ok(store.toggleFavorite(detergent.id).ok === true,
  '已结束物品仍可收藏（收藏是用户标记，不受只读限制）');
ok(store.getItem(detergent.id).name === '洗衣液', '只读拦截后名称未被改写');

// ================================================================ 汇总
setTimeout(() => {
  ok(ui.nav.some(u => u.indexOf('item-detail') >= 0 && u.indexOf('justCreated=1') >= 0),
    '建档成功后跳转详情页并带「档案已建立」引导标记');
  console.log('\n================ 模拟测试汇总 ================');
  console.log('虚拟用户走完 10 幕完整业务链路：' + pass + '/' + (pass + fail) + ' 项断言通过');
  console.log('覆盖：空态 / 五层关联 / 建档 / 收藏 / 库存筛选 / 进度条 / 幂等 / 搜索清空 / 移动留痕 / 防重复 / 只读');
  if (fail === 0) console.log('判定：PASS —— 更新后的 V1.2 交互在连续操作场景下全部成立');
  else console.log('判定：FAIL —— 存在 ' + fail + ' 项未通过，需定位修复');
  process.exit(fail ? 1 : 0);
}, 600); // 等待 doSave 内 500ms 的跳转定时器执行完，确保跳转断言可见
