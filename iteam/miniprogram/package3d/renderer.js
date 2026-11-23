/**
 * package3d/renderer.js —— Three.js 三维房间渲染器（r108 适配版 + GLB 资产）
 * 相机口径（规范 V1.0 §2.3）：固定等距视角。yaw/pitch 在 view 初始化后不再由 UI 改动；
 * room3d 页只调用 pick / dragDelta / previewMove / zoom（有限缩放浏览）/ reset / setSelected。
 * orbit / pan 仅为兼容 utils/room-renderer.js 接口保留，页面不再调用，不提供自由旋转/平移。
 * 绑定仍走逻辑节点（BR-009），本文件只负责外观与拾取。
 */
var THREE_ADAPT = require('./vendor/threejs-miniprogram.js');
var GLTF_REG = require('./vendor/gltf-loader.js');

// 代码包内资源路径：不同基础库/真机对前导斜杠的解析存在差异，逐个尝试取首个可读的。
// 真机上若资产被打包过滤（project.config.json 的 ignoreDevUnusedFiles/ignoreUploadUnusedFiles），
// manifest 会读取失败并回调 onAssetError，避免静默变成空白场景。
var BASE_CANDIDATES = [
  '/package3d/assets/furniture/',
  'package3d/assets/furniture/'
];

// 15 类家具 → 8 件 GLB 就近复用
var CATEGORY_TO_GLB = {
  '床': 'bed',
  '床头柜': 'cabinet',
  '软包椅': 'chair',
  '躺椅': 'chair',
  '沙发': 'sofa',
  '茶几': 'coffee',
  '电视柜': 'cabinet',
  '衣柜': 'wardrobe',
  '餐桌': 'table',
  '椅子': 'chair',
  '书架': 'shelf',
  '收纳盒': 'cabinet',
  '抽屉': 'cabinet'
};

var COLOR_BG = 0xF4EDE2;
var COLOR_WALL = 0xF2EADD;
var COLOR_TRIM = 0xEDE2D1;
var COLOR_FLOOR = 0xD9B98C;
var COLOR_SELECT = 0xBE5F44; // 选中态高对比标识色（不属场景色板）

// 软装色板：沿用《三维家具风格规范》低饱和暖调，绿植取鼠尾草绿系
var WOOD_TONES = [0xCAA271, 0xC09464, 0xD3AC7C, 0xB98A5C];
var GREENS = [0x5F8A5B, 0x7EA37A, 0x4F7450, 0x93B58C];
var POT_TONES = [0xC98F75, 0xD8A79C, 0xE8DED0, 0xB98B6A];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rnd(seed) { var x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }

