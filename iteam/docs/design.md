# 三维室内空间与家庭物品管理系统 · 技术设计（design）

> **口径基线**：本文档以《当前基线（唯一口径）V1.1》为唯一依据。本文与基线冲突时，以基线为准。
> **文档定位**：本项目「怎么做」的唯一事实源。每个设计条目须可追溯到 `proposal.md` 的需求；不引入 proposal 未支持的功能。
> **需求依据**：`docs/proposal.md`（单一事实源，V1.2 口径，经 CR-001 变更）；项目档案 §二技术栈；数据架构与接口契约 V1.0；界面设计文档 V1.0；产品总纲 V1.0；基线 V1.1。
> **CR-001 变更**：三维主路径由照片生成改为手动自由编辑；`photoService`/建模任务降级为可选；新增 `layout`/`source`/`bindings` 字段与模型变换交互。详见 `CR-001-三维空间模块变更提案.md`。
> **基线裁剪（V1.1）**：云同步、云数据库、云函数、云照片存储、云端管理后台 **【已移出范围】**；三维交互以 V1.3 A 方案为准（禁拖动家具、按钮化操作、保存/撤销草稿语义）。
> **性质**：回溯补建 + 变更落地——V1.2 部分为待实现的新设计（标注"待实现"），不虚构已落地能力。
> **实施更新（2026-11-22/23）**：三维渲染最终采用官方适配版 Three.js r108 + Blender 白膜 GLB，置于 `package3d` 分包按需加载；下表「轻量自建 WebGL」为 V1.2 原始设计口径，仅作历史留档，现行实现与验证口径见 `document/Three.js资产化接入评估_V1.0.md`（内容 V2.0）。

---

## 1. 技术选型及理由

| 决策 | 选择 | 理由 | 不考虑的替代 |
| --- | --- | --- | --- |
| 前端框架 | 微信原生小程序（WXML/WXSS/JS），无第三方 UI 框架 | 项目入口为微信小程序；原生栈无额外框架依赖与包体开销，与既有 21 页实现一致 | uni-app/Taro 多端框架：首版无多端需求（proposal §3、§10），引入会增加适配成本 |
| 后端 | **【已移出范围】** 纯本地 `wx.Storage`，无云端后端 | 个人单用户、纯本地存储；无需云端运维 | 自建服务/云开发：已移出交付范围（基线 §1、§6） |
| 数据同步策略 | **纯本地**：`wx.Storage` 为唯一数据源，无同步 | 21 页同步 API 零改动；断网可用（基线 §1） | ~~离线优先 + 云端异步持久化~~ **【已移出范围】** |
| 三维渲染〔V1.2 核心〕 | 官方适配版 Three.js r108 + 白膜 GLB，`package3d` 分包按需加载；V1.3 A 方案交互（禁拖动家具、按钮化移动/旋转/尺寸、保存/撤销草稿语义），失败降级列表 | CR-001 后三维为主路径；V1.3 简化操作降低真机手势门槛；失败仍有列表兜底 | 重型 3D 引擎：包体大、低端设备兼容风险高 |
| 场景来源〔V1.2 变更〕 | 手动编辑为主（`rooms.source=manual`），照片生成降级为可选/历史（`legacy_photo`） | 普通照片难以生成可用空间，手动编辑门槛低、结果可控；符合用户确认优先 | 照片→AI 候选模型作为主路径（原方案）：尺度不确定、质量与成本不可控，已由 CR-001 排除 |
| 身份与隔离 | **【已移出范围】** 纯本地单用户，无身份隔离需求 | — | ~~云函数 OPENID 隔离~~ **【已移出范围】** |

---

## 2. 总体架构

