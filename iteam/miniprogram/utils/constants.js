// utils/constants.js —— 产品文档约定的枚举与家具模型库
// 依据：PRD V1.1 第5章、业务规则 V1.1 第9章与 TBD-007（预设单位）

// 物品跟踪模式（BR / PRD 5.1）：统一档案，不拆两套系统
var TRACK_MODES = [
  { key: 'location', name: '只记位置', desc: '普通物品，记录当前存放位置' },
  { key: 'inventory', name: '只记库存', desc: '易耗品，记录数量、阈值与出入记录' },
  { key: 'hybrid', name: '位置+库存', desc: '既要位置也要数量的物品' }
];

// 物品位置状态（PRD-022 / BR-006 / TBD-002）
var LOCATION_STATUS = [
  { key: 'at_home', name: '在家' },
  { key: 'unknown', name: '位置未知' },
  { key: 'out', name: '外出携带' },
  { key: 'borrowed', name: '借出' }
];

// 管理状态（TBD-003）
var MGMT_STATUS = [
  { key: 'active', name: '日常管理' },
  { key: 'ended', name: '已结束管理' }
];

// 物品分类
var ITEM_CATEGORIES = [
  '服饰鞋包', '饰品配件', '证件卡片', '书籍文具', '电子数码', '工具五金',
  '厨房用品', '卫浴清洁', '食品饮料', '药品健康', '母婴用品', '运动户外',
  '玩具收藏', '家居布艺', '其他'
];

// 预设计量单位（TBD-007：不开放自定义，不自动换算）
var UNITS = ['个', '件', '瓶', '盒', '包', '袋', '卷', '支', '双', '套', '千克', '升'];

// 家具模型库（与三维场景程序化模型对应，模型与逻辑位置解耦 BR-009）
// size: [宽, 高, 深]，单位米；vars 为可选外观档位
var FURNITURE_LIB = {
  '床':     { size: [1.7, 0.6, 2.0], vars: ['米色床品', '灰色床品'], icon: '🛏️' },
  '床头柜': { size: [0.55, 0.48, 0.42], vars: ['白色简约', '木色原木'], icon: '🗄️' },
  '台灯':   { size: [0.36, 0.5, 0.36], vars: ['暖黄灯罩', '白色灯罩'], icon: '💡' },
  '窗帘':   { size: [2.7, 2.4, 0.1], vars: ['灰纱布帘', '米色布帘'], icon: '🪟' },
  '软包椅': { size: [0.6, 1.0, 0.6], vars: ['米白布艺', '灰色布艺'], icon: '🪑' },
  '躺椅':   { size: [0.6, 0.95, 1.2], vars: ['木色帆布', '灰色帆布'], icon: '🛋️' },
  '沙发':   { size: [2.0, 0.9, 0.95], vars: ['米色布艺', '灰色布艺', '深蓝布艺'], icon: '🛋️' },
  '茶几':   { size: [1.1, 0.45, 0.62], vars: ['深色木质', '木色原木'], icon: '🪑' },
  '电视柜': { size: [1.8, 0.5, 0.42], vars: ['深色木质', '白色简约'], icon: '📺' },
  '衣柜':   { size: [1.2, 2.0, 0.55], vars: ['白色简约', '木色原木'], icon: '🚪' },
  '餐桌':   { size: [1.4, 0.78, 0.9], vars: ['木色原木', '深色木质'], icon: '🍽️' },
  '椅子':   { size: [0.45, 0.95, 0.45], vars: ['木色原木', '灰色布艺'], icon: '🪑' },
  '书架':   { size: [0.9, 1.8, 0.35], vars: ['木色原木', '白色简约'], icon: '📚' },
  '收纳盒': { size: [0.4, 0.3, 0.3], vars: ['白色', '透明', '木色'], icon: '📦' },
  '抽屉':   { size: [0.6, 0.2, 0.5], vars: ['木色', '白色'], icon: '🗳️' }
};

// 收纳节点类型（PRD 5.2 位置层级）
var NODE_TYPES = ['房间', '家具', '抽屉/隔层', '收纳盒', '表面', '其他'];

// 库存变更类型（BR-010：调整与消耗分开记录）
var INVENTORY_TX_TYPES = [
  { key: 'in', name: '入库' },
  { key: 'consume', name: '消耗' },
  { key: 'adjust', name: '调整' }
];

// 位置事件类型（TBD-001 首次位置确认独立成类）
var MOVEMENT_TYPES = {
  initial: '初始存放信息',
  first_confirm: '首次位置确认',
  move: '移动',
  out: '外出/借出',
  return: '带回/归还',
  end: '结束管理'
};

module.exports = {
  TRACK_MODES: TRACK_MODES,
  LOCATION_STATUS: LOCATION_STATUS,
  MGMT_STATUS: MGMT_STATUS,
  ITEM_CATEGORIES: ITEM_CATEGORIES,
  UNITS: UNITS,
  FURNITURE_LIB: FURNITURE_LIB,
  NODE_TYPES: NODE_TYPES,
  INVENTORY_TX_TYPES: INVENTORY_TX_TYPES,
  MOVEMENT_TYPES: MOVEMENT_TYPES
};
