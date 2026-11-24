// utils/store.js —— 本地存储数据层（MVP 个人单用户·纯本地）
// 业务规则来源：业务规则说明书 V1.1（BR-001~015）与 TBD-001~008
// 设计原则：事实与预测分离、失败可降级、三维对象与逻辑位置解耦、用户确认优先、数据可追溯
// 所有写操作在内存中完成变更后一次性落盘，保证"位置更新与历史写入同一事务"（10.3）
//
// ============ 数据层分域契约（模块化阶段1，依据《重构影响评估与模块化开发路线 V1.0》）============
// 1) 统一对外入口：全部页面/app.js 只允许 require('utils/store.js') 这一个门面，
//    不得 require 本文件内部函数、不得绕过本文件直接 wx.getStorageSync/setStorageSync 读写
//    home3d_store_v1 / home3d_tombstones_v1 两个存储键。
// 2) 物理不拆：本阶段单文件内按业务域分节（§0 内核 → §1 空间 → §2 房间 → §3 家具 → §4 节点
//    → §5 物品 → §6 库存 → §7 提醒 → §8 统计 → §9 演示与快照 → §10 barrel 导出），
//    未来拆文件时按 § 边界切割，内核层（§0/§9）单点保留。
// 3) 内核单点：_cache 唯一实例、load/save/commit/tombstone/uid/clone/findById 全库各只有一份
//    定义；任何域不得自建缓存副本（D-01：拆双份缓存 = 双份数据、写覆盖）。
// 4) 跨领域写函数（D-02，共 8 个）：endManagement、addItem、deleteRoom、removeFurniture、
//    moveItem、refreshAlertsForItem、clearAll、applySnapshot —— 逻辑上属内核层，不强行下沉到
//    某个域；每个函数上方有「⚠ D-02」标记，未来拆文件时随内核走。

var C = require('./constants.js');

var KEY = 'home3d_store_v1';
var TOMB_KEY = 'home3d_tombstones_v1'; // 删除墓碑：记录已删除记录（本地回滚/恢复用）

// ========== §0 内核层：缓存与持久化（单点，全库唯一） ==========
function blank() {
  return {
    version: 1,
    spaces: [], rooms: [], furniture: [], nodes: [], items: [],
    movements: [], inventory: [], transactions: [], alerts: [],
    // 幂等去重：记录已处理的请求 id（moveItem / inventoryTx），避免重复提交产生重复历史/流水
    // 说明：该字段仅用于本地单次操作去重，不属于云端集合契约，不进入 exportSnapshot
    processedRequests: [],
    settings: { activeSpaceId: '', seeded: false }
  };
}

var _cache = null;

function load() {
  if (_cache) return _cache;
  var raw = null;
  try { raw = wx.getStorageSync(KEY); } catch (e) { raw = null; }
  if (!raw || typeof raw !== 'object') { _cache = blank(); return _cache; }
  var b = blank();
  // 逐字段合并，兼容旧版本缺字段
  Object.keys(b).forEach(function (k) {
    if (raw[k] === undefined || raw[k] === null) return;
    if (k === 'settings') {
      _mergeInto(b.settings, raw.settings);
    } else if (Array.isArray(raw[k])) {
      b[k] = raw[k];
    }
  });
  _cache = b;
  // 基线 §2 归属模型迁移：为历史物品补 anchorType（无则按 currentNodeId/homeNodeId 推导）
  var migrated = false;
  if (Array.isArray(_cache.items)) {
    _cache.items.forEach(function (it) {
      if (it.anchorType) return;
      it.anchorType = (it.currentNodeId || it.homeNodeId) ? 'furniture' : 'space_direct';
      migrated = true;
    });
    if (migrated) { try { wx.setStorageSync(KEY, _cache); } catch (e) {} }
  }
  return _cache;
}

function _mergeInto(dst, src) {
  if (!src || typeof src !== 'object') return;
  Object.keys(src).forEach(function (k) { dst[k] = src[k]; });
}

function save() {
  try { wx.setStorageSync(KEY, _cache); return { ok: true }; }
  catch (e) { return { ok: false, error: 'STORAGE_WRITE_FAILED', message: e.message || '' }; }
}

function commit() {
  return save();
}

// 记录删除墓碑（本地回滚/恢复用）
function tombstone(collection, id) {
  var list = [];
  try { list = wx.getStorageSync(TOMB_KEY) || []; } catch (e) {}
  list.push({ collection: collection, id: id, at: now() });
  if (list.length > 500) list = list.slice(-500);
  try { wx.setStorageSync(TOMB_KEY, list); } catch (e) {}
}

// ---- 内核层·公共工具（uid/clone/findById 等全库唯一定义，各域禁止重复实现） ----
function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// P1-5 标签规整：去空白、去重、限长，兼容旧数据（tags 缺失/非数组时返回空数组）
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  var seen = {}, out = [];
  tags.forEach(function (t) {
    var s = String(t == null ? '' : t).trim().slice(0, 12);
    if (s && !seen[s]) { seen[s] = 1; out.push(s); }
  });
  return out.slice(0, 8);
}
// 汇总全库在用标签（含主分类），供建档页与筛选页生成候选项，无需额外存储
function allTags() {
  var d = load(), seen = {}, out = [];
  d.items.forEach(function (it) {
    C.ITEM_CATEGORIES.forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } });
    (it.tags || []).forEach(function (t) { if (!seen[t]) { seen[t] = 1; out.push(t); } });
  });
  // 即使还没有物品，也把预置分类作为候选带出
  if (!out.length) return C.ITEM_CATEGORIES.slice();
  return out;
}

