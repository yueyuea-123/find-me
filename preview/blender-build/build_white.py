"""
Blender 5.x 程序化白膜家具建模脚本（由 Blender MCP 在已连接实例内执行）
依据《三维家具风格规范与预览验证方案_V1.0》3.2 尺寸基准。
与 build_furniture.py 共用几何，但：统一单一浅灰白膜材质、无任何贴图/图像。
输出 preview/assets/furniture_white/{key}.glb + manifest.json + furniture_white.blend
坐标：Blender 内部 Z-up，导出 glTF 转 Y-up；锚点为底面中心。
"""
import bpy
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(HERE, '..', 'assets', 'furniture_white'))
os.makedirs(OUT_DIR, exist_ok=True)
BLEND_PATH = os.path.join(OUT_DIR, 'furniture_white.blend')

_white = None


def ensure_white():
    """单一白膜材质：仅基色+高粗糙度，无贴图节点。"""
    global _white
    m = bpy.data.materials.get('WhiteClay')
    if m is None:
        m = bpy.data.materials.new('WhiteClay')
        m.use_nodes = True
        bsdf = None
        for node in m.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                bsdf = node
                break
        if bsdf is None:
            bsdf = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        rgba = (0.82, 0.82, 0.82, 1.0)
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Roughness'].default_value = 0.9
        if 'Metallic' in bsdf.inputs:
            bsdf.inputs['Metallic'].default_value = 0.0
        m.diffuse_color = rgba
    _white = m
    return m


