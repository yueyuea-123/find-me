// 纯 Node 测试：dataSync 云函数的幂等写入、删除、去重与 openid 隔离
// 不需要真云环境，用内存集合 mock wx-server-sdk；运行：node qa/cloud-sync-robustness-test.js
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); }
}

function makeDb() {
  const data = {};
  function col(name) {
    if (!data[name]) data[name] = [];
    const rows = data[name];
    function filtered(query) {
      return rows.filter(r => Object.keys(query || {}).every(k => r[k] === query[k]));
    }
    return {
      where(query) {
        const hit = filtered(query);
        const chain = {
          get: async () => ({ data: hit.slice() }),
          skip(n) {
            const sliced = hit.slice(n);
            return { limit(limit) { return { get: async () => ({ data: sliced.slice(0, limit) }) }; } };
          },
          limit(n) { return { get: async () => ({ data: hit.slice(0, n) }) }; },
          remove: async () => {
            hit.forEach(r => rows.splice(rows.indexOf(r), 1));
            return { removed: hit.length };
          }
        };
        return chain;
      },
      doc(id) {
        return {
          update: async ({ data: patch }) => {
            const row = rows.find(r => r._id === id);
            if (row) Object.assign(row, patch);
          }
        };
      },
      add: async ({ data: row }) => {
        const doc = Object.assign({ _id: '_' + Math.random().toString(36).slice(2) }, row);
        rows.push(doc);
        return { _id: doc._id };
      }
    };
  }
  return {
    collection: col,
    serverDate: () => Date.now(),
    command: {},
    _data: data
  };
}

const db = makeDb();
let currentOpenid = 'userA';
const cloudMock = {
  DYNAMIC_CURRENT_ENV: 'test',
  init: () => {},
  database: () => db,
  getWXContext: () => ({ OPENID: currentOpenid })
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloudMock;
  return origLoad.apply(this, arguments);
};
const fn = require(path.join(__dirname, '..', 'cloudfunctions', 'dataSync', 'index.js'));
Module._load = origLoad;

const call = (action, data) => fn.main({ action, data: data || {} });

(async () => {
  // 1. 同一业务 id 重复 upsert：只应有一条文档
  const rowA = { id: 'rm_1', name: '主卧', spaceId: 'sp_1', width: 4, updatedAt: 1 };
  await call('batch', { ops: [{ collection: 'rooms', op: 'set', id: rowA.id, data: rowA }] });
  await call('batch', { ops: [{ collection: 'rooms', op: 'set', id: rowA.id, data: Object.assign({}, rowA, { name: '主卧改名' }) }] });
  ok('同 id 重复写入不产生副本', db._data.rooms.length === 1, 'count=' + db._data.rooms.length);
  ok('同 id 重复写入更新内容', db._data.rooms[0].name === '主卧改名', db._data.rooms[0].name);

  // 2. 按 id 删除
  await call('batch', { ops: [{ collection: 'rooms', op: 'remove', id: rowA.id }] });
  ok('按业务 id 删除云端记录', db._data.rooms.length === 0, 'count=' + db._data.rooms.length);

  // 3. 历史重复数据：pull 去重并清理旧副本
  db._data.items = [
    { _id: 'old', openid: 'userA', id: 'it_1', name: '旧', updatedAt: 10 },
    { _id: 'new', openid: 'userA', id: 'it_1', name: '新', updatedAt: 20 },
    { _id: 'other', openid: 'userA', id: 'it_2', name: '另一件', updatedAt: 1 }
  ];
  const pulled = await call('pull', {});
  ok('pull 按业务 id 去重', pulled.ok && pulled.data.snapshot.items.length === 2,
    JSON.stringify(pulled.data && pulled.data.snapshot.items.map(r => r.name)));
  ok('pull 保留最新副本', pulled.data.snapshot.items.some(r => r._id === 'new' && r.name === '新'));
  ok('pull 清理历史重复副本', db._data.items.length === 2 && !db._data.items.some(r => r._id === 'old'));

  // 4. openid 隔离
  currentOpenid = 'userB';
  const other = await call('pull', {});
  ok('不同 openid 拉不到他人数据', other.ok && other.data.snapshot.items.length === 0);

  // 5. 兼容旧文档：只有 roomId 没有 id 的记录按旧键命中后更新，不再新增
  currentOpenid = 'userA';
  db._data.rooms = [{ _id: 'legacy', openid: 'userA', roomId: 'rm_2', name: '旧键房间' }];
  await call('batch', { ops: [{ collection: 'rooms', op: 'set', id: 'rm_2', data: { id: 'rm_2', name: '新键房间' } }] });
  ok('兼容旧版业务键记录', db._data.rooms.length === 1 && db._data.rooms[0].name === '新键房间',
    JSON.stringify(db._data.rooms));

  // 6. 前端同步层：拉取不清除 dirty；同步期间的新编辑也不会被本次 flush 吞掉
  let batchResolve = null, tombstonesCleared = 0;
  global.wx = { cloud: {
    init: () => {},
    callFunction: o => new Promise(resolve => {
      const action = o.data && o.data.action;
      const done = result => o.success({ result });
      if (action === 'login') done({ ok: true, data: { openid: 'userA', role: 'user' } });
      else if (action === 'pull') done({ ok: true, data: { snapshot: { rooms: [] } } });
      else if (action === 'batch') { batchResolve = () => done({ ok: true, data: {} }); }
      else done({ ok: true, data: {} });
    })
  } };
  const Sync = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'cloud-sync.js'));
  const login = await Sync.init();
  Sync.setDataProvider({
    getSnapshot: () => ({ rooms: [{ id: 'rm_1', name: 'A' }] }),
    getTombstones: () => [],
    clearTombstones: () => { tombstonesCleared++; }
  });
  Sync.markDirty();
  const pulledLocal = await Sync.pull();
  ok('pull 不清除未推送标记', pulledLocal.ok && Sync.getState().dirty === true);
  const flushing = Sync.flush();
  await new Promise(r => setImmediate(r)); // 等批次调用进入 in-flight 状态
  Sync.markDirty(); // 模拟推送过程中用户又改了内容
  batchResolve();
  const flushed = await flushing;
  ok('同步期间的新编辑保持 dirty', flushed.ok && Sync.getState().dirty === true && flushed.pending === true,
    JSON.stringify({dirty: Sync.getState().dirty, pending: flushed.pending}));
  ok('有新编辑时不提前清空墓碑', tombstonesCleared === 0, 'cleared=' + tombstonesCleared);

  console.log('\n结果 ' + pass + '/' + (pass + fail) + ' 通过');
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
