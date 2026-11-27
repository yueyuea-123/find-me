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

// 物品分类：以《MVP 可交互演示—界面与交互说明》§4.2 为准
var ITEM_CATEGORIES = ['证件卡片', '家居布艺', '电子数码', '卫浴清洁', '书籍文具', '其他'];

// 预设计量单位（TBD-007：不开放自定义，不自动换算）
var UNITS = ['个', '件', '瓶', '包', '盒', '卷'];

// 兼容旧数据的枚举补充：历史档案可能使用已下线的分类/单位，编辑时保留原值，不再作为新选项
function withCurrent(list, current) {
  var out = list.slice();
  if (current && out.indexOf(current) < 0) out.push(current);
  return out;
}

// 家具模型库（与三维场景程序化模型对应，模型与逻辑位置解耦 BR-009）
// size: [宽, 高, 深]，单位米；vars 为可选外观档位
// 模型库界面选项：演示口径 11 类；字典保留少量历史类别仅供旧数据取尺寸/渲染
// 家具类别清单：与 FURNITURE_LIB 的 15 个键保持一致（早期漏列软包椅/躺椅/餐桌/椅子，
// 导致模型库只显示 11 种；补齐后模型库与家具编辑下拉均覆盖全部已建模资产）。
var FURNITURE_CATEGORIES = [
  '床', '床头柜', '台灯', '窗帘', '软包椅', '躺椅', '沙发', '茶几', '电视柜',
  '衣柜', '餐桌', '椅子', '书架', '收纳盒', '抽屉'
];
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

// 典型场景模板（CR-001 F-07）：创建房间时的静态初始布置，用户主动选择，非 AI 生成/推荐。
// 坐标为中心原点、Y-up、单位米，按默认 4×4 房间布局；落库时按房间实际宽/深/高钳制。
// 每件为普通家具初值（category 必须在 FURNITURE_LIB 中存在）；落库后即普通 furniture 对象，可自由编辑。
//
// 2026-11-24 空间模块收敛（02空间功能设计）：
//   - 新建房间只开放 CREATABLE_ROOM_TEMPLATES 中的 6 类 + 空白（=文档第 7 类「其他」）。
//   - 文档要求的冰箱/洗衣机/马桶/洗手台/梳妆台/文件柜/边柜/置物架暂无独立 GLB，
//     统一走「模型替代」：name 保留用户可见名称，category 复用现有模型，size/model 可覆盖。
//     后续补真实模型时，只改这里的 category/size/model（或替换映射），不动模板结构与已建房间。
//   - dining/kids 保留定义仅为旧房间/旧调用兼容，不再出现在新建选项（legacy: true）。
var ROOM_TEMPLATES = {
  living: {
    key: 'living', name: '客厅', defaultName: '客厅',
    furniture: [
      { category: '沙发', name: '三人沙发', x: 0, z: 1.2, rot: 0 },
      { category: '电视柜', name: '电视柜', x: 0, z: -1.7, rot: 0 },
      { category: '茶几', name: '茶几', x: 0, z: 0, rot: 0 },
      // 文档要求「边柜」：暂用抽屉模型，尺寸按边柜覆盖
      { category: '抽屉', name: '边柜', x: -1.7, z: -1.2, rot: 0, size: [0.8, 0.8, 0.4], model: '木色' }
    ]
  },
  bedroom: {
    key: 'bedroom', name: '卧室', defaultName: '主卧',
    furniture: [
      { category: '床', name: '双人床', x: -0.8, z: 0.6, rot: 0 },
      { category: '床头柜', name: '床头柜', x: -1.9, z: -0.6, rot: 0 },
      { category: '衣柜', name: '衣柜', x: 1.4, z: 0, rot: 0 },
      // 文档要求「梳妆台」：暂用餐桌模型，尺寸按梳妆台覆盖
      { category: '餐桌', name: '梳妆台', x: 1.3, z: -1.4, rot: 0, size: [1.0, 0.75, 0.45], model: '木色原木' }
    ]
  },
  kitchen: {
    key: 'kitchen', name: '厨房', defaultName: '厨房',
    furniture: [
      // 文档要求「橱柜」：抽屉模型 + 橱柜尺寸
      { category: '抽屉', name: '橱柜', x: 0, z: -1.7, rot: 0, size: [1.2, 0.85, 0.6], model: '白色' },
      // 文档要求「冰箱」：衣柜模型 + 冰箱尺寸
      { category: '衣柜', name: '冰箱', x: 1.5, z: -1.3, rot: 0, size: [0.7, 1.8, 0.7], model: '白色简约' },
      { category: '餐桌', name: '餐桌', x: 0, z: 0.3, rot: 0 },
      // 文档要求「置物架」：书架模型
      { category: '书架', name: '置物架', x: -1.5, z: -1.0, rot: 0, size: [0.9, 1.8, 0.35], model: '木色原木' }
    ]
  },
  bath: {
    key: 'bath', name: '卫生间', defaultName: '卫生间',
    furniture: [
      // 文档要求「洗手台」：电视柜模型 + 台面尺寸
      { category: '电视柜', name: '洗手台', x: -1.2, z: -1.6, rot: 0, size: [0.8, 0.85, 0.5], model: '白色简约' },
      // 文档要求「马桶」：收纳盒模型 + 马桶尺寸
      { category: '收纳盒', name: '马桶', x: 1.2, z: -1.6, rot: 0, size: [0.4, 0.7, 0.6], model: '白色' },
      { category: '抽屉', name: '浴室柜', x: 0, z: -1.7, rot: 0, size: [0.8, 0.85, 0.45], model: '白色' },
      { category: '书架', name: '置物架', x: 1.5, z: 0.6, rot: 0, size: [0.9, 1.8, 0.35], model: '白色简约' }
    ]
  },
  study: {
    key: 'study', name: '书房', defaultName: '书房',
    furniture: [
      { category: '餐桌', name: '书桌', x: 0, z: 0.6, rot: 0, size: [1.2, 0.75, 0.6], model: '木色原木' },
      { category: '软包椅', name: '办公椅', x: 0, z: 1.4, rot: 180 },
      { category: '书架', name: '书柜', x: -1.5, z: -1.4, rot: 0, size: [0.9, 1.8, 0.35], model: '木色原木' },
      // 文档要求「文件柜」：衣柜模型 + 文件柜尺寸
      { category: '衣柜', name: '文件柜', x: 1.5, z: -1.4, rot: 0, size: [0.9, 1.8, 0.45], model: '白色简约' }
    ]
  },
  balcony: {
    key: 'balcony', name: '阳台', defaultName: '阳台',
    furniture: [
      // 文档要求「洗衣机」：抽屉模型 + 洗衣机尺寸
      { category: '抽屉', name: '洗衣机', x: -1.2, z: -1.5, rot: 0, size: [0.6, 0.85, 0.6], model: '白色' },
      // 文档要求「收纳柜」：衣柜模型 + 收纳柜尺寸
      { category: '衣柜', name: '收纳柜', x: 1.2, z: -1.5, rot: 0, size: [0.9, 1.8, 0.45], model: '木色原木' },
      { category: '书架', name: '置物架', x: 0, z: 1.5, rot: 180, size: [0.9, 1.8, 0.35], model: '木色原木' }
    ]
  },
  // 以下两类不再作为新建选项，仅为旧数据/旧调用兼容保留
  dining: {
    key: 'dining', name: '餐厅', legacy: true,
    furniture: [
      { category: '餐桌', name: '餐桌', x: 0, z: 0, rot: 0 },
      { category: '椅子', name: '餐椅一', x: -1, z: 0, rot: 90 },
      { category: '椅子', name: '餐椅二', x: 1, z: 0, rot: 270 },
      { category: '椅子', name: '餐椅三', x: 0, z: 1, rot: 180 },
      { category: '收纳盒', name: '餐具收纳盒', x: -1.3, z: -1.3, rot: 0 }
    ]
  },
  kids: {
    key: 'kids', name: '儿童房', legacy: true,
    furniture: [
      { category: '床', name: '儿童床', x: -1.2, z: 0.5, rot: 0 },
      { category: '床头柜', name: '床头柜', x: -2, z: -0.3, rot: 0 },
      { category: '书架', name: '绘本架', x: 1.2, z: -1.2, rot: 0 },
      { category: '收纳盒', name: '玩具收纳盒', x: 1.3, z: 1.0, rot: 0 }
    ]
  }
};
// 新建房间可选类型（文档 7 类中除「其他=空白」外的 6 类，按文档顺序）
var CREATABLE_ROOM_TEMPLATES = ['living', 'bedroom', 'kitchen', 'bath', 'study', 'balcony'];
var BLANK_ROOM_NAME = '我的空间';

