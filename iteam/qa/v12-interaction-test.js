/**
 * 五步补齐 V1.2 新增交互验证（纯 Node，mock 微信运行时）
 * 覆盖本轮按《五步执行顺序》补齐的交互行为：
 *   A. 收藏星标：addItem 默认 false / toggleFavorite 切换 / 已结束物品仍可收藏 / 持久化
 *   B. 库存筛选口径：listInventory 仅含 inventory|hybrid，可按 trackingMode 过滤
 *   C. 库存进度条数据：threshold/balance → low 与百分比口径
 *   D. 页面静态绑定：返回确认、防重复、清空重搜、筛选 chip、进度条、收藏星标均已接线
 * 用法: node qa/v12-interaction-test.js
 */
const path = require('path');
const fs = require('fs');

const storage = {};
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: () => {}, navigateTo: () => {}, switchTab: () => {}, redirectTo: () => {},
  navigateBack: () => {},
  canIUse: () => false, getSystemInfoSync: () => ({ windowWidth: 375 }),
  getLogManager: () => ({ error: () => {} })
};

const store = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'store.js'));
const ROOT = path.join(__dirname, '..', 'miniprogram');
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf-8'); }

// ========== A. 收藏星标 ==========
const favItem = store.addItem({ name: '收藏测试件' }).data;
ok(favItem.favorite === false, 'V1.2-A 建档默认未收藏');
const fav1 = store.toggleFavorite(favItem.id);
ok(fav1.ok && fav1.data.favorite === true, 'V1.2-A 切换为已收藏');
ok(store.getItem(favItem.id).favorite === true, 'V1.2-A 收藏状态写入物品');
const fav2 = store.toggleFavorite(favItem.id);
ok(fav2.ok && fav2.data.favorite === false, 'V1.2-A 再次切换为未收藏');
ok(store.updateItem(favItem.id, { favorite: true }).ok && store.getItem(favItem.id).favorite === true,
  'V1.2-A updateItem 支持 favorite 字段');
// 结束管理后仍可收藏（收藏是用户标记，不受只读限制）
store.addInventory;
const endItem = store.addItem({ name: '结束后收藏件' }).data;
// 无库存直接结束管理
store.endManagement(endItem.id, { type: 'other', note: '' });
const endFav = store.toggleFavorite(endItem.id);
ok(endFav.ok && endFav.data.favorite === true, 'V1.2-A 已结束管理物品仍可收藏');
ok(store.toggleFavorite('no-such').ok === false, 'V1.2-A 不存在物品收藏返回失败');

// ========== B/C. 库存筛选与进度条数据 ==========
const invItem = store.addItem({ name: '库存筛选件', trackingMode: 'inventory', balance: 2, threshold: 5, unit: '包' }).data;
const hybItem = store.addItem({ name: '混合筛选件', trackingMode: 'hybrid', balance: 10, threshold: 3, unit: '个' }).data;
const locItem = store.addItem({ name: '仅位置件' }).data;
const invList = store.listInventory();
const ids = invList.map(x => x.itemId);
ok(ids.indexOf(invItem.id) >= 0 && ids.indexOf(hybItem.id) >= 0, 'V1.2-B listInventory 含 inventory 与 hybrid');
ok(ids.indexOf(locItem.id) < 0, 'V1.2-B listInventory 不含 location 物品');
ok(invList.filter(x => store.getItem(x.itemId).trackingMode === 'inventory').length >= 1, 'V1.2-B 可按 inventory 过滤');
ok(invList.filter(x => store.getItem(x.itemId).trackingMode === 'hybrid').length >= 1, 'V1.2-B 可按 hybrid 过滤');
const invRow = invList.filter(x => x.itemId === invItem.id)[0];
ok(invRow.low === true, 'V1.2-C 余额低于阈值标记 low');
const hybRow = invList.filter(x => x.itemId === hybItem.id)[0];
ok(hybRow.low === false, 'V1.2-C 余额高于阈值不标记 low');
// 进度条百分比口径（页面层）：balance/threshold 封顶 100；无阈值视 100
const pct = (b, t) => t > 0 ? Math.min(100, Math.round(b / t * 100)) : 100;
ok(pct(invRow.balance, invRow.threshold) === 40, 'V1.2-C 进度条百分比 2/5=40');
ok(pct(hybRow.balance, hybRow.threshold) === 100, 'V1.2-C 进度条百分比封顶 100');

// ========== D. 页面静态绑定 ==========
const editJs = read('pages/item-edit/item-edit.js');
const editWxml = read('pages/item-edit/item-edit.wxml');
ok(editJs.indexOf('onBack: function') >= 0 && editJs.indexOf('放弃修改') >= 0, 'V1.2-D item-edit 放弃修改确认已接线');
ok(editJs.indexOf('if (this.data.saving) return') >= 0, 'V1.2-D item-edit 保存防重复已接线');
ok(editWxml.indexOf('loading="{{saving}}"') >= 0 && editWxml.indexOf('disabled="{{saving}}"') >= 0, 'V1.2-D 保存按钮 loading/disabled 已接线');
ok(editWxml.indexOf('ph-empty') >= 0, 'V1.2-D item-edit 缺图占位已接线');

const listJs = read('pages/item-list/item-list.js');
const listWxml = read('pages/item-list/item-list.wxml');
ok(listJs.indexOf('clearFilters: function') >= 0, 'V1.2-D item-list 清空重搜方法已接线');
ok(listWxml.indexOf('清空筛选 / 重搜') >= 0, 'V1.2-D item-list 清空重搜按钮已接线');
ok(listWxml.indexOf('skeleton-card') >= 0, 'V1.2-D item-list 加载骨架已接线');

const detailJs = read('pages/item-detail/item-detail.js');
const detailWxml = read('pages/item-detail/item-detail.wxml');
ok(detailJs.indexOf('toggleFavorite: function') >= 0, 'V1.2-D item-detail 收藏方法已接线');
ok(detailWxml.indexOf('fav-star') >= 0 && detailWxml.indexOf('toggleFavorite') >= 0, 'V1.2-D item-detail 收藏星标已接线');

const invJs = read('pages/inventory/inventory.js');
const invWxml = read('pages/inventory/inventory.wxml');
ok(invJs.indexOf('onFilter: function') >= 0 && invJs.indexOf("filterKey: 'all'") >= 0, 'V1.2-D inventory 筛选方法已接线');
ok(invWxml.indexOf('inv-filters') >= 0 && invWxml.indexOf('inv-bar') >= 0, 'V1.2-D inventory 筛选条与进度条已接线');

const idxJs = read('pages/index/index.js');
const idxWxml = read('pages/index/index.wxml');
ok(idxJs.indexOf('noRooms') >= 0 && idxWxml.indexOf('fp-empty') >= 0, 'V1.2-D index 无房间空态已接线');

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
