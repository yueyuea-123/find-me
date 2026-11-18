// utils/store.js —— 本地存储数据层（MVP 个人单用户）
// 业务规则来源：业务规则说明书 V1.1（BR-001~015）与 TBD-001~008
// 设计原则：事实与预测分离、失败可降级、三维对象与逻辑位置解耦、用户确认优先、数据可追溯
// 所有写操作在内存中完成变更后一次性落盘，保证"位置更新与历史写入同一事务"（10.3）

var C = require('./constants.js');
var Sync = null;
try { Sync = require('./cloud-sync.js'); } catch (e) { Sync = null; }

var KEY = 'home3d_store_v1';
var TOMB_KEY = 'home3d_tombstones_v1'; // 删除墓碑：记录已删除记录，供云同步表达删除

// 云同步标记：commit 时调用，不阻塞本地写操作
function markSyncDirty() { if (Sync && Sync.markDirty) { try { Sync.markDirty(); } catch (e) {} } }

// ---------- 底层读写 ----------
function blank() {
  return {
    version: 1,
    spaces: [], rooms: [], furniture: [], nodes: [], items: [],
    movements: [], inventory: [], transactions: [], alerts: [],
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
  var r = save();
  if (r.ok) markSyncDirty();
  return r;
}

// 记录删除墓碑（逻辑删除由字段表达，物理删除需记录供云端同步）
function tombstone(collection, id) {
  var list = [];
  try { list = wx.getStorageSync(TOMB_KEY) || []; } catch (e) {}
  list.push({ collection: collection, id: id, at: now() });
  if (list.length > 500) list = list.slice(-500);
  try { wx.setStorageSync(TOMB_KEY, list); } catch (e) {}
  markSyncDirty();
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function findById(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function now() { return Date.now(); }

function fmtTime(ts) {
  var d = new Date(ts);
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------- 空间（PRD-002 / 业务规则第3章） ----------
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

// ---------- 房间（PRD-003 / 业务规则第3章） ----------
function listRooms(spaceId) {
  var d = load();
  return d.rooms.filter(function (r) {
    return !r.archived && (!spaceId || r.spaceId === spaceId);
  }).slice().sort(function (a, b) { return a.createdAt - b.createdAt; });
}
function getRoom(id) { return findById(load().rooms, id); }
function addRoom(spaceId, name, dims) {
  var d = load();
  if (!findById(d.spaces, spaceId)) return { ok: false, error: 'SPACE_NOT_FOUND' };
  name = (name || '').trim();
  if (!name) return { ok: false, error: 'INVALID_NAME' };
  dims = dims || {};
  var r0 = {
    id: uid('rm'), spaceId: spaceId, name: name,
    width: dims.width || 0, depth: dims.depth || 0, height: dims.height || 0,
    calibrated: !!(dims.width && dims.depth),
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
  }
  ['width', 'depth', 'height'].forEach(function (k) { if (patch[k] !== undefined) rm[k] = Number(patch[k]) || 0; });
  if (patch.name !== undefined) rm.name = patch.name;
  if (patch.width !== undefined || patch.depth !== undefined) rm.calibrated = !!(rm.width && rm.depth);
  rm.updatedAt = now();
  var r = commit(); return r.ok ? { ok: true, data: clone(rm) } : r;
}
function archiveRoom(id) {
  var d = load(), rm = findById(d.rooms, id);
  if (!rm) return { ok: false, error: 'NOT_FOUND' };
  rm.archived = true; rm.updatedAt = now();
  var r = commit(); return r.ok ? { ok: true } : r;
}

// ---------- 照片与建模任务（PRD-005/006/007） ----------
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

// ---------- 家具（PRD-009~013 / BR-009 模型与逻辑解耦） ----------
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
function removeFurniture(id) {
  var d = load(), f = findById(d.furniture, id);
  if (!f) return { ok: false, error: 'NOT_FOUND' };
  // 关联保护（BR-008）：家具下有子节点或物品时拒绝删除
  var childNodes = d.nodes.filter(function (n) { return n.furnitureId === id && n.type !== '家具'; });
  var nodeIds = d.nodes.filter(function (n) { return n.furnitureId === id; }).map(function (n) { return n.id; });
  var items = d.items.filter(function (it) { return nodeIds.indexOf(it.currentNodeId) >= 0; });
  if (childNodes.length || items.length) {
    return { ok: false, error: 'HAS_LINKS', childNodes: childNodes.length, items: items.length };
  }
  d.furniture = d.furniture.filter(function (x) { return x.id !== id; });
  d.nodes = d.nodes.filter(function (n) { return n.furnitureId !== id; });
  tombstone('furniture', id);
  return commit();
}

// ---------- 收纳节点（PRD-014~017 / BR-007 多级树） ----------
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
  var items = d.items.filter(function (it) { return it.currentNodeId === id; });
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

// ---------- 物品档案（PRD-018~024 / BR-001~006） ----------
function listItems(filters) {
  var d = load();
  filters = filters || {};
  var list = d.items.slice();
  if (!filters.includeEnded) list = list.filter(function (it) { return it.managementStatus !== 'ended'; });
  if (filters.spaceId) list = list.filter(function (it) { return it.spaceId === filters.spaceId; });
  if (filters.keyword) {
    var kw = String(filters.keyword).trim().toLowerCase();
    list = list.filter(function (it) { return (it.name || '').toLowerCase().indexOf(kw) >= 0 || (it.category || '').toLowerCase().indexOf(kw) >= 0; });
  }
  if (filters.category) list = list.filter(function (it) { return it.category === filters.category; });
  if (filters.locationStatus) list = list.filter(function (it) { return it.locationStatus === filters.locationStatus; });
  if (filters.managementStatus) list = list.filter(function (it) { return it.managementStatus === filters.managementStatus; });
  if (filters.trackingMode) list = list.filter(function (it) { return it.trackingMode === filters.trackingMode; });
  if (filters.roomId) {
    var roomNodeIds = d.nodes.filter(function (n) { return n.roomId === filters.roomId; }).map(function (n) { return n.id; });
    list = list.filter(function (it) { return roomNodeIds.indexOf(it.currentNodeId) >= 0; });
  }
  return list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
}
function getItem(id) { return findById(load().items, id); }
function addItem(opts) {
  var d = load();
  opts = opts || {};
  var name = (opts.name || '').trim();
  if (!name) return { ok: false, error: 'INVALID_NAME' }; // BR-001 只填名称即可
  var spaceId = opts.spaceId || (getActiveSpace() || {}).id || '';
  var track = C.TRACK_MODES.some(function (m) { return m.key === opts.trackingMode; }) ? opts.trackingMode : 'location';
  var nodeId = opts.currentNodeId || '';
  var hasInitialPos = !!nodeId;
  var st = opts.locationStatus || (hasInitialPos ? 'at_home' : 'unknown');
  var it = {
    id: uid('it'), spaceId: spaceId, name: name,
    category: opts.category || '', note: opts.note || '', photoPath: opts.photoPath || '',
    trackingMode: track, currentNodeId: hasInitialPos ? nodeId : '',
    locationStatus: st, managementStatus: 'active',
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
    if (bal > 0) d.transactions.push({ id: uid('tx'), itemId: it.id, type: 'adjust', delta: bal, balanceAfter: bal, note: '建档初始数量', createdAt: now() });
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
  if (patch.name !== undefined) {
    patch.name = (patch.name || '').trim();
    if (!patch.name) return { ok: false, error: 'INVALID_NAME' };
    it.name = patch.name;
  }
  ['category', 'note', 'photoPath', 'locationStatus'].forEach(function (k) { if (patch[k] !== undefined) it[k] = patch[k]; });
  it.updatedAt = now();
  it.completed = calcCompletion(it);
  var r = commit(); return r.ok ? { ok: true, data: clone(it) } : r;
}
function setItemTrackingMode(id, mode) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  if (!C.TRACK_MODES.some(function (m) { return m.key === mode; })) return { ok: false, error: 'INVALID_MODE' };
  it.trackingMode = mode; it.updatedAt = now();
  if ((mode === 'inventory' || mode === 'hybrid') && !findInventoryByItem(id)) {
    d.inventory.push({ id: uid('iv'), itemId: id, balance: 0, unit: C.UNITS[0], threshold: 0, updatedAt: now() });
  }
  return commit();
}

// 位置移动（BR-005 事务一致：当前位置与历史同一函数写入）
function moveItem(id, opts) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  if (it.managementStatus === 'ended') return { ok: false, error: 'ENDED_ITEM' };
  opts = opts || {};
  var newStatus = opts.locationStatus || it.locationStatus;
  var newPos = opts.currentNodeId !== undefined ? opts.currentNodeId : it.currentNodeId;
  if (!newPos && newStatus === 'at_home') return { ok: false, error: 'NO_TARGET' };

  var wasUnknown = it.locationStatus === 'unknown' || !it.currentNodeId;
  var goingOut = (newStatus === 'out' || newStatus === 'borrowed') && it.locationStatus === 'at_home';
  var returning = it.locationStatus === 'out' || it.locationStatus === 'borrowed';
  var type;
  if (wasUnknown && newPos && newStatus === 'at_home') type = 'first_confirm'; // TBD-001
  else if (goingOut) type = 'out';
  else if (returning && newStatus === 'at_home') type = 'return';
  else type = 'move';

  var from = it.currentNodeId, fromStatus = it.locationStatus;
  it.currentNodeId = newPos || '';
  it.locationStatus = newStatus;
  it.updatedAt = now();
  it.completed = calcCompletion(it);
  d.movements.push({
    id: uid('mv'), itemId: id, type: type,
    fromNodeId: from, fromStatus: fromStatus,
    toNodeId: it.currentNodeId, toStatus: newStatus,
    note: opts.note || '', createdAt: now()
  });
  var r = commit(); return r.ok ? { ok: true, data: clone(it), eventType: type } : r;
}
function listMovements(itemId) {
  var d = load();
  return d.movements.filter(function (m) { return !itemId || m.itemId === itemId; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; });
}
function endManagement(id, disposal) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  // TBD-003：结束管理前须明确剩余库存去向，处置单独记录，不伪装成消耗
  var iv = findInventoryByItem(id);
  if (iv && iv.balance > 0 && !disposal) return { ok: false, error: 'NEED_DISPOSAL', balance: iv.balance };
  it.managementStatus = 'ended'; it.updatedAt = now();
  d.movements.push({ id: uid('mv'), itemId: id, type: 'end', note: disposal || '结束管理', createdAt: now() });
  var r = commit(); return r.ok ? { ok: true } : r;
}
function restoreItem(id) {
  var d = load(), it = findById(d.items, id);
  if (!it) return { ok: false, error: 'NOT_FOUND' };
  it.managementStatus = 'active'; it.updatedAt = now();
  return commit();
}

// ---------- 库存（PRD-025~029 / BR-010~012 / TBD-005/007） ----------
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
  if (patch.unit !== undefined) {
    if (C.UNITS.indexOf(patch.unit) < 0) return { ok: false, error: 'INVALID_UNIT' };
    iv.unit = patch.unit;
  }
  if (patch.threshold !== undefined) iv.threshold = Math.max(0, Number(patch.threshold) || 0);
  iv.updatedAt = now();
  var r = commit();
  if (r.ok) refreshAlertsForItem(itemId);
  return r;
}
function inventoryTx(itemId, type, amount, note) {
  var d = load(), iv = findInventoryByItem(itemId);
  if (!iv) return { ok: false, error: 'NOT_FOUND' };
  if (C.INVENTORY_TX_TYPES.map(function (t) { return t.key; }).indexOf(type) < 0) return { ok: false, error: 'INVALID_TYPE' };
  amount = Number(amount);
  if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'INVALID_AMOUNT' };
  var delta = (type === 'consume') ? -amount : amount;
  var next = iv.balance + delta;
  if (next < 0) return { ok: false, error: 'BELOW_ZERO', balance: iv.balance }; // BR-011 库存不为负
  // BR-010：每次变更都有交易记录，余额与结果一致；adjust 与 consume 分开记录
  iv.balance = next; iv.updatedAt = now();
  d.transactions.push({
    id: uid('tx'), itemId: itemId, type: type, delta: delta,
    balanceAfter: next, note: note || '', createdAt: now()
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

// ---------- 提醒（BR-012 / TBD-005 提醒生命周期） ----------
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
function listAlerts() {
  var d = load();
  return d.alerts.filter(function (a) { return a.status === 'pending' || a.status === 'ignored'; })
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

// ---------- 统计与演示数据 ----------
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

// 演示数据：首次启动填充，便于直接看到完整功能；用户可清空
function seedDemo() {
  var d = load();
  if (d.settings.seeded) return { ok: true, seeded: false };
  var sp = { id: uid('sp'), name: '我的家', archived: false, createdAt: now(), updatedAt: now() };
  d.spaces.push(sp);
  var rm = {
    id: uid('rm'), spaceId: sp.id, name: '主卧', width: 4.6, depth: 4.2, height: 2.8, calibrated: true,
    photos: [], task: { status: 'none', taskId: '', error: '' }, archived: false, createdAt: now(), updatedAt: now()
  };
  d.rooms.push(rm);
  d.settings.activeSpaceId = sp.id;

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
      d.inventory.push({ id: uid('iv'), itemId: it.id, balance: extra.balance || 0, unit: extra.unit || '瓶',
        threshold: extra.threshold || 0, updatedAt: now() });
      if (extra.balance) d.transactions.push({ id: uid('tx'), itemId: it.id, type: 'adjust', delta: extra.balance,
        balanceAfter: extra.balance, note: '建档初始数量', createdAt: now() });
    }
    return it.id;
  }
  addIt('身份证', '证件卡片', 'location', drawer.id, 'at_home');
  addIt('羊毛毯', '家居布艺', 'location', bedNode.id, 'at_home');
  addIt('洗发水', '卫浴清洁', 'inventory', '', 'at_home', { balance: 1, threshold: 2, unit: '瓶' });
  addIt('抽纸', '卫浴清洁', 'inventory', '', 'at_home', { balance: 8, threshold: 5, unit: '包' });
  addIt('备用钥匙', '其他', 'location', '', 'unknown');
  d.settings.seeded = true;
  var r = commit();
  // 刷新提醒（洗发水低于阈值）
  d.inventory.forEach(function (iv) { refreshAlertsForItem(iv.itemId); });
  return r.ok ? { ok: true, seeded: true } : r;
}
function clearAll() {
  _cache = blank();
  var r = commit();
  return r;
}

module.exports = {
  // 空间
  listSpaces: listSpaces, listAllSpaces: listAllSpaces, getActiveSpace: getActiveSpace,
  setActiveSpace: setActiveSpace, addSpace: addSpace, updateSpace: updateSpace, archiveSpace: archiveSpace,
  // 房间
  listRooms: listRooms, getRoom: getRoom, addRoom: addRoom, updateRoom: updateRoom, archiveRoom: archiveRoom,
  // 照片与任务
  addPhotos: addPhotos, removePhoto: removePhoto, startTask: startTask, finishTask: finishTask,
  // 家具
  listFurniture: listFurniture, getFurniture: getFurniture, addFurniture: addFurniture,
  updateFurniture: updateFurniture, removeFurniture: removeFurniture,
  // 节点
  listNodes: listNodes, getNode: getNode, nodePath: nodePath, childrenOf: childrenOf,
  addNode: addNode, updateNode: updateNode, reorderNode: reorderNode, removeNode: removeNode, itemsInNode: itemsInNode,
  // 物品
  listItems: listItems, getItem: getItem, addItem: addItem, updateItem: updateItem,
  setItemTrackingMode: setItemTrackingMode, moveItem: moveItem, listMovements: listMovements,
  endManagement: endManagement, restoreItem: restoreItem, calcCompletion: calcCompletion,
  // 库存
  findInventoryByItem: findInventoryByItem, listInventory: listInventory, updateInventory: updateInventory,
  inventoryTx: inventoryTx, listTransactions: listTransactions,
  // 提醒
  listAlerts: listAlerts, ignoreAlert: ignoreAlert,
  // 统计与演示
  getStats: getStats, seedDemo: seedDemo, clearAll: clearAll,
  // 工具
  fmtTime: fmtTime, uid: uid,

  // ---- 云同步适配接口（供 cloud-sync.js 使用；页面层无需调用） ----
  // 导出当前全量快照，按云集合名分组；每条保留业务 id 字段
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
  // 用云端快照覆盖本地：先备份到临时键，再写入主存储并清缓存
  applySnapshot: function (snap) {
    if (!snap || typeof snap !== 'object') return { ok: false, error: 'INVALID_SNAPSHOT' };
    var b = blank();
    ['spaces','rooms','furniture','nodes','items','movements','inventory','transactions','alerts'].forEach(function (k) {
      if (Array.isArray(snap[k])) b[k] = snap[k];
    });
    // 保留当前设置（activeSpaceId/seeded），避免跨设备覆盖用户当前所在空间
    var d = load();
    b.settings = d.settings;
    _cache = b;
    var r = save();
    return r.ok ? { ok: true } : r;
  }
};
