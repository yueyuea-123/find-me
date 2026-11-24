// 三维房间交互矩阵验证（直接拖拽主路径，基准：客厅三维空间交互与开发设计规范 V1.4）
// 运行前提：微信开发者工具已打开本项目且自动化端口 9420 已开启（cli auto --project <iteam> --auto-port 9420）
// 运行方式：node qa/interaction-matrix-sim.js（在 iteam 目录执行）
// 说明：automator 的 Element 触摸坐标语义不可靠，测试直接调用页面触摸方法并传模拟事件；
//       每个手势用例内部重新探测命中点——相机 orbit/zoom 会使早前探测的屏幕坐标失效，
//       跨手势复用会拖错家具（2026-11-24 实测踩坑）；相机变化不算家具数据变更（V1.4 §3.2）；
//       结束自动 resetDemo 恢复演示数据。
// 2026-11-24：由"固定等距视角（设计基准 V1.0）"口径同步为 V1.4 直接拖拽口径——
//       V2 改为"拖空白应转视角且不标 dirty"；V4/V5/X1 改为手势内重探测；
//       V5 由已删除的 rotateFurniture 旧方法改为 enterRotate + rotateStep 微调路径。
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
    ok('提示含 V1.4 主路径（拖动转视角/双指缩放）', /转视角/.test(init.hint) && /双指缩放/.test(init.hint), init.hint);

    // 动态找家具命中点与空白点
    const pts = await E(mp, () => { const p = getCurrentPages().slice(-1)[0];
      let hit=null, blank=null;
      for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) {
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

    // V2 拖空白：旋转相机视角（V1.4 §3.1），不平移、不移动家具、不标 dirty
    const v2 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0]; const gl=p._glRenderer;
      let no=0, np=0; const oo=gl.orbit, op=gl.pan;
      gl.orbit=function(){no++;return oo.apply(this,arguments)}; gl.pan=function(){np++;return op.apply(this,arguments)};
      const a={x:arg.ax,y:arg.ay,clientX:arg.ax+arg.left,clientY:arg.ay+arg.top},
            b={x:arg.ax+40,y:arg.ay+30,clientX:arg.ax+40+arg.left,clientY:arg.ay+30+arg.top};
      const before=p.data.furniture.map(f=>f.px+'/'+f.pz).join(',');
      const dirty0=p.data.isDirty;
      try { p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]}); }
      finally { gl.orbit=oo; gl.pan=op; }
      p.loadData();
      return {no,np,dirty0,dirty1:p.data.isDirty,changed:before!==p.data.furniture.map(f=>f.px+'/'+f.pz).join(',')};
    }, {ax:pts.blank.x,ay:pts.blank.y,...off});
    ok('V2 拖空白转视角（orbit 生效）', v2.no>0, JSON.stringify(v2));
    ok('V2 拖空白不平移（pan 不参与）', v2.np===0, 'pan=' + v2.np);
    ok('V2 拖空白不移动家具', !v2.changed);
    ok('V2 相机变化不标 dirty（V1.4 §3.2）', v2.dirty0===v2.dirty1, 'isDirty ' + v2.dirty0 + ' -> ' + v2.dirty1);

    // V3 双指缩放视图（打桩 zoom），家具尺寸不变
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

    // V4 单指拖家具：预览跟手 → 抬手一次性落盘 + 5cm 吸附（V1.4 §5.1）。
    // 命中点在本用例内重新探测：V3 的 zoom 已使此前探测的屏幕坐标失效。
    const v4 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      const findHit=()=>{ for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) { const idx=p._safeGL('pick',[x,y]); if (idx!==null&&idx>=0) return {x,y,idx}; } return null; };
      const hit=findHit();
      if (!hit) return {noHit:true};
      const idx=hit.idx;
      const raw0=JSON.parse(JSON.stringify(p._furniture[idx]._raw.position));
      const bind0=p.data.bindings?Object.keys(p.data.bindings).length:null;
      const pt=(x,y)=>({x,y,clientX:x+arg.left,clientY:y+arg.top});
      p.onTouchStart({touches:[pt(hit.x,hit.y)],changedTouches:[pt(hit.x,hit.y)]});
      p.onTouchMove({touches:[pt(hit.x+80,hit.y+50)],changedTouches:[pt(hit.x+80,hit.y+50)]});
      const midCard=p.data.selected.px+'/'+p.data.selected.pz;
      const midRaw=p._furniture[idx]._raw.position.x+'/'+p._furniture[idx]._raw.position.z;
      p.onTouchEnd({touches:[],changedTouches:[pt(hit.x+80,hit.y+50)]}); p.loadData();
      const rawAfter=p._furniture[idx]._raw.position;
      const snapOk=Math.abs(rawAfter.x*20-Math.round(rawAfter.x*20))<1e-6 && Math.abs(rawAfter.z*20-Math.round(rawAfter.z*20))<1e-6;
      const bind1=p.data.bindings?Object.keys(p.data.bindings).length:null;
      return {raw0:raw0.x+'/'+raw0.z, midCard, midRaw, rawAfter:rawAfter.x+'/'+rawAfter.z, snapOk, bind0, bind1,
              movedRaw:rawAfter.x!==raw0.x||rawAfter.z!==raw0.z};
    }, off);
    ok('V4 单指拖家具抬手落盘', v4.movedRaw, v4.raw0+' -> '+v4.rawAfter);
    ok('V4 落盘坐标按 5cm 网格吸附', v4.snapOk, v4.rawAfter);
    ok('V4 预览期卡片变化但库未变', v4.midCard!==v4.midRaw, 'card='+v4.midCard+' raw='+v4.midRaw);
    ok('V4 拖动不破坏物品绑定（BR-009）', v4.bind0===v4.bind1, 'bindings ' + v4.bind0 + ' -> ' + v4.bind1);

    // V5 角度按钮精确微调（V1.4 §5.2 辅助路径）：选中 → enterRotate → ±90°，即时落盘、可逆
    const v5hit = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) { const idx=p._safeGL('pick',[x,y]);
        if (idx!==null&&idx>=0 && typeof (p.data.furniture[idx]&&p.data.furniture[idx].rot)==='number') return {x,y,idx}; }
      return null; });
    const v5 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      if (!arg.hit) return {noHit:true};
      const pt={x:arg.hit.x,y:arg.hit.y,clientX:arg.hit.x+arg.left,clientY:arg.hit.y+arg.top};
      p.onTouchStart({touches:[pt],changedTouches:[pt]}); p.onTouchEnd({touches:[],changedTouches:[pt]});
      const r={selected:!!p.data.selected};
      if (!r.selected) return r;
      p.enterRotate(); r.mode=p.data.sceneMode;
      const rot0=p.data.selected.rot;
      p.rotateStep({currentTarget:{dataset:{dir:1,quick:1}}});
      const rot1=p.data.selected.rot;
      p.rotateStep({currentTarget:{dataset:{dir:-1,quick:1}}});
      const rot2=p.data.selected.rot;
      p.finishEdit(); r.modeAfter=p.data.sceneMode;
      r.rot0=rot0; r.rot1=rot1; r.rot2=rot2;
      return r;
    }, {hit:v5hit, ...off});
    const stepF=((v5.rot1-v5.rot0)+360)%360;
    const stepB=((v5.rot2-v5.rot1)+360)%360;
    ok('V5 进入旋转微调模式', v5.selected && v5.mode==='rotate', 'mode=' + v5.mode);
    ok('V5 角度按钮 +90° 即时落盘', stepF===90, v5.rot0+'° -> '+v5.rot1+'°');
    ok('V5 角度按钮 -90° 可逆还原', stepB===270 && v5.rot2===v5.rot0, v5.rot1+'° -> '+v5.rot2+'°');
    ok('V5 完成后退出微调模式', v5.modeAfter==='selected', 'mode=' + v5.modeAfter);

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

    // X1 越界钳制（先 resetView 恢复基准视角再探测，避免前序手势转动相机后扫不到家具）
    await E(mp, () => { getCurrentPages().slice(-1)[0].resetView(); });
    await wait(400);
    const x1 = await E(mp, arg => { const p=getCurrentPages().slice(-1)[0];
      try {
        let hit=null;
        for (let x=40;x<340;x+=10) for (let y=30;y<210;y+=10) { const idx=p._safeGL('pick',[x,y]); if (idx!==null&&idx>=0) { hit={x,y,idx}; break; } }
        if (!hit) return {noHit:true};
        const a={x:hit.x,y:hit.y,clientX:hit.x+arg.left,clientY:hit.y+arg.top}, b={x:hit.x+2000,y:hit.y+2000,clientX:hit.x+2000+arg.left,clientY:hit.y+2000+arg.top};
        p.onTouchStart({touches:[a],changedTouches:[a]}); p.onTouchMove({touches:[b],changedTouches:[b]}); p.onTouchEnd({touches:[],changedTouches:[b]});
        p.loadData();
        const f=p.data.furniture[hit.idx], rm=p._room || p.data.room;
        if (!f || !rm) return {noData:true, hasF:!!f, hasRoom:!!rm};
        return {px:Number(f.px),pz:Number(f.pz),w:rm.width,d:rm.depth};
      } catch (e) { return {err:e.message}; }
    }, off);
    ok('X1 越界位置被钳制在房间内', x1 && typeof x1.px==='number' && Math.abs(x1.px)<=x1.w/2+0.01 && Math.abs(x1.pz)<=x1.d/2+0.01,
      JSON.stringify(x1) + ` pos(${x1.px},${x1.pz}) 房间 ${x1.w}×${x1.d}`);

    // X2 删除保护（规范 §4.5 现行口径）：确认弹窗声明物品去向，确认后删除、物品记录不丢
    // （item-list 为 tabBar 页不能 navigateTo，改用页内 openBindPicker 数全量物品）
    const bedId = await E(mp, () => { const p=getCurrentPages().slice(-1)[0];
      const bed=p._furniture.find(f=>/床/.test(f.name)); return bed ? bed.id : null; });
    const x2 = await E(mp, id => { const p=getCurrentPages().slice(-1)[0];
      try {
        // 删除前：借 openBindPicker 数全量物品
        const pickOther = () => p._furniture.find(f => f.id !== id && p._targetNodeId(f.id));
        const other1 = pickOther();
        if (!other1) return {err:'无可替代数数家具'};
        p.setData({ selected: { id: other1.id, name: other1.name } });
        p.openBindPicker(); const before = p.data.bindableItems.length; p.closeBindPicker();
        // 确认删除（打桩 showModal 自动确认）
        const calls=[]; const orig=wx.showModal;
        wx.showModal=function(o){calls.push({title:o.title,content:(o.content||'').slice(0,80)}); if(o.success)o.success({confirm:true});};
        try { p.confirmRemove(id); } finally { wx.showModal=orig; }
        // 删除后：再数全量物品
        const other2 = pickOther();
        if (!other2) return {err:'删除后无可数家具', calls};
        p.setData({ selected: { id: other2.id, name: other2.name } });
        p.openBindPicker(); const after = p.data.bindableItems.length; p.closeBindPicker();
        return {calls, bedGone:!p.data.furniture.some(f=>f.id===id), before, after};
      } catch (e) { return {err:e.message, route:p.route}; }
    }, bedId);
    ok('X2 删除前有确认弹窗且声明物品去向', x2.calls && x2.calls.length===1 && x2.calls[0].title==='删除家具' && /未放置/.test(x2.calls[0].content),
      JSON.stringify(x2.calls && x2.calls[0] || x2));
    ok('X2 确认后家具被删除', x2.bedGone, `bed=${bedId}`);
    ok('X2 物品记录不丢（删除前后总数一致）', typeof x2.before==='number' && x2.before===x2.after,
      `before=${x2.before} after=${x2.after}`);

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
