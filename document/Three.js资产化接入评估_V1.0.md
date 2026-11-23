# Three.js + Blender 资产接入实施说明 V2.0

> 状态：**已实施完成（2026-11-22）**，待微信开发者工具真机验收。
> 版本沿革：V1.0 为评估方案；V2.0 在用户确认「就近复用、不保留经典渲染器、非收纳家具不建模型」后落地实施。
> 本文替代 V1.0 中「待实施」章节，保留环境约束与版本结论。

---

## 一、结论摘要

| 问题 | 结论 |
|---|---|
| 浏览器版 Three.js 能直接进小程序吗？ | **不能**，依赖 `document/window/HTMLCanvasElement`。已用官方适配版 `threejs-miniprogram@0.0.8`（内置 r108）。 |
| GLB 资产怎么来的？ | 用户已安装 Blender 5.3.0。用 `bpy` 脚本按规范建模并导出 **8 件正式 GLB**，替换了此前程序化烘焙的占位件。 |
| 包体放得下吗？ | 放得下。Three.js + GLB 全部放进 `package3d` 分包（约 1.09 MB，含白膜资产与带色版备份；上限 2 MB）；主包约 1.44 MB（上限 2 MB）。 |
| 绑定受影响吗？ | 不会。绑定走逻辑节点（`nodes.furnitureId` + `items.currentNodeId`），与渲染层和模型格式解耦（BR-009）。 |
| 经典渲染器？ | 按用户决定**不保留**：视觉开关已移除，`room-renderer-enhanced.js` 已移出小程序包；失败直接走既有列表降级（BR-014）。 |

---

## 二、Blender 正式资产

### 2.1 产出方式

- 工具：Blender 5.3.0（`/Applications/Blender.app/Contents/MacOS/blender`），后台模式执行脚本。
- 脚本：`preview/blender-build/build_furniture.py`
- 运行：`/Applications/Blender.app/Contents/MacOS/blender -b --python build_furniture.py`
- 输出：`preview/assets/furniture/{key}.glb` + `manifest.json`（同一份已同步进分包 `assets/furniture/`）。
- 风格实现：圆角盒 = cube + Bevel（segments=1）+ WeightedNormal；低饱和哑光 PBR 取规范 3.3 色板；Blender 内部 Z-up，导出 glTF 时转 Y-up；锚点为底面中心。

### 2.2 资产清单

| key | 家具 | 尺寸 W×D×H (m) | 三角面 | 体积 |
|---|---|---|---|---|
| sofa | 沙发 | 2.0 × 0.9 × 0.8 | 528 | 35 KB |
| bed | 床 | 1.5 × 2.0 × 0.5 | 264 | 19 KB |
| chair | 椅子 | 0.8 × 0.8 × 0.8 | 308 | 21 KB |
| table | 桌 | 1.4 × 0.8 × 0.75 | 264 | 18 KB |
| coffee | 茶几 | 1.0 × 0.6 × 0.4 | 308 | 22 KB |
| wardrobe | 衣柜 | 1.2 × 0.6 × 2.0 | 204 | 14 KB |
| cabinet | 斗柜 | 1.0 × 0.45 × 0.9 | 284 | 20 KB |
| shelf | 书柜 | 0.9 × 0.35 × 1.8 | 1056 | 61 KB |
| **合计** | | | **3216** | **228 KB** |

- 每件 GLB 根节点 `extras` 带 `isFurniture / key / name / size / anchor / version / source`，可被 Three.js 直接读取。
- 造型细节：沙发含底座/靠背/双扶手/双坐垫/双抱枕/四木脚；床含床架/床垫/床头板/被子/双枕；书柜含侧板/隔层/背板/16 本书脊；衣柜为双开门带拉手；斗柜三层抽屉。
- 旧的程序化占位件备份在 `preview/assets/furniture_procedural_backup/`。**将来用 Blender 手工精修替换时，按同名 `key.glb` 覆盖并更新 `manifest.json` 的 size/triangles/bytes 即可，渲染代码无需改动。**

