// bake-glb.mjs —— 把 preview 已验证的 8 件程序化家具烘焙为独立 GLB 资产
// 复用 src/furniture.js 的几何与 src/materials.js 的规范色板，风格与预览一致。
// 产出的 GLB 可被 Three.js GLTFLoader 直接加载；将来 Blender 资产按同名替换即可。
import * as THREE from 'three';
import { GLTFExporter } from './vendor/GLTFExporter.js';
import { CATALOG, makeFurniture } from './src/furniture.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'assets', 'furniture');
fs.mkdirSync(OUT, { recursive: true });

// GLTFExporter 在 Node 下可能引用 FileReader（图片路径）；纯色材质不触发，仍做兜底补丁
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend && this.onloadend();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(buf).toString('base64');
        this.onloadend && this.onloadend();
      });
    }
  };
}

const exporter = new GLTFExporter();
const manifest = [];

for (const item of CATALOG) {
  const group = makeFurniture(item);
  // 显式写入锚点元数据：底面中心锚点（Y-up，米）
  group.userData.anchor = [0, 0, 0];
  group.userData.size = item.size;
  group.userData.category = item.name;
  group.userData.version = '1.0';

  const glb = await exporter.parseAsync(group, { binary: true, onlyVisible: true });
  const buf = Buffer.from(glb);
  const file = item.key + '.glb';
  fs.writeFileSync(path.join(OUT, file), buf);

  // 统计三角面数，供资产台账
  let tris = 0;
  group.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
    }
  });

  manifest.push({
    key: item.key,
    name: item.name,
    file: file,
    size: item.size,
    anchor: [0, 0, 0],
    triangles: Math.round(tris),
    bytes: buf.length,
    version: '1.0',
    source: '程序化烘焙（Blender 可直接替换同名文件）'
  });
  console.log(`${item.key.padEnd(10)} ${String(buf.length).padStart(7)} B  ${String(Math.round(tris)).padStart(5)} tris  ${item.name}`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  version: '1.0',
  unit: 'meter',
  up: 'Y',
  note: '尺寸顺序 [宽, 深, 高]；锚点为底面中心；Blender 资产按同名 key.glb 替换即可',
  items: manifest
}, null, 2));

const total = manifest.reduce((s, x) => s + x.bytes, 0);
console.log('---');
console.log(`合计 ${manifest.length} 件，${(total / 1024).toFixed(1)} KB`);
console.log(`输出目录 ${OUT}`);
