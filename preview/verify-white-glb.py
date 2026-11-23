#!/usr/bin/env python3
"""验证 furniture_white 白膜资产：GLB 结构可解析、零贴图、单一白膜材质、元数据齐全。"""
import json
import os
import struct
import sys

ASSET_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'furniture_white')
EXPECTED = ['sofa', 'bed', 'chair', 'table', 'coffee', 'wardrobe', 'cabinet', 'shelf']
META_FIELDS = ['isFurniture', 'key', 'name', 'size', 'anchor', 'version']


def parse_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, total = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not glTF binary'
    assert version == 2, 'not glTF 2.0'
    assert total == len(data), 'length mismatch'
    clen, ctype = struct.unpack_from('<II', data, 12)
    assert ctype == 0x4E4F534A, 'first chunk not JSON'
    return json.loads(data[20:20 + clen].decode('utf-8'))


def main():
    failures = []
    with open(os.path.join(ASSET_DIR, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    if len(manifest['items']) != 8:
        failures.append('manifest items != 8')

    for key in EXPECTED:
        path = os.path.join(ASSET_DIR, key + '.glb')
        if not os.path.exists(path):
            failures.append('%s.glb missing' % key)
            continue
        try:
            g = parse_glb(path)
        except Exception as e:
            failures.append('%s.glb parse error: %s' % (key, e))
            continue

        if g.get('images') or g.get('textures') or g.get('samplers'):
            failures.append('%s has images/textures' % key)
        mats = g.get('materials', [])
        if len(mats) != 1:
            failures.append('%s materials=%d (want 1)' % (key, len(mats)))
        else:
            pbr = mats[0].get('pbrMetallicRoughness', {})
            if 'baseColorTexture' in pbr or 'metallicRoughnessTexture' in pbr:
                failures.append('%s material references texture' % key)

        roots = [n for n in g.get('nodes', []) if 'extras' in n and n['extras'].get('isFurniture')]
        if not roots:
            failures.append('%s missing furniture root extras' % key)
        else:
            ex = roots[0]['extras']
            missing = [k for k in META_FIELDS if k not in ex]
            if missing:
                failures.append('%s extras missing %s' % (key, missing))
            if ex.get('key') != key:
                failures.append('%s key mismatch %s' % (key, ex.get('key')))
            if ex.get('version') != '3.0-white':
                failures.append('%s version mismatch %s' % (key, ex.get('version')))

        mesh_count = len(g.get('meshes', []))
        print('%-9s OK  meshes=%d materials=%d images=%d bytes=%d' % (
            key, mesh_count, len(mats), len(g.get('images', [])), os.path.getsize(path)))

    if failures:
        print('\nFAIL (%d):' % len(failures))
        for f in failures:
            print('  -', f)
        sys.exit(1)
    print('\nPASS: 8/8 白膜 GLB 零贴图、单一材质、元数据齐全、结构可解析')


if __name__ == '__main__':
    main()