function findById(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function now() { return Date.now(); }

// 幂等辅助：requestId 为空时不限制；已处理则命中去重
function claimRequest(d, requestId) {
  if (!requestId) return false;
  if (!Array.isArray(d.processedRequests)) d.processedRequests = [];
  if (d.processedRequests.indexOf(requestId) >= 0) return true;
  d.processedRequests.push(requestId);
  if (d.processedRequests.length > 500) d.processedRequests = d.processedRequests.slice(-500);
  return false;
}

function fmtTime(ts) {
  var d = new Date(ts);
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ========== §1 空间域（PRD-002 / 业务规则第3章） ==========
function listSpaces() {
  var d = load();
  return d.spaces.filter(function (s) { return !s.archived; }).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
}
function listAllSpaces() { return load().spaces.slice(); }
function getActiveSpace() {
  var d = load();
  var s = findById(d.spaces, d.settings.activeSpaceId);
  if (s && !s.archived) return s;
  var active = listSpaces()[0];
  if (active) { d.settings.activeSpaceId = active.id; commit(); }
  return active || null;
}
function setActiveSpace(id) {
  var d = load();
  if (!findById(d.spaces, id)) return { ok: false, error: 'NOT_FOUND' };
  d.settings.activeSpaceId = id;
  return commit();
}
function addSpace(name) {
  var d = load();
  name = (name || '').trim();
  if (!name) return { ok: false, error: 'INVALID_NAME' };
  var s = { id: uid('sp'), name: name, archived: false, createdAt: now(), updatedAt: now() };
  d.spaces.push(s);
  if (!d.settings.activeSpaceId) d.settings.activeSpaceId = s.id;
  var r = commit();
  return r.ok ? { ok: true, data: clone(s) } : r;
}
function updateSpace(id, name) {
  var d = load(), s = findById(d.spaces, id);
  if (!s) return { ok: false, error: 'NOT_FOUND' };
  name = (name || '').trim();
  if (!name) return { ok: false, error: 'INVALID_NAME' };
  s.name = name; s.updatedAt = now();
  var r = commit(); return r.ok ? { ok: true, data: clone(s) } : r;
}
function archiveSpace(id) {
  var d = load(), s = findById(d.spaces, id);
  if (!s) return { ok: false, error: 'NOT_FOUND' };
  // 归档空间时其下房间一并归档，但保留数据不删除（可恢复）
  s.archived = true; s.updatedAt = now();
  d.rooms.forEach(function (rm) { if (rm.spaceId === id) rm.archived = true; });
  if (d.settings.activeSpaceId === id) d.settings.activeSpaceId = '';
  var r = commit(); return r.ok ? { ok: true } : r;
}

// ========== §2 房间域（PRD-003 / 业务规则第3章；CR-001 F-01 手动编辑画布；含楼层布局/照片/任务） ==========
// 空白房间布局：地面 + 四面墙 + 默认视角。尺寸单位米，Y-up；默认值保证无尺寸输入也可打开。
function makeLayout(dims) {
  dims = dims || {};
  var w = Number(dims.width) > 0 ? Number(dims.width) : 4;
  var dpt = Number(dims.depth) > 0 ? Number(dims.depth) : 4;
  var h = Number(dims.height) > 0 ? Number(dims.height) : 2.8;
  return {
    floor: { w: w, d: dpt },
    walls: [
      { side: 'north', length: w, height: h },
      { side: 'south', length: w, height: h },
      { side: 'west', length: dpt, height: h },
      { side: 'east', length: dpt, height: h }
    ],
    camera: { yaw: -45, pitch: 35, distance: Math.max(w, dpt) * 1.6 }
  };
}
// 历史房间（V1.1 及更早）缺字段时懒兜底，仅在读取时补默认值，不改存储、不动同步契约（CR-001 F-01）
function ensureRoomFields(rm) {
  if (!rm) return rm;
  if (!rm.layout) rm.layout = makeLayout({ width: rm.width, depth: rm.depth, height: rm.height });
  if (!rm.source) rm.source = 'manual';
  if (rm.templateKey === undefined) rm.templateKey = '';
  return rm;
}

// 户型总览：6 列网格；房间 floor 为用户可编辑排布 {x,y,w,h}（单位=格），
// 未编辑的房间按创建顺序回退到默认槽位。位置为布局输入，不承诺测量精度。
var FLOOR_COLS = 6;
var FLOOR_MAX_ROWS = 8;
var FLOOR_SLOTS = [
  { c: 1, r: 1, cw: 3, rh: 3 }, { c: 4, r: 1, cw: 3, rh: 4 },
  { c: 1, r: 4, cw: 3, rh: 2 }, { c: 4, r: 5, cw: 3, rh: 2 },
  { c: 1, r: 6, cw: 3, rh: 2 }, { c: 4, r: 7, cw: 3, rh: 2 },
  { c: 1, r: 8, cw: 3, rh: 2 }, { c: 4, r: 9, cw: 3, rh: 2 }
];
function floorSlot(i) { return FLOOR_SLOTS[i] || { c: 1, r: 10 + (i - 8) * 2, cw: 6, rh: 2 }; }
function floorOf(r, i) {
  if (r.floor) return r.floor;
  var s = floorSlot(i);
  return { x: s.c, y: s.r, w: s.cw, h: s.rh };
}
function floorOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function floorValid(rooms, selfId, cand) {
  if (!cand || cand.x < 1 || cand.y < 1 || cand.w < 1 || cand.h < 1) return false;
  if (cand.x + cand.w - 1 > FLOOR_COLS || cand.y + cand.h - 1 > FLOOR_MAX_ROWS) return false;
  return !rooms.some(function (r, i) { return r.id !== selfId && floorOverlap(floorOf(r, i), cand); });
}
function autoFloorPlace(sid) {
  var rooms = listRooms(sid);
  var used = rooms.map(function (r, i) { return floorOf(r, i); });
  for (var y = 1; y <= FLOOR_MAX_ROWS; y++) for (var x = 1; x + 2 <= FLOOR_COLS; x++) {
    var c = { x: x, y: y, w: 3, h: 2 };
    if (!used.some(function (u) { return floorOverlap(u, c); })) return c;
  }
  return { x: 1, y: FLOOR_MAX_ROWS, w: 3, h: 2 };
}
// 首页户型总览聚合数据（纯计算，不落库、不进云契约）
function getHomeOverview(spaceId) {
  var d = load();
  var sp = spaceId ? findById(d.spaces, spaceId) : getActiveSpace();
  if (!sp) return { rooms: [], area: 0, cols: FLOOR_COLS, maxRows: FLOOR_MAX_ROWS };
  var rooms = d.rooms.filter(function (r) { return !r.archived && r.spaceId === sp.id; })
    .map(ensureRoomFields).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
  var area = rooms.reduce(function (n, r) { return n + (Number(r.width) || 0) * (Number(r.depth) || 0); }, 0);
  var blocks = rooms.map(function (r, i) {
    var slot = floorOf(r, i);
    var fs = d.furniture.filter(function (f) { return f.roomId === r.id; });
    var rw = Number(r.width) || 4, rd = Number(r.depth) || 4;
    var furn = fs.map(function (f) {
      var pos = f.position || { x: 0, z: 0 }, size = f.size || { w: 0.6, d: 0.6 };
      var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
      return {
        id: f.id, name: f.name,
        icon: (C.FURNITURE_LIB[f.category] || {}).icon || '▪',
        left: clamp(((pos.x || 0) + rw / 2) / rw * 100, 4, 96),
        top: clamp(((pos.z || 0) + rd / 2) / rd * 100, 4, 96),
        w: clamp((size.w || 0.6) / rw * 100, 6, 48),
        h: clamp((size.d || 0.6) / rd * 100, 6, 48)
      };
    });
    // 物品经 currentNodeId → nodes.furnitureId 聚合到该房间（单源，去重）；与 itemsOfFurniture 同口径
    var nodeIdMap = {};
    d.nodes.forEach(function (n) { if (n.roomId === r.id) nodeIdMap[n.id] = 1; });
    var itemCount = d.items.filter(function (it) {
      return it.managementStatus !== 'ended' && it.currentNodeId && nodeIdMap[it.currentNodeId];
    }).length;
    return {
      id: r.id, name: r.name, width: r.width, depth: r.depth,
      templateKey: r.templateKey || '',
      floor: slot, furn: furn, itemCount: itemCount,
      tone: r.templateKey === 'bedroom' ? 'bedroom' : r.templateKey === 'living' ? 'living' : r.templateKey === 'bath' ? 'bath' : 'blank'
    };
  });
  var rows = Math.max.apply(null, [1].concat(blocks.map(function (b) { return b.floor.y + b.floor.h - 1; })));
  return { rooms: blocks, area: area, cols: FLOOR_COLS, maxRows: FLOOR_MAX_ROWS, rows: rows, spaceName: sp.name };
}
function listRooms(spaceId) {
  var d = load();
  return d.rooms.filter(function (r) {
    return !r.archived && (!spaceId || r.spaceId === spaceId);
  }).map(ensureRoomFields).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
}
function getRoom(id) { return ensureRoomFields(findById(load().rooms, id)); }
function addRoom(spaceId, name, dims) {
  var d = load();
  if (!findById(d.spaces, spaceId)) return { ok: false, error: 'SPACE_NOT_FOUND' };
  name = (name || '').trim();
  if (!name) return { ok: false, error: 'INVALID_NAME' };
  // 同一空间内房间名唯一；已归档房间不占名，避免误伤归档后重建
  if (d.rooms.some(function (x) { return !x.archived && x.spaceId === spaceId && x.name === name; })) {
    return { ok: false, error: 'ROOM_NAME_DUPLICATE' };
  }
  dims = dims || {};
  var r0 = {
    id: uid('rm'), spaceId: spaceId, name: name,
    // 新建房间写入默认尺寸 4×4×2.8m（布局输入，不承诺测量精度）
    width: Number(dims.width) > 0 ? Number(dims.width) : 4,
    depth: Number(dims.depth) > 0 ? Number(dims.depth) : 4,
    height: Number(dims.height) > 0 ? Number(dims.height) : 2.8,
    calibrated: Number(dims.width) > 0 && Number(dims.depth) > 0,
    // CR-001 F-01/F-07：手动编辑画布为主路径；templateKey 为 T9 典型场景模板预留（当前恒空）
    source: 'manual', templateKey: '', layout: makeLayout(dims),
    photos: [], task: { status: 'none', taskId: '', error: '' },
    archived: false, createdAt: now(), updatedAt: now()
  };
  d.rooms.push(r0);
  var r = commit(); return r.ok ? { ok: true, data: clone(r0) } : r;
}
function updateRoom(id, patch) {
  var d = load(), rm = findById(d.rooms, id);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  if (patch.name !== undefined) {
    patch.name = (patch.name || '').trim();
    if (!patch.name) return { ok: false, error: 'INVALID_NAME' };
    // 改名同样受同空间唯一约束，排除自身；已归档房间不占名
    if (d.rooms.some(function (x) {
      return !x.archived && x.id !== id && x.spaceId === rm.spaceId && x.name === patch.name;
    })) return { ok: false, error: 'ROOM_NAME_DUPLICATE' };
  }
  // 尺寸校验：width/depth/height 传入时必须为正数（拒绝 0/负值破坏 layout 与钳制边界）
  var sizeInvalid = ['width', 'depth', 'height'].some(function (k) {
    return patch[k] !== undefined && !(Number(patch[k]) > 0);
  });
  if (sizeInvalid) return { ok: false, error: 'INVALID_SIZE' };
  ['width', 'depth', 'height'].forEach(function (k) { if (patch[k] !== undefined) rm[k] = Number(patch[k]); });
  if (patch.name !== undefined) rm.name = patch.name;
  if (patch.width !== undefined || patch.depth !== undefined) rm.calibrated = !!(rm.width && rm.depth);
  // CR-001 F-01：手动编辑字段；尺寸变化时同步空白布局（保留已有 layout 时仅更新地面/墙/视角尺寸）
  ensureRoomFields(rm);
  var dimsChanged = patch.width !== undefined || patch.depth !== undefined || patch.height !== undefined;
  var clampedFurniture = 0;
  if (dimsChanged) {
    rm.layout = makeLayout(rm);
    // 房间缩小后越界的家具自动钳回边界（保留半个家具尺寸；家具大于房间时钳到房间中心），
    // 避免家具悬空在墙外（评估报告 D-04 连带项）。表单式修改立即生效，不进家具撤销栈。
    var halfW = (rm.width || 20) / 2, halfD = (rm.depth || 20) / 2;
    d.furniture.forEach(function (f) {
      if (f.roomId !== id) return;
      var size = f.size || { w: 0.6, d: 0.6 };
      var pos = f.position || { x: 0, y: 0, z: 0 };
      var nx = clampCenter(pos.x || 0, -halfW + size.w / 2, halfW - size.w / 2);
      var nz = clampCenter(pos.z || 0, -halfD + size.d / 2, halfD - size.d / 2);
      if (Math.abs(nx - (pos.x || 0)) > 1e-6 || Math.abs(nz - (pos.z || 0)) > 1e-6) {
        f.position = { x: round2(nx), y: pos.y || 0, z: round2(nz) };
        f.updatedAt = now();
        clampedFurniture++;
      }
    });
  }
  if (patch.source !== undefined && ['manual', 'template', 'legacy_photo'].indexOf(patch.source) >= 0) rm.source = patch.source;
  if (patch.templateKey !== undefined) rm.templateKey = String(patch.templateKey || '');
  if (patch.layout !== undefined && patch.layout && typeof patch.layout === 'object') rm.layout = clone(patch.layout);
  // 户型总览排布：用户拖拽/缩放后的网格位置；仅接受合法整数区间，越界由页面层校验后传入
  if (patch.floor !== undefined) {
    if (patch.floor === null || patch.floor === '') rm.floor = undefined;
    else if (patch.floor && typeof patch.floor === 'object') {
      rm.floor = {
        x: Math.round(Number(patch.floor.x) || 1), y: Math.round(Number(patch.floor.y) || 1),
        w: Math.round(Number(patch.floor.w) || 1), h: Math.round(Number(patch.floor.h) || 1)
      };
    }
  }
  rm.updatedAt = now();
  var r = commit();
  return r.ok ? { ok: true, data: clone(rm), clampedFurniture: clampedFurniture } : r;
}
function archiveRoom(id) {
  var d = load(), rm = findById(d.rooms, id);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  rm.archived = true; rm.updatedAt = now();
  var r = commit(); return r.ok ? { ok: true } : r;
}
// 房间删除/归档前的关联检查（业务规则第11章）：统计家具/节点/物品，阻断位置关系断裂
// 房间物理删除：移除房间及其家具/节点记录并写墓碑供云同步；
// 关联物品不物理删除，解除位置引用置为"位置未知"并写历史，避免悬空引用（业务规则第11章）
// ⚠ D-02 跨领域写函数（内核层）：rooms+nodes+items+楼层槽位+墓碑
function deleteRoom(id) {
  var d = load(), rm = findById(d.rooms, id);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  var furniture = d.furniture.filter(function (f) { return f.roomId === id; });
  var nodes = d.nodes.filter(function (n) { return n.roomId === id; });
  var nodeIds = nodes.map(function (n) { return n.id; });
  var linked = d.items.filter(function (it) {
    return it.managementStatus !== 'ended' && nodeIds.indexOf(it.currentNodeId) >= 0;
  });
  // 物品解绑：位置置未知，保留物品档案，写 restore 历史可追溯
  linked.forEach(function (it) {
    var from = it.currentNodeId, fromStatus = it.locationStatus;
    it.currentNodeId = '';
    it.locationStatus = 'unknown';
    it.borrowTo = ''; it.dueDate = '';
    it.updatedAt = now();
    it.completed = calcCompletion(it);
    d.movements.push({
      id: uid('mv'), itemId: it.id, type: 'restore',
      fromNodeId: from, fromStatus: fromStatus,
      toNodeId: '', toStatus: 'unknown',
      note: '房间删除后位置归未知', createdAt: now()
    });
  });
  // 物理移除记录
  d.rooms = d.rooms.filter(function (r) { return r.id !== id; });
  d.furniture = d.furniture.filter(function (f) { return f.roomId !== id; });
  d.nodes = d.nodes.filter(function (n) { return n.roomId !== id; });
  // 墓碑：供云端同步表达物理删除
  tombstone('rooms', id);
  furniture.forEach(function (f) { tombstone('furniture', f.id); });
  nodes.forEach(function (n) { tombstone('nodes', n.id); });
  var r = commit();
  return r.ok ? { ok: true, data: { furniture: furniture.length, nodes: nodes.length, itemsReset: linked.length } } : r;
}

function roomAssociations(roomId) {
  var d = load();
  var furniture = d.furniture.filter(function (f) { return f.roomId === roomId; });
  var nodes = d.nodes.filter(function (n) { return n.roomId === roomId; });
  var nodeIds = nodes.map(function (n) { return n.id; });
  var items = d.items.filter(function (it) {
    return it.managementStatus !== 'ended' && nodeIds.indexOf(it.currentNodeId) >= 0;
  });
  return { furniture: furniture.length, nodes: nodes.length, items: items.length,
    total: furniture.length + nodes.length + items.length };
}

// ---- §2 子节：照片与建模任务（PRD-005/006/007） ----
function addPhotos(roomId, paths) {
  var d = load(), rm = findById(d.rooms, roomId);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  paths.forEach(function (p) { rm.photos.push({ id: uid('ph'), path: p, addedAt: now() }); });
  rm.task = { status: 'ready', taskId: '', error: '' };
  rm.updatedAt = now();
  var r = commit(); return r.ok ? { ok: true, data: clone(rm.photos) } : r;
}
function removePhoto(roomId, photoId) {
  var d = load(), rm = findById(d.rooms, roomId);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  rm.photos = rm.photos.filter(function (p) { return p.id !== photoId; });
  rm.updatedAt = now();
  tombstone('rooms', roomId); // 房间内照片数组变更，推送整个房间记录
  return commit();
}
function startTask(roomId) {
  var d = load(), rm = findById(d.rooms, roomId);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  if (!rm.photos.length) return { ok: false, error: 'NO_PHOTOS' };
  rm.task = { status: 'processing', taskId: uid('task'), error: '', startedAt: now() };
  var r = commit(); return r.ok ? { ok: true, data: clone(rm.task) } : r;
}
// 本地 MVP 无云建模：任务不自动判成功，提供"标记失败→手动降级"与"标记完成→候选待确认"
function finishTask(roomId, success, errMsg) {
  var d = load(), rm = findById(d.rooms, roomId);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  rm.task = {
    status: success ? 'candidate_ready' : 'failed',
    taskId: rm.task.taskId || '', error: errMsg || '', finishedAt: now()
  };
  var r = commit(); return r.ok ? { ok: true, data: clone(rm.task) } : r;
}

// ========== §3 家具域（PRD-009~013 / BR-009 模型与逻辑解耦；含房间家具模板与变换） ==========
function listFurniture(roomId) {
  var d = load();
  return d.furniture.filter(function (f) { return f.roomId === roomId; })
    .slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
}
function getFurniture(id) { return findById(load().furniture, id); }
function addFurniture(roomId, opts) {
  var d = load();
  if (!findById(d.rooms, roomId)) return { ok: false, error: 'ROOM_NOT_FOUND' };
  opts = opts || {};
  var cat = opts.category || '其他';
  var lib = C.FURNITURE_LIB[cat] || { size: [0.5, 0.5, 0.5], vars: ['默认'] };
  var f = {
    id: uid('fu'), roomId: roomId, category: cat,
    name: (opts.name || '').trim() || cat,
    model: lib.vars.indexOf(opts.model) >= 0 ? opts.model : lib.vars[0],
    // 三维对象属性（Y-up，单位米）——与逻辑收纳节点分开保存
    position: opts.position || { x: 0, y: 0, z: 0 },
    rotation: opts.rotation || 0,
    size: opts.size || { w: lib.size[0], h: lib.size[1], d: lib.size[2] },
    // 来源与状态分离：AI候选 ≠ 用户确认事实（BR-013）
    source: opts.source || 'manual',
    status: opts.source === 'ai_candidate' ? 'candidate' : 'confirmed',
    confidence: opts.confidence || 0,
    createdAt: now(), updatedAt: now()
  };
  d.furniture.push(f);
  // 家具本身即一个逻辑位置节点（BR-009：换模型不动节点）
  var node = {
    id: uid('nd'), roomId: roomId, furnitureId: f.id, parentId: '',
    name: f.name, type: '家具', order: d.nodes.filter(function (n) { return n.roomId === roomId && !n.parentId; }).length,
    createdAt: now(), updatedAt: now()
  };
  d.nodes.push(node);
  var r = commit(); return r.ok ? { ok: true, data: clone(f), node: clone(node) } : r;
}
// CR-001 F-07 典型场景模板：列出可选模板（仅元信息，不含坐标）
function listRoomTemplates() {
  var t = C.ROOM_TEMPLATES || {};
  return Object.keys(t).map(function (k) {
    return { key: k, name: t[k].name, count: (t[k].furniture || []).length };
  });
}
// 应用模板：按房间实际尺寸钳制预置家具坐标，逐件写为普通可编辑家具；模板缺失/加载失败返回错误供降级空白房间
function applyRoomTemplate(roomId, templateKey) {
  var d = load(), rm = findById(d.rooms, roomId);
  if (!rm) return { ok: false, error: 'ROOM_NOT_FOUND' };
  var tpl = (C.ROOM_TEMPLATES || {})[templateKey];
  if (!tpl || !Array.isArray(tpl.furniture) || tpl.furniture.length === 0) return { ok: false, error: 'TEMPLATE_NOT_FOUND' };
  // 幂等保护：同一房间已应用过该模板则直接返回，避免重复点保存/模板导致家具成倍累积
  // 用来源标记(template)判定而非 rm.templateKey——种子房间也带 templateKey，但其家具无 template 标记
  var existing = d.furniture.filter(function (f) { return f.roomId === roomId && f.template === templateKey; });
  if (existing.length) {
    return { ok: true, data: { roomId: roomId, templateKey: templateKey, furnitureIds: [], applied: false } };
  }
  var halfW = (rm.width || 4) / 2, halfD = (rm.depth || 4) / 2;
  var created = [];
  tpl.furniture.forEach(function (item) {
    var lib = C.FURNITURE_LIB[item.category] || { size: [0.5, 0.5, 0.5], vars: ['默认'] };
    var size = { w: lib.size[0], h: lib.size[1], d: lib.size[2] };
    // 按房间尺寸钳制，超大家具居中（复用 T8 的 clampCenter）
    var px = round2(clampCenter(item.x || 0, -halfW + size.w / 2, halfW - size.w / 2));
    var pz = round2(clampCenter(item.z || 0, -halfD + size.d / 2, halfD - size.d / 2));
    var f = {
      id: uid('fu'), roomId: roomId, category: item.category,
      name: item.name || item.category,
      model: lib.vars[0],
      position: { x: px, y: 0, z: pz },
      rotation: item.rot || 0,
      size: size,
      source: 'manual', status: 'confirmed', confidence: 0,
      template: templateKey, createdAt: now(), updatedAt: now()
    };
    d.furniture.push(f);
    var n = {
      id: uid('nd'), roomId: roomId, furnitureId: f.id, parentId: '',
      name: f.name, type: '家具',
      order: d.nodes.filter(function (x) { return x.roomId === roomId && !x.parentId; }).length,
      createdAt: now(), updatedAt: now()
    };
    d.nodes.push(n);
    created.push(f.id);
  });
  rm.source = 'template';
  rm.templateKey = templateKey;
  rm.updatedAt = now();
  var r = commit();
  return r.ok ? { ok: true, data: { roomId: roomId, templateKey: templateKey, furnitureIds: created } } : r;
}

function updateFurniture(id, patch) {
  var d = load(), f = findById(d.furniture, id);
  if (!f) return { ok: false, error: 'NOT_FOUND' };
  if (patch.name !== undefined) {
    patch.name = (patch.name || '').trim();
    if (!patch.name) return { ok: false, error: 'INVALID_NAME' };
    f.name = patch.name;
    // 同步家具节点名称（逻辑位置显示用），不影响物品关联
    d.nodes.forEach(function (n) { if (n.furnitureId === id && n.type === '家具') { n.name = patch.name; n.updatedAt = now(); } });
  }
  if (patch.model !== undefined) f.model = patch.model; // 仅换外观，逻辑节点与物品关联不动（BR-009）
  if (patch.position !== undefined) f.position = patch.position;
  if (patch.rotation !== undefined) f.rotation = patch.rotation;
  if (patch.size !== undefined) f.size = patch.size;
  if (patch.status === 'confirmed') { f.status = 'confirmed'; f.source = 'user_confirmed'; }
  f.updatedAt = now();
  var r = commit(); return r.ok ? { ok: true, data: clone(f) } : r;
}
// CR-001 F-02 模型变换控制：移动/旋转/缩放，统一钳制，保证不产生非法布局（proposal §8 空间边界）
var SIZE_MIN = 0.1, SIZE_MAX = 12; // 米，家具尺寸合理上下限
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// 家具尺寸大于房间时 lo>hi，普通 clamp 会错误返回 lo；此时固定在房间中心
function clampCenter(v, lo, hi) { return lo > hi ? 0 : clamp(v, lo, hi); }
function transformFurniture(id, op) {
  var d = load(), f = findById(d.furniture, id);
  if (!f) return { ok: false, error: 'NOT_FOUND' };
  var room = findById(d.rooms, f.roomId) || {};
  var halfW = (room.width || 20) / 2, halfD = (room.depth || 20) / 2;
  var pos = f.position || { x: 0, y: 0, z: 0 };
  var size = f.size || { w: 0.6, h: 0.6, d: 0.6 };
  var patch = {};
  if (op.type === 'move') {
    // 新坐标 = 当前 + 增量；钳制到房间边界内（保留半个家具尺寸避免整体出界）
    var nx = clampCenter((pos.x || 0) + (op.dx || 0), -halfW + size.w / 2, halfW - size.w / 2);
    var nz = clampCenter((pos.z || 0) + (op.dz || 0), -halfD + size.d / 2, halfD - size.d / 2);
    patch.position = { x: round2(nx), y: pos.y || 0, z: round2(nz) };
  } else if (op.type === 'rotate') {
    // 角度增量（弧度），归一化到 [0, 2π)
    var r = (f.rotation || 0) + (op.dr || 0);
    r = r % (Math.PI * 2); if (r < 0) r += Math.PI * 2;
    patch.rotation = round4(r);
  } else if (op.type === 'scale') {
    var s = 1 + (op.factor || 0);
    patch.size = {
      w: round2(clamp(size.w * s, SIZE_MIN, SIZE_MAX)),
      h: round2(clamp(size.h * s, SIZE_MIN, SIZE_MAX)),
      d: round2(clamp(size.d * s, SIZE_MIN, SIZE_MAX))
    };
    // 缩放后位置可能越界，同步钳制
    patch.position = {
      x: round2(clampCenter(pos.x || 0, -halfW + patch.size.w / 2, halfW - patch.size.w / 2)),
      y: pos.y || 0,
      z: round2(clampCenter(pos.z || 0, -halfD + patch.size.d / 2, halfD - patch.size.d / 2))
    };
  } else return { ok: false, error: 'INVALID_OP' };
  return updateFurniture(id, patch);
}
function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

// ⚠ D-02 跨领域写函数（内核层）：furniture+nodes+items（删除迁移 unplaced，§4.5）
function removeFurniture(id) {
  var d = load(), f = findById(d.furniture, id);
  if (!f) return { ok: false, error: 'NOT_FOUND' };
  // 基线 §2.3：删除家具不阻断；其下节点随家具移除，物品转入 unplaced 兜底（保留 spaceId 与历史）
  var nodeIds = d.nodes.filter(function (n) { return n.furnitureId === id; }).map(function (n) { return n.id; });
  var migratedCount = 0;
  d.items.forEach(function (it) {
    if (nodeIds.indexOf(it.currentNodeId) >= 0 || (it.homeNodeId && nodeIds.indexOf(it.homeNodeId) >= 0)) {
      it.currentNodeId = '';
      it.homeNodeId = '';
      it.anchorType = 'unplaced';
      // 保留 spaceId，不清除
      migratedCount++;
    }
  });
  d.furniture = d.furniture.filter(function (x) { return x.id !== id; });
  d.nodes = d.nodes.filter(function (n) { return n.furnitureId !== id; });
  tombstone('furniture', id);
  var r = commit();
  return r.ok ? { ok: true, migratedItems: migratedCount } : r;
}

// ========== §4 节点域（PRD-014~017 / BR-007 多级树；itemsInNode 等为跨域只读查询） ==========
function listNodes(roomId) { return load().nodes.filter(function (n) { return n.roomId === roomId; }); }
function getNode(id) { return findById(load().nodes, id); }
function nodePath(nodeId) {
  var d = load(), path = [], seen = {}, cur = findById(d.nodes, nodeId);
  while (cur) {
    if (seen[cur.id]) break;
    seen[cur.id] = 1;
    path.unshift(cur.name);
    cur = cur.parentId ? findById(d.nodes, cur.parentId) : null;
  }
  return path;
}
// P1-6 由节点反查其所属空间：节点 → 房间 → 空间。用于校准物品档案归属，
// 避免建档/跨空间移动时 spaceId 与实际存放位置矛盾。取不到时返回空串，由调用方保留原值。
function spaceIdOfNode(nodeId) {
  if (!nodeId) return '';
  var d = load(), node = findById(d.nodes, nodeId);
  if (!node) return '';
  var room = findById(d.rooms, node.roomId);
  if (!room) return '';
  var sp = findById(d.spaces, room.spaceId);
  return sp ? sp.id : '';
}
function childrenOf(nodeId) {
  var d = load();
  return d.nodes.filter(function (n) { return n.parentId === nodeId; })
    .slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
}
function addNode(roomId, parentId, name, type) {
  var d = load();
  if (!findById(d.rooms, roomId)) return { ok: false, error: 'ROOM_NOT_FOUND' };
  if (parentId && !findById(d.nodes, parentId)) return { ok: false, error: 'PARENT_NOT_FOUND' };
  name = (name || '').trim();
  if (!name) return { ok: false, error: 'INVALID_NAME' };
  // TBD-004：允许同名节点，通过完整路径与同级排序区分，不强制唯一
  var siblings = d.nodes.filter(function (n) { return n.parentId === parentId && n.roomId === roomId; });
  var node = {
    id: uid('nd'), roomId: roomId, parentId: parentId || '', furnitureId: parentId ? (findById(d.nodes, parentId) || {}).furnitureId || '' : '',
    name: name, type: type || '收纳盒', order: siblings.length,
    createdAt: now(), updatedAt: now()
  };
  d.nodes.push(node);
  var r = commit(); return r.ok ? { ok: true, data: clone(node) } : r;
}
function updateNode(id, patch) {
  var d = load(), n = findById(d.nodes, id);
  if (!n) return { ok: false, error: 'NOT_FOUND' };
  if (patch.name !== undefined) {
    patch.name = (patch.name || '').trim();
    if (!patch.name) return { ok: false, error: 'INVALID_NAME' };
    n.name = patch.name;
  }
  if (patch.type !== undefined) n.type = patch.type;
  n.updatedAt = now();
  var r = commit(); return r.ok ? { ok: true, data: clone(n) } : r;
}
function reorderNode(id, dir) {
  var d = load(), n = findById(d.nodes, id);
  if (!n) return { ok: false, error: 'NOT_FOUND' };
  // TBD-006：排序只影响展示，不改层级/关联/历史
  var sibs = d.nodes.filter(function (x) { return x.parentId === n.parentId && x.roomId === n.roomId; })
    .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  var i = sibs.findIndex(function (x) { return x.id === id; });
  var j = i + (dir > 0 ? 1 : -1);
  if (j < 0 || j >= sibs.length) return { ok: true, data: null };
  var t = sibs[i].order; sibs[i].order = sibs[j].order; sibs[j].order = t;
  sibs[i].updatedAt = sibs[j].updatedAt = now();
  return commit();
}
function removeNode(id) {
  var d = load(), n = findById(d.nodes, id);
  if (!n) return { ok: false, error: 'NOT_FOUND' };
  var children = d.nodes.filter(function (x) { return x.parentId === id; });
  // 关联保护只统计仍在管理的物品；已结束物品不占用节点，与页面展示口径一致
  var items = itemsInNode(id);
  if (children.length || items.length) {
    return { ok: false, error: 'HAS_LINKS', children: children.length, items: items.length };
  }
  d.nodes = d.nodes.filter(function (x) { return x.id !== id; });
  tombstone('nodes', id);
  return commit();
}
function itemsInNode(nodeId) {
  var d = load();
  return d.items.filter(function (it) {
    return it.currentNodeId === nodeId && it.managementStatus !== 'ended';
  });
}
// CR-001 F-03 模型—物品绑定：沿该家具的全部逻辑节点聚合物品（单源 nodes.furnitureId + items.currentNodeId）
// 换模型只改 furniture.model，节点与物品不变，故此处关联天然解耦；不写 furniture.bindings，避免双绑定源
function itemsOfFurniture(furnitureId) {
  var d = load();
  var nodeIds = {};
  d.nodes.forEach(function (n) { if (n.furnitureId === furnitureId) nodeIds[n.id] = 1; });
  var seen = {}, out = [];
  d.items.forEach(function (it) {
    if (it.currentNodeId && nodeIds[it.currentNodeId] && !seen[it.id] && it.managementStatus !== 'ended') {
      seen[it.id] = 1;
      var node = findById(d.nodes, it.currentNodeId);
      out.push({ id: it.id, name: it.name, nodeId: it.currentNodeId, nodeName: node ? node.name : '', locationStatus: it.locationStatus || '' });
    }
  });
  return out;
}
// 绑定汇总（供三维选中卡展示）：节点数 + 物品列表
function bindingsOfFurniture(furnitureId) {
  var d = load();
  var nodes = d.nodes.filter(function (n) { return n.furnitureId === furnitureId; });
  return { furnitureId: furnitureId, nodeCount: nodes.length, items: itemsOfFurniture(furnitureId) };
}

// ========== §5 物品域（PRD-018~024 / BR-001~006；含移动留痕与结束管理） ==========
function listItems(filters) {
  var d = load();
  filters = filters || {};
  var list = d.items.slice();
  // 显式筛选"已结束管理"时自动纳入已结束物品，避免结果恒为空（TBD-008）
  if (filters.managementStatus === 'ended') filters.includeEnded = true;
  if (!filters.includeEnded) list = list.filter(function (it) { return it.managementStatus !== 'ended'; });
  if (filters.spaceId) list = list.filter(function (it) { return it.spaceId === filters.spaceId; });
  if (filters.keyword) {
    var kw = String(filters.keyword).trim().toLowerCase();
    list = list.filter(function (it) {
      if ((it.name || '').toLowerCase().indexOf(kw) >= 0) return true;
      if ((it.category || '').toLowerCase().indexOf(kw) >= 0) return true;
      if ((it.tags || []).some(function (t) { return String(t).toLowerCase().indexOf(kw) >= 0; })) return true;
      if ((it.note || '').toLowerCase().indexOf(kw) >= 0) return true;
      // P0-1 位置反查：按存放路径中的任一层级名（房间 / 收纳节点）匹配，便于"找东西"
      if (it.currentNodeId) {
        var segs = nodePath(it.currentNodeId);
        if (segs.some(function (s) { return String(s).toLowerCase().indexOf(kw) >= 0; })) return true;
      }
      return false;
    });
  }
  if (filters.category) list = list.filter(function (it) { return it.category === filters.category; });
  if (filters.tag) list = list.filter(function (it) { return (it.tags || []).indexOf(filters.tag) >= 0; });
  if (filters.locationStatus) list = list.filter(function (it) { return it.locationStatus === filters.locationStatus; });
  if (filters.managementStatus) list = list.filter(function (it) { return it.managementStatus === filters.managementStatus; });
  if (filters.trackingMode) list = list.filter(function (it) { return it.trackingMode === filters.trackingMode; });
  if (filters.currentNodeId) list = list.filter(function (it) { return it.currentNodeId === filters.currentNodeId; });
  if (filters.roomId) {
    var roomNodeIds = d.nodes.filter(function (n) { return n.roomId === filters.roomId; }).map(function (n) { return n.id; });
    list = list.filter(function (it) { return roomNodeIds.indexOf(it.currentNodeId) >= 0; });
  }
  return list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
}
function getItem(id) { return findById(load().items, id); }
// ⚠ D-02 跨领域写函数（内核层）：items+inventory+alerts
function addItem(opts) {
  var d = load();
  opts = opts || {};
  var name = (opts.name || '').trim();
  if (!name) return { ok: false, error: 'INVALID_NAME' }; // BR-001 只填名称即可
  var nodeId = opts.currentNodeId || '';
  // P1-6 建档归属以实际位置为准：指定了收纳节点时，空间取节点所属空间
  var nodeSpaceId = spaceIdOfNode(nodeId);
  var spaceId = nodeSpaceId || opts.spaceId || (getActiveSpace() || {}).id || '';
  var track = C.TRACK_MODES.some(function (m) { return m.key === opts.trackingMode; }) ? opts.trackingMode : 'location';
  var hasInitialPos = !!nodeId;
  var st = opts.locationStatus || (hasInitialPos ? 'at_home' : 'unknown');
  // 基线 §2 归属模型：anchorType 三态互斥
  //   furniture  — 挂家具（有 currentNodeId）
  //   space_direct — 空间直挂（用户主动不挂家具）
  //   unplaced   — 未放置兜底（家具被删除后转入）
  var anchorType = hasInitialPos ? 'furniture' : 'space_direct';
  var it = {
    id: uid('it'), spaceId: spaceId, name: name,
    category: opts.category || '', tags: normalizeTags(opts.tags), note: opts.note || '', photoPath: opts.photoPath || '',
    trackingMode: track, currentNodeId: hasInitialPos ? nodeId : '',
    anchorType: anchorType,
    // P1-4 常驻位置：物品"家"里的固定节点。外出/借出只清空 currentNodeId，
    // 不丢这个锚点；归还未指定新节点时据此自动回填。
    homeNodeId: hasInitialPos ? nodeId : '',
    locationStatus: st, managementStatus: 'active',
    // 收藏星标（交互说明书 V1.2 §5）：物品自身属性，随主数据持久化
    favorite: false,
    completed: 0, createdAt: now(), updatedAt: now()
  };
  it.completed = calcCompletion(it);
  d.items.push(it);
  // BR-004：创建时填的初始位置不记为一次移动
  // TBD-001：只有从 unknown 首次确认到具体位置才单独记 first_confirm，这里创建即填属初始信息
  if (track === 'inventory' || track === 'hybrid') {
    var unit = C.UNITS.indexOf(opts.unit) >= 0 ? opts.unit : C.UNITS[0];
    var th = Number(opts.threshold) || 0;
    var bal = Number(opts.balance) || 0;
    d.inventory.push({ id: uid('iv'), itemId: it.id, balance: bal, unit: unit, threshold: th, updatedAt: now() });
    // 初始库存属于建档初始状态，不生成交易流水（后续变化统一走库存交易）
  }
  var r = commit();
  if (!r.ok) return r;
  // 建档后按当前值刷新提醒（TBD-005）
  refreshAlertsForItem(it.id);
  return { ok: true, data: clone(it) };
}
function calcCompletion(it) {
  var n = 1; // 名称
  if (it.category) n++;
  if (it.photoPath) n++;
  if (it.note) n++;
  if (it.currentNodeId || it.locationStatus !== 'unknown') n++;
  return Math.round(n / 5 * 100);
}
function updateItem(id, patch) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  // TBD-003：已结束管理物品默认只读，禁止普通资料编辑
  if (it.managementStatus === 'ended') return { ok: false, error: 'ENDED_ITEM' };
  if (patch.name !== undefined) {
    patch.name = (patch.name || '').trim();
    if (!patch.name) return { ok: false, error: 'INVALID_NAME' };
    it.name = patch.name;
  }
  ['category', 'note', 'photoPath', 'locationStatus', 'favorite'].forEach(function (k) { if (patch[k] !== undefined) it[k] = patch[k]; });
  if (patch.tags !== undefined) it.tags = normalizeTags(patch.tags);
  it.updatedAt = now();
  it.completed = calcCompletion(it);
  var r = commit(); return r.ok ? { ok: true, data: clone(it) } : r;
}
// 收藏星标切换（交互说明书 V1.2 §5）。收藏是用户标记，已结束管理物品也允许收藏。
function toggleFavorite(id) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  it.favorite = !it.favorite;
  it.updatedAt = now();
  var r = commit();
  return r.ok ? { ok: true, data: { favorite: !!it.favorite } } : r;
}
function setItemTrackingMode(id, mode) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  if (it.managementStatus === 'ended') return { ok: false, error: 'ENDED_ITEM' };
  if (!C.TRACK_MODES.some(function (m) { return m.key === mode; })) return { ok: false, error: 'INVALID_MODE' };
  it.trackingMode = mode; it.updatedAt = now();
  if ((mode === 'inventory' || mode === 'hybrid') && !findInventoryByItem(id)) {
    d.inventory.push({ id: uid('iv'), itemId: id, balance: 0, unit: C.UNITS[0], threshold: 0, updatedAt: now() });
  }
  return commit();
}

