// 云函数 dataSync —— 离线优先架构核心：全量拉取 + 批量写入
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { ok, fail, isAllowed } = require('./common.js');

const COLS = ['spaces','rooms','furniture','nodes','items','movements','inventory','transactions','alerts','tasks'];

function rowTime(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime() || 0;
  if (typeof v === 'object' && v.$date) return new Date(v.$date).getTime() || 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
// 同一业务 id 只保留最新一条；历史同步曾按不存在的 roomId/itemId 等字段查重，
// 导致每次 flush 都新增副本，pull 会把副本全部拉回造成房间/家具重复。
function dedupeRows(rows) {
  const byId = new Map();
  const dupIds = [];
  rows.forEach(row => {
    if (!row || !row.id) return;
    const prev = byId.get(row.id);
    if (!prev) { byId.set(row.id, row); return; }
    const t = rowTime(row.updatedAt) - rowTime(prev.updatedAt) ||
              rowTime(row.createdAt) - rowTime(prev.createdAt);
    if (t > 0) { dupIds.push(prev._id); byId.set(row.id, row); }
    else dupIds.push(row._id);
  });
  const kept = [];
  rows.forEach(row => {
    if (!row) return;
    if (!row.id) { kept.push(row); return; }
    if (byId.get(row.id) === row) kept.push(row);
  });
  return { rows: kept, dupIds: dupIds.filter(Boolean) };
}

async function pullAll(openid) {
  const result = { spaces:[], rooms:[], furniture:[], nodes:[], items:[], movements:[],
    inventory:[], transactions:[], alerts:[], tasks:[] };
  for (const col of COLS) {
    // 单次上限 100，循环分页直至取完（MVP 数据量小，通常一页足够）
    let skip = 0, batch, rows = [];
    do {
      batch = await db.collection(col).where({ openid }).skip(skip).limit(100).get();
      rows = rows.concat(batch.data || []);
      skip += 100;
    } while ((batch.data || []).length === 100 && skip < 1000);
    const deduped = dedupeRows(rows);
    result[col] = deduped.rows;
    // 顺手清掉历史重复副本，只删同一 openid 下确认冗余的记录
    for (const dupId of deduped.dupIds) {
      try { await db.collection(col).where({ openid, _id: dupId }).remove(); } catch (e) {}
    }
  }
  return result;
}

async function batchWrite(openid, ops) {
  if (!Array.isArray(ops) || !ops.length) return fail('INVALID_DATA', 'ops 不能为空');
  if (ops.length > 200) return fail('INVALID_DATA', '单批最多 200 条操作');

  const results = [];
  // 同一 openid 下顺序执行，保证 moveItem / inventoryTx 的写入顺序与本地一致
  for (const op of ops) {
    const { collection, op: kind, id, data } = op;
    if (!isAllowed(collection)) { results.push({ error: 'INVALID_COLLECTION', collection }); continue; }
    const col = db.collection(collection);
    try {
      if (kind === 'set') {
        // 业务主键统一使用本地 store 的 id；先按 id 查重，再兼容旧版 spaceId/roomId 等键
        const doc = Object.assign({}, data, { openid, id: id || data.id, updatedAt: db.serverDate() });
        if (id) {
          let exist = await col.where({ openid, id }).limit(1).get();
          if (!(exist.data && exist.data.length)) {
            const legacy = idField(collection);
            if (legacy !== 'id') exist = await col.where({ openid, [legacy]: id }).limit(1).get();
          }
          if (exist.data && exist.data.length) {
            await col.doc(exist.data[0]._id).update({ data: doc });
          } else {
            const addDoc = Object.assign({}, doc, { createdAt: db.serverDate() });
            await col.add({ data: addDoc });
          }
        } else {
          const addDoc = Object.assign({}, doc, { createdAt: db.serverDate() });
          await col.add({ data: addDoc });
        }
        results.push({ ok: true });
      } else if (kind === 'remove') {
        if (id) {
          await col.where({ openid, id }).remove();
          const legacy = idField(collection);
          if (legacy !== 'id') await col.where({ openid, [legacy]: id }).remove();
        }
        results.push({ ok: true });
      } else {
        results.push({ error: 'INVALID_OP' });
      }
    } catch (e) {
      results.push({ error: 'WRITE_FAILED', message: e.message });
    }
  }
  // 记录同步日志（不写失败项明细，避免日志过大）
  try {
    await db.collection('sys_logs').add({ data: {
      openid, level: 'info', message: 'dataSync.batch', context: { count: ops.length },
      createdAt: db.serverDate()
    }});
  } catch (e) {}
  const hasError = results.some(r => !r.ok);
  return hasError ? { ok: false, error: 'SYNC_CONFLICT', results } : ok({ results, serverTime: Date.now() });
}

// 旧版云文档的冗余业务键，仅为兼容历史数据查询；新写入与查重一律用 id
function idField(col) {
  const map = { spaces:'spaceId', rooms:'roomId', furniture:'furnitureId', nodes:'nodeId',
    items:'itemId', movements:'movementId', inventory:'inventoryId', transactions:'txId',
    alerts:'alertId', tasks:'taskId' };
  return map[col] || '_id';
}

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail('NOT_LOGIN');
    const { action, data } = event;
    if (action === 'pull') return ok({ snapshot: await pullAll(openid), serverTime: Date.now() });
    if (action === 'batch') return await batchWrite(openid, data && data.ops);
    return fail('INVALID_ACTION');
  } catch (e) {
    return fail('INTERNAL_ERROR', e.message || String(e));
  }
};
