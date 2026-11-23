import * as THREE from 'three';
import { M, cssColor } from './materials.js';
import { CATALOG, makeFurniture } from './furniture.js';
import {
  createRenderer, createCamera, resizeCamera, updateCameraOrbit,
  createRoom, createLights, addContactShadow, moveContactShadow, ROOM
} from './scene.js';

const canvas = document.getElementById('c');
const wrap = document.getElementById('canvas-wrap');
const statusEl = document.getElementById('status');
const catalogEl = document.getElementById('catalog');
const infoCard = document.getElementById('info-card');
const infoName = document.getElementById('info-name');
const infoMeta = document.getElementById('info-meta');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xF5EFE3);

const renderer = createRenderer(canvas);
const camera = createCamera();
createRoom(scene);
const contactGroup = createLights(scene);

// ---------- 初始布置：8 件样品按房间分区摆位 ----------
const placed = [];
const LAYOUT = [
  { key: 'sofa',     x: -1.3, z: 1.2,  rot: 0 },
  { key: 'coffee',   x: -1.3, z: 0.1,  rot: 0 },
  { key: 'chair',    x: -2.4, z: -0.6, rot: Math.PI / 2 },
  { key: 'table',    x: 1.4,  z: 0.6,  rot: 0 },
  { key: 'bed',      x: 1.7,  z: -1.4, rot: 0 },
  { key: 'wardrobe', x: -2.4, z: -1.9, rot: 0 },
  { key: 'cabinet',  x: 0.2,  z: -2.1, rot: 0 },
  { key: 'shelf',    x: 2.5,  z: -1.6, rot: -Math.PI / 2 }
];

LAYOUT.forEach((p) => {
  const item = CATALOG.find((it) => it.key === p.key);
  const g = makeFurniture(item);
  g.position.set(p.x, 0, p.z);
  g.rotation.y = p.rot;
  scene.add(g);
  addContactShadow(contactGroup, g);
  placed.push(g);
});

// ---------- 目录 UI ----------
let activeKey = null;
function renderCatalog() {
  catalogEl.innerHTML = '';
  CATALOG.forEach((it) => {
    const el = document.createElement('div');
    el.className = 'cat-item' + (activeKey === it.key ? ' active' : '');
    el.innerHTML = `
      <div class="cat-swatch" style="background:${cssColor(it.swatch)}"></div>
      <div class="cat-name">${it.name}</div>
      <div class="cat-dim">${it.dim}</div>`;
    el.addEventListener('click', () => focusFurniture(it.key));
    catalogEl.appendChild(el);
  });
}
renderCatalog();

function focusFurniture(key) {
  activeKey = key;
  const g = placed.find((f) => f.userData.key === key);
  if (g) {
    select(g);
    camera.userData.target.set(g.position.x, 0.5, g.position.z);
    updateCameraOrbit(camera);
  }
  renderCatalog();
}

// ---------- 拾取高亮 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selected = null;
let hovered = null;
const HILITE = 0xD8A79C;

function setTint(g, on) {
  if (!g) return;
  g.traverse((o) => {
    if (!o.isMesh) return;
    if (on) {
      if (o.userData._orig === undefined) o.userData._orig = o.material;
      o.material = M.clay;
    } else if (o.userData._orig) {
      o.material = o.userData._orig;
    }
  });
}

function select(g) {
  if (selected === g) return;
  setTint(selected, false);
  selected = g;
  setTint(selected, true);
  if (selected) {
    infoName.textContent = selected.userData.name;
    infoMeta.textContent = `${selected.userData.dim} m · 拖动可移动`;
    infoCard.classList.remove('hidden');
    activeKey = selected.userData.key;
    renderCatalog();
  } else {
    infoCard.classList.add('hidden');
  }
}

function pick(ev) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(placed, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.isFurniture) o = o.parent;
  return o || null;
}

// ---------- 拖拽 / 旋转 / 缩放 ----------
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
let mode = null; // 'drag' | 'orbit'
let dragOffset = new THREE.Vector3();
let lastPointer = { x: 0, y: 0 };
let snap = true;
const SNAP = 0.1;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function limitToRoom(g, x, z) {
  const [w, d] = g.userData.size;
  return {
    x: clamp(x, -ROOM.w / 2 + w / 2, ROOM.w / 2 - w / 2),
    z: clamp(z, -ROOM.d / 2 + d / 2, ROOM.d / 2 - d / 2)
  };
}

canvas.addEventListener('pointerdown', (ev) => {
  lastPointer = { x: ev.clientX, y: ev.clientY };
  const g = pick(ev);
  if (g) {
    select(g);
    raycaster.ray.intersectPlane(groundPlane, hitPoint);
    dragOffset.set(g.position.x - hitPoint.x, 0, g.position.z - hitPoint.z);
    mode = 'drag';
  } else {
    select(null);
    mode = 'orbit';
  }
  canvas.setPointerCapture(ev.pointerId);
});

canvas.addEventListener('pointermove', (ev) => {
  if (mode === 'drag' && selected) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      let x = hitPoint.x + dragOffset.x;
      let z = hitPoint.z + dragOffset.z;
      if (snap) {
        x = Math.round(x / SNAP) * SNAP;
        z = Math.round(z / SNAP) * SNAP;
      }
      const p = limitToRoom(selected, x, z);
      selected.position.set(p.x, 0, p.z);
      moveContactShadow(selected);
    }
  } else if (mode === 'orbit') {
    const dx = ev.clientX - lastPointer.x;
    const dy = ev.clientY - lastPointer.y;
    camera.userData.yaw -= dx * 0.008;
    camera.userData.pitch = clamp(camera.userData.pitch + dy * 0.005, 0.18, 1.15);
    updateCameraOrbit(camera);
    lastPointer = { x: ev.clientX, y: ev.clientY };
  } else {
    const g = pick(ev);
    if (g !== hovered) {
      hovered = g;
      canvas.style.cursor = g ? 'grab' : 'default';
    }
  }
});

function endPointer(ev) {
  if (mode === 'drag') canvas.style.cursor = 'grab';
  mode = null;
  if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  camera.userData.viewSize = clamp(camera.userData.viewSize + ev.deltaY * 0.004, 3.5, 12);
  resizeCamera(camera, renderer, wrap);
}, { passive: false });

// ---------- 工具按钮 ----------
const btnSnap = document.getElementById('btn-snap');
btnSnap.addEventListener('click', () => {
  snap = !snap;
  btnSnap.textContent = '吸附：' + (snap ? '开' : '关');
  btnSnap.classList.toggle('active', snap);
});

document.getElementById('btn-reset').addEventListener('click', () => {
  camera.userData.yaw = Math.PI / 4;
  camera.userData.pitch = Math.PI / 6;
  camera.userData.viewSize = 6.4;
  camera.userData.target.set(0, 0.5, 0);
  updateCameraOrbit(camera);
  resizeCamera(camera, renderer, wrap);
  select(null);
  activeKey = null;
  renderCatalog();
});

// ---------- 渲染循环 ----------
function resize() {
  resizeCamera(camera, renderer, wrap);
}
window.addEventListener('resize', resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

statusEl.textContent = `就绪 · ${placed.length} 件样板 · Three.js r169`;
