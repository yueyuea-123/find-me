import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { M } from './materials.js';

// 程序化家具：圆角盒/圆柱组合，大圆角低多边形；尺寸按规范 3.2（宽 × 深 × 高，米）
function rb(w, h, d, r = 0.06) {
  const radius = Math.min(r, Math.min(w, h, d) * 0.45);
  return new RoundedBoxGeometry(w, h, d, 1, radius);
}

function part(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function group() {
  const g = new THREE.Group();
  g.userData.isFurniture = true;
  return g;
}

// 1. 沙发 2.0 × 0.9 × 0.8
function buildSofa() {
  const g = group();
  g.add(part(rb(2.0, 0.34, 0.9, 0.12), M.linen, 0, 0.30, 0));
  g.add(part(rb(2.0, 0.52, 0.22, 0.10), M.linenAlt, 0, 0.58, -0.34));
  g.add(part(rb(0.18, 0.30, 0.9, 0.08), M.linenAlt, -0.91, 0.52, 0));
  g.add(part(rb(0.18, 0.30, 0.9, 0.08), M.linenAlt, 0.91, 0.52, 0));
  g.add(part(rb(0.88, 0.14, 0.68, 0.06), M.linen, -0.45, 0.55, 0.04));
  g.add(part(rb(0.88, 0.14, 0.68, 0.06), M.linen, 0.45, 0.55, 0.04));
  g.add(part(rb(0.22, 0.22, 0.12, 0.06), M.clay, -0.62, 0.66, -0.16));
  g.add(part(rb(0.22, 0.22, 0.12, 0.06), M.sage, 0.62, 0.66, -0.16));
  [[-0.85, -0.34], [0.85, -0.34], [-0.85, 0.34], [0.85, 0.34]].forEach(([x, z]) => {
    g.add(part(rb(0.12, 0.16, 0.12, 0.04), M.woodDark, x, 0.08, z));
  });
  return g;
}

// 2. 床 1.5 × 2.0 × 0.5
function buildBed() {
  const g = group();
  g.add(part(rb(1.5, 0.24, 2.0, 0.10), M.wood, 0, 0.22, 0));
  g.add(part(rb(1.42, 0.20, 1.86, 0.09), M.linen, 0, 0.44, 0.02));
  g.add(part(rb(1.5, 0.52, 0.14, 0.07), M.woodDark, 0, 0.46, -0.93));
  g.add(part(rb(0.52, 0.12, 0.30, 0.05), M.white, -0.34, 0.60, -0.70));
  g.add(part(rb(0.52, 0.12, 0.30, 0.05), M.white, 0.34, 0.60, -0.70));
  g.add(part(rb(1.42, 0.06, 0.66, 0.03), M.sage, 0, 0.57, 0.52));
  return g;
}

// 3. 椅子 0.8 × 0.8 × 0.8
function buildChair() {
  const g = group();
  g.add(part(rb(0.62, 0.12, 0.62, 0.05), M.wood, 0, 0.46, 0));
  g.add(part(rb(0.62, 0.50, 0.12, 0.05), M.wood, 0, 0.72, -0.25));
  g.add(part(rb(0.52, 0.05, 0.08, 0.02), M.mustard, 0, 0.46, 0.30));
  [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]].forEach(([x, z]) => {
    g.add(part(rb(0.09, 0.44, 0.09, 0.03), M.woodDark, x, 0.22, z));
  });
  return g;
}

// 4. 桌（餐桌/书桌通用）1.4 × 0.8 × 0.75
function buildTable() {
  const g = group();
  g.add(part(rb(1.4, 0.10, 0.8, 0.05), M.wood, 0, 0.70, 0));
  g.add(part(rb(0.30, 0.12, 0.22, 0.03), M.clay, -0.40, 0.81, 0));
  [[-0.60, -0.30], [0.60, -0.30], [-0.60, 0.30], [0.60, 0.30]].forEach(([x, z]) => {
    g.add(part(rb(0.10, 0.66, 0.10, 0.03), M.woodDark, x, 0.33, z));
  });
  return g;
}

// 5. 茶几 1.0 × 0.6 × 0.4
function buildCoffee() {
  const g = group();
  g.add(part(rb(1.0, 0.10, 0.6, 0.05), M.wood, 0, 0.35, 0));
  g.add(part(rb(0.16, 0.05, 0.16, 0.02), M.mustard, 0.26, 0.43, 0));
  [[-0.42, -0.23], [0.42, -0.23], [-0.42, 0.23], [0.42, 0.23]].forEach(([x, z]) => {
    g.add(part(rb(0.09, 0.30, 0.09, 0.03), M.woodDark, x, 0.15, z));
  });
  return g;
}

