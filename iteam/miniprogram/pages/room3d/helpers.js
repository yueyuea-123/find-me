// pages/room3d/helpers.js —— 页面共享纯函数助手（阶段2c 提取，场景状态/手势/相机各模块共用）
// 迁移动因：mixin 模块无法访问 room3d.js 模块作用域闭包变量，loadData 等迁出后
// 引用 furnitureThumb/fmtNum 会 ReferenceError；纯函数收拢到共享模块单点持有。
var HIFI_ROOT = '/images/hifi/';
var FURN_ROOT = '/images/furniture/';
function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// 尺寸展示：保留两位小数并去掉无意义的尾随 0，避免缩放后出现长串小数
function fmtNum(v) { return String(Math.round((Number(v) || 0) * 100) / 100); }
// 高保真资产映射：交付稿 assets/ 的缩略图与家具/物品 ID 关联（视觉规范 §6）。
// 图片仅用于列表缩略，三维模型仍由 package3d 按 category 加载，二者不互相替代。
var HIFI_ROOT = '/images/hifi/';
// 阶段三：6 件样板家具的真实渲染缩略图（与 package3d 彩色模型一一对应）。
// 图片只用于列表/卡片缩略，三维模型仍由 package3d 按 key 加载，二者不互相替代。
var FURN_ROOT = '/images/furniture/';
function furnitureThumb(f) {
  var n = (f.name || '') + ' ' + (f.category || '');
  // 有专属真实缩略图的类别优先命中；注意「床头柜」含「床」，须先于「床」判断。
  if (/床头柜/.test(n)) return '';
  if (/沙发|sofa/i.test(n)) return FURN_ROOT + 'sofa.jpg';
  if (/床|bed/i.test(n)) return FURN_ROOT + 'bed.jpg';
  if (/书桌|餐桌|桌|table/i.test(n)) return FURN_ROOT + 'table.jpg';
  if (/茶几|coffee/i.test(n)) return FURN_ROOT + 'coffee.jpg';
  if (/衣柜|wardrobe/i.test(n)) return FURN_ROOT + 'wardrobe.jpg';
  if (/置物架|书架|书柜|shelf/i.test(n)) return FURN_ROOT + 'shelf.jpg';
  // 其余类别沿用原交付稿缩略图；无图时返回空串，由页面用 icon 占位，
  // 不回落到整屋图 home_isometric.jpg（那会让「双人床/落地窗」显示成整套房效果）。
  if (/躺椅/i.test(n)) return HIFI_ROOT + 'sofa.jpg';
  if (/电视|tv|影音/i.test(n)) return HIFI_ROOT + 'tv_console.jpg';
  if (/绿植|植物|plant/i.test(n)) return HIFI_ROOT + 'plant.jpg';
  return '';
}
function itemThumb(it) {
  var n = it.name || '';
  if (/保温杯|水壶|瓶|bottle/i.test(n)) return HIFI_ROOT + 'bottle.jpg';
  if (/马克杯|杯子|mug|cup/i.test(n)) return HIFI_ROOT + 'mug.jpg';
  if (/耳机|headphone/i.test(n)) return HIFI_ROOT + 'headphones.jpg';
  if (/笔记本|书|note|book/i.test(n)) return HIFI_ROOT + 'notebook.jpg';
  if (/绿植|植物|plant/i.test(n)) return HIFI_ROOT + 'plant.jpg';
  if (/纸巾|纸|tissue/i.test(n)) return HIFI_ROOT + 'tissue.jpg';
  if (/洗衣液|清洁|detergent/i.test(n)) return HIFI_ROOT + 'detergent.jpg';
  if (/电池|battery/i.test(n)) return HIFI_ROOT + 'battery.jpg';
  return '/images/default-goods-image.png';
}

module.exports = { clampNum: clampNum, fmtNum: fmtNum, furnitureThumb: furnitureThumb, itemThumb: itemThumb };
