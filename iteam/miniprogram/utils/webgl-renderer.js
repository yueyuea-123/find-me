// 原生 WebGL 渲染器：一个带光照的占位立方体，可旋转/缩放/点选
// 用途：三维技术可行性验证载体，仅验证渲染与交互能力，不进正式产品代码

var mat4 = require('./mat4.js');

var VS = [
  'attribute vec3 aPos;',
  'attribute vec3 aNormal;',
  'attribute vec3 aColor;',
  'uniform mat4 uMVP;',
  'uniform mat4 uModel;',
  'varying vec3 vNormal;',
  'varying vec3 vColor;',
  'void main() {',
  '  vNormal = mat3(uModel) * aNormal;',
  '  vColor = aColor;',
  '  gl_Position = uMVP * vec4(aPos, 1.0);',
  '}'
].join('\n');

var FS = [
  'precision mediump float;',
  'varying vec3 vNormal;',
  'varying vec3 vColor;',
  'uniform vec3 uLight;',
  'uniform float uSelected;',
  'void main() {',
  '  vec3 n = normalize(vNormal);',
  '  float d = max(dot(n, normalize(uLight)), 0.0);',
  '  float light = 0.35 + 0.65 * d;',
  '  vec3 col = vColor * light;',
  '  col = mix(col, vec3(1.0, 0.85, 0.2), uSelected * 0.45);',
  '  gl_FragColor = vec4(col, 1.0);',
  '}'
].join('\n');

// 立方体：每面 4 顶点（位置3 + 法线3 + 颜色3）
function buildCube() {
  var faces = [
    { n: [0, 0, 1], c: [0.85, 0.35, 0.30], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], c: [0.30, 0.60, 0.85], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { n: [1, 0, 0], c: [0.35, 0.75, 0.45], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { n: [-1, 0, 0], c: [0.85, 0.70, 0.30], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, 1, 0], c: [0.65, 0.45, 0.85], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], c: [0.45, 0.45, 0.50], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] }
  ];
  var data = [];
  var indices = [];
  for (var f = 0; f < faces.length; f++) {
    var face = faces[f];
    for (var i = 0; i < 4; i++) {
      data.push.apply(data, face.v[i]);
      data.push.apply(data, face.n);
      data.push.apply(data, face.c);
    }
    var o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  return { vertices: new Float32Array(data), indices: new Uint16Array(indices) };
}

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    var msg = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('shader compile failed: ' + msg);
  }
  return s;
}

function createRenderer(canvas) {
  var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return { error: 'WEBGL_UNAVAILABLE' };

  var program;
  try {
    var vs = compile(gl, gl.VERTEX_SHADER, VS);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('program link failed: ' + gl.getProgramInfoLog(program));
    }
  } catch (e) {
    return { error: 'SHADER_FAILED', message: e.message };
  }

  var cube = buildCube();
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, cube.vertices, gl.STATIC_DRAW);
  var ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);

  var loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aNormal: gl.getAttribLocation(program, 'aNormal'),
    aColor: gl.getAttribLocation(program, 'aColor'),
    uMVP: gl.getUniformLocation(program, 'uMVP'),
    uModel: gl.getUniformLocation(program, 'uModel'),
    uLight: gl.getUniformLocation(program, 'uLight'),
    uSelected: gl.getUniformLocation(program, 'uSelected')
  };

  var state = { rotX: -0.45, rotY: 0.6, zoom: 3.2, selected: false };
  var viewW = 300, viewH = 300;
  var corners = [];
  var x0 = -0.5, x1 = 0.5, y0 = -0.5, y1 = 0.5, z0 = -0.5, z1 = 0.5;
  for (var xi = 0; xi < 2; xi++) {
    for (var yi = 0; yi < 2; yi++) {
      for (var zi = 0; zi < 2; zi++) {
        corners.push([xi ? x1 : x0, yi ? y1 : y0, zi ? z1 : z0]);
      }
    }
  }

  var info = {
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION)
  };

  function resize(cssW, cssH, dpr) {
    viewW = cssW; viewH = cssH;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function modelMatrix() {
    return mat4.multiply(mat4.rotateY(state.rotY), mat4.rotateX(state.rotX));
  }

  function draw() {
    var aspect = viewW / (viewH || 1);
    var proj = mat4.perspective(Math.PI / 4, aspect, 0.1, 100);
    var view = mat4.lookAt([0, 0, state.zoom], [0, 0, 0], [0, 1, 0]);
    var model = modelMatrix();
    var mvp = mat4.multiply(proj, mat4.multiply(view, model));

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.07, 0.08, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    var stride = 9 * 4;
    gl.enableVertexAttribArray(loc.aPos);
    gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(loc.aNormal);
    gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(loc.aColor);
    gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, stride, 6 * 4);

    gl.uniformMatrix4fv(loc.uMVP, false, mvp);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniform3f(loc.uLight, 0.4, 0.8, 1.0);
    gl.uniform1f(loc.uSelected, state.selected ? 1 : 0);
    gl.drawElements(gl.TRIANGLES, cube.indices.length, gl.UNSIGNED_SHORT, 0);
  }

  // 屏幕坐标命中检测（CSS 像素 → 投影包围盒）
  function hitTest(x, y) {
    var aspect = viewW / (viewH || 1);
    var proj = mat4.perspective(Math.PI / 4, aspect, 0.1, 100);
    var view = mat4.lookAt([0, 0, state.zoom], [0, 0, 0], [0, 1, 0]);
    var mvp = mat4.multiply(proj, mat4.multiply(view, modelMatrix()));
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var i = 0; i < corners.length; i++) {
      var c = mat4.transformVec4(mvp, [corners[i][0], corners[i][1], corners[i][2], 1]);
      if (c[3] <= 0) continue;
      var sx = (c[0] / c[3] * 0.5 + 0.5) * viewW;
      var sy = (1 - (c[1] / c[3] * 0.5 + 0.5)) * viewH;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  function reset() { state.rotX = -0.45; state.rotY = 0.6; state.zoom = 3.2; state.selected = false; }

  return { gl: gl, info: info, state: state, resize: resize, draw: draw, hitTest: hitTest, reset: reset };
}

module.exports = { createRenderer: createRenderer };