**2026-11-23 资产口径更新**：小程序 `package3d/assets/furniture/` 中的 8 件 GLB 已由带材质版切换为 Blender 白膜版（`manifest.json` 的 `version` 为 `3.0-white`，单一 WhiteClay 材质、零贴图；`preview/assets/furniture_white/` 为同源产出）。带色版完整备份在 `package3d/assets/furniture_colored_backup/`，回退方式是将该目录内 8 个 GLB 与 manifest 拷回 `furniture/`。渲染器只读 `file/key/size`，不依赖 `version/材质数`，故切换无需改代码。

### 2.3 验证

| 验证项 | 方法 | 结果 |
|---|---|---|
| GLB 二进制结构 | Node 解析 magic/version/chunk 长度/JSON/BIN/根节点 extras | 8/8 通过，声明长度与实际一致 |
| 元数据 | 检查根节点 `key/name/size/anchor` | 8/8 齐全，锚点均为 `[0,0,0]` |
| 浏览器加载 | Three.js GLTFLoader 同屏加载 8 件 | `已加载 8/8`，零异常 |
| 视觉 | 无头浏览器截图 | 暖色低饱和、大圆角、多部件，无黑面/穿模 |

---

## 三、家具类别映射（已按用户口径确定）

用户确认：**就近复用**；**不能存放物品的家具不创建三维模型**；**不保留经典渲染器**。

| 原有类别 | 对应 GLB | 说明 |
|---|---|---|
| 沙发 | `sofa` | 直接对应 |
| 床 | `bed` | 直接对应 |
| 椅子 / 软包椅 / 躺椅 | `chair` | 均属坐卧承载，可搭衣物 |
| 餐桌 | `table` | 台面承载 |
| 茶几 | `coffee` | 台面承载 |
| 衣柜 | `wardrobe` | 封闭收纳 |
| 床头柜 / 电视柜 / 收纳盒 / 抽屉 | `cabinet` | 就近复用小型柜体 |
| 书架 | `shelf` | 开放收纳 |
| ~~台灯~~ | **不建模型** | 照明，不承载物品 |
| ~~窗帘~~ | **不建模型** | 装饰，不承载物品 |

实现：`package3d/renderer.js` 的 `CATEGORY_TO_GLB` 只保留上表前 13 类；查不到映射的类别直接跳过渲染，不再使用兜底方块。

- 数据层与目录**不变**：台灯、窗帘仍可建档、仍可关联物品，只是三维场景里不显示模型。
- 已知影响：卧室模板 `ROOM_TEMPLATES.bedroom` 中有 1 件「窗帘/落地窗」，创建房间后该项数据存在，但三维里不再出现对应模型。这符合「非收纳家具不建模型」的口径。
- 尺寸处理：家具自身 `size:{w,h,d}` 与 GLB 的 `[宽,深,高]` 按比例缩放，各轴限制在 0.35～2.5 倍，避免复用件比例失真。

---

## 四、分包结构与接入实现

```
miniprogram/
├── pages/room3d/...              （主包：页面壳、触摸交互、绑定汇总、列表降级）
├── utils/room-renderer.js        （保留文件，但已无页面引用）
├── app.json                      （新增 subpackages；preloadRule 因新版工具校验失败已移除）
└── package3d/                    （分包，约 1.09 MB）
    ├── renderer.js               （Three.js 场景/相机/光照/GLB/拾取/拖动预览/扭转缩放，约 25 KB）
    ├── vendor/
    │   ├── threejs-miniprogram.js （适配版 r108，584 KB）
    │   └── gltf-loader.js         （registerGLTFLoader，88 KB，已改 CommonJS）
    └── assets/
        ├── furniture/            （8 件白膜 GLB + manifest.json，228 KB）
        └── furniture_colored_backup/（带色版备份，228 KB，回退用）
```

### 4.1 加载链路

