// verify-glb.mjs —— 校验烘焙出的 GLB 二进制结构是否规范、可被 GLTFLoader 加载
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'assets', 'furniture');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

function parseGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('magic != glTF');
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  if (length !== buf.length) throw new Error(`length mismatch ${length} != ${buf.length}`);
  let off = 12;
  const chunks = [];
  while (off < buf.length) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + clen);
    chunks.push({ type: ctype.toString(16).padStart(8, '0'), len: clen, data });
    off += 8 + clen + ((4 - (clen % 4)) % 4);
    if (clen % 4 !== 0) { /* padding tolerated */ }
  }
  const jsonChunk = chunks.find((c) => c.type === '4e4f534a');
  if (!jsonChunk) throw new Error('no JSON chunk');
  let json;
  try { json = JSON.parse(jsonChunk.data.toString('utf8')); }
  catch (e) { throw new Error('JSON chunk parse failed: ' + e.message); }
  return { version, chunks, json };
}

let ok = 0;
let fail = 0;
for (const item of manifest.items) {
  const file = path.join(DIR, item.file);
  try {
    const buf = fs.readFileSync(file);
    const { version, chunks, json } = parseGLB(buf);
    const errs = [];
    if (version !== 2) errs.push('version!=2');
    if (!json.asset || json.asset.version !== '2.0') errs.push('asset.version!=2.0');
    if (!json.meshes || json.meshes.length === 0) errs.push('no meshes');
    if (!json.materials || json.materials.length === 0) errs.push('no materials');
    if (!json.accessors || json.accessors.length === 0) errs.push('no accessors');
    const hasBin = chunks.some((c) => c.type === '004e4942');
    if (!hasBin) errs.push('no BIN chunk');
    const nodes = (json.nodes || []).length;
    const root = (json.nodes || []).find((n) => n.extras && n.extras.isFurniture);
    const extras = root && root.extras;
    const anchor = extras && extras.anchor;
    if (!anchor) errs.push('no anchor extras');
    if (!extras || !extras.key) errs.push('no key extras');

    if (errs.length) { console.log(`FAIL ${item.file}: ${errs.join(', ')}`); fail++; }
    else {
      console.log(`OK   ${item.file.padEnd(14)} v${version} ${json.meshes.length} meshes ${json.materials.length} mats ${nodes} nodes anchor=${JSON.stringify(anchor)}`);
      ok++;
    }
  } catch (e) {
    console.log(`FAIL ${item.file}: ${e.message}`);
    fail++;
  }
}
console.log('---');
console.log(`结构校验 ${ok} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
