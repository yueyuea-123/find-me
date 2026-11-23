// utils/room-renderer-enhanced.js —— 视觉增强版房间渲染器（小程序原生 WebGL）
// 依据：三维家具风格规范 V1.0 §3 风格规范 / §4 家具品类
// 目标：在不引入引擎的前提下，把规范的四项风格（圆角低多边形 / 规范色板 / 软阴影 / 正交 45°·30°）落到小程序运行时
// 接口与 room-renderer.js 完全一致，可在页面侧切换并回退。
// 事实与预测分离、模型与逻辑位置解耦（BR-009）均保持不变。

var mat4;
if (typeof require === 'function') {
  mat4 = require('./mat4.js');
} else if (typeof window !== 'undefined' && window.MAT4) {
  mat4 = window.MAT4;
}

// ---------- 规范 3.3 配色板（0~1） ----------
var C = {
  wall:   [0.961, 0.937, 0.890],
  floor:  [0.851, 0.725, 0.549],
  wood:   [0.788, 0.659, 0.486],
  woodDk: [0.663, 0.518, 0.341],
  linen:  [0.910, 0.871, 0.816],
  linen2: [0.847, 0.804, 0.733],
  sage:   [0.612, 0.706, 0.604],
  mustard:[0.890, 0.769, 0.420],
  clay:   [0.847, 0.655, 0.612],
  ink:    [0.353, 0.318, 0.282],
  white:  [0.980, 0.965, 0.933]
};

// 兼容既有 variant 名称 → 规范色板
function colorOf(name) {
  if (!name) return C.wood;
  var s = String(name);
  if (s.indexOf('木') >= 0 || s.indexOf('原') >= 0) return C.wood;
  if (s.indexOf('深蓝') >= 0 || s.indexOf('深') >= 0) return C.ink;
  if (s.indexOf('灰') >= 0) return C.linen2;
  if (s.indexOf('暖黄') >= 0) return C.mustard;
  if (s.indexOf('米白') >= 0 || s.indexOf('米色') >= 0 || s.indexOf('白') >= 0) return C.linen;
  return C.wood;
}

// ---------- 着色器：哑光 + 半球环境光 + 方向光 ----------
var VS = [
  'attribute vec3 aPos;',
  'attribute vec3 aNormal;',
  'uniform mat4 uMVP;',
  'uniform mat4 uModel;',
  'varying vec3 vN;',
  'varying vec3 vW;',
  'void main(){',
  ' vec4 w=uModel*vec4(aPos,1.0);',
  ' vW=w.xyz;',
  ' vN=normalize(mat3(uModel)*aNormal);',
  ' gl_Position=uMVP*vec4(aPos,1.0);',
  '}'
].join('\n');

var FS = [
  'precision mediump float;',
  'varying vec3 vN;',
  'varying vec3 vW;',
  'uniform vec3 uColor;',
  'uniform vec3 uLight;',
  'uniform float uAlpha;',
  'uniform float uSelected;',
  'uniform float uOutline;',
  'void main(){',
  ' vec3 n=normalize(vN);',
  ' float d=max(dot(n,normalize(uLight)),0.0);',
  ' float sky=0.5+0.5*n.y;',
  ' vec3 amb=mix(vec3(0.86,0.83,0.78),vec3(1.04,1.02,0.98),sky);',
  ' float light=0.78+0.30*d;',
  ' vec3 col=uColor*amb*light;',
  ' col=mix(col,vec3(0.98,0.72,0.62),uSelected*0.35);',
  ' col=mix(col,vec3(0.85,0.60,0.52),uOutline*0.25);',
  ' gl_FragColor=vec4(col,uAlpha);',
  '}'
].join('\n');

