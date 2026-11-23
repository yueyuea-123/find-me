// 真机资产打包回归测试（纯 Node，无需开发者工具）
// 背景：真机打开三维房间只显示地板、没有家具。根因是开发者工具的
// "过滤无依赖文件"默认开启，而 GLB / manifest 通过 fs.readFileSync
// 动态拼路径读取、没有静态 require，被判定为无依赖文件从真机包剔除；
// 模拟器直接读本地目录，因此从未复现。
// 本用例锁住三项防回归：开发阶段过滤关闭、上传阶段过滤关闭、资产目录强制 include。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + ' -> ' + e.message); fail++; }
}
function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

t('开发阶段不过滤无依赖文件（预览/真机调试保留 GLB）', function () {
  const cfg = readJSON('project.private.config.json');
  if (cfg.setting.ignoreDevUnusedFiles !== false) {
    throw new Error('ignoreDevUnusedFiles 应为 false，当前=' + cfg.setting.ignoreDevUnusedFiles);
  }
});

t('上传阶段不过滤无依赖文件（体验版/线上保留 GLB）', function () {
  const cfg = readJSON('project.config.json');
  if (cfg.setting.ignoreUploadUnusedFiles !== false) {
    throw new Error('ignoreUploadUnusedFiles 应为 false，当前=' + cfg.setting.ignoreUploadUnusedFiles);
  }
});

t('资产目录已加入 packOptions.include 强制打包', function () {
  const cfg = readJSON('project.config.json');
  const inc = (cfg.packOptions && cfg.packOptions.include) || [];
  const hit = inc.some(function (x) {
    return x.type === 'folder' && /package3d\/assets\/furniture\/?$/.test(x.value);
  });
  if (!hit) throw new Error('未找到 package3d/assets/furniture 的强制打包规则');
});

t('manifest 声明的 GLB 全部存在于本地资产目录', function () {
  const mf = path.join(root, 'miniprogram', 'package3d', 'assets', 'furniture', 'manifest.json');
  const items = JSON.parse(fs.readFileSync(mf, 'utf8')).items;
  if (!items || items.length !== 8) throw new Error('manifest 资产数应为 8，当前=' + (items || []).length);
  items.forEach(function (it) {
    if (!fs.existsSync(path.join(path.dirname(mf), it.file))) throw new Error('缺少资产文件 ' + it.file);
  });
});

t('渲染器资产路径含多候选且错误会回传页面', function () {
  const code = fs.readFileSync(path.join(root, 'miniprogram', 'package3d', 'renderer.js'), 'utf8');
  if (code.indexOf('BASE_CANDIDATES') < 0) throw new Error('缺少多候选路径');
  if (code.indexOf('MANIFEST_MISSING') < 0 || code.indexOf('GLB_READ_FAILED') < 0) throw new Error('缺少资产错误分类');
  if (code.indexOf('onAssetError') < 0) throw new Error('未把资产错误回传页面');
});

console.log('\n结果 ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