```
┌───────────────────────────────────────────────────────┐
│ 展现层：微信小程序 21 页（index/room3d/item-list…）      │
│   - 只做展示与交互，不承载业务规则                        │
│   - 三维失败自动/手动切列表                              │
└───────────────┬───────────────────────────────────────┘
                │ 同步调用 store.xxx()
┌───────────────▼───────────────────────────────────────┐
│ 业务/数据层：utils/store.js（同步 CRUD，主数据源）        │
│   - BR-001~015、TBD-001~008 规则集中在此                 │
│   - 写后标记 dirty；导出快照与墓碑                        │
├───────────────┬───────────────────────────────────────┤
│ 接入层：utils/cloud-sync.js                            │
│   - 登录 → 拉快照 → 后台异步推送；失败保留本地            │
│   - utils/webgl-renderer.js / room-renderer.js（三维）   │
└───────────────┬───────────────────────────────────────┘
                │ wx.cloud.callFunction({action, data})
┌───────────────▼───────────────────────────────────────┐
│ 服务端：6 云函数（userLogin/dataSync/photoService/       │
│   backupService/adminService/reportError）             │
│   - OPENID 从上下文取，忽略客户端身份                     │
└───────────────┬───────────────────────────────────────┘
                │ 服务端管理员权限
┌───────────────▼───────────────────────────────────────┐
│ 存储层：CloudBase NoSQL 13 集合（PRIVATE）+ 私有云存储     │
└───────────────────────────────────────────────────────┘
```

管理后台（Web）经 `adminService` 访问任务/日志/用户统计，不直连数据库、不返回照片内容。

## 3. 模块划分与职责

| 模块 | 职责边界 | 对外接口 | 依赖 |
| --- | --- | --- | --- |
| `store.js` | 全同步 CRUD + 业务规则校验 + 快照/墓碑导出；不感知云端 | `getXxx/addXxx/updateXxx/moveItem/inventoryTx/…` | 无（纯本地） |
| `cloud-sync.js` | 登录、拉快照、队列推送、失败重试；不改页面契约 | `init/pull/push/syncNow` | store.js、云函数 |
| `webgl-renderer.js` / `mat4.js` | 矩阵与 WebGL 绘制；不处理业务逻辑 | 渲染/点选 API | 无 |
| `room-renderer.js` | 房间场景组织、家具对象到渲染的映射 | 场景构建 API | webgl-renderer.js |
| 云函数 `userLogin` | 登录与身份建立 | `login` | users 集合 |
| 云函数 `dataSync` | 全量同步 + 批量写入（事务） | `pull` / `batch` | 13 集合 |
| 云函数 `photoService` | 照片私有存储路径签发 | `signUpload/signRead/remove` | 云存储 |
| 云函数 `backupService` | 快照备份/恢复 + 定时触发器 | `create/list/restore` | backups 集合 |
| 云函数 `adminService` | 后台任务/日志/用户统计（admin 权限） | `tasks/logs/users` | sys_logs 等 |
| 云函数 `reportError` | 前端错误上报（脱敏） | `report` | sys_logs |

## 4. 端到端数据流

**建物品并移动**（proposal UF-003/UF-004）：
1. 页面调用 `store.addItem()` → 本地立即写入 `home3d_store_v1`，标记 dirty。
2. `cloud-sync` 后台把变更入队，调用 `dataSync.batch({ops:[…]})`。
3. 云函数校验 OPENID → 写 `items` 集合 → 记 `sys_logs`。
4. 成功清 dirty；失败保留本地标记，下次同步重试。
5. 移动物品：`store.moveItem()` 同函数内更新 `currentNodeId` 并追加 `movements`，云端打包为一次 batch，同源一致。

**手动编辑三维场景〔V1.2 主路径，CR-001 待实现〕**：页面加载空白房间（按 `rooms.layout` 渲染墙面/地面）→ 从模型库选模型加入场景 → 触摸手势拖动/旋转/缩放（`webgl-renderer` 实时更新 `furniture.position/rotation/size`，编辑期越界钳制）→ 保存时 `store.saveFurniture()` 写本地并标记 dirty → `cloud-sync` 异步推送。点选模型 → 查看/绑定 `nodes` + `items`（单物件单位置）。WebGL 异常由 `_safeGL` 置 `glError` 并切列表。

