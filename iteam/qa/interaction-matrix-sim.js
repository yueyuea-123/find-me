// 三维房间交互矩阵验证（单一主视图 / 固定等距视角，基准：交互设计规范 V1.0）
// 运行前提：微信开发者工具已打开本项目且自动化端口 9420 已开启（cli auto --auto-port 9420）
// 运行方式：node qa/interaction-matrix-sim.js（在项目根目录执行）
// 说明：automator 的 Element 触摸坐标语义不可靠，测试直接调用页面触摸方法并传模拟事件；
//       打桩渲染器 zoom 计数验证"固定视角仅有限缩放"；结束自动 resetDemo 恢复演示数据。
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
  try {
    // 从 room 页拿第一个房间进入三维页
    await E(mp, () => wx.reLaunch({ url: '/pages/room/room' })); await wait(600);
    const rid = await E(mp, () => getCurrentPages().slice(-1)[0].data.rooms[0].id);
    await E(mp, id => wx.navigateTo({ url: '/pages/room3d/room3d?id=' + id }), rid); await wait(2200);

    const init = await E(mp, () => { const p = getCurrentPages().slice(-1)[0];
      return { view:p.data.view, glError:p.data.glError, ready:!!p._glRenderer, n:p.data.furniture.length,
               singleView:p.data.mode===undefined, hint:p.data.hint }; });
    ok('初始化正常', init.view==='3d' && !init.glError && init.ready, JSON.stringify(init));
    ok('单一主视图（无三模式字段）', init.singleView, 'mode=' + init.singleView);
    ok('提示不宣称自由旋转视角', !/旋转视角|平移视角/.test(init.hint), init.hint);

    // 动态找家具命中点与空白点
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
    const off = pts.rect || {left:14,top:119};

    // V1 短按家具=选中，不跳页；卡片展示绑定数量与查看/添加入口
    await E(mp, () => getCurrentPages().slice(-1)[0].clearSel());
    const v1 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      let nav=''; const orig=wx.navigateTo; wx.navigateTo=o=>{nav=o&&o.url;};
      const pt={x:arg.cx,y:arg.cy,clientX:arg.cx+arg.left,clientY:arg.cy+arg.top};
      try { p.onTouchStart({touches:[pt],changedTouches:[pt]}); p.onTouchEnd({touches:[],changedTouches:[pt]}); }
      finally { wx.navigateTo=orig; }
      return { sel:p.data.selected&&p.data.selected.name, count:p.data.selected&&p.data.selected.bindCount, nav,
               bindings:!!p.data.bindings };
    }, {cx:pts.hit.x, cy:pts.hit.y, idx:pts.hit.idx, ...off});
    ok('V1 短按家具选中且不跳页', !!v1.sel && v1.nav==='', JSON.stringify(v1));
    ok('V1 选中卡展示已绑定物品数量', typeof v1.count==='number' && v1.bindings, 'count=' + v1.count);

    // V2 拖空白：固定视角，不 orbit / 不 pan / 不移动家具
    const v2 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0]; const gl=p._glRenderer;
      let no=0, np=0; const oo=gl.orbit, op=gl.pan;
      gl.orbit=function(){no++;return oo.apply(this,arguments)}; gl.pan=function(){np++;return op.apply(this,arguments)};
      const a={x:arg.ax,y:arg.ay,clientX:arg.ax+arg.left,clientY:arg.ay+arg.top},
            b={x:arg.ax+40,y:arg.ay+30,clientX:arg.ax+40+arg.left,clientY:arg.ay+30+arg.top};
      const before=p.data.furniture.map(f=>f.px+'/'+f.pz).join(',');
      try { p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]}); }
      finally { gl.orbit=oo; gl.pan=op; }
      p.loadData();
      return {no,np,changed:before!==p.data.furniture.map(f=>f.px+'/'+f.pz).join(',')};
    }, {ax:pts.blank.x,ay:pts.blank.y,bx:pts.blank.x+40,by:pts.blank.y+30,...off});
    ok('V2 拖空白不旋转/平移视角', v2.no===0 && v2.np===0, JSON.stringify(v2));
    ok('V2 拖空白不移动家具', !v2.changed);

    // V3 双指缩放视图（打桩 zoom），家具尺寸不变
    const v3hit = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) { const idx=p._safeGL('pick',[x,y]); if (idx!==null&&idx>=0) return {x,y,idx}; }
      return null; });
    const v3 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0]; const gl=p._glRenderer;
      let n=0; const oz=gl.zoom; gl.zoom=function(){n++;return oz.apply(this,arguments)};
      const sz0=p.data.selected && p.data.selected.sz;
      const V=(cx,cy)=>({x:cx,y:cy,clientX:cx+arg.left,clientY:cy+arg.top});
      try { p.onTouchStart({touches:[V(150,100),V(250,100)],changedTouches:[]}); p.onTouchMove({touches:[V(80,100),V(320,100)],changedTouches:[]}); p.onTouchEnd({touches:[],changedTouches:[]}); }
      finally { gl.zoom=oz; }
      return {n, sz0, sz1:p.data.selected && p.data.selected.sz};
    }, off);
    ok('V3 双指缩放视图', v3.n>0, 'zoom=' + v3.n);
    ok('V3 双指不改家具尺寸', v3.sz0===v3.sz1, v3.sz0+' -> '+v3.sz1);

    // V4 拖家具移动 + 预览落盘分离（重新探测命中点）
    const v4 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const hit=arg.hit, idx=hit.idx;
      const raw0=JSON.parse(JSON.stringify(p._furniture[idx]._raw.position));
      const a={x:hit.x,y:hit.y,clientX:hit.x+arg.left,clientY:hit.y+arg.top},
            b={x:hit.x+80,y:hit.y+50,clientX:hit.x+80+arg.left,clientY:hit.y+50+arg.top};
      p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]});
      const midCard=p.data.selected.px+'/'+p.data.selected.pz;
      const midRaw=p._furniture[idx]._raw.position.x+'/'+p._furniture[idx]._raw.position.z;
      p.onTouchEnd({touches:[],changedTouches:[b]}); p.loadData();
      return {raw0:raw0.x+'/'+raw0.z, midCard, midRaw, after:p.data.furniture[idx].px+'/'+p.data.furniture[idx].pz};
    }, {hit:v3hit, ...off});
    ok('V4 单指拖家具落盘', Math.abs(Number(v4.after.split('/')[0])-Number(v4.raw0.split('/')[0]))>0.01, v4.raw0+' -> '+v4.after);
    ok('V4 预览期卡片变化但库未变', v4.midCard!==v4.midRaw, 'card='+v4.midCard+' raw='+v4.midRaw);

    // V5 按钮旋转 ±90°、可逆
    const v5 = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      const before=p.data.selected.rot; p.rotateFurniture({currentTarget:{dataset:{dir:1}}});
      const after1=p.data.selected.rot; p.rotateFurniture({currentTarget:{dataset:{dir:-1}}});
      return {before,after1,after2:p.data.selected.rot}; });
    const step = ((v5.after1 - v5.before) + 360) % 360;
    ok('V5 按钮旋转 90° 且可逆', step===90 && v5.after2===v5.before,
      v5.before+'° -> '+v5.after1+'° -> '+v5.after2+'°');

    // V6 添加物品两路径（打桩 navigateTo / showActionSheet）
    const v6 = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      const r={}; const origNav=wx.navigateTo, origSheet=wx.showActionSheet;
      try {
        wx.showActionSheet=o=>{r.sheet=o.itemList; if(o.success)o.success({tapIndex:0});};
        p.chooseAddItem(); r.picker=p.data.showBindPicker && p.data.bindableItems.length;
        p.closeBindPicker();
        wx.showActionSheet=o=>{if(o.success)o.success({tapIndex:1});};
        wx.navigateTo=o=>{r.nav=o.url;}; p.chooseAddItem();
      } finally { wx.navigateTo=origNav; wx.showActionSheet=origSheet; p.closeBindPicker(); }
      return r; });
    ok('V6 添加物品两路径', JSON.stringify(v6.sheet)===JSON.stringify(['从已有物品中选择','新建物品']) && v6.picker>0, JSON.stringify(v6));
    ok('V6 新建物品进入建档页', /^\/pages\/item-edit\/item-edit\?nodeId=/.test(v6.nav), v6.nav);

    // V7 家具库按需展开
    const v7 = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      p.setData({showLib:false}); const before=p.data.showLib; p.toggleLib(); const after=p.data.showLib;
      p.toggleLib(); return {before,after,end:p.data.showLib}; });
    ok('V7 家具库按需展开', v7.before===false && v7.after===true && v7.end===false, JSON.stringify(v7));

    // X1 越界钳制
    const x1 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const a={x:arg.cx,y:arg.cy,clientX:arg.cx+arg.left,clientY:arg.cy+arg.top}, b={x:arg.cx+2000,y:arg.cy+2000,clientX:arg.cx+2000+arg.left,clientY:arg.cy+2000+arg.top};
      p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]});
      p.loadData();
      const f=p.data.furniture[arg.idx], rm=p._room;
      return {px:Number(f.px),pz:Number(f.pz),w:rm.width,d:rm.depth};
    }, {cx:pts.hit.x, cy:pts.hit.y, idx:pts.hit.idx, ...off});
    ok('X1 越界位置被钳制在房间内', Math.abs(x1.px)<=x1.w/2+0.01 && Math.abs(x1.pz)<=x1.d/2+0.01,
      `pos(${x1.px},${x1.pz}) 房间 ${x1.w}×${x1.d}`);

    // X2 删除保护：关联家具删除被阻断，物品记录不丢
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
    await E(mp, () => { getCurrentPages().slice(-1)[0].setView({currentTarget:{dataset:{v:'3d'}}}); });
    await wait(1800);
    const x3c = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      return {view:p.data.view,glError:p.data.glError,ready:!!p._glRenderer}; });
    ok('X3 列表↔三维降级与重建', x3a.view==='list' && x3c.view==='3d' && x3c.ready && !x3c.glError, JSON.stringify(x3c));

    // X4/X6 坐标换算
    const x4 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const c=p._canvasXY({x:arg.cx,y:arg.cy,clientX:arg.cx+arg.left,clientY:arg.cy+arg.top});
      const d=p._canvasXY({clientX:arg.cx+arg.left, clientY:arg.cy+arg.top});
      return {cx:c.x,cy:c.y,dx:d.x,dy:d.y,expectX:arg.cx,expectY:arg.cy};
    }, {cx:160,cy:110,...off});
    ok('X4 canvas 坐标不重复减窗口偏移', Math.abs(x4.cx-x4.expectX)<1 && Math.abs(x4.cy-x4.expectY)<1, JSON.stringify(x4));
    ok('X6 视口坐标兜底换算', Math.abs(x4.dx-x4.expectX)<1 && Math.abs(x4.dy-x4.expectY)<1, JSON.stringify(x4));

    // 首页户型编辑回归
    await E(mp, () => wx.reLaunch({ url: '/pages/index/index' })); await wait(600);
    const h1 = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      p.setData({editing:true}); const room=p.data.overview.rooms[2];
      p.onRoomTouchStart({touches:[{clientX:100,clientY:100}], currentTarget:{dataset:{id:room.id, handle:'s'}}});
      const started=!!p._drag && p._drag.id===room.id && p._drag.handle==='s';
      p._drag.cand={x:room.floor.x,y:room.floor.y+1,w:room.floor.w,h:room.floor.h};
      p.onRoomTouchEnd();
      const after=getCurrentPages().slice(-1)[0];
      const savedRoom=after.data.overview.rooms.filter(r=>r.id===room.id)[0];
      return {started, editing:after.data.editing, saved:!!savedRoom && savedRoom.floor.y===room.floor.y+1};
    });
    ok('H1 房间把手可发起拖动并落盘', h1.started && h1.saved, JSON.stringify(h1));
    ok('H2 连续编辑时不退出编辑态', h1.editing===true, 'editing=' + h1.editing);

    console.log('\n========== 结果: ' + pass + '/' + (pass+fail) + ' 通过 ==========');
    if (fail) console.log('未通过项见上方 FAIL');
  } catch (e) {
    console.error('RUNNER ERROR', e && e.stack || e);
    fail++;
  } finally {
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
