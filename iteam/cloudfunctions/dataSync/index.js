// 云函数 dataSync —— 离线优先架构核心：全量拉取 + 批量写入
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { ok, fail, isAllowed } = require('./common.js');

const COLS = ['spaces','rooms','furniture','nodes','items','movements','inventory','transactions','alerts','tasks'];

async function pullAll(openid) {
  const result = { spaces:[], rooms:[], furniture:[], nodes:[], items:[], movements:[],
    inventory:[], transactions:[], alerts:[], tasks:[] };
  for (const col of COLS) {
    // 单次上限 100，循环分页直至取完（MVP 数据量小，通常一页足够）
    let skip = 0, batch;
    do {
      batch = await db.collection(col).where({ openid }).skip(skip).limit(100).get();
      result[col] = result[col].concat(batch.data || []);
      skip += 100;
    } while ((batch.data || []).length === 100 && skip < 1000);
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
        const doc = Object.assign({}, data, { openid, updatedAt: db.serverDate() });
        if (id) {
          const exist = await col.where({ openid, [idField(collection)]: id }).limit(1).get();
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
        await col.where({ openid, [idField(collection)]: id }).remove();
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
