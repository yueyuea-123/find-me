// 云函数 adminService —— PRD-030 基础管理后台（仅排障所需最小能力）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { ok, fail } = require('./common.js');

// 管理员 openid 从环境变量读取，不硬编码在代码中
const ADMINS = (process.env.ADMIN_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean);

async function requireAdmin(openid) {
  if (ADMINS.indexOf(openid) >= 0) return true;
  const u = await db.collection('users').where({ openid }).limit(1).get();
  return !!(u.data && u.data.length && u.data[0].role === 'admin');
}

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail('NOT_LOGIN');
    if (!(await requireAdmin(openid))) return fail('PERMISSION_DENIED');

    const { action, data } = event;
    const page = Math.max(1, (data && data.page) || 1);
    const size = Math.min(50, (data && data.size) || 20);

    if (action === 'tasks') {
      const where = {};
      if (data && data.status) where.status = data.status;
      const cnt = await db.collection('tasks').where(where).count();
      const list = await db.collection('tasks').where(where)
        .field({ photos: false }) // 不返回照片内容
        .orderBy('createdAt', 'desc').skip((page-1)*size).limit(size).get();
      return ok({ total: cnt.total, list: list.data, page, size });
    }

    if (action === 'logs') {
      const where = {};
      if (data && data.level) where.level = data.level;
      const cnt = await db.collection('sys_logs').where(where).count();
      const list = await db.collection('sys_logs').where(where)
        .orderBy('createdAt', 'desc').skip((page-1)*size).limit(size).get();
      return ok({ total: cnt.total, list: list.data, page, size });
    }

    if (action === 'users') {
      const cnt = await db.collection('users').count();
      const list = await db.collection('users').field({ openid: true, role: true, status: true, lastLoginAt: true })
        .skip((page-1)*size).limit(size).get();
      // 只返回统计与状态，不含隐私数据
      return ok({ total: cnt.total, list: list.data, page, size });
    }
    return fail('INVALID_ACTION');
  } catch (e) {
    return fail('INTERNAL_ERROR', e.message || String(e));
  }
};
