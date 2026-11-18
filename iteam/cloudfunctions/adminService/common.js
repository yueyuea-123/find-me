// 通用响应与校验 —— 居所收纳 MVP
function ok(data) { return { ok: true, data: data }; }
function fail(error, message) { return { ok: false, error: error, message: message || error }; }

// 所有集合白名单，客户端只能操作这些集合，防止越权访问其他集合
var ALLOWED = ['spaces','rooms','furniture','nodes','items','movements',
  'inventory','transactions','alerts','tasks'];

function isAllowed(col) { return ALLOWED.indexOf(col) >= 0; }

module.exports = { ok: ok, fail: fail, ALLOWED: ALLOWED, isAllowed: isAllowed };
