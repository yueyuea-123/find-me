import * as THREE from 'three';

// 规范 3.3 配色板 + 3.4 材质：哑光 PBR，粗糙度偏高、金属度近 0
const PALETTE = {
  wall: 0xF5EFE3,
  floor: 0xD9B98C,
  wood: 0xC9A87C,
  linen: 0xE8DED0,
  sage: 0x9CB49A,
  mustard: 0xE3C46B,
  clay: 0xD8A79C,
  ink: 0x5A5148
};

// 共享材质库：全场复用，避免逐件独立材质
function matte(color, roughness = 0.88) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.0,
    flatShading: false
  });
}

export const M = {
  wall: matte(PALETTE.wall),
  floor: matte(PALETTE.floor, 0.95),
  wood: matte(PALETTE.wood),
  woodDark: matte(0xA88457),
  linen: matte(PALETTE.linen),
  linenAlt: matte(0xD8CDBB),
  sage: matte(PALETTE.sage),
  mustard: matte(PALETTE.mustard),
  clay: matte(PALETTE.clay),
  ink: matte(PALETTE.ink),
  white: matte(0xFAF6EE)
};

export { PALETTE };

// 目录卡片色块用：返回 CSS 色值
export function cssColor(hex) {
  return '#' + hex.toString(16).padStart(6, '0').toUpperCase();
}
