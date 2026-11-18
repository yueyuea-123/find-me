// 极简 4x4 矩阵库（列主序，与 WebGL 一致）
// 仅实现验证 Demo 所需的变换，非通用库

function identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

function perspective(fovy, aspect, near, far) {
  var f = 1 / Math.tan(fovy / 2);
  var nf = 1 / (near - far);
  var out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  out[15] = 0;
  return out;
}

function lookAt(eye, center, up) {
  var z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  var x = normalize(cross(up, z));
  var y = cross(z, x);
  var out = new Float32Array(16);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye); out[15] = 1;
  return out;
}

// out = a * b
function multiply(a, b) {
  var out = new Float32Array(16);
  for (var col = 0; col < 4; col++) {
    for (var row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function rotateX(a) {
  var c = Math.cos(a), s = Math.sin(a);
  var out = identity();
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}

function rotateY(a) {
  var c = Math.cos(a), s = Math.sin(a);
  var out = identity();
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

function translate(x, y, z) {
  var out = identity();
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

// 返回 m * v，v 为长度 4 的数组
function transformVec4(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3]
  ];
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v) {
  var l = Math.sqrt(dot(v, v)) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

module.exports = {
  identity: identity,
  perspective: perspective,
  lookAt: lookAt,
  multiply: multiply,
  rotateX: rotateX,
  rotateY: rotateY,
  translate: translate,
  transformVec4: transformVec4
};