// 收纳节点类型（PRD 5.2 位置层级）
var NODE_TYPES = ['房间', '家具', '抽屉/隔层', '收纳盒', '表面', '其他'];

// 库存变更类型（BR-010：调整与消耗分开记录；处置结存单独成类，不伪装成消耗）
var INVENTORY_TX_TYPES = [
  { key: 'in', name: '入库' },
  { key: 'consume', name: '消耗' },
  { key: 'adjust', name: '调整' },
  { key: 'disposal', name: '处置结存' }
];

// 处置类型（TBD-003：'已结束管理'是管理状态，处置原因另设类型，不覆盖原分类）
var DISPOSAL_TYPES = [
  { key: 'discard', name: '丢弃' },
  { key: 'gift', name: '赠送' },
  { key: 'sale', name: '出售' },
  { key: 'other', name: '其他' }
];

// 位置事件类型（TBD-001 首次位置确认独立成类）
var MOVEMENT_TYPES = {
  initial: '初始存放信息',
  first_confirm: '首次位置确认',
  move: '移动',
  out: '外出/借出',
  return: '带回/归还',
  restore: '恢复日常管理',
  end: '结束管理'
};

module.exports = {
  TRACK_MODES: TRACK_MODES,
  LOCATION_STATUS: LOCATION_STATUS,
  MGMT_STATUS: MGMT_STATUS,
  ITEM_CATEGORIES: ITEM_CATEGORIES,
  UNITS: UNITS,
  withCurrent: withCurrent,
  FURNITURE_CATEGORIES: FURNITURE_CATEGORIES,
  FURNITURE_LIB: FURNITURE_LIB,
  ROOM_TEMPLATES: ROOM_TEMPLATES,
  CREATABLE_ROOM_TEMPLATES: CREATABLE_ROOM_TEMPLATES,
  BLANK_ROOM_NAME: BLANK_ROOM_NAME,
  NODE_TYPES: NODE_TYPES,
  INVENTORY_TX_TYPES: INVENTORY_TX_TYPES,
  DISPOSAL_TYPES: DISPOSAL_TYPES,
  MOVEMENT_TYPES: MOVEMENT_TYPES
};
