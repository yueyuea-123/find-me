/* 视觉对比稿验证：静态结构 + Chrome 无头交互验证
   运行：node verify.js
   口径：以 iteam/demo 为原型，检查首页户型总览、三维编辑交互、物品详情操作、
         A/B 双方案信息结构一致，以及「并排 / 只看 A / 只看 B」切换仍可用。*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const FILE = path.join(__dirname, 'index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9344;
const URL = 'file://' + FILE;
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new CDP(ws);
      ws.onopen = () => resolve(c);
      ws.onerror = reject;
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && c.pending.has(m.id)) {
          const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id);
          m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
        }
      };
    });
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

(async () => {
  const html = fs.readFileSync(FILE, 'utf8');
  // A. 静态结构与口径
  check('文件为自包含单页（无外部脚本/样式依赖）', !/<script[^>]+src=|<link[^>]+stylesheet/.test(html));
  check('顶部与页脚均以 demo 为原型口径', (html.match(/demo 原型（15 页讲解口径）/g) || []).length >= 2);
  check('保留 A/B 双方案与视图切换', html.includes('theme-a') && html.includes('theme-b') && html.includes('id="viewSeg"'));
  check('三代表页均保留 A/B 两套', (html.match(/class="slot phone-a"/g) || []).length === 3 && (html.match(/class="slot phone-b"/g) || []).length === 3);
  // 首页
  check('首页统计对齐 demo（3/5/2/1）', (html.match(/<div class="n">3<\/div><div class="l">房间<\/div>/g) || []).length === 2
    && (html.match(/<div class="n">5<\/div><div class="l">物品<\/div>/g) || []).length === 2
    && (html.match(/<div class="n">2<\/div><div class="l">库存<\/div>/g) || []).length === 2
    && (html.match(/<div class="n">1<\/div><div class="l">提醒<\/div>/g) || []).length === 2);
  check('首页含户型总览且位于提醒前', (html.match(/户型总览/g) || []).length >= 2
    && html.indexOf('户型总览') < html.indexOf('<div class="remind"'));
  check('户型含三房间与示意说明', html.includes('主卧') && html.includes('客厅') && html.includes('卫生间') && html.includes('墙线为示意，不承诺测量精度'));
  check('首页提醒对齐 demo（1 项 / 洗发水）', (html.match(/1 项库存提醒/g) || []).length === 2 && (html.match(/洗发水剩 1 瓶/g) || []).length === 2);
  // 三维房间
  check('三维标题与画布提示对齐 demo', (html.match(/<div class="ab-title">三维房间<\/div>/g) || []).length === 2
    && (html.match(/拖动摆放 · 长按删除 · 点击进入添加物品/g) || []).length === 2);
  check('三维编辑动作为移动/旋转/缩放', (html.match(/>移动<\/div><div class="btn tiny">旋转<\/div><div class="btn tiny">缩放<\/div>/g) || []).length === 2);
  check('三维含家具模型库与越界口径', (html.match(/家具模型库/g) || []).length === 2
    && (html.match(/越界自动钳制到房间范围与合理尺寸上下限，不产生非法布局。/g) || []).length === 2);
  // 物品详情
  check('物品详情路径对齐 demo（床头柜/上层抽屉）', (html.match(/床头柜<span class="sep">\/<\/span>上层抽屉/g) || []).length === 2);
  check('状态项对齐 demo 四种口径', (html.match(/>在家<\/span>/g) || []).length === 2
    && (html.match(/>位置未知<\/span>/g) || []).length === 2
    && (html.match(/>外出携带<\/span>/g) || []).length === 2);
  check('详情页无库存操作且底部为返回物品列表', !html.includes('>库存<svg class="chev"')
    && (html.match(/<div class="btn primary">返回物品列表<\/div>/g) || []).length === 2);

  // B. Chrome 交互验证
  if (!fs.existsSync(CHROME)) { console.error('未找到 Chrome：' + CHROME); process.exit(2); }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'design-compare-verify-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1440,1000', URL
  ], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 60; i++) {
      try { const list = await getJSON('/json/list'); target = list.find(t => t.type === 'page' && t.url.includes('index.html')); if (target) break; } catch (e) {}
      await sleep(200);
    }
    if (!target) throw new Error('Chrome 未能加载视觉对比稿');
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.cmd('Runtime.enable'); await sleep(300);
    check('浏览器渲染：6 个手机屏', await cdp.eval(`document.querySelectorAll('.phone').length`) === 6);
    check('浏览器渲染：户型房间 A/B 共 6 个', await cdp.eval(`document.querySelectorAll('.fp-room').length`) === 6);
    check('视图切换：只看 A', await cdp.eval(`(function(){document.querySelector('[data-v="a"]').click();var a=getComputedStyle(document.querySelector('.phone-a')).display,b=getComputedStyle(document.querySelector('.phone-b')).display;return a!=='none'&&b==='none'})()`));
    check('视图切换：只看 B', await cdp.eval(`(function(){document.querySelector('[data-v="b"]').click();var a=getComputedStyle(document.querySelector('.phone-a')).display,b=getComputedStyle(document.querySelector('.phone-b')).display;return a==='none'&&b!=='none'})()`));
    check('视图切换：并排对比恢复', await cdp.eval(`(function(){document.querySelector('[data-v="both"]').click();var a=getComputedStyle(document.querySelector('.phone-a')).display,b=getComputedStyle(document.querySelector('.phone-b')).display;return a!=='none'&&b!=='none'})()`));
  } finally {
    chrome.kill('SIGTERM');
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exit(1);
})().catch(err => { console.error(err); process.exit(1); });
