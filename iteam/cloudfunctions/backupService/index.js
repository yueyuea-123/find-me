// 云函数 backupService —— PRD-032 备份与恢复基础
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { ok, fail } = require('./common.js');

const COLS = ['spaces','rooms','furniture','nodes','items','movements','inventory','transactions','alerts'];

async function snapshot(openid) {
  const snap = {};
  let total = 0;
  for (const col of COLS) {
    const all = await db.collection(col).where({ openid }).limit(1000).get();
    snap[col] = all.data || [];
    total += snap[col].length;
  }
  return { snapshot: snap, recordCount: total };
}

// 定时自动备份：遍历所有活跃用户，各生成一份 auto 快照
async function scheduledBackup() {
  const users = await db.collection('users').where({ status: 'active' }).limit(1000).get();
  let done = 0;
  for (const u of (users.data || [])) {
    try {
      const s = await snapshot(u.openid);
      await db.collection('backups').add({ data: {
        openid: u.openid, snapshot: s.snapshot, recordCount: s.recordCount,
        type: 'auto', note: '每日自动备份', createdAt: db.serverDate()
      }});
      done++;
    } catch (e) { /* 单用户失败不影响其他用户 */ }
  }
  return ok({ scheduled: true, users: done });
}

exports.main = async (event) => {
  try {
    // 定时触发器事件无微信用户上下文，需遍历所有活跃用户批量备份
    const isTimer = !!(event && (event.Type === 'Timer' || event.triggerName || event.Message));
    if (isTimer) return await scheduledBackup();

    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail('NOT_LOGIN');
    const { action, data } = event;
    const col = db.collection('backups');

    if (action === 'create') {
      const s = await snapshot(openid);
      const doc = {
        openid, snapshot: s.snapshot, recordCount: s.recordCount,
        type: (data && data.type) || 'manual', note: (data && data.note) || '',
        createdAt: db.serverDate()
      };
      const r = await col.add({ data: doc });
      return ok({ backupId: r._id, recordCount: s.recordCount, createdAt: Date.now() });
    }

    if (action === 'list') {
      const page = Math.max(1, (data && data.page) || 1);
      const size = Math.min(20, (data && data.size) || 10);
      const cnt = await col.where({ openid }).count();
      const list = await col.where({ openid })
        .field({ snapshot: false }) // 列表不返回快照正文，减小传输
        .orderBy('createdAt', 'desc').skip((page-1)*size).limit(size).get();
      return ok({ total: cnt.total, list: list.data, page, size });
    }

    if (action === 'restore') {
      const backupId = data && data.backupId;
      if (!backupId) return fail('INVALID_DATA', '缺少 backupId');
      const target = await col.doc(backupId).get();
      if (!target.data || target.data.openid !== openid) return fail('BACKUP_NOT_FOUND');

      // 恢复前先自动建一份当前快照，保证可回滚
      const before = await snapshot(openid);
      await col.add({ data: {
        openid, snapshot: before.snapshot, recordCount: before.recordCount,
        type: 'auto', note: '恢复前自动备份', createdAt: db.serverDate()
      }});

      // 逐集合覆盖：先清除该用户现有数据，再写入快照
      const snap = target.data.snapshot || {};
      let restored = 0;
      for (const name of COLS) {
        await db.collection(name).where({ openid }).remove();
        const rows = snap[name] || [];
        for (const row of rows) {
          const copy = Object.assign({}, row);
          delete copy._id;
          copy.openid = openid;
          await db.collection(name).add({ data: copy });
          restored++;
        }
      }
      try {
        await db.collection('sys_logs').add({ data: {
          openid, level: 'warn', message: 'backupService.restore',
          context: { backupId, restored }, createdAt: db.serverDate()
        }});
      } catch (e) {}
      return ok({ recordCount: restored, restoredAt: Date.now() });
    }
    return fail('INVALID_ACTION');
  } catch (e) {
    return fail('INTERNAL_ERROR', e.message || String(e));
  }
};