1. `app.json` 声明 `package3d` 分包。原配置的 `preloadRule` 因新版开发者工具不接受纯资源分包作为预下载目标（编译报 `preloadRule packages[0]: package3d/ 未找到`），已移除，改为按需加载。
2. `room3d.js` 的 `onReady` 拿到 webgl canvas 节点后调 `_load3D()`。
3. `wx.loadSubpackage({name:'package3d'})` 成功后以微信规范的异步形式 `require('../../package3d/renderer.js', success, fail)` 载入（跨分包同步 require 在真机会报 module not defined）。
4. 调用 `createRoomRenderer(canvas, getData)`，接口与原渲染器一致：`resize / render / pick / orbit / pan / zoom / reset / setSelected`。
5. 渲染器用 `FileSystemManager.readFileSync(path)` 读 8 个 GLB（不传 encoding，直接返回 ArrayBuffer；传 `'arraybuffer'` 是非法值，会静默加载失败），再 `GLTFLoader.parse(buffer, '', cb)` 解析——**不走网络、不依赖域名白名单**。
6. 解析完成后自动同步场景实例并重绘；页面后续交互走 `_safeGL` 保护。

### 4.2 r108 适配要点

| 项 | 适配写法 |
|---|---|
| 引擎实例 | `createScopedThreejs(canvas)`，每个 canvas 独立实例 |
| GLTFLoader | `registerGLTFLoader(THREE)` 注入后 `new THREE.GLTFLoader()` |
| 色彩输出 | `renderer.gammaOutput = true`、`gammaFactor = 2.2`（非新版 `outputColorSpace`） |
| 色调映射 / 阴影 | `ACESFilmicToneMapping`、`PCFSoftShadowMap` 在 r108 均可用 |
| 平面几何 | `PlaneBufferGeometry`（r108 命名） |
| 拾取 | **不用 Raycaster**：r108 适配版对 GLB 实例失效，改用屏幕投影包围盒（与原渲染器同口径） |
| 选中反馈 | 地面陶红高亮环；`BoxHelper` 细线在浅色地板上不可辨认，已弃用 |

### 4.3 渲染风格

正交相机（方位 45°、俯角约 33°）、`#F4EDE2` 背景、`#F2EADD` 墙面、暖色错缝木地板，半球光 + 一盏投影方向光 + 弱冷色补光，软阴影、浅色主题 UI。

2026-11-23 按「等距娃娃屋」参考图补充场景软装，全部为程序化几何、不写入业务数据、不参与拾取：

| 元素 | 实现 | 对业务的影响 |
|---|---|---|
| 木纹地板 | 单一 `BufferGeometry` 顶点色错缝拼板 + 底板留边 | 无 |
| 窗与窗光 | 墙面按窗洞分段建板，窗框/磨砂玻璃/窗帘/地面柔影 | 无 |
| 绿植与地毯 | 3–4 盆低多边形盆栽（小树/虎皮兰/灌木）、奶油底包边地毯 | 无 |
| 生活小件 | 落地灯、边桌、两本书 | 无 |

软装只在房间宽/深/高变化时重建，家具与选中态仍走原有 GLB 实例与包围盒拾取通路。r108 开启 `gammaOutput` 后，程序化材质色值须先经 `convertSRGBToLinear()` 转线性，否则整场泛白。三维窗口高度由 440rpx 调至 520rpx，以匹配娃娃屋比例。

---

## 五、验证结果