// 位置移动（BR-005 事务一致：当前位置与历史同一函数写入）
// ⚠ D-02 跨领域写函数（内核层）：items+movements+processedRequests+spaceId
function moveItem(id, opts) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  if (it.managementStatus === 'ended') return { ok: false, error: 'ENDED_ITEM' };
  opts = opts || {};
  var newStatus = opts.locationStatus || it.locationStatus;
  var newPos = opts.currentNodeId !== undefined ? opts.currentNodeId : it.currentNodeId;
  // P1-4 归还未给节点但有有效常驻位置时放行，交给下方回填逻辑处理
  var canAutoBack = (it.locationStatus === 'out' || it.locationStatus === 'borrowed') &&
    (newStatus === 'at_home') && !newPos && it.homeNodeId && findById(d.nodes, it.homeNodeId);
  if (!newPos && newStatus === 'at_home' && !canAutoBack) return { ok: false, error: 'NO_TARGET' };

  var wasUnknown = it.locationStatus === 'unknown' || !it.currentNodeId;
  var goingOut = (newStatus === 'out' || newStatus === 'borrowed') && it.locationStatus === 'at_home';
  var returning = it.locationStatus === 'out' || it.locationStatus === 'borrowed';
  // 同一位置/状态重复确认：不产生无意义的重复历史（业务规则 §8.2）
  if (newStatus === it.locationStatus && (newPos || '') === (it.currentNodeId || '')) {
    return { ok: true, data: clone(it), unchanged: true };
  }
  // 幂等：校验全部通过后、写入前占用 requestId；重复提交不重复写历史（PRD §12 / 业务规则 §8.2）
  if (opts.requestId && claimRequest(d, opts.requestId)) {
    return { ok: true, data: clone(it), idempotent: true };
  }
  var type;
  if (wasUnknown && newPos && newStatus === 'at_home') type = 'first_confirm'; // TBD-001
  else if (goingOut) type = 'out';
  // TBD-002：返回可选择具体位置，或"在家，位置未知"；两者都记为 return
  else if (returning && (newStatus === 'at_home' || newStatus === 'unknown')) type = 'return';
  else type = 'move';

  var from = it.currentNodeId, fromStatus = it.locationStatus;
  // P1-4 常驻位置维护：
  // a) 确认"在家 + 具体节点"时，该节点视为常驻位置（用户主动把家搬到此处）。
  // b) 从在家转出/借出时，先把原节点记为常驻位置，再清空 currentNodeId —— 位置不再丢失。
  if (newStatus === 'at_home' && newPos) it.homeNodeId = newPos;
  else if (goingOut && !it.homeNodeId && from) it.homeNodeId = from;
  // c) 归还未指定节点：回填常驻位置（仅当它仍然有效），省去重新定位。
  var autoBack = false;
  if (returning && (newStatus === 'at_home' || newStatus === 'unknown') && !newPos && it.homeNodeId) {
    if (findById(d.nodes, it.homeNodeId)) { newPos = it.homeNodeId; autoBack = true; }
  }
  it.currentNodeId = newPos || '';
  it.locationStatus = newStatus;
  // 基线 §2 归属模型：挂节点即 furniture；外出时 homeNodeId 仍指向家具，保持 furniture
  if (newPos) it.anchorType = 'furniture';
  else if (it.homeNodeId && findById(d.nodes, it.homeNodeId)) it.anchorType = 'furniture';
  else if (it.anchorType !== 'unplaced') it.anchorType = 'space_direct';
  // P1-6 跨空间移动时同步档案归属；外出/借出无具体节点则保留原归属不误改
  var movedSpaceId = spaceIdOfNode(newPos);
  if (movedSpaceId) it.spaceId = movedSpaceId;
  // TBD-002 可选字段：借出对象、预计归还时间（仅 borrowed 状态写入，其余清空）
  if (newStatus === 'borrowed') {
    it.borrowTo = opts.borrowTo || '';
    it.dueDate = opts.dueDate || '';
  } else {
    it.borrowTo = '';
    it.dueDate = '';
  }
  it.updatedAt = now();
  it.completed = calcCompletion(it);
  d.movements.push({
    id: uid('mv'), itemId: id, type: type,
    fromNodeId: from, fromStatus: fromStatus,
    toNodeId: it.currentNodeId, toStatus: newStatus,
    borrowTo: it.borrowTo, dueDate: it.dueDate,
    note: opts.note || '', requestId: opts.requestId || '', createdAt: now()
  });
  var r = commit(); return r.ok ? { ok: true, data: clone(it), eventType: type, autoBack: autoBack } : r;
}
function listMovements(itemId) {
  var d = load();
  return d.movements.filter(function (m) { return !itemId || m.itemId === itemId; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; });
}
// ⚠ D-02 跨领域写函数（内核层）：items+inventory+movements+alerts
function endManagement(id, disposal) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  // TBD-003：结束管理前须明确剩余库存去向，处置单独记录，不伪装成消耗
  var iv = findInventoryByItem(id);
  if (iv && iv.balance > 0 && !disposal) return { ok: false, error: 'NEED_DISPOSAL', balance: iv.balance };
  // 解析处置类型（兼容旧的字符串写法；对象写法区分处置类型与说明）
  var dtype = 'other', dnote = '';
  if (typeof disposal === 'string') { dnote = disposal || ''; }
  else if (disposal && typeof disposal === 'object') {
    dtype = C.DISPOSAL_TYPES.some(function (t) { return t.key === disposal.type; }) ? disposal.type : 'other';
    dnote = disposal.note || '';
  }
  // 有剩余库存：先用"处置结存"交易清零，留痕且不伪装成消耗（业务规则附录 A）
  if (iv && iv.balance > 0) {
    var dname = (C.DISPOSAL_TYPES.filter(function (t) { return t.key === dtype; })[0] || {}).name || '其他';
    var r0 = inventoryTx(id, 'disposal', iv.balance, '处置结存（' + dname + '）', { internal: true });
    if (!r0.ok) return r0;
  }
  it.managementStatus = 'ended'; it.disposalType = dtype; it.updatedAt = now();
  d.movements.push({
    id: uid('mv'), itemId: id, type: 'end', disposalType: dtype,
    note: dnote || '结束管理', createdAt: now()
  });
  // 结束管理后关闭该物品未结束的提醒周期
  d.alerts.forEach(function (a) {
    if (a.itemId === id && a.status !== 'recovered') { a.status = 'recovered'; a.recoveredAt = now(); }
  });
  var r = commit(); return r.ok ? { ok: true } : r;
}
// TBD-003：恢复时不自动恢复旧位置为当前事实；默认回到"位置未知"，由用户在移动页重新确认
function restoreItem(id, opts) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  opts = opts || {};
  it.managementStatus = 'active';
  it.locationStatus = opts.locationStatus || 'unknown';
  it.currentNodeId = opts.currentNodeId || '';
  it.borrowTo = ''; it.dueDate = '';
  delete it.disposalType;
  it.updatedAt = now();
  d.movements.push({
    id: uid('mv'), itemId: id, type: 'restore',
    toStatus: it.locationStatus, toNodeId: it.currentNodeId,
    note: opts.note || '恢复日常管理，位置需重新确认', createdAt: now()
  });
  var r = commit(); return r.ok ? { ok: true, data: clone(it) } : r;
}

