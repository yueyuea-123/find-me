// utils/room-renderer.js —— 产品级轻量房间渲染器（小程序原生 WebGL）
// 依据：产品总纲第11节坐标约定（Y-up、单位米）；MVP-006/009/012
// 事实与预测分离：候选对象用半透明描边表现，用户确认对象用实色。
// 三维对象与逻辑位置解耦：这里只渲染外观，收纳节点/物品关联由 store 管理。

var mat4 = require('./mat4.js');

var VERT = [
  'attribute vec3 aPos;',
  'attribute vec3 aNormal;',
  'uniform mat4 uMVP;',
  'uniform mat4 uModel;',
  'uniform vec3 uColor;',
  'uniform float uAlpha;',
  'uniform float uSelected;',
  'varying vec3 vNormal;',
  'varying vec3 vColor;',
  'void main(){',
  ' vNormal = mat3(uModel)*aNormal;',
  ' vColor = uColor;',
  ' gl_Position = uMVP*vec4(aPos,1.0);',
  '}'
].join('\n');

var FRAG = [
  'precision mediump float;',
  'varying vec3 vNormal;',
  'varying vec3 vColor;',
  'uniform vec3 uLight;',
  'uniform float uAlpha;',
  'uniform float uSelected;',
  'void main(){',
  ' vec3 n=normalize(vNormal);',
  ' float d=max(dot(n,normalize(uLight)),0.0);',
  ' float light=0.45+0.55*d;',
  ' vec3 col=vColor*light;',
  ' col=mix(col,vec3(1.0,0.82,0.2),uSelected*0.5);',
  ' gl_FragColor=vec4(col,uAlpha);',
  '}'
].join('\n');

// 单位立方体（位置+法线，36 顶点，直接三角形）
function buildCube() {
  var faces = [
    { n: [0, 0, 1], v: [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]] },
    { n: [0, 0,-1], v: [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]] },
    { n: [1, 0, 0], v: [[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,-0.5,0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]] },
    { n: [-1,0, 0], v: [[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]] },
    { n: [0, 1, 0], v: [[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]] },
    { n: [0,-1, 0], v: [[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]] }
  ];
  var data = [];
  for (var f = 0; f < faces.length; f++) {
    for (var i = 0; i < 6; i++) {
      data.push(faces[f].v[i][0], faces[f].v[i][1], faces[f].v[i][2]);
      data.push(faces[f].n[0], faces[f].n[1], faces[f].n[2]);
    }
  }
  return new Float32Array(data);
}

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// 颜色名 → RGB（0~1）
var COLORS = {
  '米色':[0.85,0.78,0.65], '灰色':[0.55,0.56,0.59], '深蓝':[0.25,0.35,0.48],
  '深色':[0.28,0.31,0.35], '木色':[0.69,0.54,0.35], '白色':[0.90,0.90,0.88],
  '暖黄':[0.95,0.82,0.40], '灰纱':[0.62,0.60,0.56], '米白':[0.90,0.87,0.80],
  '默认':[0.55,0.65,0.72]
};
function colorOf(name) {
  if (COLORS[name]) return COLORS[name];
  for (var k in COLORS) if (name && name.indexOf(k) >= 0) return COLORS[k];
  return COLORS['默认'];
}

