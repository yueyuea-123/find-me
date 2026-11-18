// 云函数 reportError —— 前端错误上报（家庭照片内容永不上报）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { ok, fail } = require('./common.js');

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail('NOT_LOGIN');
    const d = event.data || {};
    const message = String(d.message || '').slice(0, 500);
    const stack = String(d.stack || '').slice(0, 1000);
    const page = String(d.page || '').slice(0, 100);
    if (!message) return fail('INVALID_DATA');
    await db.collection('sys_logs').add({ data: {
      openid, level: 'error', message, context: { stack, page }, createdAt: db.serverDate()
    }});
    return ok({ reported: true });
  } catch (e) {
    return fail('INTERNAL_ERROR', e.message || String(e));
  }
};
