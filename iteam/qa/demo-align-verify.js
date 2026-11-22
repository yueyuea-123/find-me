/* 小程序与 iteam/demo 原型口径对齐的静态验证。
   运行：node iteam/qa/demo-align-verify.js */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
function has(file, needle, desc) {
  const text = read(file);
  checks.push({ desc, file, ok: text.indexOf(needle) >= 0 });
}
function hasNot(file, needle, desc) {
  const text = read(file);
  checks.push({ desc, file, ok: text.indexOf(needle) < 0 });
}

// 首页：快捷三维直达房间三维页
has('pages/index/index.wxml', 'bindtap="go3d"', '首页快捷「三维」绑定 go3d');
has('pages/index/index.js', "wx.navigateTo({ url: '/pages/room3d/room3d?id=' + rooms[0].id", '首页 go3d 直达第一个房间三维页');

// 三维房间：demo 提示、短按建档、默认选中卡
has('pages/room3d/room3d.wxml', '拖动摆放 · 长按删除 · 点击进入添加物品', '三维画布提示对齐 demo');
has('pages/room3d/room3d.js', 'addItemAtFurniture: function (furnitureId)', '短按家具进入建档处理函数');
has('pages/room3d/room3d.js', "'/pages/item-edit/item-edit?nodeId=' + nodeId", '短按家具预选收纳节点');
has('pages/room3d/room3d.js', 'if (!selRow && list.length) selRow = list[0];', '选中卡默认展示第一件家具');

// 物品详情：档案引导、状态 chips、操作文案、返回按钮、结束管理阻断
has('pages/item-detail/item-detail.wxml', '档案已建立', '建档后引导卡');
has('pages/item-detail/item-detail.wxml', 'class="chips4"', '位置状态 chips');
has('pages/item-detail/item-detail.wxml', '编辑档案', '操作文案：编辑档案');
has('pages/item-detail/item-detail.wxml', '移动物品', '操作文案：移动物品');
has('pages/item-detail/item-detail.wxml', '返回物品列表', '底部返回按钮');
has('pages/item-detail/item-detail.js', 'justCreated: false', 'justCreated 状态字段');
has('pages/item-detail/item-detail.js', '剩余 \' + iv.balance', '结束管理库存余额阻断');
has('pages/item-edit/item-edit.js', '&justCreated=1', '建档后跳转详情并带引导标识');

// 移动物品：在家必须选具体节点
has('pages/move/move.wxml', '选择「在家」需要同时选定具体位置', '移动页 demo 提示');
has('pages/move/move.js', "label: '请选择具体位置'", '节点首项不再是「在家，位置未知」');
hasNot('pages/move/move.js', "if (status === 'at_home' && !nodeId) status = 'unknown';", '不再把无节点的在家偷偷改成未知');

// 家具详情：换模型、删除、关联物品
has('pages/furniture-detail/furniture-detail.wxml', '更换外观模型', '家具详情换模型按钮');
has('pages/furniture-detail/furniture-detail.wxml', '关联物品（{{bindings.items.length}}）', '家具详情关联物品卡');
has('pages/furniture-detail/furniture-detail.js', 'store.bindingsOfFurniture(f.id)', '关联物品数据来源');

// 库存详情：进度条 + 三个直接动作
has('pages/inventory-detail/inventory-detail.wxml', 'class="progress"', '库存余额进度条');
has('pages/inventory-detail/inventory-detail.wxml', 'bindtap="quickTx"', '入库/消耗/调整直接动作');
has('pages/inventory-detail/inventory-detail.js', 'quickTx: function (e)', 'quickTx 实现');

// 空间 / 提醒 / 我的：说明文案对齐
has('pages/space/space.wxml', '首版仅支持个人单用户', '空间页单用户说明');
has('pages/alerts/alerts.wxml', '去处理', '提醒操作文案');
has('pages/alerts/alerts.wxml', '暂无待处理提醒', '提醒空态文案');
has('pages/profile/profile.wxml', '康女士', '个人中心称谓对齐 demo');

// ===== 视觉细节对齐（2026-11-22 第二轮：向 demo 渲染结果对齐） =====
// 首页：提醒整卡 alert-soft + 快捷图标 surface-2 + 问候语小字
has('pages/index/index.wxml', 'class="remind"', '首页提醒卡对齐 demo .remind（整卡陶红浅底）');
hasNot('pages/index/index.wxml', 'class="card remind-card"', '首页提醒卡不再是白底嵌套卡');
has('pages/index/index.wxss', 'background: #F3EDE2; color: #9C6B3F', '首页快捷图标底色对齐 demo --surface-2');
has('pages/index/index.wxss', '.hm-greet { font-size: 22rpx', '首页问候语对齐 demo 小字');
// 物品详情：serif 名称 + 图标块 + 竖列 ops（保留全部操作入口）
has('pages/item-detail/item-detail.wxml', 'class="icon-box hero-icon"', '物品详情头部图标块');
has('pages/item-detail/item-detail.wxml', 'class="ops"', '物品详情操作区改竖列 ops');
has('pages/item-detail/item-detail.wxml', 'bindtap="goHistory"', '位置历史入口保留');
has('pages/item-detail/item-detail.wxml', 'bindtap="endManage"', '结束管理入口保留');
has('pages/item-detail/item-detail.wxss', 'font-family: "Songti SC", "STSong", serif', '物品名 serif 对齐 demo');
// 全局 ops / note-inline / icon-box
has('app.wxss', '.op + .op { border-top: 1rpx solid #E9E0D2; }', '全局竖列操作分隔线对齐 demo');
has('app.wxss', '.note-inline { font-size: 24rpx; color: #6B5D4D; background: #F3EDE2', 'note-inline 底色对齐 demo --surface-2');
has('app.wxss', '.icon-box { background: #EFE2D1', '全局图标块令牌对齐 demo --accent-soft');
// 空间 / 库存 / 提醒 / 物品列表：图标块与当前空间边框
has('pages/space/space.wxml', 'class="icon-box space-icon"', '空间卡图标块对齐 demo');
has('pages/space/space.wxss', '.space-current { border: 3rpx solid #9C6B3F; }', '当前空间 accent 边框对齐 demo');
has('pages/space/space.wxml', '个房间 · 个人空间', '空间卡说明文案对齐 demo');
has('pages/inventory/inventory.wxml', 'class="icon-box inv-icon"', '库存卡图标块对齐 demo');
has('pages/alerts/alerts.wxml', 'class="alert-icon"', '提醒卡铃铛图标块对齐 demo');
has('pages/item-list/item-list.wxml', 'class="icon-box list-icon"', '物品列表卡图标块对齐 demo');
// 我的：tint 头像 + chips
has('pages/profile/profile.wxml', '● 本地可用', '个人中心本地可用 chip 对齐 demo');
has('pages/profile/profile.wxss', '.avatar { width: 88rpx; height: 88rpx; border-radius: 50%; background: #EFE2D1', '头像对齐 demo tint 风格');

let failed = 0;
checks.forEach(c => {
  if (!c.ok) failed++;
  console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.desc + '  [' + c.file + ']');
});
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
