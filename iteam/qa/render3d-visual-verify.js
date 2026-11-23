/**
 * 三维娃娃屋场景浏览器验证：真实 package3d/renderer.js + 8 件 GLB + SwiftShader。
 * 用 mock 小程序运行时打开 preview/mp-test/verify.html，检查 WebGL 确实绘出场景、
 * 拾取接口可用，并输出截图供人工比对。
 *
 * 运行: node qa/render3d-visual-verify.js
 * 环境: macOS 本机 Chrome（可用 CHROME 环境变量覆盖），无需真实微信开发者工具。
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9361;
const HTTP_PORT = 9362;
const PAGE = 'http://127.0.0.1:' + HTTP_PORT + '/mp-test/verify.html';
const SHOT = process.env.SHOT || '/tmp/render3d-visual.png';

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, r => {
      let b = '';
      r.on('data', d => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); }
  static async connect(u) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(u), s = new CDP(ws);
      ws.onopen = () => res(s); ws.onerror = rej;
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && s.p.has(m.id)) {
          const { r, j } = s.p.get(m.id); s.p.delete(m.id);
          m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
        }
      };
    });
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(e) {
    const r = await this.cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL:' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function chk(name, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' — ' + detail : ''));
  cond ? pass++ : fail++;
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--directory', path.join(ROOT, 'preview')], { stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'render3d-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
    '--window-size=1280,900', PAGE
  ], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 60; i++) {
      try { const list = await getJSON('/json/list'); target = list.find(x => x.type === 'page' && x.url.includes('verify.html')); if (target) break; } catch (e) {}
      await sleep(200);
    }
    if (!target) throw new Error('Chrome 未加载 mock 页');
    const c = await CDP.connect(target.webSocketDebuggerUrl);
    await c.cmd('Runtime.enable'); await c.cmd('Page.enable');
    await sleep(700);
    for (let i = 0; i < 50; i++) { if (await c.eval('!!window.__ready || !!window.__error')) break; await sleep(200); }

    const err = await c.eval('window.__error || null');
    chk('渲染初始化无异常', !err, err || '');
    const log = await c.eval("(document.getElementById('log') || { textContent: 'NO_LOG' }).textContent");
    chk('createRoomRenderer 返回 ok', /createRoomRenderer: \{"ok":true/.test(log));
    chk('8 件 GLB 资产全部就绪', /资源就绪: 8 个 GLB/.test(log));

    const picks = [...log.matchAll(/pick\((\d+),(\d+)\): (\d+|null)/g)].map(m => m[3]);
    chk('拾取接口可命中家具', picks.length > 0 && picks.some(x => x !== 'null'), JSON.stringify(picks));

    await c.cmd('Page.captureScreenshot', { format: 'png' })
      .then(r => fs.writeFileSync(SHOT, Buffer.from(r.data, 'base64')));
    console.log('截图: ' + SHOT);

    // 画面非空：WebGL 默认帧缓冲 readPixels 在 headless 下不可靠，改从截图统计颜色层次。
    // 纯色背景或整片过曝的场景颜色数都很少，过不了这一关。
    const Jimp = require('jimp');
    const img = await Jimp.read(SHOT);
    img.crop(0, 0, Math.min(1100, img.bitmap.width), Math.min(760, img.bitmap.height));
    const set = new Set();
    img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
      const d = this.bitmap.data;
      set.add((d[idx] >> 3) + ',' + (d[idx + 1] >> 3) + ',' + (d[idx + 2] >> 3));
    });
    chk('截图场景有层次（颜色数 > 60）', set.size > 60, 'colors=' + set.size);
  } catch (e) {
    console.log('ERROR ' + e.message); fail++;
  } finally {
    chrome.kill('SIGKILL'); server.kill('SIGKILL');
  }
  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
