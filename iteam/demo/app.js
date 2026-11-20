/* 居所收纳 · MVP 可交互演示
   数据为内存模拟，口径对齐 docs/proposal.md V1.2（CR-001）、业务规则 V1.1 与 MVP 冻结清单 V1.1。
   所有写操作都修改 state 并立即重绘右侧数据快照，便于确认流程与数据一致性。*/
(function () {
  'use strict';

  /* ============ 0. 工具 ============ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const e = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let seq = 100;
  const uid = p => p + '_' + (++seq);
  const now = () => Date.now();
  const fmt = ts => { const d = new Date(ts); const p = n => n < 10 ? '0' + n : '' + n; return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const I = (id, sz = 18) => `<svg width="${sz}" height="${sz}"><use href="#i-${id}"/></svg>`;

  function toast(msg, type) {
    const host = $('#toastHost');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, 1900);
  }
  const ok = m => toast(m, 'ok');
  const bad = m => toast(m, 'err');

  /* ============ 1. 模拟数据 ============ */
  const LIB = {
    '床': { icon: '🛏️', size: [1.7, .6, 2] }, '床头柜': { icon: '🗄️', size: [.55, .48, .42] },
    '台灯': { icon: '💡', size: [.36, .5, .36] }, '窗帘': { icon: '🪟', size: [2.7, 2.4, .1] },
    '沙发': { icon: '🛋️', size: [2, .9, .95] }, '茶几': { icon: '🪑', size: [1.1, .45, .62] },
    '电视柜': { icon: '📺', size: [1.8, .5, .42] }, '衣柜': { icon: '🚪', size: [1.2, 2, .55] },
    '书架': { icon: '📚', size: [.9, 1.8, .35] }, '收纳盒': { icon: '📦', size: [.4, .3, .3] },
    '抽屉': { icon: '🗳️', size: [.6, .2, .5] }
  };
  const TEMPLATES = {
    bedroom: { name: '卧室', items: [['床', '双人床', -1.2, .4], ['床头柜', '床头柜', -2, -.4], ['窗帘', '落地窗', .4, -2]] },
    living: { name: '客厅', items: [['沙发', '三人沙发', 0, 1.2], ['茶几', '茶几', 0, 0], ['电视柜', '电视柜', 0, -1.4]] },
    bath: { name: '卫生间', items: [['收纳盒', '浴室收纳盒', -.8, -.8], ['抽屉', '镜柜抽屉', .8, -1]] }
  };
  const TRACKS = { location: '只记位置', inventory: '只记库存', hybrid: '位置+库存' };
  const STATUS = { at_home: '在家', unknown: '位置未知', out: '外出携带', borrowed: '借出' };
  const TX = { in: '入库', consume: '消耗', adjust: '调整' };
  const MV = { initial: '初始存放信息', first_confirm: '首次位置确认', move: '移动', out: '外出/借出', return: '带回/归还', end: '结束管理' };
  const CATS = ['证件卡片', '家居布艺', '电子数码', '卫浴清洁', '书籍文具', '其他'];
  const UNITS = ['个', '件', '瓶', '包', '盒', '卷'];

  let S;
  function seed() {
    seq = 100;
    const sp = { id: 'sp1', name: '我的家', archived: false };
    const rm1 = { id: 'rm1', spaceId: sp.id, name: '主卧', width: 4.6, depth: 4.2, height: 2.8, templateKey: 'bedroom' };
    const rm2 = { id: 'rm2', spaceId: sp.id, name: '客厅', width: 4.2, depth: 3.8, height: 2.8, templateKey: 'living' };
    const rm3 = { id: 'rm3', spaceId: sp.id, name: '卫生间', width: 2.4, depth: 2, height: 2.6, templateKey: 'bath' };
    const furniture = [], nodes = [];
    function addF(rm, cat, name, x, z, model) {
      const f = { id: uid('fu'), roomId: rm.id, category: cat, name, model: model || LIB[cat].size && '默认', position: { x, y: 0, z }, rotation: 0, size: { w: LIB[cat].size[0], h: LIB[cat].size[1], d: LIB[cat].size[2] }, status: 'confirmed' };
      furniture.push(f);
      const n = { id: uid('nd'), roomId: rm.id, furnitureId: f.id, parentId: '', name, type: '家具' };
      nodes.push(n);
      return { f, n };
    }
    const bed = addF(rm1, '床', '双人床', -1.2, .4);
    const cab = addF(rm1, '床头柜', '床头柜', -2, -.4, '木色原木');
    addF(rm1, '窗帘', '落地窗', .4, -2);
    addF(rm2, '沙发', '三人沙发', 0, 1.2);
    addF(rm2, '茶几', '茶几', 0, 0);
    const tv = addF(rm2, '电视柜', '电视柜', 0, -1.4);
    addF(rm3, '收纳盒', '浴室收纳盒', -.8, -.8);
    const drawer = { id: 'nd_drawer', roomId: rm1.id, furnitureId: cab.f.id, parentId: cab.n.id, name: '上层抽屉', type: '抽屉/隔层' };
    nodes.push(drawer);
    const items = [
      { id: 'it1', name: '身份证', category: '证件卡片', trackingMode: 'location', currentNodeId: drawer.id, locationStatus: 'at_home', managementStatus: 'active', completed: 75, note: '', updatedAt: now() - 6e5 },
      { id: 'it2', name: '羊毛毯', category: '家居布艺', trackingMode: 'location', currentNodeId: bed.n.id, locationStatus: 'at_home', completed: 60, note: '', updatedAt: now() - 36e5 },
      { id: 'it3', name: '洗发水', category: '卫浴清洁', trackingMode: 'inventory', currentNodeId: '', locationStatus: 'at_home', completed: 60, note: '', updatedAt: now() - 864e5 },
      { id: 'it4', name: '抽纸', category: '卫浴清洁', trackingMode: 'inventory', currentNodeId: '', locationStatus: 'at_home', completed: 60, note: '', updatedAt: now() - 1728e5 },
      { id: 'it5', name: '备用钥匙', category: '其他', trackingMode: 'location', currentNodeId: '', locationStatus: 'unknown', completed: 40, note: '', updatedAt: now() - 2592e5 }
    ];
    return {
      spaces: [sp], activeSpaceId: sp.id, rooms: [rm1, rm2, rm3], furniture, nodes, items,
      movements: [{ id: 'mv1', itemId: 'it1', type: 'move', fromNodeId: tv.n.id, toNodeId: drawer.id, fromStatus: 'at_home', toStatus: 'at_home', note: '改放床头柜上层', createdAt: now() - 36e5 }],
      inventory: [{ itemId: 'it3', balance: 1, unit: '瓶', threshold: 2 }, { itemId: 'it4', balance: 8, unit: '包', threshold: 5 }],
      transactions: [
        { id: 'tx1', itemId: 'it3', type: 'in', delta: 2, balanceAfter: 3, note: '超市采购', createdAt: now() - 1728e5 },
        { id: 'tx2', itemId: 'it3', type: 'consume', delta: -2, balanceAfter: 1, note: '', createdAt: now() - 6e5 }
      ],
      alerts: [{ id: 'al1', itemId: 'it3', status: 'pending', createdAt: now() - 36e5 }],
      ui: { page: 'home', ctx: {}, stack: [], listMode: false, mode: '浏览', selF: cab.f.id, search: '', filter: 'all' },
      log: []
    };
  }

  /* ============ 2. 数据查询与业务操作（口径对齐 store.js） ============ */
  const activeSpace = () => S.spaces.find(s => s.id === S.activeSpaceId) || S.spaces[0];
  const roomsOf = sid => S.rooms.filter(r => r.spaceId === sid && !r.archived);
  const nodesOf = rid => S.nodes.filter(n => n.roomId === rid);
  const furnitureOf = rid => S.furniture.filter(f => f.roomId === rid);
  const itemById = id => S.items.find(i => i.id === id);
  const nodeById = id => S.nodes.find(n => n.id === id);
  const itemsOfNode = nid => S.items.filter(i => i.currentNodeId === nid && i.managementStatus !== 'ended');
  const itemsOfFurniture = fid => { const ids = S.nodes.filter(n => n.furnitureId === fid).map(n => n.id); return S.items.filter(i => ids.includes(i.currentNodeId) && i.managementStatus !== 'ended'); };
  const invOf = iid => S.inventory.find(v => v.itemId === iid);
  function pathOf(nid) {
    const out = []; let cur = nodeById(nid), guard = 0;
    while (cur && guard++ < 8) { out.unshift(cur.name); cur = cur.parentId ? nodeById(cur.parentId) : null; }
    return out;
  }
  function locationText(it) {
    if (it.locationStatus === 'un known' || it.locationStatus === 'unknown') return '位置未知';
    if (it.locationStatus === 'out' || it.locationStatus === 'borrowed') return STATUS[it.locationStatus];
    const p = pathOf(it.currentNodeId);
    return p.length ? p.join(' / ') : '位置未知';
  }
  function writeLog(text) { S.log.unshift({ text, at: fmt(now()) }); if (S.log.length > 12) S.log.pop(); }
  function commit(msg) { if (msg) writeLog(msg); render(); }
  function completion(it) {
    let n = 1;
    if (it.category) n++; if (it.note) n++; if (it.photo) n++;
    if (it.currentNodeId || it.locationStatus !== 'unknown') n++;
    return Math.round(n / 5 * 100);
  }
  function refreshAlerts(iid) {
    const iv = invOf(iid); if (!iv || iv.threshold <= 0) return;
    const low = iv.balance <= iv.threshold;
    const open = S.alerts.find(a => a.itemId === iid && a.status !== 'recovered');
    if (low && !open) S.alerts.push({ id: uid('al'), itemId: iid, status: 'pending', createdAt: now() });
    else if (!low && open) { open.status = 'recovered'; open.recoveredAt = now(); }
  }
  function moveItem(item, patch, typeOverride) {
    const from = item.currentNodeId, fromStatus = item.locationStatus;
    const wasUnknown = fromStatus === 'unknown' || !from;
    const goingOut = (patch.locationStatus === 'out' || patch.locationStatus === 'borrowed') && fromStatus === 'at_home';
    const returning = (fromStatus === 'out' || fromStatus === 'borrowed') && patch.locationStatus === 'at_home';
    const type = typeOverride || (wasUnknown && patch.currentNodeId && patch.locationStatus === 'at_home' ? 'first_confirm' : goingOut ? 'out' : returning ? 'return' : 'move');
    item.currentNodeId = patch.currentNodeId !== undefined ? patch.currentNodeId : item.currentNodeId;
    item.locationStatus = patch.locationStatus || item.locationStatus;
    item.updatedAt = now(); item.completed = completion(item);
    S.movements.unshift({ id: uid('mv'), itemId: item.id, type, fromNodeId: from, toNodeId: item.currentNodeId, fromStatus, toStatus: item.locationStatus, note: patch.note || '', createdAt: now() });
    return type;
  }

  /* ============ 3. 导航 ============ */
  const TABS = [
    { p: 'home', label: '首页', icon: 'home' }, { p: 'room', label: '空间', icon: 'grid' },
    { p: 'itemList', label: '物品', icon: 'box' }, { p: 'inventory', label: '库存', icon: 'list' },
    { p: 'profile', label: '我的', icon: 'user' }
  ];
  function nav(p, ctx, push) {
    if (push !== false) S.ui.stack.push({ page: S.ui.page, ctx: S.ui.ctx });
    S.ui.page = p; S.ui.ctx = ctx || {};
    render();
  }
  function back() {
    const prev = S.ui.stack.pop();
    if (prev) { S.ui.page = prev.page; S.ui.ctx = prev.ctx; render(); }
    else toast('已经在首页');
  }

  /* ============ 4. 页面渲染 ============ */
  const PAGE_TITLE = {
    home: '首页', space: '空间列表', room: '房间', room3d: '三维房间', furniture: '家具详情',
    node: '收纳节点', itemList: '物品', itemEdit: '物品建档', itemDetail: '物品详情',
    move: '移动物品', history: '位置历史', inventory: '库存总览', inventoryDetail: '库存详情',
    alerts: '提醒中心', profile: '我的'
  };
  function statusbar() {
    return `<div class="statusbar"><span>9:41</span><span class="sb-r">
      <svg width="17" height="12"><g fill="currentColor"><rect x="0" y="8" width="2.5" height="4" rx=".6"/><rect x="4" y="6" width="2.5" height="6" rx=".6"/><rect x="8" y="3" width="2.5" height="9" rx=".6"/><rect x="12" y="0" width="2.5" height="12" rx=".6"/></g></svg>
      <svg width="15" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 4a10 10 0 0 1 14 0M3.5 6.7a6.5 6.5 0 0 1 9 0M6 9.4a3 3 0 0 1 4 0"/><circle cx="8" cy="11.4" r=".7" fill="currentColor" stroke="none"/></svg>
      <svg width="21" height="12"><rect x="1" y="1" width="18" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3" y="3" width="12" height="6" rx="1" fill="currentColor"/></svg>
    </span></div>`;
  }
  function appbar() {
    const p = S.ui.page, t = PAGE_TITLE[p] || '首页';
    const isRoot = TABS.some(x => x.p === p);
    let left = isRoot ? '' : `<div class="icon-btn plain" data-act="back">${I('back', 17)}</div>`;
    let right = '';
    if (p === 'home') right = `<div class="icon-btn tint" data-act="goto" data-p="alerts">康</div>`;
    if (p === 'room3d') right = `<div class="icon-btn plain" data-act="toggle-list">${I(S.ui.listMode ? 'eye' : 'list', 17)}</div>`;
    if (p === 'itemDetail') right = `<div class="icon-btn plain" data-act="goto" data-p="itemEdit" data-id="${e(S.ui.ctx.id)}">${I('edit', 16)}</div>`;
    return `<div class="appbar">${left}<div class="ab-title ${isRoot ? '' : 'sm'}">${e(t)}</div><div class="grow"></div>${right}</div>`;
  }
  function tabbar() {
    if (!TABS.some(x => x.p === S.ui.page)) return '';
    return `<div class="tabbar">${TABS.map(t => `<div class="tb ${t.p === S.ui.page ? 'on' : ''}" data-act="goto" data-p="${t.p}">${I(t.icon, 20)}${t.p === S.ui.page ? `<b>${t.label}</b>` : t.label}</div>`).join('')}</div>`;
  }
  function body() {
    switch (S.ui.page) {
      case 'home': return pHome(); case 'space': return pSpace(); case 'room': return pRoom();
      case 'room3d': return pRoom3d(); case 'furniture': return pFurniture(); case 'node': return pNode();
      case 'itemList': return pItemList(); case 'itemEdit': return pItemEdit(); case 'itemDetail': return pItemDetail();
      case 'move': return pMove(); case 'history': return pHistory(); case 'inventory': return pInventory();
      case 'inventoryDetail': return pInventoryDetail(); case 'alerts': return pAlerts(); case 'profile': return pProfile();
      default: return pHome();
    }
  }
  function cta(html) { return html ? `<div class="bottom-cta">${html}</div>` : ''; }

  function pHome() {
    const sp = activeSpace();
    const rooms = roomsOf(sp.id).length;
    const items = S.items.filter(i => i.managementStatus !== 'ended');
    const alerts = S.alerts.filter(a => a.status === 'pending' || a.status === 'ignored');
    const lowNames = alerts.map(a => { const it = itemById(a.itemId); const iv = invOf(a.itemId); return it && iv ? `${it.name}剩 ${iv.balance} ${iv.unit}` : ''; }).filter(Boolean);
    const recent = S.log.slice(0, 2);
    return `<div class="scroll">
      <div class="hero-mini"><div><div class="hm-t">上午好，康女士</div><div class="hm-n">${e(sp.name)} ${I('chev-d', 13)}</div></div></div>
      <div class="card" style="margin-top:10px"><div class="stat-grid">
        <div class="stat"><div class="n">${rooms}</div><div class="l">房间</div></div>
        <div class="stat"><div class="n">${items.length}</div><div class="l">物品</div></div>
        <div class="stat"><div class="n">${S.inventory.length}</div><div class="l">库存</div></div>
        <div class="stat alert-n"><div class="n">${alerts.length}</div><div class="l">提醒</div></div>
      </div></div>
      ${alerts.length ? `<div class="remind" style="margin-top:10px" data-act="goto" data-p="alerts"><div class="ri">${I('bell', 18)}</div><div class="rt"><b>${alerts.length} 项库存提醒</b><span>${e(lowNames.join(' · '))}</span></div><div class="go">查看</div></div>` : ''}
      <div class="card" style="margin-top:10px"><div class="quick">
        <div class="q" data-act="goto" data-p="room"><div class="qi">${I('grid', 22)}</div><span>房间</span></div>
        <div class="q" data-act="goto" data-p="itemEdit"><div class="qi">${I('plus', 22)}</div><span>加物品</span></div>
        <div class="q" data-act="goto" data-p="room3d" data-id="${roomsOf(sp.id)[0] ? roomsOf(sp.id)[0].id : ''}"><div class="qi">${I('eye', 22)}</div><span>三维</span></div>
        <div class="q" data-act="goto" data-p="inventory"><div class="qi">${I('list', 22)}</div><span>库存</span></div>
      </div></div>
      <div class="card" style="margin-top:10px"><div class="card-t" style="margin-bottom:4px">最近变动</div>
        ${recent.length ? recent.map(l => `<div class="row"><div class="dot ac">${I('sync', 15)}</div><div class="rt"><b>${e(l.text)}</b><span>${e(l.at)}</span></div></div>`).join('') : `<div class="empty">暂无变动，去建一份档案吧</div>`}
      </div>
    </div>`;
  }
  function pSpace() {
    return `<div class="scroll">
      ${S.spaces.map(s => `<div class="card" data-act="activate-space" data-id="${s.id}" style="cursor:pointer;border:${s.id === S.activeSpaceId ? '1.5px solid var(--accent)' : ''}">
        <div style="display:flex;align-items:center;gap:10px"><div class="dot ac" style="width:34px;height:34px;border-radius:11px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center">${I('home', 18)}</div>
        <div style="flex:1"><div class="card-t">${e(s.name)}</div><div class="muted">${roomsOf(s.id).length} 个房间 · 个人空间</div></div>
        ${s.id === S.activeSpaceId ? '<span class="chip accent">当前</span>' : ''}</div></div>`).join('')}
      <div class="note-inline">首版仅支持个人单用户，不支持家庭成员共享；可创建多个空间分别管理。</div>
    </div>` + cta(`<div class="btn primary" data-act="new-space">＋ 新建空间</div>`);
  }
  function pRoom() {
    const sp = activeSpace();
    const list = roomsOf(sp.id);
    return `<div class="scroll">
      <div class="muted" style="margin:2px 0 8px">${e(sp.name)} · 共 ${list.length} 个房间</div>
      ${list.length ? list.map(r => `<div class="card" style="cursor:pointer" data-act="goto" data-p="room3d" data-id="${r.id}">
        <div style="display:flex;align-items:center;gap:10px"><div style="width:40px;height:40px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center">${I('grid', 20)}</div>
        <div style="flex:1"><div class="card-t">${e(r.name)}</div><div class="muted">${r.width}×${r.depth}×${r.height} m · ${furnitureOf(r.id).length} 件家具</div></div>${I('chev', 15)}</div>
        <div class="chips"><span class="chip neutral">${r.templateKey ? '场景模板' : '空白房间'}</span><span class="chip good"><span class="cdot"></span>用户确认事实</span></div>
      </div>`).join('') : `<div class="card"><div class="empty"><div class="ei">🗂️</div>还没有房间，先建一个吧</div></div>`}
      <div class="note-inline">房间可先以基础信息存在；三维不是业务数据可用的前提，WebGL 失败可切列表管理。</div>
    </div>` + cta(`<div class="btn-row"><div class="btn" data-act="goto" data-p="space">空间列表</div><div class="btn primary" data-act="new-room">＋ 新建房间</div></div>`);
  }
  function pRoom3d() {
    const r = S.rooms.find(x => x.id === S.ui.ctx.id) || roomsOf(activeSpace().id)[0];
    if (!r) return `<div class="scroll"><div class="empty">请先创建房间</div></div>`;
    S.ui.ctx.id = r.id;
    const fs = furnitureOf(r.id);
    const sel = fs.find(f => f.id === S.ui.selF) || fs[0];
    const bound = sel ? itemsOfFurniture(sel.id) : [];
    const furnHtml = fs.map(f => {
      const left = 18 + (f.position.x + (r.width / 2)) / r.width * 54;
      const top = 16 + (f.position.z + (r.depth / 2)) / r.depth * 52;
      const w = Math.max(10, Math.min(38, f.size.w / r.width * 100));
      return `<div class="furn ${sel && sel.id === f.id ? 'sel' : ''}" data-act="select-f" data-id="${f.id}" style="left:${left}%;top:${top}%;width:${w}%;height:${Math.max(8, Math.min(20, f.size.d / r.depth * 100))}%">${e(f.name.slice(0, 4))}<span class="cap">${e(f.name)}</span></div>`;
    }).join('');
    return `<div class="scroll">
      <div class="segbar"><span class="s ${S.ui.mode === '浏览' ? 'on' : ''}" data-act="mode" data-v="浏览">浏览</span><span class="s ${S.ui.mode === '编辑' ? 'on' : ''}" data-act="mode" data-v="编辑">编辑</span><span class="s ${S.ui.mode === '收纳' ? 'on' : ''}" data-act="mode" data-v="收纳">收纳</span></div>
      ${S.ui.listMode ? `<div class="card" style="margin-top:10px"><div class="card-t">家具列表（三维降级）</div>${fs.map(f => `<div class="row" data-act="goto" data-p="furniture" data-id="${f.id}"><div class="dot">${I('box', 15)}</div><div class="rt"><b>${e(f.name)}</b><span>${itemsOfFurniture(f.id).length} 件关联物品</span></div>${I('chev', 14)}</div>`).join('') || '<div class="empty">暂无家具</div>'}</div>` : `
      <div class="canvas3d"><div class="floor"></div>${furnHtml}<div class="canvas-hint">${S.ui.mode === '编辑' ? '选中模型后可用下方按钮编辑' : '点选模型可查看与编辑'}</div></div>`}
      ${sel ? `<div class="card" style="margin-top:10px">
        <div style="display:flex;align-items:center;gap:6px"><div class="card-t">${e(sel.name)}</div><span class="chip good" style="margin-left:auto"><span class="cdot"></span>已保存</span></div>
        <div class="field-row"><div class="field"><span class="fl">位置 X / Z</span><div class="fv" style="font-size:11.5px;background:var(--surface-2);padding:7px 8px;border-radius:10px">${sel.position.x} / ${sel.position.z}</div></div>
          <div class="field"><span class="fl">旋转</span><div class="fv" style="font-size:11.5px;background:var(--surface-2);padding:7px 8px;border-radius:10px">${Math.round(sel.rotation * 180 / Math.PI)}°</div></div>
          <div class="field"><span class="fl">宽×深×高</span><div class="fv" style="font-size:11px;background:var(--surface-2);padding:7px 8px;border-radius:10px">${sel.size.w}×${sel.size.d}×${sel.size.h}</div></div></div>
        <div class="bind" data-act="goto" data-p="furniture" data-id="${sel.id}" style="cursor:pointer"><div class="bi">${I('link', 17)}</div><div class="bt"><b>${bound.length ? '已绑定物品' : '未绑定物品'}</b><span>${bound.length ? bound.map(i => i.name).join('、') : '从家具详情创建节点并绑定'}</span></div>${I('chev', 14)}</div>
        ${S.ui.mode === '编辑' ? `<div class="btn-row"><div class="btn tiny" data-act="xf" data-op="move">移动</div><div class="btn tiny" data-act="xf" data-op="rotate">旋转</div><div class="btn tiny" data-act="xf" data-op="scale">缩放</div></div>
        <div class="note-inline">越界自动钳制到房间范围与合理尺寸上下限，不产生非法布局。</div>` : ''}
      </div>` : `<div class="card" style="margin-top:10px"><div class="empty">房间还是空的，从模型库添加第一件家具</div></div>`}
      <div class="card" style="margin-top:10px"><div class="card-t" style="margin-bottom:6px">家具模型库</div><div class="library">
        ${Object.keys(LIB).map(k => `<div class="lib-item" data-act="add-f" data-cat="${k}"><div class="li">${LIB[k].icon}</div>${k}</div>`).join('')}
      </div></div>
    </div>`;
  }
  function pFurniture() {
    const f = S.furniture.find(x => x.id === S.ui.ctx.id) || S.furniture[0];
    if (!f) return `<div class="scroll"><div class="empty">未找到家具</div></div>`;
    const root = S.nodes.find(n => n.furnitureId === f.id && !n.parentId);
    const kids = root ? S.nodes.filter(n => n.parentId === root.id) : [];
    const bound = itemsOfFurniture(f.id);
    return `<div class="scroll">
      <div class="card"><div style="display:flex;align-items:center;gap:10px"><div style="width:44px;height:44px;border-radius:12px;background:var(--accent-soft);font-size:22px;display:flex;align-items:center;justify-content:center">${LIB[f.category] ? LIB[f.category].icon : '📦'}</div>
        <div style="flex:1"><div class="card-t">${e(f.name)}</div><div class="muted">${e(f.category)} · 模型：${e(f.model)}</div></div></div>
        <div class="note-inline">模型外观与逻辑收纳节点解耦：更换模型不会破坏节点与物品关联。</div>
        <div class="btn-row"><div class="btn tiny" data-act="change-model">更换外观模型</div><div class="btn danger tiny" data-act="del-f">删除家具</div></div>
      </div>
      <div class="card"><div class="card-t">收纳节点 <span class="more" data-act="add-node">＋ 新增</span></div>
        ${root ? `<div class="tree-node" data-act="goto" data-p="node" data-id="${root.id}"><span style="color:var(--accent)">${I('layers', 15)}</span><span class="tn">${e(root.name)}</span><span class="chip neutral">家具</span></div>
          ${kids.map(n => `<div class="tree-node child" data-act="goto" data-p="node" data-id="${n.id}"><span class="tn">${e(n.name)}</span><span class="chip neutral">${e(n.type)}</span>${I('chev', 13)}</div>`).join('')}` : '<div class="empty">暂无节点</div>'}
      </div>
      <div class="card"><div class="card-t">关联物品（${bound.length}）</div>
        ${bound.length ? bound.map(i => `<div class="row" data-act="goto" data-p="itemDetail" data-id="${i.id}"><div class="dot ac">${I('box', 15)}</div><div class="rt"><b>${e(i.name)}</b><span>${e(pathOf(i.currentNodeId).join(' / '))}</span></div>${I('chev', 14)}</div>`).join('') : '<div class="empty">还没有物品绑定到这里</div>'}
      </div>
    </div>`;
  }
  function pNode() {
    const n = nodeById(S.ui.ctx.id) || S.nodes[0];
    if (!n) return `<div class="scroll"><div class="empty">未找到节点</div></div>`;
    const items = itemsOfNode(n.id);
    const kids = S.nodes.filter(x => x.parentId === n.id);
    return `<div class="scroll">
      <div class="card"><div class="muted">${e(pathOf(n.id).join(' / '))}</div><div class="card-t" style="margin-top:4px">${e(n.name)}</div>
        <div class="chips"><span class="chip neutral">${e(n.type)}</span><span class="chip good">用户确认事实</span></div>
        <div class="btn-row"><div class="btn tiny" data-act="rename-node">重命名</div><div class="btn danger tiny" data-act="del-node">删除节点</div></div>
      </div>
      <div class="card"><div class="card-t">下级位置 <span class="more" data-act="add-child-node">＋ 新增</span></div>
        ${kids.length ? kids.map(k => `<div class="tree-node child" data-act="goto" data-p="node" data-id="${k.id}"><span class="tn">${e(k.name)}</span>${I('chev', 13)}</div>`).join('') : '<div class="empty">无下级位置</div>'}
      </div>
      <div class="card"><div class="card-t">节点内物品（${items.length}）</div>
        ${items.length ? items.map(i => `<div class="row" data-act="goto" data-p="itemDetail" data-id="${i.id}"><div class="dot ac">${I('box', 15)}</div><div class="rt"><b>${e(i.name)}</b><span>${e(TRACKS[i.trackingMode])}</span></div>${I('chev', 14)}</div>`).join('') : '<div class="empty">该节点暂无物品</div>'}
      </div>
      <div class="note-inline">删除含下级节点或关联物品的节点会被阻断，须先迁移或归档。</div>
    </div>` + cta(`<div class="btn primary" data-act="goto" data-p="itemEdit" data-node="${n.id}">在此位置添加物品</div>`);
  }
  function pItemList() {
    const kw = S.ui.search.toLowerCase();
    let list = S.items.filter(i => i.managementStatus !== 'ended');
    if (kw) list = list.filter(i => i.name.toLowerCase().includes(kw) || (i.category || '').toLowerCase().includes(kw));
    if (S.ui.filter === 'unknown') list = list.filter(i => i.locationStatus === 'unknown');
    if (S.ui.filter === 'low') list = list.filter(i => { const v = invOf(i.id); return v && v.threshold > 0 && v.balance <= v.threshold; });
    return `<div class="scroll">
      <div class="searchbar">${I('grid', 15)}<input id="searchInput" placeholder="搜索物品名称 / 分类" value="${e(S.ui.search)}" data-act="search-input"><span class="chip neutral">${list.length}</span></div>
      <div class="chips" style="margin-bottom:4px">
        ${[['all', '全部'], ['unknown', '位置未知'], ['low', '低库存']].map(([k, l]) => `<span class="chip ${S.ui.filter === k ? 'accent' : 'neutral'}" data-act="filter" data-v="${k}" style="cursor:pointer">${l}</span>`).join('')}
      </div>
      ${list.length ? list.map(i => {
        const v = invOf(i.id), low = v && v.threshold > 0 && v.balance <= v.threshold;
        return `<div class="card" style="cursor:pointer;margin-top:8px" data-act="goto" data-p="itemDetail" data-id="${i.id}">
          <div style="display:flex;align-items:center;gap:10px"><div style="width:36px;height:36px;border-radius:11px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center">${I('box', 18)}</div>
          <div style="flex:1;min-width:0"><div class="card-t">${e(i.name)}</div><div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(locationText(i))}</div></div>
          ${low ? '<span class="chip alert"><span class="cdot"></span>低库存</span>' : `<span class="chip neutral">${e(TRACKS[i.trackingMode])}</span>`}</div>
        </div>`;
      }).join('') : `<div class="card"><div class="empty"><div class="ei">🔍</div>没有匹配的物品</div></div>`}
      <div class="fab" data-act="goto" data-p="itemEdit">${I('plus', 22)}</div>
    </div>`;
  }
  function pItemEdit() {
    const it = S.ui.ctx.id ? itemById(S.ui.ctx.id) : null;
    const presetNode = S.ui.ctx.node || '';
    return `<div class="scroll">
      <div class="card"><div class="card-t">${it ? '完善档案' : '新建物品档案'}</div><div class="muted">${it ? '仅名称即可建档，其余信息随时补充' : '只需名称即可保存；分类、照片、位置可后续补充（渐进式建档）'}</div>
        <div class="field"><label class="fl">名称 <span style="color:var(--alert)">*必填</span></label><input id="fName" value="${e(it ? it.name : '')}" placeholder="例如：蓝牙耳机"></div>
        <div class="field two"><div class="field"><label class="fl">分类</label><select id="fCat"><option value="">未分类</option>${CATS.map(c => `<option ${it && it.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label class="fl">跟踪模式</label><select id="fTrack">${Object.keys(TRACKS).map(k => `<option value="${k}" ${it && it.trackingMode === k ? 'selected' : ''}>${TRACKS[k]}</option>`).join('')}</select></div></div>
        <div class="field"><label class="fl">当前位置</label><select id="fNode"><option value="">位置未知 / 暂不指定</option>${S.nodes.map(n => `<option value="${n.id}" ${presetNode === n.id || (it && it.currentNodeId === n.id) ? 'selected' : ''}>${e(pathOf(n.id).join(' / '))}</option>`).join('')}</select></div>
        <div class="field"><label class="fl">备注（可选）</label><input id="fNote" value="${e(it ? it.note : '')}" placeholder="备注信息"></div>
        <div class="note-inline">创建时填写的位置属于初始存放信息，不会记为一次「移动」。</div>
      </div>
    </div>` + cta(`<div class="btn-row"><div class="btn" data-act="save-item" data-continue="1">保存并继续</div><div class="btn primary" data-act="save-item">${it ? '保存' : '建档'}</div></div>`);
  }
  function pItemDetail() {
    const it = itemById(S.ui.ctx.id);
    if (!it) return `<div class="scroll"><div class="empty">未找到物品</div></div>`;
    const v = invOf(it.id), low = v && v.threshold > 0 && v.balance <= v.threshold;
    return `<div class="scroll">
      <div class="card"><div style="display:flex;align-items:center;gap:12px"><div style="width:52px;height:52px;border-radius:13px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center">${I('box', 26)}</div>
        <div style="flex:1"><div style="font-family:var(--font-serif);font-size:19px;font-weight:600">${e(it.name)}</div><div class="muted">${e(it.category || '未分类')} · ${e(TRACKS[it.trackingMode])}</div></div>
        <span class="chip neutral">档案 ${it.completed}%</span></div><div class="progress"><i style="width:${it.completed}%"></i></div>
      </div>
      <div class="card"><div class="chip ${it.locationStatus === 'at_home' && it.currentNodeId ? 'good' : it.locationStatus === 'unknown' ? 'alert' : 'neutral'}"><span class="cdot"></span>${it.currentNodeId && it.locationStatus === 'at_home' ? '已定位' : STATUS[it.locationStatus]}</div>
        <div class="path" style="margin-top:8px">${e(locationText(it))}</div><div class="muted">最近更新：${fmt(it.updatedAt || now())}</div>
        <div class="chips">${Object.keys(STATUS).map(k => `<span class="chip ${it.locationStatus === k ? 'accent' : 'neutral'}">${STATUS[k]}</span>`).join('')}</div>
      </div>
      ${v ? `<div class="card"><div style="display:flex;align-items:center"><div class="card-t">库存</div><span class="chip ${low ? 'alert' : 'good'}" style="margin-left:auto">${low ? '低于阈值' : '正常'}</span></div>
        <div style="font-size:22px;font-weight:700;margin-top:4px">${v.balance} <span style="font-size:12px;color:var(--ink-3)">${v.unit}</span></div>
        <div class="muted">最低库存阈值：${v.threshold} ${v.unit}</div>
        <div class="btn-row"><div class="btn tiny" data-act="goto" data-p="inventoryDetail" data-id="${it.id}">查看交易流水</div></div>
      </div>` : ''}
      <div class="card"><div class="card-t" style="margin-bottom:4px">操作</div><div class="ops">
        <div class="op" data-act="goto" data-p="itemEdit" data-id="${it.id}">${I('edit', 16)} 编辑档案 ${I('chev', 13, 'chev')}</div>
        <div class="op" data-act="goto" data-p="move" data-id="${it.id}">${I('move', 16)} 移动物品 ${I('chev', 13, 'chev')}</div>
        <div class="op" data-act="goto" data-p="history" data-id="${it.id}">${I('clock', 16)} 位置历史 ${I('chev', 13, 'chev')}</div>
        <div class="op danger" data-act="end-item" data-id="${it.id}">${I('warn', 16)} 结束管理 ${I('chev', 13, 'chev')}</div>
      </div></div>
    </div>` + cta(`<div class="btn primary" data-act="goto" data-p="move" data-id="${it.id}">移动物品</div>`);
  }
  function pMove() {
    const it = itemById(S.ui.ctx.id);
    if (!it) return `<div class="scroll"><div class="empty">未找到物品</div></div>`;
    const spaces = S.spaces.map(sp => `<div class="muted" style="margin-top:10px">${e(sp.name)}</div>${roomsOf(sp.id).map(r => `<div class="tree-node" style="cursor:default;background:transparent;border:1px solid var(--line)">${e(r.name)}</div>${nodesOf(r.id).filter(n => !n.parentId).map(n => `<div class="tree-node child" data-act="pick-node" data-id="${n.id}" style="${it.currentNodeId === n.id ? 'border-color:var(--accent)' : ''}"><span class="tn">${e(n.name)}</span>${S.nodes.filter(x => x.parentId === n.id).map(x => `<span class="chip neutral" data-act="pick-node" data-id="${x.id}">${e(x.name)}</span>`).join('')}</div>`).join('')}`).join('')}`).join('');
    return `<div class="scroll">
      <div class="card"><div class="card-t">${e(it.name)}</div><div class="muted">当前位置：${e(locationText(it))}</div></div>
      <div class="card"><div class="card-t" style="margin-bottom:2px">目标状态</div><div class="chips">${Object.keys(STATUS).map(k => `<span class="chip ${S.ui.ctx.status === k || (!S.ui.ctx.status && it.locationStatus === k) ? 'accent' : 'neutral'}" data-act="pick-status" data-v="${k}" style="cursor:pointer">${STATUS[k]}</span>`).join('')}</div></div>
      <div class="card"><div class="card-t">目标位置（收纳节点）</div>${spaces}<div class="note-inline">选择「在家」需同时选定具体位置；未知首次确认到具体位置记为独立事件。</div></div>
      <div class="field"><label class="fl">备注（可选）</label><input id="mvNote" placeholder="例如：从客厅移回主卧"></div>
    </div>` + cta(`<div class="btn primary" data-act="confirm-move">确认移动</div>`);
  }
  function pHistory() {
    const it = itemById(S.ui.ctx.id);
    const list = S.movements.filter(m => !it || m.itemId === it.id);
    return `<div class="scroll"><div class="card"><div class="card-t">${it ? e(it.name) + ' · ' : ''}位置历史（${list.length}）</div>
      ${list.length ? `<div class="timeline" style="margin-top:12px">${list.map(m => `<div class="tl-item"><div class="tl-t"><span class="chip ${m.type === 'first_confirm' ? 'accent' : 'neutral'}">${MV[m.type]}</span></div>
        <div class="tl-d">${e(m.fromNodeId ? pathOf(m.fromNodeId).join(' / ') : STATUS[m.fromStatus] || '位置未知')} → ${e(m.toNodeId ? pathOf(m.toNodeId).join(' / ') : STATUS[m.toStatus] || '位置未知')}</div>
        <div class="tl-d">${fmt(m.createdAt)}${m.note ? ' · ' + e(m.note) : ''}</div></div>`).join('')}</div>` : '<div class="empty">暂无历史</div>'}
      </div><div class="note-inline">当前位置与历史在同一事务内更新；首次位置确认不伪装为 A→B 移动。</div></div>`;
  }
  function pInventory() {
    const list = S.inventory.map(v => ({ v, it: itemById(v.itemId) })).filter(x => x.it);
    list.sort((a, b) => (a.v.balance - a.v.threshold) - (b.v.balance - b.v.threshold));
    return `<div class="scroll">
      ${list.length ? list.map(({ v, it }) => `<div class="card" style="cursor:pointer" data-act="goto" data-p="inventoryDetail" data-id="${it.id}">
        <div style="display:flex;align-items:center;gap:10px"><div style="width:36px;height:36px;border-radius:11px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center">${I('box', 18)}</div>
        <div style="flex:1"><div class="card-t">${e(it.name)}</div><div class="muted">阈值 ${v.threshold} ${v.unit} · ${e(it.category || '易耗品')}</div></div>
        <div style="text-align:right"><div style="font-size:17px;font-weight:700;color:${v.balance <= v.threshold ? 'var(--alert)' : 'var(--ink)'}">${v.balance}</div><div class="muted">${v.unit}</div></div></div>
      </div>`).join('') : `<div class="card"><div class="empty">暂无库存物品</div></div>`}
      <div class="note-inline">库存不得低于零；纠错走「调整」交易，与真实消耗分开记录。</div>
    </div>` + cta(`<div class="btn" data-act="goto" data-p="alerts">查看提醒中心</div>`);
  }
  function pInventoryDetail() {
    const it = itemById(S.ui.ctx.id);
    const v = it && invOf(it.id);
    if (!v) return `<div class="scroll"><div class="empty">该物品未启用库存跟踪</div></div>`;
    const txs = S.transactions.filter(t => t.itemId === it.id);
    const low = v.balance <= v.threshold;
    return `<div class="scroll">
      <div class="card"><div class="card-t">${e(it.name)}</div><div style="display:flex;align-items:baseline;gap:6px;margin-top:6px"><span style="font-size:28px;font-weight:700;color:${low ? 'var(--alert)' : 'var(--ink)'}">${v.balance}</span><span class="muted">${v.unit} · 阈值 ${v.threshold}</span></div>
        <div class="progress"><i style="width:${Math.min(100, Math.round(v.balance / Math.max(1, v.threshold * 2) * 100))}%;background:${low ? 'var(--alert)' : 'var(--accent)'}"></i></div>
        ${low ? `<div class="chip alert" style="margin-top:8px"><span class="cdot"></span>达到最低库存，已生成提醒</div>` : ''}
      </div>
      <div class="card"><div class="card-t" style="margin-bottom:4px">库存变更</div>
        <div class="field row two" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px"><input id="txAmount" type="number" min="1" value="1" placeholder="数量"><input id="txNote" placeholder="说明（可选）"></div>
        <div class="btn-row"><div class="btn tiny" data-act="tx" data-v="in">入库</div><div class="btn tiny" data-act="tx" data-v="consume">消耗</div><div class="btn tiny" data-act="tx" data-v="adjust">调整</div></div>
      </div>
      <div class="card"><div class="card-t">交易流水（${txs.length}）</div>
        ${txs.length ? txs.map(t => `<div class="row" style="cursor:default"><div class="dot ac">${I(t.delta > 0 ? 'plus' : 'move', 15)}</div><div class="rt"><b>${TX[t.type]} ${t.delta > 0 ? '+' : ''}${t.delta} ${v.unit}</b><span>${fmt(t.createdAt)}${t.note ? ' · ' + e(t.note) : ''}</span></div><div class="tm">余额 ${t.balanceAfter}</div></div>`).join('') : '<div class="empty">暂无交易</div>'}
      </div>
    </div>`;
  }
  function pAlerts() {
    const list = S.alerts.filter(a => a.status !== 'recovered');
    return `<div class="scroll">
      ${list.length ? list.map(a => { const it = itemById(a.itemId), v = invOf(a.itemId); return `<div class="card">
        <div style="display:flex;align-items:center;gap:10px"><div class="ri" style="width:34px;height:34px;border-radius:10px;background:var(--alert-soft);color:var(--alert);display:flex;align-items:center;justify-content:center">${I('bell', 18)}</div>
        <div style="flex:1"><div class="card-t">${e(it ? it.name : '未知物品')}</div><div class="muted">${v ? `当前 ${v.balance} ${v.unit} · 阈值 ${v.threshold}` : ''} · ${a.status === 'ignored' ? '已忽略' : '待处理'}</div></div></div>
        <div class="btn-row"><div class="btn tiny" data-act="goto" data-p="inventoryDetail" data-id="${a.itemId}">去处理</div><div class="btn danger tiny" data-act="ignore-alert" data-id="${a.id}">忽略</div></div>
      </div>`; }).join('') : `<div class="card"><div class="empty"><div class="ei">✅</div>暂无待处理提醒</div></div>`}
      <div class="note-inline">补货使余额高于阈值后，当前提醒周期自动结束并恢复。</div>
    </div>`;
  }
  function pProfile() {
    return `<div class="scroll">
      <div class="card"><div style="display:flex;align-items:center;gap:12px"><div class="icon-btn tint" style="width:44px;height:44px;font-size:17px">康</div><div><div class="card-t">康女士</div><div class="muted">个人单用户 · 本地演示模式</div></div></div>
        <div class="chips" style="margin-top:10px"><span class="chip good"><span class="cdot"></span>本地可用</span><span class="chip neutral">待同步标记由真实后端处理</span></div>
      </div>
      <div class="card"><div class="ops">
        <div class="op" data-act="goto" data-p="space">${I('grid', 16)} 空间与房间 ${I('chev', 13, 'chev')}</div>
        <div class="op" data-act="goto" data-p="history">${I('clock', 16)} 全部位置历史 ${I('chev', 13, 'chev')}</div>
        <div class="op" data-act="goto" data-p="alerts">${I('bell', 16)} 提醒中心 ${I('chev', 13, 'chev')}</div>
        <div class="op" data-act="reset-demo">${I('sync', 16)} 重置演示数据 ${I('chev', 13, 'chev')}</div>
      </div></div>
      <div class="note-inline">本页数据全部为模拟数据；真实版本的数据隔离、照片私有存储与备份恢复由后端实现，本演示不涉及。</div>
    </div>`;
  }

  function render() {
    $('#screen').innerHTML = statusbar() + appbar() + body() + tabbar();
    const p = S.ui.page;
    $('#crumb').textContent = '当前：' + (PAGE_TITLE[p] || p);
    renderData();
  }
  function renderData() {
    const pending = S.alerts.filter(a => a.status !== 'recovered').length;
    const cells = [
      [S.spaces.length, '空间'], [S.rooms.length, '房间'], [S.furniture.length, '家具'],
      [S.nodes.length, '节点'], [S.items.length, '物品'], [S.movements.length, '历史'],
      [S.inventory.length, '库存'], [S.transactions.length, '交易'], [pending, '提醒']
    ];
    $('#dataGrid').innerHTML = cells.map(([n, l], i) => `<div class="dp-cell ${i === 8 && n ? 'hot' : ''}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
    $('#dataLog').innerHTML = S.log.length ? S.log.map(l => `<div><b>${l.at}</b> ${e(l.text)}</div>`).join('') : '<div>等待操作…</div>';
  }

  /* ============ 5. 表单与操作 ============ */
  function sheet(title, desc, actions) {
    $('#sheet').innerHTML = `<h3>${e(title)}</h3><div class="sh-desc">${e(desc)}</div>
      <div class="field"><label class="fl">名称</label><input id="sheetName" placeholder="输入名称"></div>
      <div class="sh-actions">${actions.map((a, i) => `<div class="btn ${a.primary ? 'primary' : ''}" data-act="sheet-act" data-i="${i}">${e(a.label)}</div>`).join('')}</div>`;
    $('#sheetMask').classList.add('on'); $('#sheet').classList.add('on');
    window._sheetActions = actions;
    setTimeout(() => $('#sheetName') && $('#sheetName').focus(), 50);
  }
  function closeSheet() { $('#sheetMask').classList.remove('on'); $('#sheet').classList.remove('on'); }

  function saveItem(cont) {
    const name = $('#fName') && $('#fName').value.trim();
    if (!name) { bad('名称为必填项'); $('#fName').classList.add('err'); return; }
    const ctx = S.ui.ctx, id = ctx.id;
    const patch = {
      name, category: $('#fCat') ? $('#fCat').value : '', trackingMode: $('#fTrack') ? $('#fTrack').value : 'location',
      currentNodeId: $('#fNode') ? $('#fNode').value : '', note: $('#fNote') ? $('#fNote').value : ''
    };
    let targetId = id;
    if (id) {
      const it = itemById(id);
      Object.assign(it, patch); it.completed = completion(it); it.updatedAt = now();
      if ((patch.trackingMode === 'inventory' || patch.trackingMode === 'hybrid') && !invOf(id)) S.inventory.push({ itemId: id, balance: 0, unit: '个', threshold: 0 });
      writeLog(`完善档案「${name}」`); ok('档案已更新');
    } else {
      const it = { id: uid('it'), name, category: patch.category, trackingMode: patch.trackingMode, currentNodeId: patch.currentNodeId, locationStatus: patch.currentNodeId ? 'at_home' : 'unknown', managementStatus: 'active', completed: 0, note: patch.note, updatedAt: now() };
      it.completed = completion(it);
      S.items.push(it);
      targetId = it.id;
      if (patch.trackingMode !== 'location') S.inventory.push({ itemId: it.id, balance: 0, unit: '个', threshold: 0 });
      writeLog(`新建物品「${name}」${patch.currentNodeId ? '（初始位置已填）' : '（仅名称）'}`); ok('档案已建立');
    }
    if (cont) { S.ui.ctx = {}; nav('itemEdit', {}, false); $('#fName') && ($('#fName').value = ''); }
    else nav('itemDetail', { id: targetId });
  }

  function doTx(type) {
    const it = itemById(S.ui.ctx.id), v = it && invOf(it.id);
    if (!v) return;
    const amount = Number($('#txAmount') && $('#txAmount').value);
    const note = $('#txNote') && $('#txNote').value.trim();
    if (!Number.isFinite(amount) || amount <= 0) { bad('数量必须为正数'); return; }
    if (type === 'consume' && v.balance - amount < 0) { bad(`库存不足：当前仅 ${v.balance} ${v.unit}；纠错请走「调整」`); return; }
    const delta = type === 'consume' ? -amount : amount;
    if (type === 'adjust') { v.balance = amount; }
    else v.balance += delta;
    S.transactions.unshift({ id: uid('tx'), itemId: it.id, type, delta: type === 'adjust' ? amount - (v.balance - amount) : delta, balanceAfter: v.balance, note, createdAt: now() });
    if (type === 'adjust') S.transactions[0].delta = amount;
    refreshAlerts(it.id);
    writeLog(`${it.name} ${TX[type]}，余额 ${v.balance} ${v.unit}`);
    ok(`${TX[type]}成功，余额 ${v.balance}`); render();
  }

  function addFurniture(cat) {
    const r = S.rooms.find(x => x.id === S.ui.ctx.id) || roomsOf(activeSpace().id)[0];
    if (!r) { bad('请先创建房间'); return; }
    const lib = LIB[cat];
    const count = furnitureOf(r.id).filter(f => f.category === cat).length;
    const name = count ? `${cat} ${count + 1}` : cat;
    const f = { id: uid('fu'), roomId: r.id, category: cat, name, model: '默认', position: { x: 0, y: 0, z: 0 }, rotation: 0, size: { w: lib.size[0], h: lib.size[1], d: lib.size[2] }, status: 'confirmed' };
    S.furniture.push(f);
    S.nodes.push({ id: uid('nd'), roomId: r.id, furnitureId: f.id, parentId: '', name, type: '家具' });
    S.ui.selF = f.id;
    writeLog(`添加家具「${name}」到 ${r.name}`); ok('已添加，可在编辑模式调整'); render();
  }
  function transformF(op) {
    const f = S.furniture.find(x => x.id === S.ui.selF); if (!f) return;
    const r = S.rooms.find(x => x.id === f.roomId);
    if (op === 'move') { f.position.x = Math.round(Math.max(-r.width / 2 + f.size.w / 2, Math.min(r.width / 2 - f.size.w / 2, f.position.x + .3)) * 10) / 10; }
    if (op === 'rotate') { f.rotation = (f.rotation + Math.PI / 4) % (Math.PI * 2); }
    if (op === 'scale') {
      const nw = Math.max(.1, Math.min(12, Math.round((f.size.w * 1.1) * 100) / 100));
      f.size = { w: nw, h: Math.max(.1, Math.min(12, f.size.h)), d: Math.max(.1, Math.min(12, Math.round(f.size.d * 1.1 * 100) / 100)) };
      f.position.x = Math.round(Math.max(-r.width / 2 + f.size.w / 2, Math.min(r.width / 2 - f.size.w / 2, f.position.x)) * 10) / 10;
    }
    writeLog(`编辑家具「${f.name}」：${{ move: '移动', rotate: '旋转', scale: '缩放' }[op]}`); ok('变换已保存（越界已钳制）'); render();
  }

  /* ============ 6. 事件委托 ============ */
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
    switch (a) {
      case 'back': back(); break;
      case 'goto': nav(v || el.dataset.p, { id, node: el.dataset.node }); break;
      case 'reset-demo': S = seed(); renderFlow(); render(); toast('演示数据已重置', 'ok'); break;
      case 'activate-space': S.activeSpaceId = id; writeLog('切换当前空间'); nav('room'); break;
      case 'new-space': sheet('新建空间', '支持多个空间，首版仅个人使用', [{ label: '取消' }, { label: '创建', primary: true, run(n) { if (!n) return bad('请输入名称'); S.spaces.push({ id: uid('sp'), name: n, archived: false }); S.activeSpaceId = S.spaces[S.spaces.length - 1].id; writeLog(`新建空间「${n}」`); ok('空间已创建'); nav('space'); } }]); break;
      case 'new-room': sheet('新建房间', '填写宽 / 深 / 高作为布局输入，不承诺测量精度', [{ label: '取消' }, { label: '创建空白房间', primary: true, run(n) { if (!n) return bad('请输入房间名称'); const r = { id: uid('rm'), spaceId: activeSpace().id, name: n, width: 4, depth: 4, height: 2.8, templateKey: '' }; S.rooms.push(r); writeLog(`新建房间「${n}」（空白）`); ok('房间已创建'); nav('room3d', { id: r.id }); } }, { label: '用卧室模板', run(n) { if (!n) return bad('请输入房间名称'); const r = { id: uid('rm'), spaceId: activeSpace().id, name: n, width: 4, depth: 4, height: 2.8, templateKey: 'bedroom' }; S.rooms.push(r); TEMPLATES.bedroom.items.forEach(([c, nm, x, z]) => { const f = { id: uid('fu'), roomId: r.id, category: c, name: nm, model: '默认', position: { x, y: 0, z }, rotation: 0, size: { w: LIB[c].size[0], h: LIB[c].size[1], d: LIB[c].size[2] }, status: 'confirmed' }; S.furniture.push(f); S.nodes.push({ id: uid('nd'), roomId: r.id, furnitureId: f.id, parentId: '', name: nm, type: '家具' }); }); writeLog(`新建房间「${n}」（卧室模板，家具可编辑）`); ok('模板家具已预置'); nav('room3d', { id: r.id }); } }]); break;
      case 'toggle-list': S.ui.listMode = !S.ui.listMode; render(); break;
      case 'mode': S.ui.mode = v; render(); break;
      case 'select-f': S.ui.selF = id; render(); break;
      case 'add-f': addFurniture(el.dataset.cat); break;
      case 'xf': transformF(el.dataset.op); break;
      case 'change-model': { const f = S.furniture.find(x => x.id === S.ui.ctx.id); if (f) { f.model = f.model === '默认' ? '木色原木' : '默认'; writeLog(`更换「${f.name}」外观模型`); ok('外观已更换，节点与物品关联不变'); render(); } break; }
      case 'del-f': { const f = S.furniture.find(x => x.id === S.ui.ctx.id); if (!f) return; const bound = itemsOfFurniture(f.id); const kids = S.nodes.filter(n => n.furnitureId === f.id && n.type !== '家具'); if (bound.length || kids.length) { bad(`已被关联：${bound.length} 件物品 / ${kids.length} 个节点，须先迁移或归档`); writeLog(`删除「${f.name}」被阻断（关联保护）`); renderData(); } else { S.furniture = S.furniture.filter(x => x.id !== f.id); S.nodes = S.nodes.filter(n => n.furnitureId !== f.id); writeLog(`删除家具「${f.name}」`); ok('已删除'); nav('room3d', { id: f.roomId }); } break; }
      case 'add-node': case 'add-child-node': sheet(el.dataset.act === 'add-node' ? '新增收纳节点' : '新增下级节点', '允许同名，用完整路径与排序区分', [{ label: '取消' }, { label: '创建', primary: true, run(n) { if (!n) return bad('请输入名称'); const f = S.furniture.find(x => x.id === S.ui.ctx.id); const parent = nodeById(S.ui.ctx.id); const node = { id: uid('nd'), roomId: f ? f.roomId : parent.roomId, furnitureId: f ? f.id : parent.furnitureId, parentId: f ? '' : parent.id, name: n, type: f ? '收纳盒' : '抽屉/隔层' }; S.nodes.push(node); writeLog(`新增节点「${n}」`); ok('节点已创建'); render(); } }]); break;
      case 'rename-node': { const n = nodeById(id); if (n) sheet('重命名节点', n.name, [{ label: '取消' }, { label: '保存', primary: true, run(x) { if (!x) return bad('请输入名称'); n.name = x; writeLog(`节点重命名为「${x}」`); ok('已重命名'); render(); } }]); break; }
      case 'del-node': { const n = nodeById(id); if (!n) return; const kids = S.nodes.filter(x => x.parentId === n.id), its = itemsOfNode(n.id); if (kids.length || its.length) { bad(`含 ${kids.length} 个下级节点 / ${its.length} 件物品，禁止删除`); writeLog(`删除节点「${n.name}」被阻断`); renderData(); } else { S.nodes = S.nodes.filter(x => x.id !== n.id); writeLog(`删除节点「${n.name}」`); ok('已删除'); nav('furniture', { id: n.furnitureId }); } break; }
      case 'search-input': break;
      case 'filter': S.ui.filter = v; render(); break;
      case 'save-item': saveItem(!!el.dataset.continue); break;
      case 'pick-node': S.ui.ctx.nodeId = id; S.ui.ctx.status = 'at_home'; ev.stopPropagation(); render(); ok('已选目标位置'); break;
      case 'pick-status': S.ui.ctx.status = v; if (v !== 'at_home') S.ui.ctx.nodeId = ''; render(); break;
      case 'confirm-move': { const it = itemById(S.ui.ctx.id); if (!it) return; const st = S.ui.ctx.status || it.locationStatus; if (st === 'at_home' && !S.ui.ctx.nodeId) { bad('选择「在家」需同时选定具体位置'); return; } const type = moveItem(it, { locationStatus: st, currentNodeId: S.ui.ctx.nodeId !== undefined ? S.ui.ctx.nodeId : it.currentNodeId, note: ($('#mvNote') || {}).value || '' }); writeLog(`移动「${it.name}」：${MV[type]}`); ok(`已确认：${MV[type]}，历史 +1`); nav('itemDetail', { id: it.id }); break; }
      case 'end-item': { const it = itemById(id); if (!it) return; const v = invOf(it.id); if (v && v.balance > 0) { bad(`剩余 ${v.balance} ${v.unit} 库存，须先明确处置方式`); writeLog(`结束管理「${it.name}」被阻断（库存处置）`); renderData(); } else { it.managementStatus = 'ended'; S.movements.unshift({ id: uid('mv'), itemId: it.id, type: 'end', note: '结束管理', createdAt: now() }); writeLog(`结束管理「${it.name}」`); ok('已结束管理'); nav('itemList'); } break; }
      case 'tx': doTx(v); break;
      case 'ignore-alert': { const al = S.alerts.find(x => x.id === id); if (al) { al.status = 'ignored'; writeLog('忽略一条提醒'); render(); } break; }
      case 'sheet-act': { const act = window._sheetActions[Number(el.dataset.i)]; closeSheet(); if (act && act.run) act.run(($('#sheetName') || {}).value || ''); break; }
      case 'flow-tab': gotoFlow(Number(el.dataset.i)); break;
      case 'flow-step': jumpStep(Number(el.dataset.i)); break;
      case 'flow-next': nextStep(); break;
      case 'flow-prev': prevStep(); break;
    }
  });
  document.addEventListener('input', ev => {
    if (ev.target.id === 'searchInput') { S.ui.search = ev.target.value; render(); const inp = $('#searchInput'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
  });
  $('#sheetMask').addEventListener('click', closeSheet);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });

  /* ============ 7. 流程引导 ============ */
  const FLOWS = [
    {
      name: 'UF-001 首次建立空间', goal: '建空间 → 建房间（宽深高）→ 选起点 → 三维加家具 → 编辑保存',
      steps: [
        { t: '打开空间列表', note: '支持创建多个空间；首版仅个人单用户。', run() { nav('space'); } },
        { t: '新建空间「演示·新居」', note: '空间是最高层级，其下可建多个房间。', run() { S.spaces.push({ id: uid('sp'), name: '演示·新居', archived: false }); S.activeSpaceId = S.spaces[S.spaces.length - 1].id; writeLog('新建空间「演示·新居」'); nav('space'); } },
        { t: '新建房间「书房」并填宽深高', note: '尺寸为布局输入，不承诺测量精度；无模型时房间仍可存在。', run() { const r = { id: uid('rm'), spaceId: activeSpace().id, name: '书房', width: 3.2, depth: 2.8, height: 2.6, templateKey: '' }; S.rooms.push(r); writeLog('新建房间「书房」3.2×2.8×2.6 m'); nav('room'); } },
        { t: '为书房应用「卧室模板」', note: '模板家具为普通可编辑对象，不锁定；模板缺失可降级空白房间。', run() { const r = S.rooms.find(x => x.name === '书房'); if (!r) return; const t = TEMPLATES.bedroom; r.templateKey = 'bedroom'; t.items.forEach(([c, nm, x, z]) => { const f = { id: uid('fu'), roomId: r.id, category: c, name: nm, model: '默认', position: { x, y: 0, z }, rotation: 0, size: { w: LIB[c].size[0], h: LIB[c].size[1], d: LIB[c].size[2] }, status: 'confirmed' }; S.furniture.push(f); S.nodes.push({ id: uid('nd'), roomId: r.id, furnitureId: f.id, parentId: '', name: nm, type: '家具' }); }); writeLog('应用卧室模板，预置 3 件家具'); nav('room3d', { id: r.id }); } },
        { t: '从模型库添加家具', note: 'V1.2 主路径：手动添加，可先用占位模型；不依赖照片。', run() { const r = S.rooms.find(x => x.name === '书房'); if (!r) return; addFurniture('收纳盒'); S.ui.selF = S.furniture[S.furniture.length - 1].id; nav('room3d', { id: r.id }); } },
        { t: '拖动 / 旋转 / 缩放并保存', note: '越界自动钳制；重进后位置与尺寸保持一致。', run() { const f = S.furniture[S.furniture.length - 1]; S.ui.selF = f.id; S.ui.mode = '编辑'; transformF('move'); transformF('rotate'); writeLog('编辑变换后保存（越界已钳制）'); nav('room3d', { id: f.roomId }); } }
      ]
    },
    {
      name: 'UF-002 家具与收纳', goal: '建收纳节点 → 绑定物品 → 换模型不动逻辑节点',
      steps: [
        { t: '打开床头柜详情', note: '家具本身即逻辑位置节点；模型与逻辑位置分离。', run() { const f = S.furniture.find(x => x.name === '床头柜'); nav('furniture', { id: f.id }); } },
        { t: '创建收纳节点「证件隔层」', note: '多级位置树：家具 → 抽屉/隔层 → 收纳盒。', run() { const f = S.furniture.find(x => x.name === '床头柜'); const root = S.nodes.find(n => n.furnitureId === f.id && !n.parentId); const n = { id: uid('nd'), roomId: f.roomId, furnitureId: f.id, parentId: root.id, name: '证件隔层', type: '抽屉/隔层' }; S.nodes.push(n); writeLog('新增节点「证件隔层」'); nav('node', { id: n.id }); } },
        { t: '将「身份证」绑定到该节点', note: '单物件单位置；绑定沿 nodes.furnitureId + items.currentNodeId 单源表达。', run() { const n = S.nodes.find(x => x.name === '证件隔层'); const it = itemById('it1'); it.currentNodeId = n.id; it.locationStatus = 'at_home'; it.updatedAt = now(); writeLog('身份证绑定至「证件隔层」'); nav('node', { id: n.id }); } },
        { t: '点选模型查看关联物品', note: '从三维选中模型可直接看到关联物品与节点。', run() { const f = S.furniture.find(x => x.name === '床头柜'); S.ui.selF = f.id; nav('room3d', { id: f.roomId }); } },
        { t: '更换外观模型验证解耦', note: '换模型后节点与物品关联保持不变（MVP-016）。', run() { const f = S.furniture.find(x => x.name === '床头柜'); f.model = f.model === '默认' ? '木色原木' : '默认'; writeLog('更换床头柜外观模型，关联不变'); nav('furniture', { id: f.id }); } }
      ]
    },
    {
      name: 'UF-003 添加物品', goal: '仅名称建档 → 渐进完善 → 保存并继续 → 搜索查看',
      steps: [
        { t: '打开物品建档页', note: '只需名称即可建档，降低一次性录入负担。', run() { nav('itemEdit'); } },
        { t: '仅填名称保存「演示·数据线」', note: '分类、照片、位置可后续补充，档案完整度随之提高。', run() { S.items.push({ id: uid('it'), name: '演示·数据线', category: '', trackingMode: 'location', currentNodeId: '', locationStatus: 'unknown', managementStatus: 'active', completed: 0, note: '', updatedAt: now() }); writeLog('仅名称建档「演示·数据线」'); nav('itemList'); } },
        { t: '打开新建页演示「保存并继续」', note: '连续建档时每件独立建档，可保留默认家具/节点。', run() { nav('itemEdit'); toast('可填写名称后点击「保存并继续」', 'ok'); } },
        { t: '渐进完善刚建的档案', note: '位置一次填写属初始存放信息，不记为移动。', run() { const it = S.items.find(x => x.name === '演示·数据线'); if (it) { it.category = '电子数码'; it.currentNodeId = S.nodes.find(n => n.name === '床头柜').id; it.locationStatus = 'at_home'; it.completed = completion(it); writeLog('完善「演示·数据线」档案'); nav('itemDetail', { id: it.id }); } } },
        { t: '搜索并查看位置', note: '列表支持按名称/分类搜索；未知状态明确显示。', run() { S.ui.search = ''; S.ui.filter = 'all'; nav('itemList'); } }
      ]
    },
    {
      name: 'UF-004 移动物品', goal: '详情 → 移动 → 选目标并确认 → 同事务更新位置与历史',
      steps: [
        { t: '打开「身份证」详情', note: '当前位置为用户确认事实，移动须用户显式确认。', run() { nav('itemDetail', { id: 'it1' }); } },
        { t: '进入移动页', note: '目标可为具体位置，也可为外出/借出等状态。', run() { nav('move', { id: 'it1' }); } },
        { t: '选择目标位置「上层抽屉」', note: '移动前的位置来自历史确认，不自动推断。', run() { S.ui.ctx.nodeId = 'nd_drawer'; S.ui.ctx.status = 'at_home'; nav('move', { id: 'it1', nodeId: 'nd_drawer', status: 'at_home' }); } },
        { t: '确认移动', note: '当前位置与历史在同一事务写入，两者保持一致。', run() { const it = itemById('it1'); const type = moveItem(it, { locationStatus: 'at_home', currentNodeId: 'nd_drawer', note: '流程演示移动' }); writeLog(`移动身份证：${MV[type]}`); nav('itemDetail', { id: 'it1' }); } },
        { t: '查看位置历史', note: '历史可追溯；首次位置确认单独成类，不伪装为移动。', run() { nav('history', { id: 'it1' }); } }
      ]
    },
    {
      name: 'UF-005 库存管理', goal: '入库/消耗/调整 → 库存不为负 → 交易流水 → 阈值提醒',
      steps: [
        { t: '打开库存总览', note: '低库存条目置顶；余额与阈值一目了然。', run() { nav('inventory'); } },
        { t: '查看「洗发水」库存详情', note: '每次变化都留交易记录，调整与消耗分开。', run() { nav('inventoryDetail', { id: 'it3' }); } },
        { t: '消耗 4 瓶（触发不足拦截）', note: '当前仅 1 瓶，消耗会导致余额为负 → 拒绝，纠错走调整。', run() { nav('inventoryDetail', { id: 'it3' }); const inp = $('#txAmount'); if (inp) inp.value = 4; bad('库存不足：当前仅 1 瓶；纠错请走「调整」'); writeLog('消耗 4 瓶被拦截（库存不为负）'); renderData(); } },
        { t: '入库 3 瓶', note: '入库增加余额并生成一条交易，提醒自动恢复。', run() { const v = invOf('it3'); v.balance += 3; S.transactions.unshift({ id: uid('tx'), itemId: 'it3', type: 'in', delta: 3, balanceAfter: v.balance, note: '流程演示入库', createdAt: now() }); refreshAlerts('it3'); writeLog('洗发水入库 3 瓶，余额 4'); nav('inventoryDetail', { id: 'it3' }); } },
        { t: '检查提醒自动恢复', note: '补货使余额高于阈值后，当前提醒周期自动结束。', run() { nav('alerts'); } }
      ]
    },
    {
      name: '异常与降级', goal: '验证关联保护、三维降级、首次位置确认与库存约束',
      steps: [
        { t: '删除含物品的节点 → 阻断', note: '上层抽屉含身份证，删除被阻断并提示先迁移/归档。', run() { const n = nodeById('nd_drawer'); const its = itemsOfNode(n.id), kids = S.nodes.filter(x => x.parentId === n.id); bad(`含 ${kids.length} 个下级节点 / ${its.length} 件物品，禁止删除`); writeLog('删除含物品节点被阻断'); nav('node', { id: n.id }); } },
        { t: '三维不可用 → 切列表', note: '列表视图下家具与位置管理仍可完成。', run() { S.ui.listMode = true; const r = roomsOf(activeSpace().id)[0]; writeLog('切换到列表降级视图'); nav('room3d', { id: r.id }); } },
        { t: '未知首次确认 → 独立事件', note: '备用钥匙原本位置未知，确认到具体位置记为 first_confirm。', run() { const it = itemById('it5'); const target = S.nodes.find(n => n.name === '上层抽屉') || S.nodes[0]; const type = moveItem(it, { locationStatus: 'at_home', currentNodeId: target.id, note: '首次位置确认' }); writeLog(`备用钥匙：${MV[type]}`); nav('history', { id: it.id }); } },
        { t: '结束管理需处置剩余库存', note: '有余额时须先明确处置方式，不能伪装成消耗。', run() { const v = invOf('it3'); bad(`剩余 ${v.balance} ${v.unit} 库存，须先明确处置方式`); writeLog('结束管理被阻断（库存处置）'); nav('itemDetail', { id: 'it3' }); } }
      ]
    }
  ];
  let fi = 0, si = 0;
  function renderFlow() {
    $('#flowTabs').innerHTML = FLOWS.map((f, i) => `<div class="flow-tab ${i === fi ? 'on' : ''}" data-act="flow-tab" data-i="${i}">${e(f.name.split(' ')[0])}</div>`).join('');
    const f = FLOWS[fi];
    $('#flowTitle').textContent = f.name;
    $('#flowGoal').textContent = f.goal;
    $('#flowProgress').textContent = `${si} / ${f.steps.length}`;
    $('#steps').innerHTML = f.steps.map((s, i) => `<li class="step ${i < si ? 'done' : i === si ? 'now' : ''}" data-act="flow-step" data-i="${i}"><span class="sn">${i < si ? '✓' : i + 1}</span><span class="st">${e(s.t)}</span></li>`).join('');
    $('#stepNote').textContent = si < f.steps.length ? '当前：' + f.steps[si].note : '本流程已演示完成，可切换其他流程或重置数据。';
  }
  function gotoFlow(i) { fi = i; si = 0; renderFlow(); toast('已切换到：' + FLOWS[fi].name); }
  function nextStep() {
    const f = FLOWS[fi];
    if (si >= f.steps.length) { toast('本流程已结束', 'ok'); return; }
    const step = f.steps[si];
    if (step.run) step.run();
    si++; renderFlow();
  }
  function prevStep() {
    if (si <= 0) { toast('已经是第一步'); return; }
    si--; renderFlow(); toast('已回看上一步说明（数据不回滚）');
  }
  function jumpStep(i) { if (i <= si) { si = i; renderFlow(); } else toast('请按「演示下一步」顺序执行'); }

  /* ============ 8. 初始化 ============ */
  S = seed();
  renderFlow();
  render();
  window.addEventListener('hashchange', () => {});
})();