**典型场景模板加载〔V1.2 待实现，CR-001 F-07〕**：创建房间时选起点——空白房间，或典型场景模板（卧室/客厅/卫生间，静态模板定义含一组家具的 `model/category/position/rotation/size` 初值）。选模板后按房间 `width/depth/height` 钳制家具坐标 → 批量写入 `furniture`（`source=manual`，逐件为用户可编辑的普通对象）→ 房间记 `source=template`、`templateKey`。模板是静态预置起点，落库后与手动添加家具走同一编辑/保存/同步路径，无持续绑定关系；模板缺失/加载失败则降级空白房间并提示。

**照片与建模任务〔V1.2 可选，非主路径〕**：`photoService.signUpload` → 上传 → `tasks` 记录仅用于可选素材处理；失败不阻塞手动主路径。

**首次进入**：`app.js` 启动 → `userLogin.login` → `dataSync.pull` 拉快照 → 与本地合并（last-write-wins，按 `updatedAt`）→ 进入首页。

## 5. 核心数据结构

13 个集合（业务键 / 主要字段详见《数据架构与接口契约 V1.0》§二）：

| 集合 | 承载需求 | 关键字段 |
| --- | --- | --- |
| `users` | MVP-001/031 | openid(唯一)、role(user/admin)、status |
| `spaces` / `rooms` | MVP-002/003、CR-001 F-01/F-07 | spaceId/roomId、name、archived、width/depth/height；**新增 `layout`(JSON：墙面/地面/默认视角)、`source`(manual/template/legacy_photo)、`templateKey`(模板标识，选模板时必填)**；photos/task 降为可选 |
| `furniture` | MVP-008~011/016、CR-001 F-02/F-03 | furnitureId、roomId、position/rotation/size、modelKey/category；**新增 `bindings`(Array[{itemId,nodeId}]，仅作直接绑定补充)**；V1.2 用户创建即确认事实 |
| `nodes` | MVP-013~016、CR-001 F-03 | nodeId、parentId、furnitureId、order；作为模型↔物品绑定的主通道（与 items.currentNodeId 配合） |
| `items` | MVP-017~026、CR-001 F-03 | itemId、trackingMode、currentNodeId、locationStatus、managementStatus、completed；绑定写入与历史同事务 |
| `movements` | MVP-023/024 | movementId、itemId、from/to 节点与状态 |
| `inventory` / `transactions` | MVP-027~030 | balance、unit、threshold；txId、type、delta、balanceAfter |
| `alerts` | MVP-030 | cycleId、status、ignoredAt/recoveredAt |
| `backups` | MVP-033 | snapshot、type(auto/manual)、recordCount |
| `sys_logs` / `tasks` | MVP-007/031 | level/message/context；taskId、status、error |

约定：业务 id 用 `xxx_时间戳_随机`，与云 `_id` 分离；每集合含 `openid` + `createdAt` + `updatedAt`。三维坐标统一 Y-up、单位米（proposal §5/§7）。

## 6. 关键接口设计

统一请求 `{action, data}`、响应 `{ok:true,data}` / `{ok:false,error,message}`；身份从上下文取。

| 云函数 | action | 输入 → 输出 |
| --- | --- | --- |
| userLogin | login | `{}` → `{openid,isNew,role,status}` |
| dataSync | pull | `{since}` → `{snapshot,serverTime}` |
| dataSync | batch | `{ops:[{collection,op,id,data}]}` → `{results,serverTime}`（整批回滚） |
| photoService | signUpload/signRead/remove | `{roomId,ext}` → `{cloudPath,fileId}` 等 |
| backupService | create/list/restore | `{type,note}` → `{backupId,…}`；恢复先建回滚快照 |
| adminService | tasks/logs/users | 分页参数 → 列表（admin 权限，不含照片） |
| reportError | report | `{message,stack,page}` → `{ok}`（脱敏，不上报照片） |

错误码：`NOT_LOGIN` / `PERMISSION_DENIED` / `INVALID_ACTION` / `INVALID_DATA` / `SYNC_CONFLICT` / `STORAGE_FAILED` / `BACKUP_NOT_FOUND` / `INTERNAL_ERROR`。

## 7. 状态流转

