// utils/cloud-sync.js —— 云同步适配层（离线优先）
// 设计原则：store.js 保持全同步 API，页面层零改动；本模块在后台完成登录/拉取/推送
// 数据隔离：openid 由云函数从微信上下文获取，前端不传身份
// 失败降级：云不可用时本地功能完整可用，标记 dirty 并允许重试
// 删除表达：本地维护墓碑(tombstone)列表，flush 时连同快照一起推送

var CLOUD_ENV_ID = ''; // 部署时在此填写环境 ID；留空则使用默认环境
var DATA_PROVIDER = null; // 由 app.js 注入：{ getSnapshot, getTombstones, clearTombstones }

var FN = {
  login: 'userLogin', sync: 'dataSync', photo: 'photoService',
  backup: 'backupService', admin: 'adminService', error: 'reportError'
};

var state = {
  enabled: false, loggedIn: false, openid: '', role: 'user',
  dirty: false, lastSyncAt: 0, lastError: '', syncing: false
};

var listeners = [];
function emit() { listeners.forEach(function (fn) { try { fn(getState()); } catch (e) {} }); }
function onStateChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }

function getState() {
  return {
    enabled: state.enabled, loggedIn: state.loggedIn, openid: state.openid,
    role: state.role, dirty: state.dirty,
    lastSyncAt: state.lastSyncAt, lastError: state.lastError
  };
}

function setDataProvider(p) { DATA_PROVIDER = p; }

function callFunction(name, action, data) {
  return new Promise(function (resolve, reject) {
    if (!wx.cloud) { reject(new Error('CLOUD_UNAVAILABLE')); return; }
    wx.cloud.callFunction({
      name: name,
      data: { action: action, data: data || {} },
      success: function (res) { resolve(res && res.result); },
      fail: function (err) { reject(err); }
    });
  });
}

// 初始化云能力。失败不抛错，返回 { ok:false, error } 让调用方降级
function init() {
  if (!wx.cloud) { state.lastError = 'CLOUD_UNAVAILABLE'; emit(); return Promise.resolve({ ok: false, error: 'CLOUD_UNAVAILABLE' }); }
  try { wx.cloud.init({ traceUser: true, env: CLOUD_ENV_ID || undefined }); }
  catch (e) { state.lastError = 'CLOUD_INIT_FAILED'; emit(); return Promise.resolve({ ok: false, error: 'CLOUD_INIT_FAILED' }); }
  state.enabled = true;
  return callFunction(FN.login, 'login', {})
    .then(function (r) {
      if (!r || !r.ok) { state.lastError = (r && r.error) || 'LOGIN_FAILED'; emit(); return { ok: false, error: state.lastError }; }
      state.loggedIn = true;
      state.openid = r.data.openid;
      state.role = r.data.role || 'user';
      state.lastError = '';
      emit();
      return { ok: true, role: state.role, isNew: r.data.isNew };
    })
    .catch(function (e) { state.lastError = e.message || 'LOGIN_FAILED'; emit(); return { ok: false, error: state.lastError }; });
}

// 从云端拉取全量快照。调用方负责用 snapshot 覆盖本地存储
function pull() {
  if (!state.loggedIn) return Promise.resolve({ ok: false, error: 'NOT_LOGIN' });
  return callFunction(FN.sync, 'pull', {})
    .then(function (r) {
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'PULL_FAILED' };
      state.lastSyncAt = Date.now(); state.dirty = false; state.lastError = '';
      emit();
      return { ok: true, snapshot: r.data.snapshot };
    })
    .catch(function (e) { state.lastError = e.message || 'PULL_FAILED'; emit(); return { ok: false, error: state.lastError }; });
}

// 标记本地有未推送变更（由 store.commit 调用）
function markDirty() {
  if (!state.enabled) return;
  state.dirty = true;
  emit();
}