// 6. 衣柜 1.2 × 0.6 × 2.0
function buildWardrobe() {
  const g = group();
  g.add(part(rb(1.2, 2.0, 0.6, 0.08), M.wood, 0, 1.0, 0));
  g.add(part(rb(0.55, 1.88, 0.05, 0.03), M.linen, -0.29, 1.0, 0.31));
  g.add(part(rb(0.55, 1.88, 0.05, 0.03), M.linenAlt, 0.29, 1.0, 0.31));
  g.add(part(rb(0.03, 0.20, 0.03, 0.01), M.ink, -0.06, 1.0, 0.35));
  g.add(part(rb(0.03, 0.20, 0.03, 0.01), M.ink, 0.06, 1.0, 0.35));
  return g;
}

// 7. 斗柜/抽屉柜 1.0 × 0.45 × 0.9
function buildCabinet() {
  const g = group();
  g.add(part(rb(1.0, 0.9, 0.45, 0.07), M.wood, 0, 0.45, 0));
  [0.22, 0.47, 0.72].forEach((y) => {
    g.add(part(rb(0.90, 0.22, 0.04, 0.03), M.linen, 0, y, 0.235));
    g.add(part(rb(0.14, 0.03, 0.03, 0.01), M.ink, 0, y, 0.26));
  });
  g.add(part(rb(0.18, 0.08, 0.12, 0.03), M.sage, -0.28, 0.98, 0));
  return g;
}

// 8. 书柜/置物架 0.9 × 0.35 × 1.8
function buildShelf() {
  const g = group();
  g.add(part(rb(0.07, 1.8, 0.35, 0.03), M.woodDark, -0.42, 0.90, 0));
  g.add(part(rb(0.07, 1.8, 0.35, 0.03), M.woodDark, 0.42, 0.90, 0));
  g.add(part(rb(0.9, 0.06, 0.35, 0.02), M.woodDark, 0, 0.03, 0));
  g.add(part(rb(0.9, 0.06, 0.35, 0.02), M.woodDark, 0, 1.77, 0));
  [0.47, 0.92, 1.37].forEach((y) => {
    g.add(part(rb(0.78, 0.05, 0.33, 0.02), M.wood, 0, y, 0));
  });
  const bookMats = [M.clay, M.sage, M.mustard, M.linenAlt, M.woodDark];
  [0.50, 0.95, 1.40].forEach((y, layer) => {
    for (let i = 0; i < 5; i++) {
      const x = -0.30 + i * 0.15;
      const h = 0.22 + ((i + layer) % 3) * 0.03;
      g.add(part(rb(0.09, h, 0.22, 0.02), bookMats[(i + layer) % bookMats.length], x, y + h / 2, 0));
    }
  });
  return g;
}

// 目录元数据：尺寸顺序为 宽 × 深 × 高
export const CATALOG = [
  { key: 'sofa',     name: '沙发',        dim: '2.0 × 0.9 × 0.8', size: [2.0, 0.9, 0.8], swatch: 0xE8DED0, build: buildSofa },
  { key: 'bed',      name: '床',          dim: '1.5 × 2.0 × 0.5', size: [1.5, 2.0, 0.5], swatch: 0xC9A87C, build: buildBed },
  { key: 'chair',    name: '椅子',        dim: '0.8 × 0.8 × 0.8', size: [0.8, 0.8, 0.8], swatch: 0xE3C46B, build: buildChair },
  { key: 'table',    name: '桌',          dim: '1.4 × 0.8 × 0.75', size: [1.4, 0.8, 0.75], swatch: 0xC9A87C, build: buildTable },
  { key: 'coffee',   name: '茶几',        dim: '1.0 × 0.6 × 0.4', size: [1.0, 0.6, 0.4], swatch: 0xA88457, build: buildCoffee },
  { key: 'wardrobe', name: '衣柜',        dim: '1.2 × 0.6 × 2.0', size: [1.2, 0.6, 2.0], swatch: 0xE8DED0, build: buildWardrobe },
  { key: 'cabinet',  name: '斗柜/抽屉柜', dim: '1.0 × 0.45 × 0.9', size: [1.0, 0.45, 0.9], swatch: 0xD8A79C, build: buildCabinet },
  { key: 'shelf',    name: '书柜/置物架', dim: '0.9 × 0.35 × 1.8', size: [0.9, 0.35, 1.8], swatch: 0x9CB49A, build: buildShelf }
];

export function makeFurniture(item) {
  const g = item.build();
  g.userData.key = item.key;
  g.userData.name = item.name;
  g.userData.dim = item.dim;
  g.userData.size = item.size;
  return g;
}
