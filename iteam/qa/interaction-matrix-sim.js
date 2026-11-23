// 全面验证 room3d 页面交互逻辑矩阵（三种模式 × 各手势 + 边界 + 降级 + 预览落盘）
// 运行前提：微信开发者工具已打开本项目且自动化端口 9420 已开启（cli auto --auto-port 9420）
// 运行方式：node qa/interaction-matrix-sim.js（在项目根目录执行）
// 说明：automator 的 Element 触摸坐标语义不可靠，测试直接调用页面触摸方法并传模拟事件；
//       打桩渲染器 orbit/zoom/pan 计数以验证视角操作；运行结束自动 resetDemo 恢复演示数据。
const automator = require('../node_modules/miniprogram-automator');
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')); }
}
const E = (mp, fn, arg) => mp.evaluate(fn, arg);

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const setMode = m => E(mp, x => { const p = getCurrentPages().slice(-1)[0]; p.setMode({currentTarget:{dataset:{m:x}}}); }, m);
  try {
    // 从 room 页拿第一个房间进入三维页
    await E(mp, () => wx.reLaunch({ url: '/pages/room/room' })); await wait(600);
    const rid = await E(mp, () => getCurrentPages().slice(-1)[0].data.rooms[0].id);
    await E(mp, id => wx.navigateTo({ url: '/pages/room3d/room3d?id=' + id }), rid); await wait(2200);

    const init = await E(mp, () => { const p = getCurrentPages().slice(-1)[0];
      return { view:p.data.view, glError:p.data.glError, ready:!!p._glRenderer, n:p.data.furniture.length }; });
    ok('初始化正常', init.view==='3d' && !init.glError && init.ready, JSON.stringify(init));

    // 动态找命中点（canvas 内坐标）和空白点，并读 rect 偏移
    const pts = await E(mp, () => { const p = getCurrentPages().slice(-1)[0];
      let hit=null, blank=null;
      for (let x=40;x<340;x+=20) for (let y=30;y<210;y+=20) {
        const idx=p._safeGL('pick',[x,y]);
        if (idx!==null && idx>=0 && !hit) hit={x,y,idx};
        if (idx===null && !blank) blank={x,y};
      }
      return {hit,blank,rect:p._glRect?{left:p._glRect.left,top:p._glRect.top}:null};
    });
    ok('找到家具命中点', !!pts.hit, JSON.stringify(pts.hit));
    ok('找到空白点', !!pts.blank, JSON.stringify(pts.blank));
    ok('canvas 窗口偏移可读（坐标换算前提）', !!pts.rect && pts.rect.left!==undefined, JSON.stringify(pts.rect));
    const off = pts.rect || {left:14,top:119};
    const V = (cx,cy) => ({x:cx+off.left, y:cy+off.top});

    // 辅助：在 evaluate 里打桩某个渲染器方法，执行 fn，返回调用次数
    const spy = async (method, actions) => E(mp, arg => {
      const p = getCurrentPages().slice(-1)[0];
      const gl = p._glRenderer;
      let n = 0;
      const orig = gl[arg.method];
      gl[arg.method] = function(){ n++; return orig.apply(this, arguments); };
      try { actions(p, arg); } finally { gl[arg.method] = orig; }
      return n;
    }, {method, a:arguments[1], b:arguments[2]}).catch(e=>({err:e.message}));

    // ================= 浏览模式 =================
    await setMode('browse');
    await E(mp, () => getCurrentPages().slice(-1)[0].clearSel());
    const b1 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const pt={x:arg.cx+arg.left,y:arg.cy+arg.top};
      p.onTouchStart({touches:[pt],changedTouches:[pt]});
      p.onTouchEnd({touches:[],changedTouches:[pt]});
      return { sel:p.data.selected&&p.data.selected.name, hit:arg.idx };
    }, {cx:pts.hit.x, cy:pts.hit.y, idx:pts.hit.idx, ...off});
    ok('B1 浏览-短按家具选中', !!b1.sel, 'sel=' + b1.sel);

    // B2 浏览-拖空白旋转视角（打桩 orbit）
    const b2 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0]; const gl=p._glRenderer;
      let n=0; const orig=gl.orbit; gl.orbit=function(){n++;return orig.apply(this,arguments)};
      const a={x:arg.ax+arg.left,y:arg.ay+arg.top}, b={x:arg.bx+arg.left,y:arg.by+arg.top};
      try { p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]}); }
      finally { gl.orbit=orig; }
      return n;
    }, {ax:pts.blank.x,ay:pts.blank.y,bx:pts.blank.x+40,by:pts.blank.y+30,...off});
    ok('B2 浏览-拖空白旋转视角', b2>0, 'orbit次数=' + b2);

    // B3 浏览-双指缩放视角（打桩 zoom）
    const b3 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0]; const gl=p._glRenderer;
      let n=0; const orig=gl.zoom; gl.zoom=function(){n++;return orig.apply(this,arguments)};
      const a1={x:100+arg.left,y:100+arg.top},a2={x:200+arg.left,y:100+arg.top};
      const b1={x:80+arg.left,y:100+arg.top},b2p={x:220+arg.left,y:100+arg.top};
      try { p.onTouchStart({touches:[a1,a2],changedTouches:[]}); p.onTouchMove({touches:[b1,b2p],changedTouches:[]}); p.onTouchEnd({touches:[],changedTouches:[]}); }
      finally { gl.zoom=orig; }
      return n;
    }, off);
    ok('B3 浏览-双指缩放视角', b3>0, 'zoom次数=' + b3);

    // B4 浏览-拖家具不移动位置
    const b4 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const idx=arg.idx, fid=p._furniture[idx].id;
      const before=p.data.furniture[idx].px+'/'+p.data.furniture[idx].pz;
      const a={x:arg.cx+arg.left,y:arg.cy+arg.top}, b={x:arg.cx+60+arg.left,y:arg.cy+40+arg.top};
      p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]});
      p.loadData();
      return {before,after:p.data.furniture[idx].px+'/'+p.data.furniture[idx].pz};
    }, {cx:pts.hit.x, cy:pts.hit.y, idx:pts.hit.idx, ...off});
    ok('B4 浏览-拖家具不移动', b4.before===b4.after, b4.before+' -> '+b4.after);

    // ================= 编辑模式 =================
    await setMode('edit');
    const e1 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const pt={x:arg.cx+arg.left,y:arg.cy+arg.top};
      p.onTouchStart({touches:[pt],changedTouches:[pt]}); p.onTouchEnd({touches:[],changedTouches:[pt]});
      return {sel:p.data.selected&&p.data.selected.name};
    }, {cx:pts.hit.x, cy:pts.hit.y, idx:pts.hit.idx, ...off});
    ok('E1 编辑-短按仅选中', !!e1.sel, 'sel=' + e1.sel);

    // E2 编辑-单指拖家具移动 + X5 预览落盘分离（重新探测命中点）
    const e2hit = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) {
        const idx=p._safeGL('pick',[x,y]); if (idx!==null && idx>=0) return {x,y,idx};
      } return null; });
    const e2 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const idx=arg.hit.idx;
      const raw0=JSON.parse(JSON.stringify(p._furniture[idx]._raw.position));
      const a={x:arg.hit.x+arg.left,y:arg.hit.y+arg.top}, b={x:arg.hit.x+80+arg.left,y:arg.hit.y+50+arg.top};
      p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]});
      const midCard=p.data.selected.px+'/'+p.data.selected.pz;
      const midRaw=p._furniture[idx]._raw.position.x+'/'+p._furniture[idx]._raw.position.z;
      const previewPos=p._previewPos;
      p.onTouchEnd({touches:[],changedTouches:[b]});
      p.loadData();
      const after=p.data.furniture[idx].px+'/'+p.data.furniture[idx].pz;
      return {raw0:raw0.x+'/'+raw0.z, midCard, midRaw, after, previewPos:!!previewPos};
    }, {hit:e2hit, ...off});
    ok('E2 编辑-单指拖家具落盘移动', Math.abs(Number(e2.after.split('/')[0])-Number(e2.raw0.split('/')[0]))>0.01, e2.raw0+' -> '+e2.after);
    ok('X5 预览期卡片变化但库未变', e2.midCard!==e2.midRaw, 'card='+e2.midCard+' raw='+e2.midRaw);

    // E3 编辑-双指捏合缩放家具
    const e3 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const before=p.data.selected.sz;
      const a1={x:100+arg.left,y:100+arg.top},a2={x:200+arg.left,y:100+arg.top};
      const b1={x:60+arg.left,y:100+arg.top},b2p={x:240+arg.left,y:100+arg.top};
      p.onTouchStart({touches:[a1,a2],changedTouches:[]}); p.onTouchMove({touches:[b1,b2p],changedTouches:[]});
      const preview=p.data.selected.sz;
      p.onTouchEnd({touches:[],changedTouches:[]});
      return {before,preview,after:p.data.selected&&p.data.selected.sz};
    }, off);
    ok('E3 编辑-双指捏合缩放家具', e3.before!==e3.preview && e3.before!==e3.after, e3.before+' -> '+e3.after);

    // E4 编辑-双指扭转旋转家具
    const e4 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const before=p.data.selected.rot;
      const a1={x:100+arg.left,y:100+arg.top},a2={x:200+arg.left,y:100+arg.top};
      const b1={x:100+arg.left,y:140+arg.top},b2p={x:200+arg.left,y:60+arg.top};
      p.onTouchStart({touches:[a1,a2],changedTouches:[]}); p.onTouchMove({touches:[b1,b2p],changedTouches:[]});
      const preview=p.data.selected.rot;
      p.onTouchEnd({touches:[],changedTouches:[]});
      return {before,preview,after:p.data.selected&&p.data.selected.rot};
    }, off);
    ok('E4 编辑-双指扭转旋转家具', e4.before!==e4.preview && e4.before!==e4.after, e4.before+'° -> '+e4.after+'°');

    // E6 编辑-拖空白平移视角（打桩 pan）
    const e6 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0]; const gl=p._glRenderer;
      let n=0; const orig=gl.pan; gl.pan=function(){n++;return orig.apply(this,arguments)};
      const a={x:arg.ax+arg.left,y:arg.ay+arg.top}, b={x:arg.ax+40+arg.left,y:arg.ay+30+arg.top};
      try { p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]}); }
      finally { gl.pan=orig; }
      return n;
    }, {ax:pts.blank.x,ay:pts.blank.y,...off});
    ok('E6 编辑-拖空白平移视角', e6>0, 'pan次数=' + e6);

    // E5 编辑-长按删除确认（真实等 600ms，打桩 showModal 不真删）
    // 家具已被前序用例移动，重新探测当前命中点
    const e5hit = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) {
        const idx=p._safeGL('pick',[x,y]);
        if (idx!==null && idx>=0) return {x,y,idx};
      }
      return null;
    });
    ok('E5 重新找到家具命中点', !!e5hit, JSON.stringify(e5hit));
    await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      window.__mt=[]; window.__om=wx.showModal;
      wx.showModal=function(o){ window.__mt.push(o.title); };
      const pt={x:arg.cx+arg.left,y:arg.cy+arg.top};
      p.onTouchStart({touches:[pt],changedTouches:[pt]});
    }, {cx:e5hit.x, cy:e5hit.y, idx:e5hit.idx, ...off});
    await wait(750);
    const e5 = await E(mp, () => { wx.showModal=window.__om; const t=window.__mt.slice();
      const p=getCurrentPages().slice(-1)[0]; p.onTouchEnd({touches:[],changedTouches:[]}); return t; });
    ok('E5 编辑-长按触发删除确认', e5.indexOf('删除家具')>=0, 'modal=' + JSON.stringify(e5));

    // ================= 收纳模式 =================
    await setMode('store');
    // S1 收纳-点家具进节点详情（打桩 navigateTo）；重新探测命中点
    const s1hit = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) {
        const idx=p._safeGL('pick',[x,y]);
        if (idx!==null && idx>=0) return {x,y,idx};
      }
      return null;
    });
    const s1 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      let url=''; const orig=wx.navigateTo; wx.navigateTo=function(o){url=o.url};
      try { const pt={x:arg.cx+arg.left,y:arg.cy+arg.top};
        p.onTouchStart({touches:[pt],changedTouches:[pt]}); p.onTouchEnd({touches:[],changedTouches:[pt]}); }
      finally { wx.navigateTo=orig; }
      return url;
    }, {cx:s1hit.x, cy:s1hit.y, idx:s1hit.idx, ...off});
    ok('S1 收纳-点家具进节点详情', /furniture-detail/.test(s1), 'url=' + s1);

    // S2 收纳-拖空白旋转视角（打桩 orbit）
    const s2 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0]; const gl=p._glRenderer;
      let n=0; const orig=gl.orbit; gl.orbit=function(){n++;return orig.apply(this,arguments)};
      const a={x:arg.ax+arg.left,y:arg.ay+arg.top}, b={x:arg.ax+40+arg.left,y:arg.ay+30+arg.top};
      try { p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]}); }
      finally { gl.orbit=orig; }
      return n;
    }, {ax:pts.blank.x,ay:pts.blank.y,...off});
    ok('S2 收纳-拖空白旋转视角', s2>0, 'orbit次数=' + s2);

    await setMode('browse');

    // ================= 边界与降级 =================
    // X1 越界钳制：大幅拖家具
    await setMode('edit');
    const x1 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const idx=arg.idx;
      const a={x:arg.cx+arg.left,y:arg.cy+arg.top}, b={x:arg.cx+2000+arg.left,y:arg.cy+2000+arg.top};
      p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]});
      p.loadData();
      const f=p.data.furniture[idx], rm=p._room;
      return {px:Number(f.px),pz:Number(f.pz),w:rm.width,d:rm.depth};
    }, {cx:pts.hit.x, cy:pts.hit.y, idx:pts.hit.idx, ...off});
    ok('X1 越界位置被钳制在房间内',
      Math.abs(x1.px)<=x1.w/2+0.01 && Math.abs(x1.pz)<=x1.d/2+0.01,
      `pos(${x1.px},${x1.pz}) 房间 ${x1.w}×${x1.d}`);

    // X2 删除保护：关联家具删除被阻断（双人床关联羊毛毯）
    const x2 = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      const bed=p._furniture.find(f=>/床/.test(f.name));
      let titles=[]; const orig=wx.showModal; wx.showModal=function(o){titles.push(o.title)};
      try { p._doRemoveFurniture(bed.id); } finally { wx.showModal=orig; }
      p.loadData();
      return {titles, stillThere:p.data.furniture.some(f=>f.id===bed.id)};
    });
    ok('X2 有关联家具删除被阻断', x2.stillThere && x2.titles.indexOf('无法删除')>=0, JSON.stringify(x2));

    // X3 降级：切列表再切回三维重建
    const x3a = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      p.setView({currentTarget:{dataset:{v:'list'}}}); return {view:p.data.view}; });
    await wait(200);
    const x3b = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      p.setView({currentTarget:{dataset:{v:'3d'}}}); return {view:p.data.view}; });
    await wait(1800);
    const x3c = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      return {view:p.data.view,glError:p.data.glError,ready:!!p._glRenderer}; });
    ok('X3 列表↔三维降级与重建', x3a.view==='list' && x3b.view==='3d' && x3c.ready && !x3c.glError,
      JSON.stringify({x3a,x3c}));

    // X4 坐标换算：_canvasXY 正确减偏移
    const x4 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const c=p._canvasXY({x:arg.cx+arg.left,y:arg.cy+arg.top});
      return {cx:c.x,cy:c.y,expectX:arg.cx,expectY:arg.cy};
    }, {cx:160,cy:110,...off});
    ok('X4 触摸坐标减去窗口偏移', Math.abs(x4.cx-x4.expectX)<1 && Math.abs(x4.cy-x4.expectY)<1, JSON.stringify(x4));

    console.log('\n========== 结果: ' + pass + '/' + (pass+fail) + ' 通过 ==========');
    if (fail) console.log('未通过项见上方 FAIL');

  } catch (e) {
    console.error('RUNNER ERROR', e && e.stack || e);
    fail++;
  } finally {
    // 恢复演示数据
    try {
      await E(mp, () => wx.reLaunch({url:'/pages/profile/profile'})); await wait(500);
      await E(mp, () => { const p=getCurrentPages().slice(-1)[0]; const o=wx.showModal;
        wx.showModal=function(x){if(x&&x.success)x.success({confirm:true})};
        try{p.resetDemo()}catch(e){}finally{wx.showModal=o} });
      await wait(400);
    } catch (e) {}
    await mp.disconnect();
    console.log('演示数据已重置');
    process.exit(fail ? 1 : 0);
  }
})();