// ========== §6 库存域（PRD-025~029 / BR-010~012 / TBD-005/007） ==========
function findInventoryByItem(itemId) {
  var list = load().inventory;
  for (var i = 0; i < list.length; i++) if (list[i].itemId === itemId) return list[i];
  return null;
}
function listInventory() {
  var d = load();
  return d.inventory.filter(function (iv) {
    var it = findById(d.items, iv.itemId);
    return it && it.managementStatus !== 'ended' && it.trackingMode !== 'location';
  }).map(function (iv) {
    var it = findById(d.items, iv.itemId);
    return {
      id: iv.id, itemId: iv.itemId, name: it.name, category: it.category,
      balance: iv.balance, unit: iv.unit, threshold: iv.threshold,
      low: iv.threshold > 0 && iv.balance <= iv.threshold
    };
  }).sort(function (a, b) { return (a.balance - a.threshold) - (b.balance - b.threshold); });
}
function updateInventory(itemId, patch) {
  var d = load(), iv = findInventoryByItem(itemId);
  if (!iv) return { ok: false, error: 'NOT_FOUND' };
  var _it = findById(d.items, itemId);
  if (_it && _it.managementStatus === 'ended') return { ok: false, error: 'ENDED_ITEM' };
  if (patch.unit !== undefined) {
    // 兼容历史单位：已有值原样保存时不拒绝，只拦截新的非法单位
    if (patch.unit !== iv.unit && C.UNITS.indexOf(patch.unit) < 0) return { ok: false, error: 'INVALID_UNIT' };
    iv.unit = patch.unit;
  }
  if (patch.threshold !== undefined) iv.threshold = Math.max(0, Number(patch.threshold) || 0);
  iv.updatedAt = now();
  var r = commit();
  if (r.ok) refreshAlertsForItem(itemId);
  return r;
}
function inventoryTx(itemId, type, amount, note, opts) {
  var d = load(), iv = findInventoryByItem(itemId);
  if (!iv) return { ok: false, error: 'NOT_FOUND' };
  var _it = findById(d.items, itemId);
  if (_it && _it.managementStatus === 'ended') return { ok: false, error: 'ENDED_ITEM' };
  opts = opts || {};
  if (C.INVENTORY_TX_TYPES.map(function (t) { return t.key; }).indexOf(type) < 0) return { ok: false, error: 'INVALID_TYPE' };
  amount = Number(amount);
  if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' };
  // TBD-003：处置结存用于结束管理时清零剩余库存，不伪装成消耗
  if (type === 'disposal' && !opts.internal) return { ok: false, error: 'INVALID_TYPE' };
  if (type === 'adjust' && !opts.internal && !(opts.reason || (note || '').trim())) {
    return { ok: false, error: 'REASON_REQUIRED' };
  }
  // 调整：把余额直接设为输入数量（与消耗/入库的增减语义分开）；delta 记实际增减量
  var next = (type === 'adjust') ? amount : iv.balance + ((type === 'consume' || type === 'disposal') ? -amount : amount);
  var delta = next - iv.balance;
  if (next < 0) return { ok: false, error: 'BELOW_ZERO', balance: iv.balance }; // BR-011 库存不为负
  // 幂等：全部校验通过后、写入前占用 requestId；重复提交不重复入账（业务规则 §9.2/§12）
  if (opts.requestId && claimRequest(d, opts.requestId)) {
    return { ok: true, balance: iv.balance, idempotent: true };
  }
  // BR-010：每次变更都有交易记录，余额与结果一致；adjust 与 consume 分开记录
  iv.balance = next; iv.updatedAt = now();
  d.transactions.push({
    id: uid('tx'), itemId: itemId, type: type, delta: delta,
    balanceAfter: next, note: note || '', reason: opts.reason || '',
    requestId: opts.requestId || '', createdAt: now()
  });
  var r = commit();
  if (r.ok) refreshAlertsForItem(itemId);
  return r.ok ? { ok: true, balance: next } : r;
}
function listTransactions(itemId) {
  var d = load();
  return d.transactions.filter(function (t) { return !itemId || t.itemId === itemId; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; });
}