| 验证项 | 结果 |
|---|---|
| 静态质量门禁 | **100/100**（D1–D9 全满，P0/P1 均为 0） |
| 运行时冒烟 | **79/79 通过**，21 页执行、134 次事件、零异常 |
| 界面口径对齐 | **76/76 通过**（含新增 8 条娃娃屋场景静态断言） |
| 模拟器交互矩阵 | **22/22 通过**（选中/拖动/缩放/旋转/长按/模式/降级/越界/坐标换算） |
| 设备 AC（可观测项） | **7/7 通过**（WebGL 初始化、列表降级、编辑模式、绑定汇总；SDK 3.18.0） |
| 真机样式兼容 | **4/4 通过**（不可配置 style、重复初始化不抛错） |
| 白膜 GLB 资产 | **8/8 通过**（零贴图、单材质、元数据齐全） |
| JS 语法 | room3d.js / renderer.js / gltf-loader.js / app.json 全部通过（由静态门禁 D4 覆盖） |
| 包体 | 主包约 1.44 M（≤2 M）；分包约 1.09 M（≤2 M，含带色版备份） |
| 分包渲染器 mock 验证 | `createRoomRenderer: {"ok":true}`；8 GLB 加载；木地板/窗/绿植/地毯/落地灯渲染正常；截图颜色层次 637 色；拾取命中家具 |

mock 验证页：`preview/mp-test/verify.html`（含小程序 `wx` API 模拟，直接在浏览器跑分包渲染器源码）。视觉回归脚本：`qa/render3d-visual-verify.js`，自动起本地服务 + SwiftShader 无头 Chrome，输出截图 `/tmp/render3d-visual.png`。

---

## 六、真机待办（需你在微信开发者工具完成）

> 2026-11-23 补充：开发者工具服务端口已开启，模拟器编译与自动化 AC（22/22 + 7/7）已通过；下表为**物理真机扫码**仍需人工确认的项，属自动化盲区（手势手感、机型兼容、帧率）。

1. 导入 `iteam/miniprogram`，确认分包 `package3d` 被识别、`app.json` 无校验错误。
2. 进入任一房间的三维页，确认分包按需加载成功、无长时间空白。
3. 核对四件代表家具的造型/光照/视角与白膜材质表现（当前为白膜资产，带色版备份可回退），确认选中高亮与短按拾取。
4. 验证编辑模式：移动、旋转、缩放、长按删除、越界钳制。
5. 验证 BR-009：选中家具后关联物品汇总仍正常，换模型不破坏绑定。
6. 确认卧室模板中的「落地窗」在三维里不显示、但数据仍在。
7. 低端机观察帧率与内存；若分包加载失败，确认自动落到列表视图而非黑屏。

任何一项不通过，先记录具体现象，再针对该点调整——当前已验收的数据层与业务逻辑未被改动。

---

## 七、文件清单（本轮变更）

| 文件 | 变更 |
|---|---|
| `preview/blender-build/build_furniture.py` | 新增，Blender 建模与导出脚本 |
| `preview/assets/furniture/*.glb`、`manifest.json` | 替换为 Blender 正式资产（V2.0） |
| `preview/assets/furniture_procedural_backup/` | 新增，旧占位件备份 |
| `preview/blender-build/build_white.py`、`preview/assets/furniture_white/`、`preview/verify-white-glb.py` | 2026-11-23 新增：白膜建模脚本、8 件白膜资产、结构校验脚本 |
| `preview/blender-all.html`、`glb-verify-blender.html`、`mp-test/verify.html` | 新增验证页 |
| `iteam/miniprogram/package3d/` | 新增分包（渲染器 + 适配版 + 白膜 GLB + 带色版备份） |
| `iteam/miniprogram/app.json` | 增加分包声明；`preloadRule` 因新版工具校验失败已移除，改为按需加载 |
| `iteam/miniprogram/pages/room3d/room3d.{js,wxml,wxss}` | 移除视觉开关，改为分包 Three.js 渲染，主题固定浅色；房间真实比例、分段布局、拖动/扭转/捏合手势 |
| `iteam/miniprogram/package3d/vendor/threejs-miniprogram.js` | 2026-11-23 修复：适配层对不可配置 `canvas.style` 做容错，解决真机初始化失败 |
| `iteam/miniprogram/utils/room-renderer-enhanced.js` | 移至 `preview/room-renderer-enhanced.legacy.js`（不再打包） |
