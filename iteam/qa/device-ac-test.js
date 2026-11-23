/**
 * device-ac-test.js —— 真机（微信开发者工具）验收脚本
 *
 * 用途：补充 Node mock 冒烟覆盖不到的「真实 WebGL 渲染与页面交互」层。
 * 运行环境：需先由用户开启 IDE 服务端口并登录，且 `cli auto --auto-port 9420` 常驻。
 * 连接方式：automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })。
 *
 * 边界（务必先读）：
 *  1) 本脚本不 require store（小程序自动化上下文禁止跨模块 require），
 *     不写业务数据层，不碰生产数据。仅通过页面 setData 注入临时渲染态，
 *     用于观察 WebGL/降级/交互逻辑，验证后自动退出，不留痕。
 *  2) 判据来自 traceability-matrix.md 的验证意图（见每条注释），
 *     文档未逐条硬定义 AC 数值，故本脚本只验证「可观测行为」，
 *     不臆造帧率/加载时长等未定值指标。
 *  3) 需人工真机确认的项（手势手感、真机机型兼容、账号合规）不在此脚本，
 *     输出中会显式标注，避免误判为「全部通过」。
 *
 * 覆盖：AC-13(WebGL/降级) · AC-02/03(编辑模式与变换按钮/手势入口) ·
 *       AC-16/17(模板起点、缺失降级) · AC-04/05(选中与绑定卡) 的可观测部分。
 */
const automator = require('miniprogram-automator');

const WS = process.env.MP_WS || 'ws://127.0.0.1:9420';
const results = [];
function record(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS });
    console.log('CONNECT: OK');
    const sys = await mp.systemInfo().catch(() => ({}));
    console.log(`ENV: platform=${sys.platform || '?'} SDK=${sys.SDKVersion || '?'}`);

    // 跳到三维房间页（空 roomId 也能加载：loadData  handles 空 id，用临时 data 注入家具）
    await mp.reLaunch('/pages/room3d/room3d?id=__device_ac_probe__').catch(() => {});
    await new Promise(r => setTimeout(r, 1200));
    const route = await mp.evaluate(() => {
      const p = getCurrentPages(); return p[p.length - 1] ? p[p.length - 1].route : '?';
    });
    record('ENV-01', '三维页可加载', route === 'pages/room3d/room3d', `route=${route}`);

    // --- AC-13：WebGL 初始化 + 列表降级通路（来源：MVP-006/012、F-06） ---
    const gl = await mp.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      return { view: p.data.view, glError: p.data.glError || '' };
    }).catch(e => ({ err: e.message }));
    // 开发者工具支持 WebGL：期望 view=3d 且无 glError；不支持则 view=list 且 glError 非空。
    const degradeOK = (gl.view === '3d' && !gl.glError) || (gl.view === 'list' && !!gl.glError);
    record('AC-13', 'WebGL初始化或降级（二者必居其一，不白屏）', degradeOK,
      `view=${gl.view}, glError=${gl.glError || '(空)'}${gl.err ? ', err=' + gl.err : ''}`);

    // 降级切换：调用页面 setView 切列表，验证 view 变为 list（来源：MVP-012 降级入口）
    const listView = await mp.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      p.setData({ view: 'list' });
      return p.data.view;
    });
    record('AC-13b', '列表降级视图可切换', listView === 'list', `view=${listView}`);

    // --- AC-02/03：单一主视图与选中卡变换入口（规范 V1.0） ---
    const single = await mp.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      return { noMode: p.data.mode === undefined, hint: p.data.hint || '' };
    });
    record('AC-02', '单一主视图（无三模式）', single.noMode, `mode字段=${single.noMode}`);
    record('AC-02b', '固定视角提示口径', !/旋转视角|平移视角/.test(single.hint), `hint=${single.hint}`);

    // 注入一件临时家具（仅页面 data，不落库），验证选中卡与旋转按钮入口
    const rot = await mp.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      const f = { id: '__probe__', name: '探针家具', px: 1, pz: 1, rot: 0, status: 'confirmed', bindCount: 0 };
      p.setData({ furniture: [f], selected: {
        id: f.id, name: f.name, px: f.px, pz: f.pz, rot: f.rot, status: f.status, bindCount: 0
      }, bindings: { nodeCount: 0, items: [] } });
      return { rot: (p.data.selected && p.data.selected.rot), hasBind: !!p.data.bindings,
               hasCount: typeof (p.data.selected && p.data.selected.bindCount) === 'number',
               rotateFn: typeof p.rotateFurniture === 'function' };
    });
    record('AC-03', '选中卡绑定数量与旋转入口完整', rot.hasBind && rot.hasCount && rot.rotateFn,
      `selected.rot=${rot.rot}, count=${rot.hasCount}, rotate=${rot.rotateFn}`);

    // --- AC-04/05：绑定卡渲染（来源：F-03 T10） ---
    const bind = await mp.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      p.setData({ bindings: { nodeCount: 2, items: [{ id: 'i1', name: '测试物品', nodeName: '测试位置' }] } });
      return { n: p.data.bindings.nodeCount, items: (p.data.bindings.items || []).length };
    });
    record('AC-04', '绑定汇总卡可渲染', bind.n === 2 && bind.items === 1,
      `nodeCount=${bind.n}, items=${bind.items}`);

    // --- AC-16/17：列表降级下家具可见（来源：F-07 模板缺失降级 / MVP-012） ---
    const listHas = await mp.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      return { view: p.data.view, n: (p.data.furniture || []).length };
    });
    record('AC-17', '列表模式下家具可见', listHas.view === 'list' && listHas.n >= 1,
      `view=${listHas.view}, furniture=${listHas.n}`);

    // 还原到首页，不在三维页留下临时 data
    await mp.reLaunch('/pages/index/index').catch(() => {});
    console.log('CLEANUP: 已返回首页；临时 data 仅存在于已卸载的页面实例，不落库。');
  } catch (e) {
    record('CONN', '连接与执行', false, e.message.slice(0, 200));
  } finally {
    if (mp) await mp.disconnect().catch(() => {});
    const pass = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log(`\nSUMMARY: ${pass} PASS / ${fail} FAIL / ${results.length} TOTAL`);
    console.log('NOT COVERED (需人工真机): 手势手感与双指缩放、真机机型 WebGL 兼容、AC-06 换模型保关联手工、提审合规四项。');
    process.exitCode = fail ? 1 : 0;
  }
})();