function createRoomRenderer(canvas, getData, opts) {
  opts = opts || {};
  var THREE;
  try {
    THREE = THREE_ADAPT.createScopedThreejs(canvas);
    GLTF_REG.registerGLTFLoader(THREE);
  } catch (e) {
    return { ok: false, error: 'THREE_INIT_FAILED', message: String(e && e.message || e) };
  }

  // r108 开启 gammaOutput 后材质色需先转线性，否则 sRGB 色值会被二次提亮、整场泛白
  function lin(hex) { var c = new THREE.Color(hex); if (c.convertSRGBToLinear) c.convertSRGBToLinear(); return c; }

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.gammaOutput = true;       // r108 色彩输出（非新版 outputColorSpace）
    renderer.gammaFactor = 2.2;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
  } catch (e) {
    return { ok: false, error: 'WEBGL_UNAVAILABLE', message: String(e && e.message || e) };
  }

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR_BG);

  var camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 200);
  // baseSpan：正交相机垂直半视野（世界单位=米），由房间真实尺寸在 updateRoomGeometry 中自适应
  var view = { yaw: Math.PI / 4, pitch: Math.PI / 5.5, dist: 14, target: new THREE.Vector3(0, 0.4, 0), zoom: 1, baseSpan: 3.3 };
  var roomSize = { w: 0, d: 0, h: 0 };

  function applyFrustum() {
    var span = view.baseSpan / view.zoom;
    var aspect = Math.max(0.6, (canvas.width || 1) / (canvas.height || 1));
    camera.left = -span * aspect; camera.right = span * aspect;
    camera.top = span; camera.bottom = -span;
    camera.updateProjectionMatrix();
  }

  function applyCamera() {
    var cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    camera.position.set(
      view.target.x + view.dist * cp * Math.cos(view.yaw),
      view.target.y + view.dist * sp,
      view.target.z + view.dist * cp * Math.sin(view.yaw)
    );
    camera.lookAt(view.target);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
  }
  applyCamera();

  // 柔和环境光 + 一盏投影主光 + 弱冷色补光：避免硬阴影与死黑角落
  scene.add(new THREE.HemisphereLight(0xFFFAF0, 0xC9A87C, 0.95));
  var sun = new THREE.DirectionalLight(0xFFF1DA, 1.15);
  sun.position.set(-6, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  var fillLight = new THREE.DirectionalLight(0xE6EEF5, 0.18);
  fillLight.position.set(6, 5, -5);
  scene.add(fillLight);

  // ---------- 场景软装：全部程序化几何，不写业务数据、不参与拾取 ----------
  // 参考「等距娃娃屋」：木纹地板、带窗框与窗光的墙、绿植、地毯、落地灯、边桌。
  // 只在房间尺寸变化时重建，避免每帧开销；材质按色值缓存复用。
  var decorRoot = new THREE.Group();
  scene.add(decorRoot);
  var matCache = {};

  function stdMat(color, opts) {
    var key = 's' + color + '|' + (opts ? JSON.stringify(opts) : '');
    if (!matCache[key]) {
      var p = { color: lin(color), roughness: 0.94, metalness: 0 };
      if (opts) for (var k in opts) p[k] = opts[k];
      matCache[key] = new THREE.MeshStandardMaterial(p);
    }
    return matCache[key];
  }
  function basicMat(color, opacity) {
    var key = 'b' + color + '|' + opacity;
    if (!matCache[key]) matCache[key] = new THREE.MeshBasicMaterial({
      color: lin(color), transparent: opacity < 1, opacity: opacity,
      depthWrite: opacity >= 1, side: THREE.DoubleSide
    });
    return matCache[key];
  }
  function addBox(parent, w, h, d, color, x, y, z, shadow) {
    var m = new THREE.Mesh(new THREE.BoxBufferGeometry(w, h, d), stdMat(color));
    m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = !!shadow;
    parent.add(m); return m;
  }
  function addCyl(parent, rt, rb, hgt, seg, color, x, y, z, shadow) {
    var m = new THREE.Mesh(new THREE.CylinderBufferGeometry(rt, rb, hgt, seg || 10), stdMat(color));
    m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = !!shadow;
    parent.add(m); return m;
  }
  function addCone(parent, r, hgt, color, x, y, z) {
    var m = new THREE.Mesh(new THREE.ConeBufferGeometry(r, hgt, 8), stdMat(color));
    m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }
  function addBall(parent, r, color, x, y, z, sx, sy, sz) {
    var m = new THREE.Mesh(new THREE.SphereBufferGeometry(r, 8, 6), stdMat(color));
    m.position.set(x, y, z);
    m.scale.set(sx || 1, sy || 1, sz || 1);
    m.castShadow = true; parent.add(m); return m;
  }
  function clearDecor() {
    for (var i = decorRoot.children.length - 1; i >= 0; i--) {
      var child = decorRoot.children[i];
      child.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      decorRoot.remove(child);
    }
  }

  // 木地板：错缝拼板用一份带顶点色的 BufferGeometry 实现，一张 draw call 铺满整间房
  function buildPlanks(parent, w, d) {
    var pos = [], nor = [], col = [];
    var rowW = 0.23, segL = 1.15, gap = 0.012, y = 0.006;
    var rows = Math.ceil(d / rowW);
    for (var r = 0; r < rows; r++) {
      var z0 = -d / 2 + r * rowW;
      var z1 = Math.min(z0 + rowW - gap, d / 2);
      if (z1 - z0 < 0.02) continue;
      var offset = (r % 2) ? segL * 0.5 : 0;
      for (var x = -w / 2 - offset; x < w / 2; x += segL) {
        var a = Math.max(x + gap / 2, -w / 2);
        var b = Math.min(x + segL - gap / 2, w / 2);
        if (b - a < 0.06) continue;
        var tone = WOOD_TONES[Math.floor(rnd(r * 31 + Math.floor(x * 7)) * WOOD_TONES.length)];
        var c = lin(tone);
        var pts = [[a, z0], [a, z1], [b, z1], [a, z0], [b, z1], [b, z0]];
        for (var p = 0; p < pts.length; p++) {
          pos.push(pts[p][0], y, pts[p][1]);
          nor.push(0, 1, 0);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    if (!pos.length) return;
    var geo = new THREE.BufferGeometry();
    geo.addAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.addAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.addAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    var mesh = new THREE.Mesh(geo, stdMat(0xFFFFFF, { vertexColors: true, roughness: 0.96, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  // 单面墙（局部坐标：墙面在 z=0，墙厚向 -z）。窗洞由四段墙板围出，窗框/玻璃/窗帘在洞内侧。
  function buildWall(parent, len, hgt, t, windows, sill, winH) {
    addBox(parent, len, sill, t, COLOR_WALL, 0, sill / 2, -t / 2);
    addBox(parent, len, Math.max(0.02, hgt - sill - winH), t, COLOR_WALL, 0, (sill + winH + hgt) / 2, -t / 2);
    var sorted = windows.slice().sort(function (a, b) { return a.x - b.x; });
    var cursor = -len / 2;
    for (var i = 0; i < sorted.length; i++) {
      var left = sorted[i].x - sorted[i].w / 2;
      var right = sorted[i].x + sorted[i].w / 2;
      if (left > cursor) addBox(parent, left - cursor, winH, t, COLOR_WALL, (left + cursor) / 2, sill + winH / 2, -t / 2);
      cursor = Math.max(cursor, right);
    }
    if (cursor < len / 2) addBox(parent, len / 2 - cursor, winH, t, COLOR_WALL, (len / 2 + cursor) / 2, sill + winH / 2, -t / 2);

    for (var j = 0; j < sorted.length; j++) {
      var wx = sorted[j].x, ww = sorted[j].w;
      var glass = new THREE.Mesh(new THREE.PlaneBufferGeometry(ww - 0.06, winH - 0.06), basicMat(0xC5DADD, 0.78));
      glass.position.set(wx, sill + winH / 2, -0.012);
      parent.add(glass);
      // 玻璃后的树影，让窗外不是一块死板的蓝
      addBall(parent, 0.16, 0xB9CCAE, wx - ww * 0.22, sill + winH * 0.3, -0.05, 1, 0.8, 0.25);
      addBall(parent, 0.13, 0xCBD9BF, wx + ww * 0.2, sill + winH * 0.24, -0.055, 1, 0.9, 0.25);
      addBox(parent, ww + 0.08, 0.055, 0.055, COLOR_TRIM, wx, sill + winH + 0.02, 0.012);
      addBox(parent, ww + 0.08, 0.055, 0.055, COLOR_TRIM, wx, sill - 0.02, 0.012);
      addBox(parent, 0.055, winH, 0.055, COLOR_TRIM, wx - ww / 2, sill + winH / 2, 0.012);
      addBox(parent, 0.055, winH, 0.055, COLOR_TRIM, wx + ww / 2, sill + winH / 2, 0.012);
      addBox(parent, 0.035, winH, 0.045, COLOR_TRIM, wx, sill + winH / 2, 0.02);
      addBox(parent, ww, 0.035, 0.045, COLOR_TRIM, wx, sill + winH * 0.52, 0.02);
      addBox(parent, ww + 0.18, 0.045, 0.17, COLOR_TRIM, wx, sill - 0.045, 0.07);
      addBox(parent, 0.13, winH + 0.1, 0.03, 0xE8DED0, wx - ww / 2 - 0.1, sill + winH / 2, 0.045);
      addBox(parent, 0.13, winH + 0.1, 0.03, 0xE8DED0, wx + ww / 2 + 0.1, sill + winH / 2, 0.045);
    }
    addBox(parent, len, 0.085, 0.035, COLOR_TRIM, 0, 0.042, 0.018);
  }

  // 窗光落在地板上的平行四边形柔影
  function addSunPatch(parent, x, z, wPatch, dPatch, opacity) {
    var geo = new THREE.BufferGeometry();
    var y = 0.009;
    var x0 = x - wPatch / 2, x1 = x + wPatch / 2;
    var x2 = x + wPatch * 0.78, x3 = x - wPatch * 0.78, z1 = z + dPatch;
    geo.addAttribute('position', new THREE.Float32BufferAttribute([
      x0, y, z, x1, y, z, x2, y, z1,
      x0, y, z, x2, y, z1, x3, y, z1
    ], 3));
    var m = new THREE.Mesh(geo, basicMat(0xFFF0CE, opacity));
    m.renderOrder = 3;
    parent.add(m);
  }

  function addPlant(parent, x, z, sc, kind, seed) {
    var g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(sc);
    addCyl(g, 0.15, 0.115, 0.22, 10, POT_TONES[Math.floor(rnd(seed) * POT_TONES.length)], 0, 0.11, 0, true);
    addCyl(g, 0.132, 0.132, 0.025, 10, 0x6B5D4D, 0, 0.225, 0);
    var i;
    if (kind === 0) { // 小树：主干 + 团簇叶
      addCyl(g, 0.018, 0.025, 0.42, 6, 0x8A6B4F, 0, 0.44, 0, true);
      for (i = 0; i < 7; i++) {
        var a = i * 2.4, rr = 0.09 + rnd(seed + i) * 0.12;
        addBall(g, 0.14, GREENS[i % GREENS.length], Math.cos(a) * rr, 0.58 + rnd(seed + i * 3) * 0.35, Math.sin(a) * rr, 1, 0.65, 0.9);
      }
    } else if (kind === 1) { // 虎皮兰：直立锥叶
      for (i = 0; i < 6; i++) {
        var ang = i * 1.05, hh = 0.38 + rnd(seed + i * 5) * 0.32;
        var leaf = addCone(g, 0.045, hh, GREENS[i % GREENS.length], Math.cos(ang) * 0.06, 0.24 + hh / 2, Math.sin(ang) * 0.06);
        leaf.rotation.z = Math.cos(ang) * 0.18;
        leaf.rotation.x = Math.sin(ang) * 0.18;
      }
    } else { // 小灌木
      for (i = 0; i < 6; i++) {
        var an = i * 1.1, r2 = 0.05 + rnd(seed + i * 7) * 0.1;
        addBall(g, 0.12, GREENS[(i + 1) % GREENS.length], Math.cos(an) * r2, 0.34 + rnd(seed + i) * 0.18, Math.sin(an) * r2, 1, 0.85, 1);
      }
    }
    parent.add(g);
  }

  function buildDecor(w, d, h) {
    clearDecor();
    var g = decorRoot;
    // 娃娃屋底板：地板四周留一圈浅色边框，形成"微缩模型"观感
    addBox(g, w + 0.16, 0.1, d + 0.16, COLOR_TRIM, 0, -0.05, 0);
    addBox(g, w + 0.2, 0.035, d + 0.2, 0xD8C8B2, 0, -0.118, 0);
    var base = new THREE.Mesh(new THREE.PlaneBufferGeometry(w, d), stdMat(0x8F6E4C));
    base.rotation.x = -Math.PI / 2; base.position.y = 0.001; base.receiveShadow = true; g.add(base);
    buildPlanks(g, w, d);

    var sill = Math.min(0.82, h * 0.32);
    var winH = Math.min(1.35, Math.max(0.6, h * 0.46));
    if (sill + winH > h - 0.16) winH = Math.max(0.4, h - 0.16 - sill);
    var nBack = w >= 4.2 ? 3 : 2;
    var backWins = [], leftWins = [];
    for (var i = 0; i < nBack; i++) {
      backWins.push({ x: nBack === 2 ? (i ? 1 : -1) * w * 0.24 : (i - 1) * w * 0.27,
                      w: Math.min(1.15, w / (nBack * 2.1)) });
    }
    var nLeft = d >= 5.2 ? 2 : 1;
    for (var j = 0; j < nLeft; j++) {
      leftWins.push({ x: nLeft === 2 ? (j ? 1 : -1) * d * 0.24 : 0,
                      w: Math.min(1.15, d / (nLeft * 2.1)) });
    }
    var back = new THREE.Group();
    buildWall(back, w, h, 0.06, backWins, sill, winH);
    back.position.z = -d / 2; g.add(back);
    var left = new THREE.Group();
    buildWall(left, d, h, 0.06, leftWins, sill, winH);
    left.position.x = -w / 2; left.rotation.y = Math.PI / 2; g.add(left);

    // 地毯：奶油底 + 鼠尾草绿包边 + 两条陶土粉细纹
    var rw = Math.min(w * 0.56, 2.3), rd = Math.min(d * 0.46, 1.7);
    var rx = w * 0.04, rz = d * 0.06;
    addBox(g, rw + 0.1, 0.008, rd + 0.1, 0x9CB49A, rx, 0.012, rz);
    addBox(g, rw, 0.01, rd, 0xEDE2D1, rx, 0.018, rz);
    addBox(g, rw * 0.7, 0.004, 0.035, 0xD8A79C, rx, 0.025, rz - rd * 0.24);
    addBox(g, rw * 0.7, 0.004, 0.035, 0xD8A79C, rx, 0.025, rz + rd * 0.24);

    // 绿植靠墙角，不占用家具主要摆放区
    addPlant(g, -w / 2 + 0.42, -d / 2 + 0.46, 1.2, 0, 11);
    addPlant(g, w / 2 - 0.46, -d / 2 + 0.44, 1.0, 1, 23);
    addPlant(g, -w / 2 + 0.44, d / 2 - 0.5, 0.9, 2, 37);
    if (w > 4.4) addPlant(g, w / 2 - 0.5, d / 2 - 0.55, 0.82, 0, 51);

    // 落地灯：细杆 + 暖黄锥形灯罩
    var lx = w / 2 - 0.6, lz = -d / 2 + 0.78;
    addCyl(g, 0.16, 0.18, 0.035, 12, 0x5A5148, lx, 0.02, lz);
    addCyl(g, 0.018, 0.018, 1.3, 8, 0x9C8B76, lx, 0.68, lz);
    var shade = new THREE.Mesh(new THREE.ConeBufferGeometry(0.24, 0.3, 12, 1, true), stdMat(0xE3C46B, { side: THREE.DoubleSide }));
    shade.position.set(lx, 1.44, lz); g.add(shade);

    // 边桌 + 两本书，补足生活气息
    var tx = w / 2 - 0.62, tz = d / 2 - 0.62;
    addCyl(g, 0.24, 0.24, 0.035, 12, 0xC9A87C, tx, 0.48, tz);
    addCyl(g, 0.022, 0.022, 0.46, 6, 0x5A5148, tx, 0.23, tz);
    addBox(g, 0.2, 0.035, 0.15, 0xD8A79C, tx - 0.03, 0.515, tz);
    addBox(g, 0.18, 0.03, 0.14, 0x9CB49A, tx + 0.02, 0.548, tz);

    for (var k = 0; k < backWins.length; k++) {
      addSunPatch(g, backWins[k].x, -d / 2 + 0.03, backWins[k].w * 1.25, Math.min(1.7, d * 0.38), 0.2);
    }
  }

  // 按房间真实尺寸重建场景、视野与阴影范围；只在尺寸变化时执行
  function updateRoomGeometry(room) {
    var w = Math.max(0.5, Number(room && room.width) || 4);
    var d = Math.max(0.5, Number(room && room.depth) || 4);
    var h = Math.max(0.5, Number(room && room.height) || 2.8);
    if (w === roomSize.w && d === roomSize.d && h === roomSize.h) return;
    roomSize = { w: w, d: d, h: h };

    buildDecor(w, d, h);

    var diag = Math.sqrt(w * w + d * d);
    view.baseSpan = clamp(Math.max(diag, h * 1.6) * 0.5 + 0.72, 1.8, 9.5);
    view.target.set(0, Math.min(0.55, h * 0.26), 0);

    var r = Math.max(diag, h) * 0.8 + 1;
    sun.shadow.camera.left = -r; sun.shadow.camera.right = r;
    sun.shadow.camera.top = r; sun.shadow.camera.bottom = -r;
    sun.shadow.camera.updateProjectionMatrix();
    applyFrustum();
    applyCamera();
  }

  // GLB 模板与实例
  var templates = {};
  var meta = {};
  var instances = [];       // { index, group, sig, meshes }
  var selectedIndex = -1;
  var helper = null;
  var pendingSig = '';

  // 资产加载诊断：真机上若资产被打包过滤，失败静默会变成"只有地板没有家具"的空白场景。
  // 这里汇总失败原因，通过 opts.onAssetError 回传页面，由页面给出明确提示或降级。
  function assetError(code, detail) {
    if (typeof opts.onAssetError !== 'function') return;
    try { opts.onAssetError({ code: code, detail: detail || '' }); } catch (e) {}
  }

  function loadAssets() {
    var fs;
    try { fs = wx.getFileSystemManager(); }
    catch (e) { assetError('FS_UNAVAILABLE', String(e && e.message || e)); return; }

    // manifest 决定能否继续：逐个候选路径尝试，保留首个成功的 base
    var manifest = null, base = '', manifestErrs = [];
    for (var b = 0; b < BASE_CANDIDATES.length; b++) {
      try {
        var raw = fs.readFileSync(BASE_CANDIDATES[b] + 'manifest.json', 'utf8');
        var parsed = JSON.parse(raw);
        if (parsed && parsed.items && parsed.items.length) { manifest = parsed; base = BASE_CANDIDATES[b]; break; }
        manifestErrs.push(BASE_CANDIDATES[b] + ': manifest 内容为空');
      } catch (e) {
        manifestErrs.push(BASE_CANDIDATES[b] + ': ' + String(e && e.message || e));
      }
    }
    if (!manifest) { assetError('MANIFEST_MISSING', manifestErrs.join(' | ')); return; }

    var expected = manifest.items.length, loaded = 0, glbErrs = [];
    for (var i = 0; i < expected; i++) {
      (function (item) {
        var buf;
        // readFileSync 不传 encoding 才返回 ArrayBuffer；'arraybuffer' 不是合法编码
        try { buf = fs.readFileSync(base + item.file); }
        catch (e) {
          glbErrs.push(item.file + ': ' + String(e && e.message || e));
          if (++loaded === expected) assetError('GLB_READ_FAILED', glbErrs.join(' | '));
          return;
        }
        var loader = new THREE.GLTFLoader();
        loader.parse(buf, '', function (gltf) {
          templates[item.key] = gltf.scene;
          meta[item.key] = item;
          pendingSig = '';
          syncScene();
          draw();
          if (++loaded === expected && !glbErrs.length) assetError('ASSETS_READY', 'loaded=' + expected);
        }, function (err) {
          glbErrs.push(item.file + ': parse ' + String(err && err.message || err));
          if (++loaded === expected) assetError('GLB_PARSE_FAILED', glbErrs.join(' | '));
        });
      })(manifest.items[i]);
    }
  }

  function sceneData() {
    try { return getData() || {}; } catch (e) { return {}; }
  }

  function furnitureList(d) {
    return (d && d.furniture) || [];
  }

  function signature(list) {
    var s = '';
    for (var i = 0; i < list.length; i++) {
      var f = list[i] || {}, p = f.position || {}, z = f.size || {};
      // model 纳入签名：更换外观模型（FURNITURE_LIB.vars）后必须重建，三维外观才会跟随变化
      s += i + ':' + f.id + '|' + f.category + '|' + (f.model || '') + '|' + p.x + ',' + p.z + '|' + f.rotation + '|' + z.w + ',' + z.h + ',' + z.d + ';';
    }
    return s;
  }

  // 外观模型变体色板：同一 category 的不同 model 派生稳定的着色差异，
  // 使「米色床品 / 灰色床品」等在三维里可见；索引用 model 在 vars 中的位置，越界回落到原色。
  var MODEL_VARIANT_COLORS = [0xD9C7A8, 0x9AA0A6, 0xB08C6A, 0x8FA9A0, 0xC9A9A0, 0xA79BB5];
  // 仅标准材质（GLB 木/布构件）参与变体着色；玻璃/灯光等基础材质保持原色
  function isTintable(mat) { return !!(mat && mat.isMeshStandardMaterial && mat.color); }
  function variantColor(category, model) {
    if (!model) return null;
    try {
      var lib = require('../../utils/constants.js').FURNITURE_LIB || {};
      var vars = (lib[category] || {}).vars || [];
      var idx = vars.indexOf(model);
      if (idx <= 0) return null; // 首个变体=原色，不覆写 GLB 自带材质
      return MODEL_VARIANT_COLORS[(idx - 1) % MODEL_VARIANT_COLORS.length];
    } catch (e) { return null; }
  }

  function syncScene() {
    var d = sceneData();
    updateRoomGeometry(d.room);
    var list = furnitureList(d);
    var sig = signature(list);
    if (sig === pendingSig) return;
    pendingSig = sig;

    for (var k = 0; k < instances.length; k++) scene.remove(instances[k].group);
    instances = [];

    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      // 不承载物品的类别（台灯、窗帘等）不建三维模型；数据记录与物品关联不受影响
      var key = CATEGORY_TO_GLB[f.category];
      if (!key) continue;
      var tpl = templates[key];
      if (!tpl) continue;
      var g = tpl.clone(true);
      var m = meta[key];
      var sz = f.size || {};
      // f.size = {w, h, d}；manifest.size = [宽, 深, 高]，Y-up 下依次映射到 x/z/y
      var gw = m ? m.size[0] : 1, gd = m ? m.size[1] : 1, gh = m ? m.size[2] : 1;
      var sx = clamp((sz.w || gw) / gw, 0.35, 2.5);
      var sy = clamp((sz.h || gh) / gh, 0.35, 2.5);
      var szz = clamp((sz.d || gd) / gd, 0.35, 2.5);
      g.scale.set(sx, sy, szz);
      g.position.set((f.position && f.position.x) || 0, 0, (f.position && f.position.z) || 0);
      g.rotation.y = f.rotation || 0;
      g.userData.furnitureIndex = i;
      var tint = variantColor(f.category, f.model);
      g.traverse(function (o) {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.userData.furnitureIndex = i;
          // 外观模型变体：clone 材质避免污染共享模板；仅对浅色（近似木/布）mesh 着色，
          // 跳过深色/玻璃构件，保留 GLB 原有层次。首个变体不着色=原色。
          if (tint && isTintable(o.material)) {
            o.material = o.material.clone();
            o.material.color = lin(tint);
          }
        }
      });
      scene.add(g);
      instances.push({ index: i, group: g });
    }
    applySelection();
  }

  function findGroup(idx) {
    for (var i = 0; i < instances.length; i++) if (instances[i].index === idx) return instances[i].group;
    return null;
  }

  function applySelection() {
    if (helper) {
      scene.remove(helper);
      if (helper.geometry) helper.geometry.dispose();
      if (helper.material) helper.material.dispose();
      helper = null;
    }
    var g = findGroup(selectedIndex);
    if (!g) return;
    try {
      // 地面高亮环：浅色地板上比线框 BoxHelper 更易辨认
      var box = new THREE.Box3().setFromObject(g);
      var cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      var size = new THREE.Vector3(); box.getSize(size);
      var rad = Math.max(size.x, size.z) * 0.62 + 0.12;
      helper = new THREE.Mesh(
        new THREE.RingGeometry(rad * 0.84, rad, 32),
        new THREE.MeshBasicMaterial({ color: COLOR_SELECT, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
      );
      helper.rotation.x = -Math.PI / 2;
      helper.position.set(cx, 0.015, cz);
      scene.add(helper);
    } catch (e) { helper = null; }
  }

  function draw() {
    renderer.render(scene, camera);
  }

  // 屏幕像素位移 → 地面世界位移（正交相机方形像素：worldPerPixel=2*span/画布高度；
  // 俯视下屏幕纵向在地面上的投影缩短为 sin(pitch)，故纵向按 1/sin(pitch) 补偿做到跟手）。
  // 返回 A=屏幕水平（右为正）位移、B=屏幕纵向（下为正）位移，pan 与 dragDelta 共用此口径。
  function screenDelta(dxPx, dyPx) {
    var h = canvas.height || 1;
    var wpp = (2 * (view.baseSpan / view.zoom)) / h;
    var sp = Math.sin(view.pitch) || 0.0001;
    return { A: dxPx * wpp, B: dyPx * wpp / sp };
  }

  loadAssets();

  return {
    ok: true,
    resize: function (w, h) {
      w = Math.max(1, w); h = Math.max(1, h);
      renderer.setSize(w, h, false);
      applyFrustum();
    },
    render: function () { syncScene(); draw(); },
    // 屏幕投影包围盒拾取：与原渲染器同口径，规避 r108 适配版 Raycaster 对 GLB 实例失效的问题
    pick: function (x, y) {
      var w = canvas.width || 1, h = canvas.height || 1;
      var best = null, bestDist = 1e12;
      for (var i = 0; i < instances.length; i++) {
        var box = new THREE.Box3().setFromObject(instances[i].group);
        var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (var a = 0; a < 2; a++) for (var b = 0; b < 2; b++) for (var c = 0; c < 2; c++) {
          var v = new THREE.Vector3(
            a ? box.max.x : box.min.x,
            b ? box.max.y : box.min.y,
            c ? box.max.z : box.min.z
          );
          v.project(camera);
          var sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
          var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d < bestDist) { bestDist = d; best = instances[i].index; }
        }
      }
      return best;
    },
    // 旋转视角：内容跟手（手往右内容往右、手往上内容往上）。
    // yaw 用 += 而非 -=：原先 -= 会让手往右拖时内容往左跑，与平移方向相反。
    orbit: function (dx, dy) {
      view.yaw += dx * 0.008;
      view.pitch = clamp(view.pitch + dy * 0.006, 0.18, 1.15);
      applyCamera();
    },
    // 平移视角：与 dragDelta 共用同一套屏幕→地面换算，target 取反方向移动，
    // 使视图内容跟手（手往右内容往右、手往上内容往上），修复原先轴向用反导致的反向漂移。
    pan: function (dx, dy) {
      var d = screenDelta(dx, dy);
      var A = d.A, B = d.B;
      var sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
      view.target.x -= A * sy + B * cy;
      view.target.z -= B * sy - A * cy;
      applyCamera();
    },
    // 屏幕像素位移 → 地面世界位移（米）。正交相机方形像素：worldPerPixel=2*span/canvas.height；
    // 屏幕竖直方向在地面上的投影缩短为 sin(pitch)，故纵向位移按 1/sin(pitch) 补偿，做到"跟手"。
    dragDelta: function (dxPx, dyPx) {
      var d = screenDelta(dxPx, dyPx);
      var A = d.A, B = d.B;
      var sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
      return { dx: A * sy + B * cy, dz: B * sy - A * cy };
    },
    // 拖动中只在内存里移动模型（不改 _raw，signature 不变 → syncScene 不重建实例），
    // 返回钳制后的坐标供页面刷新选中卡；真正落盘由 touchend 一次性调 transformFurniture 完成。
    previewMove: function (idx, x, z) {
      var g = findGroup(idx);
      if (!g) return null;
      var d = sceneData(), f = (furnitureList(d)[idx]) || {}, room = d.room || {};
      var halfW = (room.width || 20) / 2, halfD = (room.depth || 20) / 2;
      var sz = f.size || {}, fw = (sz.w || 0.6) / 2, fd = (sz.d || 0.6) / 2;
      var loX = -halfW + fw, hiX = halfW - fw, loZ = -halfD + fd, hiZ = halfD - fd;
      var cx = loX > hiX ? 0 : clamp(x, loX, hiX);
      var cz = loZ > hiZ ? 0 : clamp(z, loZ, hiZ);
      var ddx = cx - g.position.x, ddz = cz - g.position.z;
      g.position.x = cx; g.position.z = cz;
      if (helper && selectedIndex === idx) { helper.position.x += ddx; helper.position.z += ddz; }
      draw();
      return { x: Math.round(cx * 100) / 100, z: Math.round(cz * 100) / 100 };
    },
    // 拖动中只改 group 朝向（不改 _raw，signature 不含临时 rotation 时 syncScene 不重建），抬手再落盘
    previewRotate: function (idx, rot) {
      var g = findGroup(idx);
      if (!g) return null;
      g.rotation.y = rot;
      draw();
      return { rotation: rot };
    },
    // 预览缩放：只改 group.scale，不改 _raw，signature 不变 → syncScene 不重建
    previewScale: function (idx, size) {
      var g = findGroup(idx);
      if (!g || !size) return null;
      var f = furnitureList(sceneData())[idx] || {};
      var m = meta[CATEGORY_TO_GLB[f.category] || ''];
      var gw = m ? m.size[0] : 1, gd = m ? m.size[1] : 1, gh = m ? m.size[2] : 1;
      g.scale.set(
        clamp((size.w || gw) / gw, 0.35, 2.5),
        clamp((size.h || gh) / gh, 0.35, 2.5),
        clamp((size.d || gd) / gd, 0.35, 2.5)
      );
      draw();
      return { w: size.w, h: size.h, d: size.d };
    },
    zoom: function (delta) {
      view.zoom = clamp(view.zoom * (1 - delta * 0.001), 0.45, 3.2);
      applyFrustum();
      applyCamera();
    },
    reset: function () {
      view.yaw = Math.PI / 4; view.pitch = Math.PI / 5.5;
      view.dist = 14; view.zoom = 1;
      view.target.set(0, Math.min(0.6, (roomSize.h || 2.8) * 0.3), 0);
      applyFrustum();
      applyCamera();
    },
    // V1.3 §3.1「适配」：保留当前观察角度，仅把房间与家具整体拉回视野（target 归房间中心、缩放归 1）。
    // 与 reset 的区别：reset 同时恢复等距默认角度；fit 不动角度。
    fit: function () {
      view.zoom = 1;
      view.target.set(0, Math.min(0.6, (roomSize.h || 2.8) * 0.3), 0);
      applyFrustum();
      applyCamera();
    },
    // V1.3 §3.1 视角预设：等距 / 俯视 / 正面。首版实现等距与俯视，正面一并给出接口。
    // 俯视取接近垂直但不等于 π/2 的角度，避免正交相机取景退化。
    setPreset: function (name) {
      if (name === 'top') { view.yaw = 0; view.pitch = 1.42; }
      else if (name === 'front') { view.yaw = 0; view.pitch = 0.22; }
      else { view.yaw = Math.PI / 4; view.pitch = Math.PI / 5.5; } // isometric
      view.zoom = 1;
      view.target.set(0, Math.min(0.6, (roomSize.h || 2.8) * 0.3), 0);
      applyFrustum();
      applyCamera();
      return name;
    },
    setSelected: function (idx) {
      selectedIndex = (typeof idx === 'number' && idx >= 0) ? idx : -1;
      applySelection();
    }
  };
}

module.exports = { createRoomRenderer: createRoomRenderer, CATEGORY_TO_GLB: CATEGORY_TO_GLB };
