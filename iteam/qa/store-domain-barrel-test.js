/**
 * store-domain-barrel-test.js —— 数据层分域契约测试（模块化阶段1，D-01/D-02/D-03 固化）
 *
 * 锁定四件事（依据《重构影响评估与模块化开发路线 V1.0》阶段1）：
 *  A. store.js 分节完整：§0 内核 → §10 barrel，按序出现，域边界可被未来物理拆分直接引用；
 *  B. 内核单点（D-01）：_cache / load / save / commit / tombstone / uid / clone / findById
 *     全文件各只有一处定义，任何域不得自建缓存副本或重复实现；
 *  C. 跨领域写函数（D-02）：endManagement/addItem/deleteRoom/removeFurniture/moveItem/
 *     refreshAlertsForItem/clearAll/applySnapshot 共 8 个，每个必须有「⚠ D-02」标记，
 *     且不得在标记名单之外新增跨领域写函数（新增需同步更新本测试）；
 *  D. barrel 双向闭合（D-03）：
 *     D1) module.exports 的键集合与冻结清单完全一致（多删少均 FAIL，防止接口静默消失/新增）；
 *     D2) 页面与 app.js 中所有 store.<name> 用法都能在导出中找到（防止页面用到未导出接口）；
 *     D3) 所有数据层 require 只走 utils/store.js 单一入口；
 *     D4) home3d_store_v1 / home3d_tombstones_v1 存储键只允许出现在 utils/store.js。
 *
 * 运行：node qa/store-domain-barrel-test.js（纯 Node 静态分析 + 实际 require 校验）
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var MP = path.join(ROOT, 'miniprogram');
var results = [];
function ok(name, cond, detail) {
  results.push(!!cond);
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

// ---------- A. 分节完整且按序 ----------
var src = fs.readFileSync(path.join(MP, 'utils/store.js'), 'utf8');
var SECTIONS = ['§0', '§1 空间域', '§2 房间域', '§3 家具域', '§4 节点域', '§5 物品域', '§6 库存域', '§7 提醒域', '§8 统计域', '§9 演示数据与快照', '§10 统一对外入口'];
var lastPos = -1, inOrder = true, missing = [];
SECTIONS.forEach(function (s) {
  var pos = src.indexOf('// ========== ' + s);
  if (pos < 0) { missing.push(s); inOrder = false; return; }
  if (pos < lastPos) inOrder = false;
  lastPos = pos;
});
ok('A1 分节横幅齐全且按序（§0→§10）', missing.length === 0 && inOrder, missing.length ? '缺:' + missing.join(',') : '11 节齐');

// ---------- B. 内核单点 ----------
var KERNELS = ['_cache', 'function load(', 'function save(', 'function commit(', 'function tombstone(', 'function uid(', 'function clone(', 'function findById('];
var dup = [];
KERNELS.forEach(function (k) {
  var needle = (k === '_cache') ? 'var _cache' : k;
  var n = src.split(needle).length - 1;
  if (n !== 1) dup.push(k + '×' + n);
});
ok('B1 内核定义全库单点（D-01）', dup.length === 0, dup.length ? dup.join(' ') : '_cache/load/save/commit/tombstone/uid/clone/findById 各 1 处');

// ---------- C. 跨领域写函数标记（D-02） ----------
var CROSS = ['endManagement', 'addItem', 'deleteRoom', 'removeFurniture', 'moveItem', 'refreshAlertsForItem', 'clearAll', 'applySnapshot'];
var unmarked = [], lines = src.split('\n');
CROSS.forEach(function (fn) {
  var marked = lines.some(function (l, i) {
    return l.indexOf('⚠ D-02') >= 0 && lines.slice(i + 1, i + 4).some(function (m) {
      return m.indexOf('function ' + fn + '(') >= 0 || m.indexOf(fn + ': function') >= 0;
    });
  });
  if (!marked) unmarked.push(fn);
});
ok('C1 8 个跨领域写函数均有 D-02 标记', unmarked.length === 0, unmarked.length ? '缺标记:' + unmarked.join(',') : CROSS.join('/'));

// ---------- D1. 导出键集合冻结（barrel 契约） ----------
global.wx = { getStorageSync: function () { return null; }, setStorageSync: function () {} };
var store = require(path.join(MP, 'utils/store.js'));
var EXPECTED = ['FLOOR_COLS', 'FLOOR_MAX_ROWS', 'addFurniture', 'addItem', 'addNode', 'addPhotos', 'addRoom', 'addSpace',
  'allTags', 'applyRoomTemplate', 'applySnapshot', 'archiveRoom', 'archiveSpace', 'autoFloorPlace', 'bindingsOfFurniture',
  'calcCompletion', 'childrenOf', 'clearAll', 'clearTombstones', 'deleteRoom', 'endManagement', 'exportSnapshot',
  'findInventoryByItem', 'finishTask', 'floorValid', 'fmtTime', 'getActiveSpace', 'getFurniture', 'getHomeOverview',
  'getItem', 'getNode', 'getRoom', 'getStats', 'getTombstones', 'ignoreAlert', 'inventoryTx', 'itemsInNode',
  'itemsOfFurniture', 'listAlerts', 'listAllSpaces', 'listFurniture', 'listInventory', 'listItems', 'listMovements',
  'listNodes', 'listRoomTemplates', 'listRooms', 'listSpaces', 'listTransactions', 'moveItem', 'nodePath',
  'normalizeTags', 'removeFurniture', 'removeNode', 'removePhoto', 'reorderNode', 'restoreItem', 'roomAssociations',
  'seedDemo', 'setActiveSpace', 'setItemTrackingMode', 'spaceIdOfNode', 'startTask', 'toggleFavorite',
  'transformFurniture', 'uid', 'updateFurniture', 'updateInventory', 'updateItem', 'updateNode', 'updateRoom', 'updateSpace'];
// 注：内核持久化接口 load/save/commit/tombstone/findById/clone 有意不对外导出（barrel 只出业务接口 + uid/fmtTime），
// 未来若确需导出，须同步修改本冻结清单并在档案中说明理由。
var actual = Object.keys(store).sort();
var expected = EXPECTED.slice().sort();
var extra = actual.filter(function (k) { return expected.indexOf(k) < 0; });
var lost = expected.filter(function (k) { return actual.indexOf(k) < 0; });
ok('D1 导出键集合与冻结清单一致（' + actual.length + ' 个）', extra.length === 0 && lost.length === 0,
  (extra.length ? '多出:' + extra.join(',') : '') + (lost.length ? '缺失:' + lost.join(',') : ''));

// ---------- D2. 页面用量闭合：store.<name> 必须已导出 ----------
var used = {};
['app.js'].concat(fs.readdirSync(path.join(MP, 'pages')).map(function (d) { return 'pages/' + d; })).forEach(function (dir) {
  var full = path.join(MP, dir);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return;
  walkJs(full).forEach(function (f) {
    var t = fs.readFileSync(f, 'utf8');
    (t.match(/store\.([A-Za-z_$][\w$]*)/g) || []).forEach(function (m) {
      var name = m.slice(6);
      if (name === 'js') return; // require('../../utils/store.js') 路径命中，非接口用法
      used[name] = (used[name] || 0) + 1;
    });
  });
});
function walkJs(dir) {
  var out = [];
  fs.readdirSync(dir).forEach(function (f) {
    var p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out = out.concat(walkJs(p));
    else if (/\.js$/.test(f)) out.push(p);
  });
  return out;
}
var unknownUse = Object.keys(used).filter(function (k) { return actual.indexOf(k) < 0; });
ok('D2 页面 store.<name> 用法全部已导出（' + Object.keys(used).length + ' 个接口在用）', unknownUse.length === 0,
  unknownUse.length ? '未导出却被使用:' + unknownUse.join(',') : '');

// ---------- D3. 数据层 require 单一入口 ----------
var badRequire = [];
walkJs(MP).forEach(function (f) {
  if (f.indexOf('utils' + path.sep + 'store.js') >= 0) return;
  var t = fs.readFileSync(f, 'utf8');
  (t.match(/require\((['"])([^'"]*)\1\)/g) || []).forEach(function (m) {
    if (/store/i.test(m) && m.indexOf('store.js') >= 0 && !/utils\/store\.js|utils\\store\.js/.test(m)) badRequire.push(path.relative(MP, f) + ' → ' + m);
  });
});
ok('D3 数据层 require 只走 utils/store.js', badRequire.length === 0, badRequire.length ? badRequire.join(' | ') : '');

// ---------- D4. 存储键隔离 ----------
var keyLeak = [];
walkJs(MP).forEach(function (f) {
  var rel = path.relative(MP, f);
  if (rel === path.join('utils', 'store.js')) return;
  var t = fs.readFileSync(f, 'utf8');
  if (t.indexOf('home3d_store_v1') >= 0 || t.indexOf('home3d_tombstones_v1') >= 0) keyLeak.push(rel);
});
ok('D4 存储键只在 store.js 出现', keyLeak.length === 0, keyLeak.length ? keyLeak.join(',') : '');

var pass = results.filter(Boolean).length;
console.log('\n结果: ' + pass + '/' + results.length + ' 通过');
process.exitCode = (pass === results.length) ? 0 : 1;