| 对象 | 状态机 | 触发与约束（对应 proposal 需求） |
| --- | --- | --- |
| 建模任务〔V1.2 可选〕 | queued → processing → succeeded / failed | 仅用于可选素材处理，失败不阻塞手动主路径（MVP-007 降级） |
| 房间起点〔V1.2 待实现〕 | blank(source=manual) / template(source=template) | 模板房间记 `templateKey`；模板家具落库后与普通家具同路径，模板缺失降级空白房间（CR-001 F-07） |
| 家具来源 | manual（V1.2 主，含模板预置） / confirmed / legacy_candidate | V1.2 用户创建及模板预置均为用户确认事实；candidate 仅兼容历史 AI 数据，不再由主路径产生（CR-001） |
| 模型编辑〔V1.2 待实现〕 | idle → editing(拖动/旋转/缩放) → saved / reverted | 编辑期越界钳制；失败保留可恢复输入（CR-001 F-02、空间边界） |
| 模型绑定〔V1.2 待实现〕 | unbound → bound(itemId,nodeId) → rebound / unbound | 单物件单位置；换模型保留关联；删除前须解绑（CR-001 F-03、绑定边界） |
| 物品位置 | unknown → confirmed / away / borrowed → confirmed | 首次确认记为独立"首次位置确认"，非普通移动（TBD-001/002、MVP-021/024） |
| 物品档案 | 基础记录 → 已分类 → 已定位 → 已完善 | 渐进式，非强制校验（MVP-022） |
| 物品管理 | active → archived / discarded | 归档优先于物理删除；历史保留（TBD-003、MVP-025） |
| 库存提醒 | 关闭 → 开启(一周期一条) → 达标自动结束 → 可再触发 | 补货须经入库交易（TBD-005、MVP-030） |
| 云同步 | clean → dirty → syncing → clean / dirty(失败保留) | 失败保留本地标记，允许重试（proposal §8 环境异常） |

## 8. 错误处理

| 类别 | 场景 | 处理（对应 proposal §8） |
| --- | --- | --- |
| 可重试 | 网络/保存失败、编辑中断 | 保留可恢复输入与本地标记，用户可重试；不显示虚假成功 |
| 不可重试 | 库存超扣、模型编辑越界 | 钳制/拒绝并提示原因（V1.2 无照片模糊/视角不足场景） |
| 降级 | 三维/WebGL 加载失败、模型库缺失 | 自动/手动切列表，用占位模型；核心管理不中断（CR-001 F-06） |
| 数据保护 | 删除含物品的节点/家具/绑定模型 | 阻断并提示先解绑、迁移或归档 |
| 幂等 | 重复移动请求 | 幂等处理，避免重复历史 |
| 服务端 | 云函数异常 | 记 `sys_logs`，返回 `INTERNAL_ERROR`，前端友好文案；照片内容不上报 |

## 9. 权限、安全与隐私

- **最小权限**：集合权限 PRIVATE，客户端 SDK 直连拒绝；所有读写经云函数（服务端权限）。
- **身份隔离**：OPENID 从 `cloud.getWXContext()` 获取，忽略客户端传入；所有查询强制带 openid 条件（MVP-001/032）。
- **照片私有**：路径 `photos/{openid}/{roomId}/{photoId}`，读取用短时链接；后台只显任务状态与元信息，不返回照片内容（PRD-031）。
- **角色**：`users.role` 判 admin；管理员 openid 由环境变量 `ADMIN_OPENIDS` 配置，不硬编码（MVP-031）。
- **脱敏**：错误上报只发文案与堆栈，不发家庭照片或物品明细。
- **第三方 AI**：未经授权不得用于训练；费用、数据保留、可替换性与停服预案须明确（proposal §9）。

## 10. 性能考虑与降级方案

- **性能门槛**：帧率、加载时长、模型数量、照片数量上限等不预设数值，须真机验证后确定（proposal §10）。
- **数据量**：MVP 单用户每集合远低于 100 条上限，`dataSync.pull` 一次拉全量快照。
- **索引**：按集合设计 `{openid:1}`、`{openid,updatedAt}`、`{openid,roomId}` 等，避免全表扫描。
- **降级方案**：WebGL 不可用→列表；建模失败→手动建房/家具；云不可用→本地完整可用 + dirty 待同步；备份恢复前先建回滚快照。