// 推送本地全量快照 + 墓碑删除。合并为一次 batch，保证 moveItem/inventoryTx 同源
function flush() {
  if (!state.loggedIn || state.syncing || !state.dirty) return Promise.resolve({ ok: false, error: 'IDLE' });
  if (!DATA_PROVIDER) return Promise.resolve({ ok: false, error: 'NO_PROVIDER' });
  state.syncing = true;

  var ops = [];
  try {
    var snap = DATA_PROVIDER.getSnapshot() || {};
    Object.keys(snap).forEach(function (col) {
      (snap[col] || []).forEach(function (row) {
        var id = row.id || row._id;
        ops.push({ collection: col, op: 'set', id: id, data: row });
      });
    });
    var tombstones = DATA_PROVIDER.getTombstones() || [];
    tombstones.forEach(function (t) {
      ops.push({ collection: t.collection, op: 'remove', id: t.id });
    });
  } catch (e) {
    state.syncing = false; state.lastError = 'SNAPSHOT_FAILED';
    emit();
    return Promise.resolve({ ok: false, error: 'SNAPSHOT_FAILED' });
  }

  if (!ops.length) { state.syncing = false; state.dirty = false; emit(); return Promise.resolve({ ok: true, empty: true }); }
  // 分批推送，每批不超过 200 条
  var batches = [];
  for (var i = 0; i < ops.length; i += 200) batches.push(ops.slice(i, i + 200));

  var chain = Promise.resolve({ ok: true });
  batches.forEach(function (b) {
    chain = chain.then(function (prev) {
      if (!prev.ok) return prev;
      return callFunction(FN.sync, 'batch', { ops: b }).then(function (r) {
        if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'SYNC_FAILED' };
        return { ok: true };
      }).catch(function (e) { return { ok: false, error: e.message || 'SYNC_FAILED' }; });
    });
  });

  return chain.then(function (r) {
    state.syncing = false;
    if (r.ok) {
      state.dirty = false; state.lastSyncAt = Date.now(); state.lastError = '';
      if (DATA_PROVIDER.clearTombstones) DATA_PROVIDER.clearTombstones();
      emit();
      return { ok: true, pushed: ops.length };
    }
    state.lastError = r.error || 'SYNC_FAILED';
    emit();
    return { ok: false, error: state.lastError };
  });
}

// 上传照片：先向云函数申请隔离路径，再 wx.cloud.uploadFile
function uploadPhoto(filePath, roomId, ext) {
  if (!state.loggedIn) return Promise.reject(new Error('NOT_LOGIN'));
  return callFunction(FN.photo, 'signUpload', { roomId: roomId, ext: ext })
    .then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'SIGN_FAILED');
      return new Promise(function (resolve, reject) {
        wx.cloud.uploadFile({
          cloudPath: r.data.cloudPath, filePath: filePath,
          success: function (up) { resolve({ fileId: up.fileID, cloudPath: r.data.cloudPath }); },
          fail: function (err) { reject(err); }
        });
      });
    });
}

function getTempUrls(fileIds) {
  if (!state.loggedIn) return Promise.resolve([]);
  return callFunction(FN.photo, 'signRead', { fileIds: fileIds })
    .then(function (r) { return (r && r.ok) ? (r.data.urls || []) : []; })
    .catch(function () { return []; });
}

function backup(action, data) {
  if (!state.loggedIn) return Promise.resolve({ ok: false, error: 'NOT_LOGIN' });
  return callFunction(FN.backup, action, data)
    .catch(function (e) { return { ok: false, error: e.message || 'BACKUP_FAILED' }; });
}

function adminQuery(action, data) {
  if (!state.loggedIn || state.role !== 'admin') return Promise.resolve({ ok: false, error: 'PERMISSION_DENIED' });
  return callFunction(FN.admin, action, data)
    .catch(function (e) { return { ok: false, error: e.message || 'ADMIN_FAILED' }; });
}

function reportError(info) {
  if (!state.loggedIn) return;
  callFunction(FN.error, 'report', info).catch(function () {});
}

var timer = null;
function startAutoSync() {
  if (timer) return;
  timer = setInterval(function () { if (state.dirty) flush(); }, 30000);
}
function stopAutoSync() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = {
  setEnv: function (id) { CLOUD_ENV_ID = id; },
  setDataProvider: setDataProvider,
  init: init, pull: pull, markDirty: markDirty, flush: flush,
  uploadPhoto: uploadPhoto, getTempUrls: getTempUrls,
  backup: backup, adminQuery: adminQuery, reportError: reportError,
  getState: getState, onStateChange: onStateChange,
  startAutoSync: startAutoSync, stopAutoSync: stopAutoSync
};