// 圆角盒几何：以单位立方体为基，顶点向内收 r 后沿法线外扩，得到连续圆角
// seg 每面细分数，r 圆角半径（单位立方体比例）
function buildRoundedBox(seg, r) {
  var data = [];
  var lim = 0.5 - r;
  function clamp(v) { return Math.max(-lim, Math.min(lim, v)); }
  function face(axis, sign, uAxis, vAxis) {
    function pt(u, v) {
      var p = [0, 0, 0];
      p[axis] = sign * 0.5;
      p[uAxis] = u;
      p[vAxis] = v;
      return p;
    }
    for (var i = 0; i < seg; i++) {
      for (var j = 0; j < seg; j++) {
        var u0 = -0.5 + i / seg, u1 = -0.5 + (i + 1) / seg;
        var v0 = -0.5 + j / seg, v1 = -0.5 + (j + 1) / seg;
        var quad = [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v0), pt(u1, v1), pt(u0, v1)];
        for (var k = 0; k < 6; k++) {
          var p = quad[k];
          var q = [clamp(p[0]), clamp(p[1]), clamp(p[2])];
          var dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
          var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          var nx = dx / len, ny = dy / len, nz = dz / len;
          data.push(q[0] + nx * r, q[1] + ny * r, q[2] + nz * r, nx, ny, nz);
        }
      }
    }
  }
  face(2, 1, 0, 1); face(2, -1, 0, 1);
  face(0, 1, 2, 1); face(0, -1, 2, 1);
  face(1, 1, 0, 2); face(1, -1, 0, 2);
  return new Float32Array(data);
}

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function scaleM(x, y, z) {
  return new Float32Array([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);
}

// 正交投影：规范 3.5
function ortho(w, h, viewSize) {
  var aspect = w / h;
  var s = viewSize / 2;
  var out = new Float32Array(16);
  out[0] = 1 / (s * aspect); out[5] = 1 / s; out[10] = -2 / 100;
  out[14] = -1; out[15] = 1;
  return out;
}

// 渐变接触阴影贴图（程序化生成，无外部资源）
function makeShadowTexture(gl) {
  var S = 64, px = new Uint8Array(S * S * 4);
  for (var y = 0; y < S; y++) {
    for (var x = 0; x < S; x++) {
      var dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      var d = Math.sqrt(dx * dx + dy * dy);
      var a = Math.max(0, 1 - d);
      a = a * a * (3 - 2 * a);
      var i = (y * S + x) * 4;
      px[i] = 255; px[i+1] = 255; px[i+2] = 255; px[i+3] = Math.floor(a * 255);
    }
  }
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// ---------- 家具部件组合表 ----------
// 每项 [dx,dy,dz, w,h,d, 颜色键]；坐标以家具底面中心为原点，单位为整体尺寸的比例
// dy 为部件中心高度比例（0 底面、1 顶面）
function partsOf(category, variant) {
  var main = colorOf(variant);
  var c = category || '';
  if (c.indexOf('沙发') >= 0 || c.indexOf('sofa') >= 0) {
    return [
      [0,0.22,0, 1.0,0.30,1.0, main], [0,0.52,-0.34, 1.0,0.46,0.24, C.linen2],
      [-0.45,0.34,0, 0.12,0.40,1.0, C.linen2], [0.45,0.34,0, 0.12,0.40,1.0, C.linen2],
      [-0.24,0.40,0.06, 0.44,0.10,0.80, C.linen], [0.24,0.40,0.06, 0.44,0.10,0.80, C.linen],
      [-0.30,0.55,-0.18, 0.20,0.20,0.12, C.clay], [0.30,0.55,-0.18, 0.20,0.20,0.12, C.sage]
    ];
  }
  if (c.indexOf('床') >= 0 && c.indexOf('床头') < 0 || c.indexOf('bed') >= 0) {
    return [
      [0,0.20,0, 1.0,0.32,1.0, C.wood], [0,0.42,0.02, 0.94,0.20,0.94, C.linen],
      [0,0.40,-0.47, 1.0,0.56,0.08, C.woodDk],
      [-0.24,0.55,-0.32, 0.34,0.10,0.20, C.white], [0.24,0.55,-0.32, 0.34,0.10,0.20, C.white],
      [0,0.53,0.28, 0.94,0.06,0.42, C.sage]
    ];
  }
  if (c.indexOf('床头柜') >= 0) {
    return [
      [0,0.50,0, 1.0,0.86,1.0, main],
      [0,0.55,0.51, 0.88,0.34,0.06, C.linen], [0,0.27,0.51, 0.88,0.34,0.06, C.linen],
      [-0.18,0.55,0.55, 0.06,0.06,0.04, C.ink], [-0.18,0.27,0.55, 0.06,0.06,0.04, C.ink],
      [0.18,0.55,0.55, 0.06,0.06,0.04, C.ink], [0.18,0.27,0.55, 0.06,0.06,0.04, C.ink]
    ];
  }
  if (c.indexOf('衣柜') >= 0 || c.indexOf('wardrobe') >= 0) {
    return [
      [0,0.50,0, 1.0,1.0,1.0, main],
      [-0.25,0.50,0.52, 0.46,0.94,0.05, C.linen], [0.25,0.50,0.52, 0.46,0.94,0.05, C.linen2],
      [-0.05,0.50,0.56, 0.03,0.16,0.03, C.ink], [0.05,0.50,0.56, 0.03,0.16,0.03, C.ink]
    ];
  }
  if (c.indexOf('书架') >= 0 || c.indexOf('书柜') >= 0 || c.indexOf('置物') >= 0 || c.indexOf('shelf') >= 0) {
    var p = [
      [-0.46,0.50,0, 0.10,1.0,1.0, C.woodDk], [0.46,0.50,0, 0.10,1.0,1.0, C.woodDk],
      [0,0.03,0, 1.0,0.06,1.0, C.woodDk], [0,0.97,0, 1.0,0.06,1.0, C.woodDk],
      [0,0.30,0, 0.90,0.05,0.96, main], [0,0.60,0, 0.90,0.05,0.96, main]
    ];
    var bc = [C.clay, C.sage, C.mustard, C.linen2, C.woodDk];
    [[0.34,-0.30],[0.61,-0.28],[0.90,-0.26]].forEach(function (row, ri) {
      for (var i = 0; i < 4; i++) {
        p.push([-0.30 + i * 0.20, row[0] + 0.06, row[1], 0.10,0.22,0.30, bc[(i + ri) % 5]]);
      }
    });
    return p;
  }
  if (c.indexOf('抽屉') >= 0 || c.indexOf('斗柜') >= 0 || c.indexOf('cabinet') >= 0) {
    return [
      [0,0.48,0, 1.0,0.90,1.0, main],
      [0,0.72,0.52, 0.90,0.26,0.05, C.linen], [0,0.45,0.52, 0.90,0.26,0.05, C.linen2], [0,0.18,0.52, 0.90,0.26,0.05, C.linen],
      [0,0.72,0.56, 0.14,0.04,0.03, C.ink], [0,0.45,0.56, 0.14,0.04,0.03, C.ink], [0,0.18,0.56, 0.14,0.04,0.03, C.ink]
    ];
  }
  if (c.indexOf('收纳盒') >= 0) {
    return [
      [0,0.45,0, 1.0,0.86,1.0, main], [0,0.90,0, 1.04,0.10,1.04, C.linen2]
    ];
  }
  if (c.indexOf('茶几') >= 0 || c.indexOf('coffee') >= 0) {
    return [
      [0,0.82,0, 1.0,0.14,1.0, main],
      [-0.42,0.38,-0.40, 0.10,0.70,0.10, C.woodDk], [0.42,0.38,-0.40, 0.10,0.70,0.10, C.woodDk],
      [-0.42,0.38,0.40, 0.10,0.70,0.10, C.woodDk], [0.42,0.38,0.40, 0.10,0.70,0.10, C.woodDk],
      [0.26,0.94,0, 0.20,0.10,0.20, C.mustard]
    ];
  }
  if (c.indexOf('电视柜') >= 0) {
    return [
      [0,0.25,0, 1.0,0.50,1.0, main],
      [-0.24,0.26,0.51, 0.46,0.40,0.05, C.linen], [0.24,0.26,0.51, 0.46,0.40,0.05, C.linen2]
    ];
  }
  if (c.indexOf('桌') >= 0 || c.indexOf('table') >= 0) {
    return [
      [0,0.94,0, 1.0,0.10,1.0, main],
      [-0.42,0.45,-0.38, 0.09,0.86,0.09, C.woodDk], [0.42,0.45,-0.38, 0.09,0.86,0.09, C.woodDk],
      [-0.42,0.45,0.38, 0.09,0.86,0.09, C.woodDk], [0.42,0.45,0.38, 0.09,0.86,0.09, C.woodDk],
      [-0.25,1.04,0, 0.20,0.12,0.18, C.clay]
    ];
  }
  if (c.indexOf('椅') >= 0 || c.indexOf('chair') >= 0) {
    return [
      [0,0.48,0, 1.0,0.10,1.0, main], [0,0.72,-0.42, 1.0,0.48,0.12, main],
      [-0.40,0.22,-0.38, 0.10,0.44,0.10, C.woodDk], [0.40,0.22,-0.38, 0.10,0.44,0.10, C.woodDk],
      [-0.40,0.22,0.38, 0.10,0.44,0.10, C.woodDk], [0.40,0.22,0.38, 0.10,0.44,0.10, C.woodDk]
    ];
  }
  if (c.indexOf('躺椅') >= 0) {
    return [
      [0,0.20,0, 1.0,0.26,1.0, C.wood], [0,0.40,0.10, 0.92,0.20,0.80, main],
      [0,0.55,-0.42, 0.92,0.44,0.16, main]
    ];
  }
  if (c.indexOf('台灯') >= 0) {
    return [
      [0,0.04,0, 0.60,0.08,0.60, C.ink], [0,0.30,0, 0.10,0.50,0.10, C.woodDk],
      [0,0.62,0, 0.62,0.24,0.62, colorOf(variant) || C.mustard]
    ];
  }
  if (c.indexOf('窗帘') >= 0) {
    return [[0,0.50,0, 1.0,1.0,1.0, colorOf(variant)]];
  }
  // 兜底：单圆角体，保证任何 category 都有可见占位
  return [[0,0.50,0, 0.92,0.92,0.92, main]];
}

function createRoomRenderer(canvas, getScene) {
  var gl = canvas.getContext('webgl');
  if (!gl) return { ok: false, error: 'WEBGL_UNAVAILABLE' };

  var program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (e) {
    return { ok: false, error: 'SHADER_FAILED', message: e.message };
  }

  // 圆角体（家具）与直角体（墙/地面）共用一套顶点格式
  var geoRound = buildRoundedBox(4, 0.14);
  var geoBox = buildRoundedBox(1, 0.001);
  var vbo = gl.createBuffer();
  function bindGeo(data) {
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  var loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aNormal: gl.getAttribLocation(program, 'aNormal'),
    uMVP: gl.getUniformLocation(program, 'uMVP'),
    uModel: gl.getUniformLocation(program, 'uModel'),
    uColor: gl.getUniformLocation(program, 'uColor'),
    uLight: gl.getUniformLocation(program, 'uLight'),
    uAlpha: gl.getUniformLocation(program, 'uAlpha'),
    uSelected: gl.getUniformLocation(program, 'uSelected'),
    uOutline: gl.getUniformLocation(program, 'uOutline')
  };
  var shadowTex = makeShadowTexture(gl);

  // 相机：正交 45° / 30°，规范 3.5
  var cam = { yaw: 0.7, pitch: 0.52, view: 6.2, tx: 0, tz: 0 };
  var W = 300, H = 300;
  var selectedIndex = -1;
  var screenPoints = [];

  function resize(w, h) { W = w; H = h; gl.viewport(0, 0, W, H); }

  function draw(data, model, mvp, color, alpha, selected, outline) {
    bindGeo(data);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 24, 12);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniformMatrix4fv(loc.uMVP, false, mvp);
    gl.uniform3fv(loc.uColor, color);
    gl.uniform1f(loc.uAlpha, alpha);
    gl.uniform1f(loc.uSelected, selected ? 1 : 0);
    gl.uniform1f(loc.uOutline, outline ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
  }

  function eyePos() {
    var r = 14;
    return [
      cam.tx + r * Math.sin(cam.yaw) * Math.cos(cam.pitch),
      r * Math.sin(cam.pitch),
      cam.tz + r * Math.cos(cam.yaw) * Math.cos(cam.pitch)
    ];
  }

  function render() {
    var scene = getScene() || { room: null, furniture: [] };
    gl.clearColor(C.wall[0], C.wall[1], C.wall[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform3f(loc.uLight, 0.45, 0.86, 0.28);

    var eye = eyePos();
    var proj = ortho(W, H, cam.view);
    var view = mat4.lookAt(eye, [cam.tx, 0.45, cam.tz], [0, 1, 0]);
    var vp = mat4.multiply(proj, view);

    var room = scene.room, rw = 6, rd = 5, rh = 2.8;
    if (room && room.width && room.depth) { rw = room.width; rd = room.depth; rh = room.height || 2.8; }

    // 地面（规范色板 floor）
    var fm = mat4.multiply(mat4.translate(0, -0.05, 0), scaleM(rw, 0.1, rd));
    draw(geoBox, fm, mat4.multiply(vp, fm), C.floor, 1, false, false);

    // 后墙与左墙（半透明，前墙隐藏）
    var bm = mat4.multiply(mat4.translate(0, rh / 2 - 0.05, -rd / 2), scaleM(rw, rh, 0.06));
    draw(geoBox, bm, mat4.multiply(vp, bm), C.wall, 0.72, false, false);
    var lm = mat4.multiply(mat4.translate(-rw / 2, rh / 2 - 0.05, 0), scaleM(0.06, rh, rd));
    draw(geoBox, lm, mat4.multiply(vp, lm), C.wall, 0.62, false, false);

    // 窗光（后墙浅色窗格）
    var wm = mat4.multiply(mat4.translate(rw * 0.22, rh * 0.56, -rd / 2 + 0.05), scaleM(1.5, 1.1, 0.06));
    draw(geoBox, wm, mat4.multiply(vp, wm), C.white, 0.92, false, false);

    // 家具：多部件圆角组合 + 渐变接触阴影
    screenPoints = [];
    var list = scene.furniture || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var sz = f.size || {};
      var w = sz.w || 0.6, h = sz.h || 0.6, d = sz.d || 0.6;
      var px = (f.position && f.position.x) || 0, pz = (f.position && f.position.z) || 0;
      var py = ((f.position && f.position.y) || 0);
      var rot = f.rotation || 0;
      var base = mat4.multiply(mat4.translate(px, py, pz), mat4.rotateY(rot));
      var isCand = f.status === 'candidate';

      // 接触阴影：贴地的半透明渐变方片
      var sm = mat4.multiply(mat4.multiply(base, mat4.translate(0, 0.012, 0)), scaleM(w * 1.25, 1, d * 1.25));
      drawShadow(sm, vp, 0.5);

      var parts = partsOf(f.category || f.model || '', f.model || f.variant || '');
      for (var k = 0; k < parts.length; k++) {
        var q = parts[k];
        var pm = mat4.multiply(base, mat4.multiply(
          mat4.translate(q[0] * w, q[1] * h, q[2] * d),
          scaleM(q[3] * w, q[4] * h, q[5] * d)
        ));
        draw(geoRound, pm, mat4.multiply(vp, pm), q[6], isCand ? 0.55 : 1, i === selectedIndex, false);
      }

      var c = mat4.transformVec4(mat4.multiply(base, mat4.translate(0, h / 2, 0)), [0, 0, 0, 1]);
      var cp = mat4.transformVec4(vp, c);
      if (cp[3] > 0) {
        screenPoints.push({
          index: i,
          x: (cp[0] / cp[3] * 0.5 + 0.5) * W,
          y: (1 - (cp[1] / cp[3] * 0.5 + 0.5)) * H
        });
      }
    }
  }

  // 接触阴影绘制：独立小程序，复用同一 MVP 约定
  var shadowVS = [
    'attribute vec3 aPos;',
    'uniform mat4 uMVP;',
    'varying vec2 vUV;',
    'void main(){ vUV=aPos.xz+0.5; gl_Position=uMVP*vec4(aPos,1.0); }'
  ].join('\n');
  var shadowFS = [
    'precision mediump float;',
    'varying vec2 vUV;',
    'uniform sampler2D uTex;',
    'uniform float uAlpha;',
    'void main(){ float a=texture2D(uTex,vUV).a*uAlpha; gl_FragColor=vec4(0.32,0.26,0.19,a); }'
  ].join('\n');
  var sp;
  try {
    sp = gl.createProgram();
    gl.attachShader(sp, compile(gl, gl.VERTEX_SHADER, shadowVS));
    gl.attachShader(sp, compile(gl, gl.FRAGMENT_SHADER, shadowFS));
    gl.linkProgram(sp);
    if (!gl.getProgramParameter(sp, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(sp));
  } catch (e) {
    return { ok: false, error: 'SHADER_FAILED', message: e.message };
  }
  var sl = {
    aPos: gl.getAttribLocation(sp, 'aPos'),
    uMVP: gl.getUniformLocation(sp, 'uMVP'),
    uTex: gl.getUniformLocation(sp, 'uTex'),
    uAlpha: gl.getUniformLocation(sp, 'uAlpha')
  };
  var shadowGeo = new Float32Array([
    -0.5,0,-0.5, 0.5,0,-0.5, 0.5,0,0.5,
    -0.5,0,-0.5, 0.5,0,0.5, -0.5,0,0.5
  ]);
  var shadowVbo = gl.createBuffer();

  function drawShadow(model, vp, alpha) {
    gl.useProgram(sp);
    gl.bindBuffer(gl.ARRAY_BUFFER, shadowVbo);
    gl.bufferData(gl.ARRAY_BUFFER, shadowGeo, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(sl.aPos);
    gl.vertexAttribPointer(sl.aPos, 3, gl.FLOAT, false, 12, 0);
    gl.uniformMatrix4fv(sl.uMVP, false, mat4.multiply(vp, model));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(sl.uTex, 0);
    gl.uniform1f(sl.uAlpha, alpha);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.useProgram(program);
  }

  function pick(x, y) {
    var best = -1, bestD = 44 * 44;
    for (var i = 0; i < screenPoints.length; i++) {
      var p = screenPoints[i], dx = p.x - x, dy = p.y - y, dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = p.index; }
    }
    selectedIndex = best;
    return best;
  }

  function orbit(dx, dy) {
    cam.yaw -= dx * 0.008;
    cam.pitch = Math.max(0.18, Math.min(1.12, cam.pitch + dy * 0.006));
  }
  function pan(dx, dy) {
    cam.tx -= dx * 0.008 * Math.cos(cam.yaw);
    cam.tz += dx * 0.008 * Math.sin(cam.yaw);
    cam.tz += dy * 0.008;
  }
  function zoom(delta) {
    cam.view = Math.max(3.4, Math.min(11, cam.view + delta * 0.012));
  }
  function reset() {
    cam.yaw = 0.7; cam.pitch = 0.52; cam.view = 6.2;
    cam.tx = 0; cam.tz = 0; selectedIndex = -1;
  }

  // render 中调用 drawShadow 前需保证 program 已激活，此处在 render 顶部已 useProgram(program)，
  // drawShadow 内部会切换到阴影 program 并在结束时切回，故顺序安全。

  return {
    ok: true, render: render, resize: resize, pick: pick,
    orbit: orbit, pan: pan, zoom: zoom, reset: reset,
    getSelected: function () { return selectedIndex; },
    setSelected: function (i) { selectedIndex = i; },
    _debug: function () { return { yaw: cam.yaw, pitch: cam.pitch, view: cam.view, pieces: geoRound.length / 6 }; }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createRoomRenderer: createRoomRenderer, colorOf: colorOf, partsOf: partsOf };
}
if (typeof window !== 'undefined') {
  window.RoomRendererEnhanced = { createRoomRenderer: createRoomRenderer, colorOf: colorOf, partsOf: partsOf };
}