## 11. 目录结构

```
iteam/
├─ docs/                       SDD 规范（本五件套 + 治理资产）
│  ├─ proposal.md / design.md / tasks.md / project_rules.md
│  ├─ layouts/                 逐页布局（阶段 D 补）
│  ├─ requirement-confirmation.md
│  └─ change-log.md / traceability-matrix.md（后者阶段 G 补）
├─ miniprogram/
│  ├─ app.js / app.json / app.wxss / envList.js / sitemap.json
│  ├─ pages/                   21 注册页（另有 example/、verify3d/ 残留待清理，D4）
│  └─ utils/                   store.js / cloud-sync.js / webgl-renderer.js /
│                              room-renderer.js / mat4.js / constants.js
├─ cloudfunctions/             6 有效云函数（另有 quickstartFunctions 残留，D4）
├─ qa/                         check_and_score.py / smoke-test.js / quality-report.json
└─ verify-browser/             技术验证载体，不属于小程序运行时依赖
```

## 12. 需求-方案对应关系

> 保证 proposal 每条需求有方案承接；用例与验收在阶段 G 的追溯矩阵中逐条落实。

| proposal 需求 | 方案章节 | 落地模块 |
| --- | --- | --- |
| MVP-001 个人账户（PRD-001） | §9 身份隔离 | userLogin + users |
| MVP-002/003 空间/房间、CR-001 F-01 | §5 spaces/rooms(layout/source) | store + dataSync + 手动建房间 |
| CR-001 F-07 典型场景初始布置〔待实现〕 | §4 模板加载 + §5 templateKey + §7 房间起点 | 静态模板定义 + store 批量写 furniture + 降级空白房间 |
| MVP-004/005/007 照片/尺寸/任务〔V1.2 可选〕 | §4 §8 | photoService + tasks（降级，不阻塞主路径） |
| MVP-006/008~012 三维与家具、CR-001 F-02 | §1 §4 §7 §10 | webgl-renderer 手动编辑画布 + furniture 页 + 列表降级 |
| CR-001 F-03 模型—物品绑定〔待实现〕 | §5 bindings/nodes + §7 绑定状态 | store(node/item) + bindings + room3d 选中卡 |
| CR-001 F-04/F-05 查看/持久化 | §4 §10 | room3d 点选 + cloud-sync |
| CR-001 F-06 降级 | §8 | _safeGL + 列表视图 |
| MVP-013~016 收纳结构 | §5 nodes + §7 解耦 | store(node) + node 页 |
| MVP-017~025 物品档案 | §5 items/movements + §7 状态 | store(item/move) + item 页 |
| MVP-026~030 库存与提醒 | §5 inventory/transactions/alerts + §7 周期 | store(inventoryTx) + inventory 页 |
| MVP-031 后台/隐私 | §9 | adminService + reportError + admin/privacy 页 |
| MVP-032 隐私与权限 | §9 | photoService + PRIVATE + 隐私说明页 |
| MVP-033 备份恢复 | §6 backupService | backupService + 定时触发器 |
| MVP-034 部署交付 | §11 | 部署与交付文档 + qa 门禁 |
| proposal §8 异常场景 | §8 错误处理 | 各页降级 + store 校验 + 云函数错误码 |

**缺口已补齐**：需求-方案对应关系（本节）、状态流转（§7）、目录结构（§11）为原《数据架构与接口契约 V1.0》未系统覆盖的三项，现已按 SDD §3 模板补全。

**测试对齐（2026-11-20）**：CR-001 F-01/F-02/F-03/F-07 的断言已固化进 `qa/smoke-test.js`（新增 8 条，冒烟 48→56/56 全绿），并在 `qa/check_and_score.py` D8 增加 V1.2 方法与字段检查（静态 100/100、0 P0）；可追溯矩阵缺口状态同步更新。本节 §5/§7 的数据与状态口径与测试一致。真机 AC（手势手感、绑定一致性、模板入口）仍待验，不在文档中标为通过。

**待确认**：TBD-001~008 已按 V1.1 确认口径落入 §7；基础库最低版本、三维量化指标仍待真机验证，不在本文虚构。