// ========== §7 提醒域（BR-012 / TBD-005 提醒生命周期） ==========
// ⚠ D-02 跨领域写函数（内核层）：alerts+items+inventory+transactions
function refreshAlertsForItem(itemId) {
  var d = load(), iv = findInventoryByItem(itemId);
  if (!iv || iv.threshold <= 0) return;
  var it = findById(d.items, itemId);
  if (!it || it.managementStatus === 'ended' || it.trackingMode === 'location') return;
  var low = iv.balance <= iv.threshold;
  // 找该物品当前未结束的提醒周期
  var open = null;
  for (var i = 0; i < d.alerts.length; i++) {
    var a = d.alerts[i];
    if (a.itemId === itemId && a.status !== 'recovered') { open = a; break; }
  }
  if (low) {
    if (!open) {
      // 开启新周期，同一周期只生成一条
      d.alerts.push({ id: uid('al'), itemId: itemId, cycleId: uid('cy'), status: 'pending', createdAt: now() });
    }
    // 已忽略不因再次读取而改变（忽略不代表恢复）
  } else if (open) {
    open.status = 'recovered'; open.recoveredAt = now(); // 达标自动结束周期
  }
  commit();
}
function listAlerts(opts) {
  var d = load();
  opts = opts || {};
  return d.alerts.filter(function (a) {
    return opts.includeRecovered ? true : (a.status === 'pending' || a.status === 'ignored');
  })
    .map(function (a) {
      var it = findById(d.items, a.itemId);
      var iv = findInventoryByItem(a.itemId);
      return {
        id: a.id, itemId: a.itemId, status: a.status, createdAt: a.createdAt,
        name: it ? it.name : '（物品已删除）',
        balance: iv ? iv.balance : 0, threshold: iv ? iv.threshold : 0, unit: iv ? iv.unit : ''
      };
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
}
function ignoreAlert(id) {
  var d = load(), a = findById(d.alerts, id);
  if (!a) return { ok: false, error: 'NOT_FOUND' };
  a.status = 'ignored'; a.ignoredAt = now();
  return commit();
}

// ========== §8 统计域（跨集合只读聚合） ==========
function getStats() {
  var activeSpace = getActiveSpace();
  var sid = activeSpace ? activeSpace.id : '';
  var items = listItems({ spaceId: sid });
  var inv = listInventory();
  var alerts = listAlerts();
  return {
    spaceName: activeSpace ? activeSpace.name : '',
    spaceCount: listSpaces().length,
    roomCount: sid ? listRooms(sid).length : 0,
    itemCount: items.length,
    inventoryCount: inv.length,
    lowCount: alerts.length,
    unknownCount: items.filter(function (i) { return i.locationStatus === 'unknown'; }).length
  };
}

// ========== §9 演示数据与快照（内核级：种子数据/清空/导出导入，随内核走，不随域拆分） ==========
// 演示数据：首次启动填充，便于直接看到完整功能；用户可清空
function seedDemo() {
  var d = load();
  if (d.settings.seeded) return { ok: true, seeded: false };
  var sp = { id: uid('sp'), name: '我的家', archived: false, createdAt: now(), updatedAt: now() };
  d.spaces.push(sp);
  var rm = {
    id: uid('rm'), spaceId: sp.id, name: '主卧', width: 4.6, depth: 4.2, height: 2.8, calibrated: true,
    source: 'manual', templateKey: '', layout: makeLayout({ width: 4.6, depth: 4.2, height: 2.8 }),
    photos: [], task: { status: 'none', taskId: '', error: '' }, archived: false, createdAt: now(), updatedAt: now()
  };
  d.rooms.push(rm);
  // 主卧在户型总览中的排布（与 demo 默认槽位一致）
  rm.floor = { x: 1, y: 1, w: 3, h: 3 };
  rm.templateKey = 'bedroom';
  d.settings.activeSpaceId = sp.id;

  // 追加客厅/卫生间，使首页户型总览接近既定演示样貌（仅新增，不改主卧既有数据）
  function seedExtraRoom(name, width, depth, height, tpl, floor, furnList) {
    var r = {
      id: uid('rm'), spaceId: sp.id, name: name, width: width, depth: depth, height: height, calibrated: true,
      source: 'manual', templateKey: tpl, layout: makeLayout({ width: width, depth: depth, height: height }),
      floor: floor, photos: [], task: { status: 'none', taskId: '', error: '' },
      archived: false, createdAt: now(), updatedAt: now()
    };
    d.rooms.push(r);
    furnList.forEach(function (f) {
      var lib = C.FURNITURE_LIB[f[0]] || { size: [0.5, 0.5, 0.5], vars: ['默认'] };
      var fu = {
        id: uid('fu'), roomId: r.id, category: f[0], name: f[1], model: lib.vars[0],
        position: { x: f[2], y: 0, z: f[3] }, rotation: 0,
        size: { w: lib.size[0], h: lib.size[1], d: lib.size[2] },
        source: 'manual', status: 'confirmed', confidence: 0, createdAt: now(), updatedAt: now()
      };
      d.furniture.push(fu);
      d.nodes.push({
        id: uid('nd'), roomId: r.id, furnitureId: fu.id, parentId: '', name: f[1], type: '家具',
        order: d.nodes.filter(function (x) { return x.roomId === r.id && !x.parentId; }).length,
        createdAt: now(), updatedAt: now()
      });
    });
  }
  seedExtraRoom('客厅', 4.2, 3.8, 2.8, 'living', { x: 4, y: 1, w: 3, h: 4 }, [
    ['电视柜', '电视柜', 0, -1.4], ['沙发', '三人沙发', 0, 1.2], ['茶几', '茶几', 0, 0]
  ]);
  seedExtraRoom('卫生间', 2.4, 2.0, 2.6, 'bath', { x: 1, y: 4, w: 3, h: 2 }, [
    ['收纳盒', '浴室收纳盒', -0.8, -0.8], ['抽屉', '镜柜抽屉', 0.8, -1]
  ]);

  function addF(cat, name, x, z, rot) {
    var lib = C.FURNITURE_LIB[cat] || { size: [0.5, 0.5, 0.5], vars: ['默认'] };
    var f = { id: uid('fu'), roomId: rm.id, category: cat, name: name, model: lib.vars[0],
      position: { x: x, y: 0, z: z }, rotation: rot || 0,
      size: { w: lib.size[0], h: lib.size[1], d: lib.size[2] },
      source: 'manual', status: 'confirmed', confidence: 0, createdAt: now(), updatedAt: now() };
    d.furniture.push(f);
    var n = { id: uid('nd'), roomId: rm.id, furnitureId: f.id, parentId: '', name: name, type: '家具',
      order: d.nodes.filter(function (x) { return x.roomId === rm.id && !x.parentId; }).length, createdAt: now(), updatedAt: now() };
    d.nodes.push(n);
    return n;
  }
  var bedNode = addF('床', '双人床', -1.2, 0.4, 0);
  var cabNode = addF('床头柜', '床头柜', -2.0, -0.4, 0);
  addF('窗帘', '落地窗', 0.4, -2.0, 0);
  // 床头柜下的抽屉节点
  var drawer = { id: uid('nd'), roomId: rm.id, furnitureId: cabNode.furnitureId, parentId: cabNode.id,
    name: '上层抽屉', type: '抽屉/隔层', order: 0, createdAt: now(), updatedAt: now() };
  d.nodes.push(drawer);

  function addIt(name, cat, mode, nodeId, st, extra) {
    extra = extra || {};
    var it = { id: uid('it'), spaceId: sp.id, name: name, category: cat, note: extra.note || '', photoPath: '',
      trackingMode: mode, currentNodeId: nodeId || '', locationStatus: st || (nodeId ? 'at_home' : 'unknown'),
      managementStatus: 'active', completed: 60, createdAt: now(), updatedAt: now() };
    d.items.push(it);
    if (mode === 'inventory' || mode === 'hybrid') {
      // 建档初始库存不生成流水；演示数据中的洗发水交易用于展示后续入库/消耗记录
      d.inventory.push({ id: uid('iv'), itemId: it.id, balance: extra.balance || 0, unit: extra.unit || '瓶',
        threshold: extra.threshold || 0, updatedAt: now() });
    }
    return it.id;
  }
  addIt('身份证', '证件卡片', 'location', drawer.id, 'at_home');
  addIt('羊毛毯', '家居布艺', 'location', bedNode.id, 'at_home');
  var shampooId = addIt('洗发水', '卫浴清洁', 'inventory', '', 'at_home', { balance: 1, threshold: 2, unit: '瓶' });
  addIt('抽纸', '卫浴清洁', 'inventory', '', 'at_home', { balance: 8, threshold: 5, unit: '包' });
  // 演示交易：与 demo 快照一致，体现入库/消耗留痕，初始库存本身不记交易
  d.transactions.push({ id: uid('tx'), itemId: shampooId, type: 'in', delta: 2, balanceAfter: 3, note: '超市采购', createdAt: now() - 1728e5 });
  d.transactions.push({ id: uid('tx'), itemId: shampooId, type: 'consume', delta: -2, balanceAfter: 1, note: '', createdAt: now() - 6e5 });
  addIt('备用钥匙', '其他', 'location', '', 'unknown');
  d.settings.seeded = true;
  var r = commit();
  // 刷新提醒（洗发水低于阈值）
  d.inventory.forEach(function (iv) { refreshAlertsForItem(iv.itemId); });
  return r.ok ? { ok: true, seeded: true } : r;
}
// ⚠ D-02 跨领域写函数（内核层）：全集合+墓碑+_cache 重置
function clearAll() {
  var d = load();
  // 清空前为所有业务记录写删除墓碑（BR：清空/重建必须与云端一致）
  // 否则云端旧记录不删，重新载入演示数据后 pull 会把新旧两套数据叠加，出现多个同名房间
  var cols = ['spaces','rooms','furniture','nodes','items','movements','inventory','transactions','alerts'];
  cols.forEach(function (col) {
    (d[col] || []).forEach(function (row) { if (row && row.id) tombstone(col, row.id); });
  });
  _cache = blank();
  var r = commit();
  return r;
}

// ========== §10 统一对外入口（barrel）：页面只允许从这里取数据接口 ==========
// 导出接口与正文 § 分节一一对应；跨领域写函数已在 §0/§9 与正文各自上方标注。
module.exports = {
  // 空间
  listSpaces: listSpaces, listAllSpaces: listAllSpaces, getActiveSpace: getActiveSpace,
  setActiveSpace: setActiveSpace, addSpace: addSpace, updateSpace: updateSpace, archiveSpace: archiveSpace,
  // 房间
  listRooms: listRooms, getRoom: getRoom, addRoom: addRoom, updateRoom: updateRoom,   archiveRoom: archiveRoom, deleteRoom: deleteRoom,
  roomAssociations: roomAssociations,
  // 照片与任务
  addPhotos: addPhotos, removePhoto: removePhoto, startTask: startTask, finishTask: finishTask,
  // 家具
  listFurniture: listFurniture, getFurniture: getFurniture, addFurniture: addFurniture,
  listRoomTemplates: listRoomTemplates, applyRoomTemplate: applyRoomTemplate,
  updateFurniture: updateFurniture, transformFurniture: transformFurniture, removeFurniture: removeFurniture,
  // 节点
  listNodes: listNodes, getNode: getNode, nodePath: nodePath, childrenOf: childrenOf,
  addNode: addNode, updateNode: updateNode, reorderNode: reorderNode, removeNode: removeNode, itemsInNode: itemsInNode,
  itemsOfFurniture: itemsOfFurniture, bindingsOfFurniture: bindingsOfFurniture,
  // 物品
  listItems: listItems, getItem: getItem, addItem: addItem, updateItem: updateItem,
  toggleFavorite: toggleFavorite,
  setItemTrackingMode: setItemTrackingMode, moveItem: moveItem, listMovements: listMovements,
  endManagement: endManagement, restoreItem: restoreItem, calcCompletion: calcCompletion,
  allTags: allTags, normalizeTags: normalizeTags, spaceIdOfNode: spaceIdOfNode,
  // 库存
  findInventoryByItem: findInventoryByItem, listInventory: listInventory, updateInventory: updateInventory,
  inventoryTx: inventoryTx, listTransactions: listTransactions,
  // 提醒
  listAlerts: listAlerts, ignoreAlert: ignoreAlert,
  // 统计与演示
  getStats: getStats, getHomeOverview: getHomeOverview,
  floorValid: floorValid, autoFloorPlace: autoFloorPlace,
  FLOOR_COLS: FLOOR_COLS, FLOOR_MAX_ROWS: FLOOR_MAX_ROWS,
  seedDemo: seedDemo, clearAll: clearAll,
  // 工具
  fmtTime: fmtTime, uid: uid,

  // ---- §9 内核级·本地备份/恢复接口（供 backup 页面使用；页面层无需直接调用） ----
  // 导出当前全量快照；每条保留业务 id 字段
  exportSnapshot: function () {
    var d = load();
    return {
      spaces: d.spaces, rooms: d.rooms, furniture: d.furniture, nodes: d.nodes,
      items: d.items, movements: d.movements, inventory: d.inventory,
      transactions: d.transactions, alerts: d.alerts, tasks: []
    };
  },
  // 导出删除墓碑
  getTombstones: function () {
    try { return wx.getStorageSync(TOMB_KEY) || []; } catch (e) { return []; }
  },
  // 墓碑清空（同步成功后调用）
  clearTombstones: function () { try { wx.setStorageSync(TOMB_KEY, []); } catch (e) {} },
  // ⚠ D-02 跨领域写函数（内核层）：全集合覆盖+_cache 重置
  // 用云端快照覆盖本地：按业务 id 去重（兼容历史重复数据），再写入主存储并清缓存
  applySnapshot: function (snap) {
    if (!snap || typeof snap !== 'object') return { ok: false, error: 'INVALID_SNAPSHOT' };
    function timeOf(v) {
      if (v === undefined || v === null) return 0;
      if (typeof v === 'object' && v.$date) return new Date(v.$date).getTime() || 0;
      var n = Number(v);
      return isNaN(n) ? 0 : n;
    }
    function uniqueById(rows) {
      var seen = {}, out = [];
      (rows || []).forEach(function (row) {
        if (!row) return;
        var key = row.id || row._id;
        if (!key) { out.push(row); return; }
        var prev = seen[key];
        if (!prev) { seen[key] = row; out.push(row); return; }
        var t = (timeOf(row.updatedAt) - timeOf(prev.updatedAt)) ||
                (timeOf(row.createdAt) - timeOf(prev.createdAt));
        if (t > 0) { out[out.indexOf(prev)] = row; seen[key] = row; }
      });
      return out;
    }
    var b = blank();
    ['spaces','rooms','furniture','nodes','items','movements','inventory','transactions','alerts'].forEach(function (k) {
      if (Array.isArray(snap[k])) b[k] = uniqueById(snap[k]);
    });
    // 保留当前设置（activeSpaceId/seeded），避免跨设备覆盖用户当前所在空间
    var d = load();
    b.settings = d.settings;
    _cache = b;
    var r = save();
    return r.ok ? { ok: true } : r;
  }
};
