/**
 * renderer 方法签名契约测试（纯 Node，静态源码分析）
 *
 * 背景（评估报告 3D-02）：room3d 页通过 _safeGL('方法名', [实参]) 以字符串反射调用
 * package3d/renderer.js 暴露的 7+ 个方法。_safeGL 内部对不存在的方法静默返回 null
 * （typeof 检查），方法被改名或参数错位时静态编译查不出，运行时才退化为
 * "三维异常已切换列表"。本测试把"页面调用 ↔ 渲染器实现"的双向契约固化为可执行断言：
 *   1) renderer 返回对象的全部方法与形参数量逐一锁定；
 *   2) room3d 页所有 _safeGL 调用的方法名必须存在于 renderer；
 *   3) 每个调用点的实参数必须与 renderer 形参数一致；
 *   4) 7 个高危反射方法（pick/dragDelta/previewMove/previewRotate/zoom/orbit/projectAll）单列锁定。
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

// ---------- 3. room3d 全部 _safeGL 调用点 → renderer 方法存在性 ----------
const callRe = /_safeGL\(\s*'([A-Za-z_$][\w$]*)'\s*(?:,\s*\[([^\]]*)\])?\s*\)/g;
const calls = []; // {name, argc, raw}
while ((m = callRe.exec(room3dSrc)) !== null) {
  const argsStr = m[2];
  let argc = null;
  if (argsStr !== undefined && !/[[\]]/.test(argsStr)) {
    argc = argsStr.trim() === '' ? 0 : argsStr.split(',').filter(s => s.trim() !== '').length;
  }
  calls.push({ name: m[1], argc: argc, raw: m[0] });
}
ok(calls.length > 0, 'room3d 存在 _safeGL 反射调用点（共 ' + calls.length + ' 处）');

const calledNames = [...new Set(calls.map(c => c.name))];
for (const name of calledNames) {
  ok(rendererMethods[name] !== undefined,
    '页面调用 renderer.' + name + ' 在渲染器中存在（' + calls.filter(c => c.name === name).length + ' 处调用）',
    'renderer 未定义该方法，运行时将静默返回 null');
}

// ---------- 4. 调用点实参数 ↔ renderer 形参数 ----------
for (const c of calls) {
  if (c.argc === null) continue; // 实参含嵌套括号时跳过计数，交由人工复核
  const expected = rendererMethods[c.name];
  if (expected === undefined) continue; // 已在第 3 组报 FAIL
  ok(c.argc === expected,
    'renderer.' + c.name + ' 实参数与形参数一致',
    '调用传 ' + c.argc + ' 参，renderer 声明 ' + expected + ' 参');
}

// ---------- 5. 7 个高危反射方法单列锁定（评估报告 3D-02 P0） ----------
const HIGH_RISK = { pick: 2, dragDelta: 2, previewMove: 3, previewRotate: 2, zoom: 1, orbit: 2, projectAll: 0 };
for (const name of Object.keys(HIGH_RISK)) {
  ok(rendererMethods[name] === HIGH_RISK[name],
    '高危方法 ' + name + ' 签名锁定（' + HIGH_RISK[name] + ' 参）',
    '实际 ' + rendererMethods[name]);
  ok(calledNames.indexOf(name) !== -1,
    '高危方法 ' + name + ' 仍被页面反射调用（契约持续生效）',
    '页面已不再调用：应同步更新本测试的契约清单');
}

// ---------- 6. _safeGL 静默失败守卫存在性（说明为何必须静态契约兜底） ----------
ok(/typeof this\._glRenderer\[[^\]]+\]\s*!==\s*'function'/.test(room3dSrc),
  '_safeGL 对未知方法静默返回 null（证实反射不可静态发现，契约测试为必要兜底）');

// ---------- 7. module.exports 面不变 ----------
ok(/module\.exports\s*=\s*\{[^}]*createRoomRenderer/.test(rendererSrc),
  'renderer.js 对外导出 createRoomRenderer');
ok(/module\.exports\s*=\s*\{[^}]*CATEGORY_TO_GLB/.test(rendererSrc),
  'renderer.js 对外导出 CATEGORY_TO_GLB');

console.log('');
console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail === 0 ? 0 : 1);
