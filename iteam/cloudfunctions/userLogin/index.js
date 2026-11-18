// 云函数 userLogin —— PRD-001 个人账户登录
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { ok, fail } = require('./common.js');

exports.main = async (event) => {
  try {
    const wxCtx = cloud.getWXContext();
    const openid = wxCtx.OPENID;
    if (!openid) return fail('NOT_LOGIN');

    const users = db.collection('users');
    const found = await users.where({ openid: openid }).limit(1).get();

    if (!found.data || !found.data.length) {
      const doc = {
        openid, role: 'user', status: 'active',
        createdAt: db.serverDate(), lastLoginAt: db.serverDate()
      };
      const r = await users.add({ data: doc });
      return ok({ openid, isNew: true, role: 'user', status: 'active', _id: r._id });
    }
    const u = found.data[0];
    if (u.status === 'banned') return fail('PERMISSION_DENIED', '账号已被禁用');
    await users.doc(u._id).update({ data: { lastLoginAt: db.serverDate() } });
    return ok({ openid, isNew: false, role: u.role || 'user', status: u.status || 'active' });
  } catch (e) {
    return fail('INTERNAL_ERROR', e.message || String(e));
  }
};
