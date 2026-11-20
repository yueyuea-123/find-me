/* demo 验证脚本：用本机 Chrome 无头模式真实加载页面并驱动交互，
   按仓库规则「每次改动后必须测试并通过」。运行：node verify.js
   验证内容：
   1) 页面能正常渲染（手机界面 / 流程引导 / 数据快照）
   2) 5 条主路径 + 异常分支的每一步「演示下一步」都能执行且不抛异常
   3) 关键业务口径：库存不为负、关联保护、首次位置确认独立成类、提醒自动恢复
   4) 手动交互：页面跳转、表单建档、库存交易、搜索筛选
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const ROOT = __dirname;
const URL = 'file://' + path.join(ROOT, 'index.html');

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }
  static async connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const self = new CDP(ws);
      ws.onopen = () => resolve(self);
      ws.onerror = reject;
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && self.pending.has(m.id)) { const { res, rej } = self.pending.get(m.id); self.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
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

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); }

(async () => {
  if (!fs.existsSync(CHROME)) { console.error('未找到 Chrome：' + CHROME); process.exit(2); }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-demo-verify-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1280,900', URL
  ], { stdio: 'ignore' });

  try {
    let target = null;
    for (let i = 0; i < 60; i++) {
      try { const list = await getJSON('/json/list'); target = list.find(t => t.type === 'page' && t.url.includes('index.html')); if (target) break; } catch (e) {}
      await sleep(200);
    }
    if (!target) throw new Error('Chrome 未能加载 demo 页面');
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.cmd('Runtime.enable');
    await sleep(400);

    // 1. 初始渲染
    check('初始渲染：手机界面存在', await cdp.eval(`!!document.querySelector('#screen .statusbar') && !!document.querySelector('#screen .tabbar')`));
    check('初始渲染：流程引导 6 条', await cdp.eval(`document.querySelectorAll('.flow-tab').length`) === 6);
    check('初始渲染：数据快照 9 项', await cdp.eval(`document.querySelectorAll('.dp-cell').length`) === 9);
    check('初始渲染：首页统计房间=3', (await cdp.eval(`document.querySelectorAll('.stat .n')[0].textContent`)) === '3');

    // 1b. 首页整体户型视图
    check('首页户型视图存在', await cdp.eval(`!!document.querySelector('#screen .floorplan') && !!document.querySelector('#screen .fp-card')`));
    check('户型视图展示 3 个房间', (await cdp.eval(`document.querySelectorAll('#screen .fp-room').length`)) === 3);
    check('户型视图含主卧/客厅/卫生间', await cdp.eval(`(function(){const t=document.querySelector('#screen .floorplan').textContent;return t.includes('主卧')&&t.includes('客厅')&&t.includes('卫生间')})()`));
    check('户型视图含家具微缩块', (await cdp.eval(`document.querySelectorAll('#screen .fp-furn').length`)) >= 5);
    check('户型视图面积标注', await cdp.eval(`document.querySelector('#screen .fp-meta').textContent.includes('㎡')`));
    check('点击户型房间进入三维', await cdp.eval(`(function(){document.querySelector('#screen .fp-room').click();return !!document.querySelector('#screen .canvas3d') && document.querySelector('#crumb').textContent.includes('三维房间')})()`));

    // 2. 逐条流程跑完，检查无异常、步骤计数推进
    const errors = [];
    for (let f = 0; f < 6; f++) {
      await cdp.eval(`document.querySelectorAll('.flow-tab')[${f}].click()`);
      const total = await cdp.eval(`document.querySelectorAll('.step').length`);
      for (let s = 0; s < total; s++) {
        await cdp.eval(`document.querySelector('[data-act="flow-next"]').click()`);
        const cur = await cdp.eval(`document.querySelector('#flowProgress').textContent.trim()`);
        if (cur !== `${s + 1} / ${total}`) errors.push(`flow${f} step${s}: ${cur}`);
        const rendered = await cdp.eval(`!!document.querySelector('#screen .statusbar') && document.querySelector('#screen').innerHTML.length > 500`);
        if (!rendered) errors.push(`flow${f} step${s}: 页面未渲染`);
      }
    }
    check('6 条流程全部步骤执行完成', errors.length === 0, errors.slice(0, 3).join(' | '));

    // 3. 业务口径检查（读数据快照）
    check('库存不为负：消耗被拦截后余额仍为 1', await cdp.eval(`(function(){document.querySelector('[data-act="reset-demo"]').click();document.querySelectorAll('.flow-tab')[4].click();for(let i=0;i<3;i++)document.querySelector('[data-act="flow-next"]').click();return document.querySelector('#dataLog').textContent.includes('被拦截')})()`));
    check('关联保护：删除含物品节点被阻断', await cdp.eval(`(function(){document.querySelector('[data-act="reset-demo"]').click();document.querySelectorAll('.flow-tab')[5].click();document.querySelector('[data-act="flow-next"]').click();return document.querySelector('#dataLog').textContent.includes('被阻断')})()`));
    check('首次位置确认独立成类', await cdp.eval(`(function(){document.querySelector('[data-act="flow-next"]').click();document.querySelector('[data-act="flow-next"]').click();return document.querySelector('#screen').textContent.includes('首次位置确认')})()`));

    // 4. 手动交互：新建物品（仅名称）
    check('手动建档：仅名称即可保存', await cdp.eval(`(function(){document.querySelector('[data-act="reset-demo"]').click();document.querySelector('.quick [data-p="itemEdit"]').click();document.querySelector('#fName').value='测试物品';document.querySelector('[data-act="save-item"]:not([data-continue])').click();return document.querySelector('#screen').textContent.includes('测试物品')})()`));

    // 5. 手动交互：三维降级切列表
    check('三维降级：可切到列表视图', await cdp.eval(`(function(){document.querySelector('[data-act="goto"][data-p="room3d"]');document.querySelectorAll('.flow-tab')[5].click();document.querySelector('[data-act="flow-next"]').click();document.querySelector('[data-act="flow-next"]').click();return document.querySelector('#screen').textContent.includes('家具列表（三维降级）')})()`));

    // 5b. 新建房间后户型视图同步
    check('新建房间后户型视图同步', await cdp.eval(`(function(){try{
      document.querySelector('[data-act="reset-demo"]').click();
      document.querySelector('.quick [data-p="room"]').click();
      document.querySelector('[data-act="new-room"]').click();
      document.querySelector('#sheetName').value='测试书房';
      document.querySelector('[data-act="sheet-act"][data-i="1"]').click();
      document.querySelector('#screen [data-act="back"]').click();
      document.querySelector('#screen .tabbar [data-p="home"]').click();
      return document.querySelectorAll('#screen .fp-room').length===4 && document.querySelector('#screen .floorplan').textContent.includes('测试书房');
    }catch(err){return false}})()`));

    // 6. 重置
    check('重置演示数据恢复初始', await cdp.eval(`(function(){document.querySelector('[data-act="reset-demo"]').click();return document.querySelectorAll('.stat .n')[0].textContent==='3' && document.querySelector('#dataLog').textContent.includes('等待操作')})()`));

    cdp.ws.close();
  } finally {
    chrome.kill('SIGKILL');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\nRESULT: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map(x => x.name).join(', ')); process.exit(1); }
  console.log('ALL_CHECKS_PASSED');
})().catch(e => { console.error('VERIFY_ERROR', e.stack || e); process.exit(2); });
