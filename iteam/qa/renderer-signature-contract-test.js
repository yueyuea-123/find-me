/**
 * renderer 方法签名契约测试（纯 Node，静态源码分析）
 *
 * 背景（评估报告 3D-02，阶段2a 已落地显式引用）：room3d 页原以 _safeGL('方法名', [实参])
 * 字符串反射调用 package3d/renderer.js，方法改名静态编译查不出。阶段2a 已改为
 * _withGL(function (gl) { return gl.方法名(实参); }) 显式调用；本测试继续兜底：
 *   1) renderer 返回对象的全部方法与形参数量逐一锁定；
 *   2) room3d 页所有 gl.<方法>(...) 显式调用的方法名必须存在于 renderer；
 *   3) 每个调用点的实参数必须与 renderer 形参数一致；
 *   4) 7 个高危方法（pick/dragDelta/previewMove/previewRotate/zoom/orbit/projectAll）单列锁定；
 *   5) 页面不得残留字符串反射调用点（_safeGL 仅保留为 qa 探针适配器）。
 * 用法: node qa/renderer-signature-contract-test.js
 */
const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..', 'miniprogram');
const rendererSrc = fs.readFileSync(path.join(MP, 'package3d', 'renderer.js'), 'utf8');
const room3dSrc = fs.readFileSync(path.join(MP, 'pages', 'room3d', 'room3d.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}

// ---------- 1. 提取 createRoomRenderer 返回对象的方法签名 ----------
const retStart = rendererSrc.indexOf('  return {');
const retEnd = rendererSrc.indexOf('module.exports');
ok(retStart !== -1 && retEnd !== -1 && retStart < retEnd, 'renderer.js 可定位返回对象区块');
if (retStart === -1 || retEnd === -1 || retStart >= retEnd) {
  console.log(fail + '/' + (pass + fail) + ' passed');
  process.exit(1);
}
const returnBlock = rendererSrc.slice(retStart, retEnd);

// 形如 "    name: function (a, b) {" 的方法定义（返回对象内统一 4 空格缩进）
const methodRe = /^\s{4}([A-Za-z_$][\w$]*):\s*function\s*\(([^)]*)\)\s*\{/gm;
const rendererMethods = {}; // name -> 形参数
let m;
while ((m = methodRe.exec(returnBlock)) !== null) {
  const params = m[2].trim();
  rendererMethods[m[1]] = params === '' ? 0 : params.split(',').length;
}

// ---------- 2. 全量方法与形参数量锁定 ----------
const EXPECTED = {
  resize: 2, render: 0, projectAll: 0, pick: 2, orbit: 2, pan: 2,
  dragDelta: 2, previewMove: 3, previewRotate: 2, previewScale: 2,
  zoom: 1, reset: 0, fit: 0, setPreset: 1, setSelected: 1
};
for (const name of Object.keys(EXPECTED)) {
  const actual = rendererMethods[name];
  ok(actual !== undefined,
    'renderer 提供 ' + name + ' 方法',
    actual === undefined ? '未找到（返回对象方法集：' + Object.keys(rendererMethods).join(',') + '）' : '');
  if (actual !== undefined) {
    ok(actual === EXPECTED[name],
      name + ' 形参数锁定为 ' + EXPECTED[name],
      '实际 ' + actual);
  }
}
const unexpected = Object.keys(rendererMethods).filter(n => !(n in EXPECTED));
ok(unexpected.length === 0,
  '返回对象无未登记的新增方法（防签名漂移未入契约）',
  unexpected.length ? '新增未登记：' + unexpected.join(',') : '');

// ---------- 3. room3d 全部 gl.<方法>(...) 显式调用点 → renderer 方法存在性 ----------
// 提取 gl.name( 后的平衡括号内容，数顶层逗号得到实参数
function extractGlCalls(src) {
  const calls = [];
  const re = /\bgl\.([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth !== 0) continue; // 括号不平衡（异常源码），跳过
    const argsText = src.slice(start, i - 1).trim();
    let argc = 0;
    if (argsText !== '') {
      let d = 0, count = 1;
      for (const ch of argsText) {
        if (ch === '(' || ch === '[' || ch === '{') d++;
        else if (ch === ')' || ch === ']' || ch === '}') d--;
        else if (ch === ',' && d === 0) count++;
      }
      argc = count;
    }
    calls.push({ name: m[1], argc: argc, raw: m[0] });
  }
  return calls;
}
const calls = extractGlCalls(room3dSrc);
ok(calls.length > 0, 'room3d 存在 gl.<方法> 显式调用点（共 ' + calls.length + ' 处）');

const calledNames = [...new Set(calls.map(c => c.name))];
for (const name of calledNames) {
  ok(rendererMethods[name] !== undefined,
    '页面调用 renderer.' + name + ' 在渲染器中存在（' + calls.filter(c => c.name === name).length + ' 处调用）',
    'renderer 未定义该方法，运行时将触发 catch 降级列表');
}

// ---------- 4. 调用点实参数 ↔ renderer 形参数 ----------
for (const c of calls) {
  const expected = rendererMethods[c.name];
  if (expected === undefined) continue; // 已在第 3 组报 FAIL
  ok(c.argc === expected,
    'renderer.' + c.name + ' 实参数与形参数一致',
    '调用传 ' + c.argc + ' 参，renderer 声明 ' + expected + ' 参');
}

// ---------- 5. 7 个高危方法单列锁定（评估报告 3D-02 P0） ----------
const HIGH_RISK = { pick: 2, dragDelta: 2, previewMove: 3, previewRotate: 2, zoom: 1, orbit: 2, projectAll: 0 };
for (const name of Object.keys(HIGH_RISK)) {
  ok(rendererMethods[name] === HIGH_RISK[name],
    '高危方法 ' + name + ' 签名锁定（' + HIGH_RISK[name] + ' 参）',
    '实际 ' + rendererMethods[name]);
  ok(calledNames.indexOf(name) !== -1,
    '高危方法 ' + name + ' 仍被页面显式调用（契约持续生效）',
    '页面已不再调用：应同步更新本测试的契约清单');
}

// ---------- 6. 显式引用已落地，字符串反射调用点清零 ----------
ok(/_withGL: function/.test(room3dSrc), 'room3d 存在 _withGL 显式调用封装（阶段2a）');
const reflectCalls = (room3dSrc.match(/\._safeGL\(\s*'/g) || []).length;
ok(reflectCalls === 0,
  '页面无残留 _safeGL 字符串反射调用点',
  '残留 ' + reflectCalls + ' 处（页面代码应走 _withGL；_safeGL 仅保留为 qa 探针适配器）');

// ---------- 6.5 渲染锁只经 GLLifecycle 管理（阶段2d，评估 3D-03） ----------
const glLifecycleSrc = fs.readFileSync(path.join(MP, 'pages', 'room3d', 'gl-lifecycle.js'), 'utf8');
ok(/reset: function|unlockInit: function/.test(glLifecycleSrc), 'gl-lifecycle.js 管理器存在（reset/unlockInit/beginInit/setCanvas/attachRenderer）');
const directLock = (room3dSrc.match(/[.\w]\s*_gl(?:Renderer|Canvas|InitStarted)\s*=\s*[^=]/g) || []).length;
ok(directLock === 0,
  'room3d 页无渲染锁直接赋值（三把锁全部经 glLifecycle）',
  '残留 ' + directLock + ' 处直接赋值：应改走 glLifecycle.reset/unlockInit/beginInit/setCanvas/attachRenderer');
ok(/glLifecycle\.require|require\('\.\/gl-lifecycle\.js'\)/.test(room3dSrc), 'room3d 引入 gl-lifecycle 模块');

// ---------- 7. module.exports 面不变 ----------
ok(/module\.exports\s*=\s*\{[^}]*createRoomRenderer/.test(rendererSrc),
  'renderer.js 对外导出 createRoomRenderer');
ok(/module\.exports\s*=\s*\{[^}]*CATEGORY_TO_GLB/.test(rendererSrc),
  'renderer.js 对外导出 CATEGORY_TO_GLB');

console.log('');
console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail === 0 ? 0 : 1);
