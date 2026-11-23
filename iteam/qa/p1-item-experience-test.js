/**
 * P1 物品管理体验增强验证（纯 Node，mock 微信运行时直接驱动数据层）
 * 覆盖三项新行为：
 *   P1-4 借出保留常驻位置 homeNodeId + 归还未指定节点自动回填
 *   P1-6 建档/移动时 spaceId 以位置节点实际归属空间为准
 *   P1-5 标签 normalizeTags / allTags / addItem / updateItem / listItems 筛选
 * 用法: node qa/p1-item-experience-test.js
 */
const path = require('path');

const storage = {};
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: k => { delete storage[k]; },
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: () => {}, navigateTo: () => {}, switchTab: () => {}, redirectTo: () => {},
  canIUse: () => false, getSystemInfoSync: () => ({ windowWidth: 375 }),
  getLogManager: () => ({ error: () => {} })
};

const store = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'store.js'));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

// ---------- 造数据：两个空间，各一个房间，各一个节点 ----------
const spA = store.addSpace('A 空间').data;
const spB = store.addSpace('B 空间').data;
store.setActiveSpace(spA.id);
const rmA = store.addRoom(spA.id, '卧室A').data;
const rmB = store.addRoom(spB.id, '卧室B').data;
const ndA = store.addNode(rmA.id, '', 'A-抽屉', '抽屉/隔层').data;
const ndB = store.addNode(rmB.id, '', 'B-柜子', '收纳盒').data;

// ========== P1-6 spaceId 归属校准 ==========
ok(store.spaceIdOfNode(ndB.id) === spB.id, 'P1-6 节点反查空间正确');
ok(store.spaceIdOfNode('no-such') === '', 'P1-6 无效节点返回空串');
const itemAB = store.addItem({ name: '校准测试件', currentNodeId: ndB.id, spaceId: spA.id }).data;
ok(itemAB.spaceId === spB.id, 'P1-6 建档归属以节点空间为准（覆盖传入 spaceId）', itemAB.spaceId);

// ========== P1-4 常驻位置与归还回填 ==========
const it = store.addItem({ name: '借出测试件', currentNodeId: ndA.id }).data;
ok(it.homeNodeId === ndA.id, 'P1-4 建档带位置时同时记为常驻位置');
// 借出：从在家转 borrowed，currentNodeId 清空但 homeNodeId 保留
const out = store.moveItem(it.id, { locationStatus: 'borrowed', borrowTo: '同事', currentNodeId: '' });
ok(out.ok, 'P1-4 借出操作成功');
ok(store.getItem(it.id).currentNodeId === '', 'P1-4 借出后当前位置为空');
ok(store.getItem(it.id).homeNodeId === ndA.id, 'P1-4 借出后常驻位置未丢失');
// 归还：未指定节点 → 自动回填常驻位置
const back = store.moveItem(it.id, { locationStatus: 'at_home', currentNodeId: '' });
ok(back.ok && back.autoBack === true, 'P1-4 归还未给节点时放行并标记自动回填');
ok(store.getItem(it.id).currentNodeId === ndA.id, 'P1-4 归还自动回填到常驻位置');
ok(store.getItem(it.id).spaceId === spA.id, 'P1-4 回填后归属同步校准为常驻节点空间');
// 跨空间移动 → 归属随之更新，且常驻位置更新为新节点
const cross = store.moveItem(it.id, { locationStatus: 'at_home', currentNodeId: ndB.id });
ok(cross.ok && store.getItem(it.id).spaceId === spB.id, 'P1-6 跨空间移动后归属更新为目标空间');
ok(store.getItem(it.id).homeNodeId === ndB.id, 'P1-4 在家确认新节点会更新常驻位置');

// ========== P1-5 标签 ==========
ok(JSON.stringify(store.normalizeTags([' 重要 ', '重要', '', '电子', null])) === JSON.stringify(['重要', '电子']),
  'P1-5 标签规整：去空白/去重/去空值');
ok(store.normalizeTags('not-array').length === 0, 'P1-5 非数组输入兼容为空');
const long = []; for (let i = 0; i < 12; i++) long.push('标签' + i);
ok(store.normalizeTags(long).length === 8, 'P1-5 标签数量上限 8');
const tagged = store.addItem({ name: '标签测试件', tags: ['重要', '电子', '电子'] }).data;
ok(JSON.stringify(tagged.tags) === JSON.stringify(['重要', '电子']), 'P1-5 建档写入标签并去重');
store.updateItem(tagged.id, { tags: ['机密'] });
ok(JSON.stringify(store.getItem(tagged.id).tags) === JSON.stringify(['机密']), 'P1-5 编辑覆盖标签');
ok(store.listItems({ tag: '机密' }).some(x => x.id === tagged.id), 'P1-5 按标签筛选命中');
ok(!store.listItems({ tag: '重要' }).some(x => x.id === tagged.id), 'P1-5 按标签筛选不误命中旧标签');
ok(store.allTags().indexOf('机密') >= 0, 'P1-5 allTags 汇总在用标签');
ok(store.allTags().indexOf('证件卡片') >= 0, 'P1-5 allTags 含预置分类');
ok(store.listItems({ keyword: '机密' }).some(x => x.id === tagged.id), 'P1-5 关键词可搜到标签');

console.log('\n' + pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