function createRoomRenderer(canvas, getScene) {
  var gl = canvas.getContext('webgl');
  if (!gl) return { ok: false, error: 'WEBGL_UNAVAILABLE' };

  var program;
  try {
    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getShaderInfoLog(program));
  } catch (e) {
    return { ok: false, error: 'SHADER_FAILED', message: e.message };
  }

  var cube = buildCube();
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, cube, gl.STATIC_DRAW);

  var loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aNormal: gl.getAttribLocation(program, 'aNormal'),
    uMVP: gl.getUniformLocation(program, 'uMVP'),
    uModel: gl.getUniformLocation(program, 'uModel'),
    uColor: gl.getUniformLocation(program, 'uColor'),
    uAlpha: gl.getUniformLocation(program, 'uAlpha'),
    uSelected: gl.getUniformLocation(program, 'uSelected'),
    uLight: gl.getUniformLocation(program, 'uLight')
  };

  var cam = { yaw: 0.7, pitch: -0.5, dist: 8, tx: 0, tz: 0 };
  var W = 300, H = 300;
  var selectedIndex = -1;
  var screenPoints = []; // 每件家具的屏幕投影中心，用于点选

  function resize(w, h) { W = w; H = h; gl.viewport(0, 0, W, H); }

  function drawBox(model, mvp, color, alpha, selected) {
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniformMatrix4fv(loc.uMVP, false, mvp);
    gl.uniform3fv(loc.uColor, color);
    gl.uniform1f(loc.uAlpha, alpha);
    gl.uniform1f(loc.uSelected, selected ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }

  function render() {
    var scene = getScene() || { room: null, furniture: [] };
    gl.clearColor(0.10, 0.13, 0.17, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 24, 12);
    gl.uniform3f(loc.uLight, 0.5, 1.0, 0.8);

    var eye = [
      cam.tx + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      -cam.dist * Math.sin(cam.pitch),
      cam.tz + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw)
    ];
    var proj = mat4.perspective(Math.PI / 4, W / H, 0.1, 100);
    var view = mat4.lookAt(eye, [cam.tx, 0.4, cam.tz], [0, 1, 0]);
    var vp = mat4.multiply(proj, view);

    var room = scene.room, rw = 6, rd = 5, rh = 2.8;
    if (room && room.width && room.depth) { rw = room.width; rd = room.depth; rh = room.height || 2.8; }

    // 地面
    var floorModel = mat4.multiply(mat4.translate(0, -0.05, 0), mat4.scale ? mat4.scale(rw, 0.1, rd) : scaleM(rw, 0.1, rd));
    drawBox(floorModel, mat4.multiply(vp, floorModel), [0.42, 0.40, 0.35], 1, false);

    // 两面墙（后墙、左墙）作为空间参照
    var backModel = mat4.multiply(mat4.translate(0, rh / 2 - 0.05, -rd / 2), scaleM(rw, rh, 0.08));
    drawBox(backModel, mat4.multiply(vp, backModel), [0.80, 0.82, 0.84], 0.55, false);
    var leftModel = mat4.multiply(mat4.translate(-rw / 2, rh / 2 - 0.05, 0), scaleM(0.08, rh, rd));
    drawBox(leftModel, mat4.multiply(vp, leftModel), [0.78, 0.80, 0.82], 0.4, false);

    // 家具
    screenPoints = [];
    var list = scene.furniture || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var w = (f.size && f.size.w) || 0.6, h = (f.size && f.size.h) || 0.6, d = (f.size && f.size.d) || 0.6;
      var px = (f.position && f.position.x) || 0, pz = (f.position && f.position.z) || 0;
      var py = h / 2 + ((f.position && f.position.y) || 0);
      var model = mat4.multiply(mat4.multiply(mat4.translate(px, py, pz), mat4.rotateY(f.rotation || 0)), scaleM(w, h, d));
      var mvp = mat4.multiply(vp, model);
      var color = colorOf(f.model || f.variant || '');
      var isCand = f.status === 'candidate';
      drawBox(model, mvp, color, isCand ? 0.5 : 1, i === selectedIndex);
      // 投影中心（简化：用模型矩阵作用于原点）
      var c = mat4.transformVec4(model, [0, 0, 0, 1]);
      var clip = mat4.transformVec4(vp, c);
      if (clip[3] > 0) {
        screenPoints.push({
          index: i,
          x: (clip[0] / clip[3] * 0.5 + 0.5) * W,
          y: (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * H
        });
      }
    }
  }

  // mat4 库未导出 scale，这里本地实现列主序缩放矩阵
  function scaleM(x, y, z) {
    return new Float32Array([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);
  }

  function pick(x, y) {
    var best = -1, bestD = 40 * 40; // 点击半径 40px
    for (var i = 0; i < screenPoints.length; i++) {
      var p = screenPoints[i], dx = p.x - x, dy = p.y - y, dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = p.index; }
    }
    selectedIndex = best;
    return best;
  }

  function orbit(dx, dy) {
    cam.yaw -= dx * 0.01;
    cam.pitch = Math.max(-1.2, Math.min(-0.05, cam.pitch + dy * 0.008));
  }
  function pan(dx, dy) {
    cam.tx -= dx * 0.01 * Math.cos(cam.yaw);
    cam.tz += dx * 0.01 * Math.sin(cam.yaw);
    cam.tz += dy * 0.01;
  }
  function zoom(delta) { cam.dist = Math.max(3, Math.min(20, cam.dist + delta * 0.01)); }
  function reset() { cam.yaw = 0.7; cam.pitch = -0.5; cam.dist = 8; cam.tx = 0; cam.tz = 0; selectedIndex = -1; }

  return {
    ok: true, render: render, resize: resize, pick: pick,
    orbit: orbit, pan: pan, zoom: zoom, reset: reset,
    getSelected: function () { return selectedIndex; },
    setSelected: function (i) { selectedIndex = i; }
  };
}

module.exports = { createRoomRenderer: createRoomRenderer, colorOf: colorOf };
