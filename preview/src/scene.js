import * as THREE from 'three';
import { M } from './materials.js';

// 规范 3.5：正交相机，方位约 45°、俯角约 30°
const YAW = Math.PI / 4;
const PITCH = Math.PI / 6;
export const ROOM = { w: 6.0, d: 5.0, h: 2.8 };

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0xF5EFE3);
  return renderer;
}

export function createCamera() {
  // 正交相机：viewSize 为纵向可视高度，随容器比例调整
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  cam.userData.viewSize = 6.4;
  cam.userData.yaw = YAW;
  cam.userData.pitch = PITCH;
  cam.userData.target = new THREE.Vector3(0, 0.5, 0);
  updateCameraOrbit(cam);
  return cam;
}

export function resizeCamera(cam, renderer, wrap) {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  const vs = cam.userData.viewSize;
  cam.left = -vs * aspect / 2;
  cam.right = vs * aspect / 2;
  cam.top = vs / 2;
  cam.bottom = -vs / 2;
  cam.updateProjectionMatrix();
}

export function updateCameraOrbit(cam) {
  const { yaw, pitch, target } = cam.userData;
  const r = 14;
  cam.position.set(
    target.x + r * Math.sin(yaw) * Math.cos(pitch),
    target.y + r * Math.sin(pitch),
    target.z + r * Math.cos(yaw) * Math.cos(pitch)
  );
  cam.lookAt(target);
}

// 房间：地板 + 三面墙（前墙隐藏）+ 窗光
export function createRoom(scene) {
  const room = new THREE.Group();
  const { w, d, h } = ROOM;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);

  // 后墙（z 负方向）与左墙（x 负方向）；前墙、右墙隐藏，保留娃娃屋视角
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.wall);
  back.position.set(0, h / 2, -d / 2);
  back.receiveShadow = true;
  room.add(back);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(d, h), M.wall);
  left.rotation.y = Math.PI / 2;
  left.position.set(-w / 2, h / 2, 0);
  left.receiveShadow = true;
  room.add(left);

  // 踢脚线，给低多边形场景一点收口层次
  const skirtMat = M.linenAlt;
  const backSkirt = new THREE.Mesh(new THREE.BoxGeometry(w, 0.10, 0.04), skirtMat);
  backSkirt.position.set(0, 0.05, -d / 2 + 0.03);
  room.add(backSkirt);
  const leftSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, d), skirtMat);
  leftSkirt.position.set(-w / 2 + 0.03, 0.05, 0);
  room.add(leftSkirt);

  // 窗光：后墙上的浅色窗格（不透光，仅作氛围提示）
  const winMat = new THREE.MeshStandardMaterial({
    color: 0xFDF7E8, roughness: 0.9, metalness: 0,
    emissive: 0xFDF7E8, emissiveIntensity: 0.35
  });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), winMat);
  win.position.set(1.4, h * 0.58, -d / 2 + 0.012);
  room.add(win);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.03), M.white);
  crossV.position.set(1.4, h * 0.58, -d / 2 + 0.02);
  room.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.03), M.white);
  crossH.position.set(1.4, h * 0.58, -d / 2 + 0.02);
  room.add(crossH);

  scene.add(room);
  return room;
}

// 规范 3.4：半球环境光 + 方向光软阴影 + 接触阴影
export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xFFFFFF, 0xD9B98C, 1.25);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xFFF4E0, 2.1);
  dir.position.set(5, 8, 4);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 30;
  dir.shadow.camera.left = -7;
  dir.shadow.camera.right = 7;
  dir.shadow.camera.top = 7;
  dir.shadow.camera.bottom = -7;
  dir.shadow.bias = -0.0008;
  dir.shadow.normalBias = 0.02;
  dir.shadow.radius = 4;
  scene.add(dir);

  // 接触阴影：家具底部的柔和暗斑贴图，避免物体"漂浮感"
  const contact = new THREE.Group();
  const tex = makeContactTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.42,
    depthWrite: false, color: 0x6B5A45
  });
  contact.userData.material = shadowMat;
  scene.add(contact);
  return contact;
}

// 生成径向渐变接触阴影贴图（canvas 生成，无外部资源）
function makeContactTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export function addContactShadow(contactGroup, furniture) {
  const [w, d] = furniture.userData.size;
  const mat = contactGroup.userData.material;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.15, d * 1.15), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.006;
  plane.renderOrder = 1;
  furniture.userData.contact = plane;
  contactGroup.add(plane);
}

export function moveContactShadow(furniture) {
  const plane = furniture.userData.contact;
  if (!plane) return;
  plane.position.x = furniture.position.x;
  plane.position.z = furniture.position.z;
}