def reset():
    """仅清空物体，保留白膜材质以便复用。"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def activate(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def rbox(name, loc, size, radius, rot=None):
    """大圆角盒：cube + bevel(segments=1) + weighted normal"""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius > 0:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = radius
        b.segments = 1
        try:
            b.affect = 'EDGES'
        except Exception:
            pass
        bpy.ops.object.modifier_apply(modifier=b.name)
    wn = o.modifiers.new('WeightedNormal', 'WEIGHTED_NORMAL')
    bpy.ops.object.modifier_apply(modifier=wn.name)
    o.data.materials.append(ensure_white())
    if rot:
        o.rotation_euler = rot
    return o


def cyl(name, loc, radius, height, vertices=12, rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=loc)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(ensure_white())
    if rot:
        o.rotation_euler = rot
    return o


def make_root(key, name_cn, size, version='3.0-white'):
    root = bpy.data.objects.new('ROOT_' + key, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = 'PLAIN_AXES'
    root['isFurniture'] = True
    root['key'] = key
    root['name'] = name_cn
    root['size'] = [float(v) for v in size]
    root['anchor'] = [0.0, 0.0, 0.0]
    root['version'] = version
    root['source'] = 'Blender procedural white-clay (no textures)'
    return root


def parent_all(root):
    for o in bpy.context.scene.objects:
        if o is root:
            continue
        if o.parent is None:
            o.parent = root


# ---------------- 8 件 L1 家具几何（与 build_furniture.py 一致） ----------------

def build_sofa():
    rbox('base', (0, 0, 0.16), (2.0, 0.9, 0.26), 0.09)
    rbox('back', (0, -0.40, 0.48), (2.0, 0.16, 0.44), 0.09)
    for s in (-1, 1):
        rbox('arm_' + str(s), (s * 0.89, 0, 0.34), (0.22, 0.9, 0.38), 0.10)
    for s in (-1, 1):
        rbox('cushion_' + str(s), (s * 0.44, 0.10, 0.36), (0.84, 0.68, 0.18), 0.09)
    rbox('pillow_a', (-0.55, -0.04, 0.56), (0.30, 0.14, 0.30), 0.07, (0, 0, 0.18))
    rbox('pillow_b', (0.55, -0.04, 0.56), (0.30, 0.14, 0.30), 0.07, (0, 0, -0.18))
    for x in (-0.84, 0.84):
        for y in (-0.32, 0.32):
            cyl('leg', (x, y, 0.04), 0.03, 0.08)


def build_bed():
    rbox('frame', (0, 0, 0.13), (1.5, 2.0, 0.26), 0.06)
    rbox('mattress', (0, 0.02, 0.32), (1.42, 1.90, 0.16), 0.06)
    rbox('headboard', (0, -0.95, 0.25), (1.5, 0.12, 0.50), 0.06)
    rbox('quilt', (0, 0.35, 0.43), (1.38, 1.10, 0.10), 0.05)
    for x in (-0.34, 0.34):
        rbox('pillow', (x, -0.68, 0.44), (0.58, 0.30, 0.12), 0.05)


def build_chair():
    rbox('seat', (0, 0, 0.42), (0.68, 0.68, 0.12), 0.05)
    rbox('seat_pad', (0, 0.02, 0.50), (0.60, 0.60, 0.06), 0.03)
    rbox('back', (0, -0.28, 0.58), (0.68, 0.10, 0.40), 0.05)
    for x in (-0.26, 0.26):
        for y in (-0.26, 0.26):
            cyl('leg', (x, y, 0.18), 0.028, 0.36)


def build_table():
    rbox('top', (0, 0, 0.71), (1.4, 0.8, 0.08), 0.04)
    rbox('apron', (0, 0, 0.64), (1.28, 0.68, 0.08), 0.03)
    for x in (-0.61, 0.61):
        for y in (-0.31, 0.31):
            cyl('leg', (x, y, 0.335), 0.035, 0.67)


def build_coffee():
    rbox('top', (0, 0, 0.36), (1.0, 0.6, 0.07), 0.035)
    rbox('shelf', (0, 0, 0.12), (0.88, 0.48, 0.04), 0.02)
    for x in (-0.42, 0.42):
        for y in (-0.22, 0.22):
            cyl('leg', (x, y, 0.17), 0.025, 0.34)
    cyl('tray', (0.26, 0.02, 0.415), 0.07, 0.045)


def build_wardrobe():
    rbox('body', (0, 0, 1.0), (1.2, 0.6, 2.0), 0.05)
    for s in (-1, 1):
        rbox('door_' + str(s), (s * 0.295, -0.31, 1.0), (0.58, 0.035, 1.90), 0.04)
        cyl('handle', (s * 0.06, -0.34, 1.0), 0.015, 0.10, vertices=10)


def build_cabinet():
    rbox('body', (0, 0, 0.45), (1.0, 0.45, 0.9), 0.05)
    for i, z in enumerate((0.16, 0.45, 0.74)):
        rbox('drawer_' + str(i), (0, -0.235, z), (0.92, 0.025, 0.27), 0.035)
        cyl('handle_' + str(i), (0, -0.255, z), 0.014, 0.10, vertices=10)


def build_shelf():
    rbox('back', (0, 0.17, 0.9), (0.84, 0.02, 1.74), 0.01)
    for s in (-1, 1):
        rbox('side_' + str(s), (s * 0.42, 0, 0.9), (0.06, 0.35, 1.8), 0.025)
    rbox('top', (0, 0, 1.77), (0.9, 0.35, 0.06), 0.025)
    rbox('bottom', (0, 0, 0.03), (0.9, 0.35, 0.06), 0.025)
    for i, z in enumerate((0.46, 0.90, 1.34)):
        rbox('divider_' + str(i), (0, 0, z), (0.84, 0.32, 0.045), 0.02)
    for li, z in enumerate((0.08, 0.52, 0.96, 1.40)):
        for bi in range(4):
            x = -0.30 + bi * 0.19
            rbox('book_%d_%d' % (li, bi), (x, 0.01, z + 0.16), (0.11, 0.24, 0.30), 0.015)


BUILDERS = [
    (build_sofa, 'sofa', '沙发', (2.0, 0.9, 0.8)),
    (build_bed, 'bed', '床', (1.5, 2.0, 0.5)),
    (build_chair, 'chair', '椅子', (0.8, 0.8, 0.8)),
    (build_table, 'table', '桌', (1.4, 0.8, 0.75)),
    (build_coffee, 'coffee', '茶几', (1.0, 0.6, 0.4)),
    (build_wardrobe, 'wardrobe', '衣柜', (1.2, 0.6, 2.0)),
    (build_cabinet, 'cabinet', '斗柜', (1.0, 0.45, 0.9)),
    (build_shelf, 'shelf', '书柜', (0.9, 0.35, 1.8)),
]


def gltf_params():
    allowed = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    wanted = {
        'export_format': 'GLB',
        'use_selection': False,
        'export_apply': True,
        'export_yup': True,
        'export_materials': 'EXPORT',
        'export_cameras': False,
        'export_lights': False,
        'export_extras': True,
    }
    return {k: v for k, v in wanted.items() if k in allowed}


def count_tris():
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            tris += sum(max(0, len(p.vertices) - 2) for p in o.data.polygons)
    return tris


def build_one(builder, key, name_cn, size):
    reset()
    ensure_white()
    root = make_root(key, name_cn, size)
    builder()
    parent_all(root)
    return root


def main():
    manifest = {
        'version': '3.0-white',
        'unit': 'meter',
        'up': 'Y',
        'material': 'WhiteClay only, no image/texture',
        'note': 'Blender 程序化白膜；尺寸顺序 [宽,深,高]；锚点底面中心',
        'items': [],
    }
    for builder, key, name_cn, size in BUILDERS:
        build_one(builder, key, name_cn, size)
        path = os.path.join(OUT_DIR, key + '.glb')
        bpy.ops.export_scene.gltf(filepath=path, **gltf_params())
        manifest['items'].append({
            'key': key,
            'name': name_cn,
            'file': key + '.glb',
            'size': list(size),
            'anchor': [0, 0, 0],
            'triangles': count_tris(),
            'bytes': os.path.getsize(path),
            'version': '3.0-white',
            'source': 'Blender procedural white-clay (no textures)',
        })
        print('BUILT %-9s %6d tris %8d bytes' % (key, manifest['items'][-1]['triangles'], manifest['items'][-1]['bytes']))

    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # 展示场景：8 件按 4x2 网格摆开，保存 .blend 便于人工核对白膜造型
    reset()
    ensure_white()
    spacing = 2.8
    for idx, (builder, key, name_cn, size) in enumerate(BUILDERS):
        root = make_root(key, name_cn, size)
        builder()
        parent_all(root)
        col, row = idx % 4, idx // 4
        root.location = ((col - 1.5) * spacing, (0.5 - row) * spacing, 0.0)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print('BLEND', BLEND_PATH)
    print('MANIFEST', os.path.join(OUT_DIR, 'manifest.json'))
    print('DONE white-clay items=%d' % len(manifest['items']))


main()
