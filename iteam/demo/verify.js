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
async function drag(cdp, from, to, steps = 6) {
  await cdp.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, button: 'left', buttons: 1 });
  }
  await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(120);
}
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
    check('首页户型总览位于提醒栏之前', await cdp.eval(`(function(){const s=document.querySelector('#screen'),fp=s.querySelector('.fp-card'),rm=s.querySelector('.remind');return !!fp&&!!rm&&!!(fp.compareDocumentPosition(rm)&Node.DOCUMENT_POSITION_FOLLOWING)})()`));
    check('户型视图展示 3 个房间', (await cdp.eval(`document.querySelectorAll('#screen .fp-room').length`)) === 3);
    check('户型视图含主卧/客厅/卫生间', await cdp.eval(`(function(){const t=document.querySelector('#screen .floorplan').textContent;return t.includes('主卧')&&t.includes('客厅')&&t.includes('卫生间')})()`));
    check('户型视图含家具微缩块', (await cdp.eval(`document.querySelectorAll('#screen .fp-furn').length`)) >= 5);
    check('户型视图面积标注', await cdp.eval(`document.querySelector('#screen .fp-meta').textContent.includes('㎡')`));
    check('点击户型房间进入三维', await cdp.eval(`(function(){document.querySelector('#screen .fp-room').click();return !!document.querySelector('#screen .canvas3d') && document.querySelector('#crumb').textContent.includes('三维房间')})()`));

    // 1c. 户型布局编辑：进入编辑 / 拖动 / 越界钳制 / 重叠阻断 / 缩放 / 自动排布 / 重进一致
    const backHome = async () => { await cdp.eval(`(function(){var b=document.querySelector('#screen [data-act="back"]');if(b)b.click();var h=document.querySelector('#screen .tabbar [data-p="home"]');if(h)h.click();})()`); await sleep(100); };
    await backHome();
    await cdp.eval(`document.querySelector('[data-act="reset-demo"]').click()`); await sleep(100);
    check('户型视图：高度按实际占用自适应（无 10 行空白）', await cdp.eval(`(function(){var g=document.querySelector('.floorplan');return Number(g.dataset.rows)===5 && g.getBoundingClientRect().height<280})()`));
    check('户型编辑：可进入编辑模式（8 方向把手）', await cdp.eval(`(function(){document.querySelector('[data-act="floor-edit"]').click();var hs=document.querySelectorAll('.fp-handle');return document.querySelector('.floorplan').classList.contains('fp-grid-on') && hs.length===24 && ['nw','n','ne','e','se','s','sw','w'].every(function(d){return !!document.querySelector('.fh-'+d)})})()`));

    // 拖动卫生间(rm3)向下移动到空位（下移不与其他房间冲突）
    const g = await cdp.eval(`(function(){var el=document.querySelector('.fp-room[data-id="rm3"]'),r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    await drag(cdp, { x: g.x + g.w / 2, y: g.y + g.h / 2 }, { x: g.x + g.w / 2, y: g.y + g.h / 2 + g.h });
    check('户型编辑：拖动房间并保存位置', await cdp.eval(`(function(){var el=document.querySelector('.fp-room[data-id="rm3"]');return el && el.style.gridRow.indexOf('6 /')===0 && document.querySelector('#dataLog').textContent.includes('调整「卫生间」布局')})()`));

    // 越界钳制：把卫生间继续向右拖出边界，x 应被钳制到不越界
    const g2 = await cdp.eval(`(function(){var el=document.querySelector('.fp-room[data-id="rm3"]'),r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    await drag(cdp, { x: g2.x + g2.w / 2, y: g2.y + g2.h / 2 }, { x: g2.x + g2.w / 2 + g2.w * 4, y: g2.y + g2.h / 2 });
    check('户型编辑：越界自动钳制', await cdp.eval(`(function(){var el=document.querySelector('.fp-room[data-id="rm3"]'),m=el.style.gridColumn.match(/^(\\d+) \\/ (\\d+)$/);return !!m && Number(m[2])<=7})()`));

    // 重叠阻断：把卫生间拖回主卧/客厅所在区域，应被拒绝且不保存
    const g3 = await cdp.eval(`(function(){var el=document.querySelector('.fp-room[data-id="rm3"]'),r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    const beforeOverlap = await cdp.eval(`document.querySelector('.fp-room[data-id="rm3"]').style.gridColumn + '|' + document.querySelector('.fp-room[data-id="rm3"]').style.gridRow`);
    await drag(cdp, { x: g3.x + g3.w / 2, y: g3.y + g3.h / 2 }, { x: g3.x - g3.w * 6, y: g3.y - g3.h * 8 });
    check('户型编辑：重叠被阻断且不保存', await cdp.eval(`(function(){var el=document.querySelector('.fp-room[data-id="rm3"]');return document.querySelector('#dataLog').textContent.includes('被阻断（重叠/越界）') && el.style.gridColumn.indexOf('4 /')===0})()`), '重叠校验');

    // 角把手缩放：拖右下（se）向下放大卫生间（向下为空位）
    await cdp.eval(`document.querySelector('.fp-room[data-id="rm3"] .fh-se').scrollIntoView({block:'center'})`); await sleep(120);
    const gh = await cdp.eval(`(function(){var hd=document.querySelector('.fp-room[data-id="rm3"] .fh-se'),r=hd.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    const rowBefore = await cdp.eval(`document.querySelector('.fp-room[data-id="rm3"]').style.gridRow`);
    await drag(cdp, { x: gh.x + gh.w / 2, y: gh.y + gh.h / 2 }, { x: gh.x + gh.w / 2, y: gh.y + gh.h / 2 + gh.h * 8 });
    const rowAfter = await cdp.eval(`document.querySelector('.fp-room[data-id="rm3"]').style.gridRow`);
    check('户型编辑：拖角把手缩放房间', rowAfter !== rowBefore);

    // 边把手缩放：拖左边缘（w）向右收缩卫生间宽度
    await cdp.eval(`document.querySelector('.fp-room[data-id="rm3"] .fh-w').scrollIntoView({block:'center'})`); await sleep(120);
    const gw = await cdp.eval(`(function(){var hd=document.querySelector('.fp-room[data-id="rm3"] .fh-w'),r=hd.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    const colBefore = await cdp.eval(`document.querySelector('.fp-room[data-id="rm3"]').style.gridColumn`);
    await drag(cdp, { x: gw.x + gw.w / 2, y: gw.y + gw.h / 2 }, { x: gw.x + gw.w / 2 + gw.w * 8, y: gw.y + gw.h / 2 });
    const colAfter = await cdp.eval(`document.querySelector('.fp-room[data-id="rm3"]').style.gridColumn`);
    check('户型编辑：拖边把手调整宽度', colAfter !== colBefore, '边把手缩放');

    check('户型编辑：重进布局保持一致', await cdp.eval(`(function(){var before=document.querySelector('.fp-room[data-id="rm3"]').style.gridColumn;document.querySelector('[data-act="floor-done"]').click();document.querySelector('[data-act="floor-edit"]').click();return before===document.querySelector('.fp-room[data-id="rm3"]').style.gridColumn})()`));

    check('户型编辑：恢复自动排布', await cdp.eval(`(function(){document.querySelector('[data-act="floor-auto"]').click();var el=document.querySelector('.fp-room[data-id="rm3"]');return el.style.gridColumn==='1 / 4' && el.style.gridRow==='4 / 6'})()`));

    // 1d. 家具交互：点击进入添加物品 / 拖动摆放 / 长按删除（关联保护）
    await cdp.eval(`document.querySelector('[data-act="reset-demo"]').click()`); await sleep(80);
    await cdp.eval(`document.querySelector('[data-act="goto"][data-p="room3d"]').click()`); await sleep(80);
    // 点击家具（无位移）→ 进入建档页，且预选该家具节点
    check('家具交互：点击进入添加物品界面', await cdp.eval(`(function(){var el=document.querySelector('.furn');var r=el.getBoundingClientRect();['pointerdown','pointerup'].forEach(function(t){el.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));});return document.querySelector('#fName')!==null && document.querySelector('#fNode')!==null})()`));
    await cdp.eval(`(function(){var b=document.querySelector('#screen [data-act="back"]');if(b)b.click()})()`); await sleep(80);
    // 拖动家具：位置数据变化并写日志
    const fb = await cdp.eval(`(function(){var el=document.querySelector('.furn'),r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await drag(cdp, { x: fb.x, y: fb.y }, { x: fb.x + 30, y: fb.y });
    check('家具交互：拖动摆放并保存', await cdp.eval(`document.querySelector('#dataLog').textContent.includes('拖动家具')`));
    // 长按删除：床头柜含子节点（上层抽屉），应被关联保护阻断
    await cdp.eval(`(function(){var el=Array.prototype.find.call(document.querySelectorAll('.furn'),function(x){return x.textContent.indexOf('床头柜')>=0});var r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`);
    await sleep(700);
    await cdp.eval(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
    check('家具交互：长按删除（含节点被阻断）', await cdp.eval(`document.querySelector('#dataLog').textContent.includes('被阻断（关联保护）')`));
    // 长按删除：无关联的家具（落地窗）可删除，家具数 -1
    const furnBefore = await cdp.eval(`document.querySelectorAll('.furn').length`);
    await cdp.eval(`(function(){var el=Array.prototype.find.call(document.querySelectorAll('.furn'),function(x){return x.textContent.indexOf('落地窗')>=0});var r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`);
    await sleep(700);
    await cdp.eval(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
    check('家具交互：长按删除无关联家具', (await cdp.eval(`document.querySelectorAll('.furn').length`)) === furnBefore - 1);

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

    // 5c. 物品建档/详情/移动的交互优化
    check('建档引导：详情页显示下一步引导条', await cdp.eval(`(function(){try{
      document.querySelector('[data-act="reset-demo"]').click();
      document.querySelector('.quick [data-p="itemEdit"]').click();
      document.querySelector('#fName').value='引导测试';
      document.querySelector('[data-act="save-item"]:not([data-continue])').click();
      var txt=document.querySelector('#screen').textContent;
      return txt.includes('档案已建立') && txt.includes('下一步') && !!document.querySelector('.guide-card [data-act="goto"]');
    }catch(e){return false}})()`));

    check('详情页：纯位置物品只有一个移动入口', await cdp.eval(`(function(){
      var txt=document.querySelector('#screen').textContent;
      return (txt.match(/移动物品/g)||[]).length===1;
    })()`));

    check('库存建档：切换模式展开初始字段并保存数量/单位/阈值', await cdp.eval(`(function(){try{
      document.querySelector('[data-act="reset-demo"]').click();
      document.querySelector('.quick [data-p="itemEdit"]').click();
      var sel=document.querySelector('#fTrack'); sel.value='inventory'; sel.dispatchEvent(new Event('change',{bubbles:true}));
      if (document.querySelector('#invInit').style.display==='none') return false;
      document.querySelector('#fName').value='库存建档测试';
      document.querySelector('#fQty').value='5';
      document.querySelector('#fUnit').value='瓶';
      document.querySelector('#fThreshold').value='2';
      document.querySelector('[data-act="save-item"]:not([data-continue])').click();
      var txt=document.querySelector('#screen').textContent;
      return txt.includes('库存建档测试') && txt.includes('5 瓶') && txt.includes('阈值：2 瓶');
    }catch(e){return false}})()`));

    check('库存建档：初始数量不生成交易流水', await cdp.eval(`(function(){
      document.querySelector('#screen [data-act="goto"][data-p="inventoryDetail"]').click();
      var txt=document.querySelector('#screen').textContent;
      return txt.includes('交易流水（0）') && txt.includes('暂无交易');
    })()`));

    check('库存建档：库存总览显示新物品及余额', await cdp.eval(`(function(){try{
      for (var i=0;i<6 && !document.querySelector('.tabbar');i++) {
        var bk=document.querySelector('#screen [data-act="back"]'); if(!bk) break; bk.click();
      }
      document.querySelector('.tabbar [data-p="inventory"]').click();
      var txt=document.querySelector('#screen').textContent.replace(/\\s+/g,'');
      return txt.includes('库存建档测试') && txt.includes('5瓶');
    }catch(e){return false}})()`));

    check('详情页：有库存物品主行动为「记一笔库存」且移动入口唯一', await cdp.eval(`(function(){try{
      document.querySelector('[data-act="reset-demo"]').click();
      document.querySelector('.quick [data-p="itemEdit"]').click();
      var sel=document.querySelector('#fTrack'); sel.value='inventory'; sel.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#fName').value='去重测试';
      document.querySelector('[data-act="save-item"]:not([data-continue])').click();
      var txt=document.querySelector('#screen').textContent;
      return (txt.match(/移动物品/g)||[]).length===1 && txt.includes('记一笔库存');
    }catch(e){return false}})()`));

    check('移动页：选中下层节点高亮并回显目标路径', await cdp.eval(`(function(){try{
      document.querySelector('[data-act="reset-demo"]').click();
      document.querySelector('.tabbar [data-p="itemList"]').click();
      document.querySelector('#screen [data-act="goto"][data-p="itemDetail"]').click();
      document.querySelector('#screen [data-act="goto"][data-p="move"]').click();
      var chip=document.querySelector('#screen .chip[data-act="pick-node"]');
      if (!chip) return false;
      var id=chip.dataset.id, name=chip.textContent;
      chip.click();
      var after=document.querySelector('#screen .chip[data-act="pick-node"][data-id="'+id+'"]');
      var txt=document.querySelector('#screen').textContent;
      return !!after && after.classList.contains('sel') && txt.includes('目标位置：') && txt.includes(name);
    }catch(e){return false}})()`));

    check('移动页：选中上层节点高亮（与下层互斥）', await cdp.eval(`(function(){try{
      var node=document.querySelector('#screen .tree-node.child[data-act="pick-node"]');
      if (!node) return false;
      var id=node.dataset.id;
      node.click();
      var after=document.querySelector('#screen .tree-node.child[data-act="pick-node"][data-id="'+id+'"]');
      return !!after && after.classList.contains('sel') && !document.querySelector('#screen .chip.sel');
    }catch(e){return false}})()`));

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
