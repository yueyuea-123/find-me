"""
Blender 5.x 程序化家具建模脚本
依据《三维家具风格规范与预览验证方案_V1.0》3.2 尺寸基准、3.3 配色板。
输出 preview/assets/furniture_blender/{key}.glb + manifest.json
运行：/Applications/Blender.app/Contents/MacOS/blender -b --python build_furniture.py
坐标：Blender 内部 Z-up，导出 glTF 时转 Y-up；锚点为底面中心。
"""
import bpy
import os
import math

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(HERE, '..', 'assets', 'furniture_blender'))
os.makedirs(OUT_DIR, exist_ok=True)

PALETTE = {
    'wall':   '#F5EFE3',
    'floor':  '#D9B98C',
    'wood':   '#C9A87C',
    'linen':  '#E8DED0',
    'green':  '#9CB49A',
    'yellow': '#E3C46B',
    'clay':   '#D8A79C',
    'dark':   '#5A5148',
}
_mats = {}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color):
    h = hex_color.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def mat(key, roughness=0.85, metallic=0.0):
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new('M_' + key)
    m.use_nodes = True
    bsdf = None
    for node in m.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            bsdf = node
            break
    if bsdf is None:
        bsdf = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = rgba(PALETTE[key])
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    m.diffuse_color = rgba(PALETTE[key])
    _mats[key] = m
    return m


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    _mats.clear()


def activate(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def rbox(name, loc, size, radius, material, rot=None):
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
    o.data.materials.append(material)
    if rot:
        o.rotation_euler = rot
    return o


def cyl(name, loc, radius, height, material, vertices=12, rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=loc)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    if rot:
        o.rotation_euler = rot
    return o


def make_root(key, name_cn, size):
    root = bpy.data.objects.new('ROOT_' + key, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_type = 'PLAIN_AXES'
    root['isFurniture'] = True
    root['key'] = key
    root['name'] = name_cn
    root['size'] = [float(v) for v in size]
    root['anchor'] = [0.0, 0.0, 0.0]
    root['version'] = '2.0'
    root['source'] = 'Blender procedural'
    return root


def parent_all(root):
    for o in bpy.context.scene.objects:
        if o is root:
            continue
        if o.parent is None:
            o.parent = root


# ---------------- 8 件家具 ----------------

def build_sofa():
    reset()
    root = make_root('sofa', '沙发', (2.0, 0.9, 0.8))
    linen, wall, wood = mat('linen'), mat('wall'), mat('wood')
    rbox('base', (0, 0, 0.16), (2.0, 0.9, 0.26), 0.09, linen)
    rbox('back', (0, -0.40, 0.48), (2.0, 0.16, 0.44), 0.09, linen)
    for s in (-1, 1):
        rbox('arm_' + str(s), (s * 0.89, 0, 0.34), (0.22, 0.9, 0.38), 0.10, linen)
    for s in (-1, 1):
        rbox('cushion_' + str(s), (s * 0.44, 0.10, 0.36), (0.84, 0.68, 0.18), 0.09, wall)
    rbox('pillow_a', (-0.55, -0.04, 0.56), (0.30, 0.14, 0.30), 0.07, mat('clay'), (0, 0, 0.18))
    rbox('pillow_b', (0.55, -0.04, 0.56), (0.30, 0.14, 0.30), 0.07, mat('green'), (0, 0, -0.18))
    for x in (-0.84, 0.84):
        for y in (-0.32, 0.32):
            cyl('leg', (x, y, 0.04), 0.03, 0.08, wood)
    parent_all(root)
    return 'sofa'


def build_bed():
    reset()
    root = make_root('bed', '床', (1.5, 2.0, 0.5))
    wood, wall, linen, green = mat('wood'), mat('wall'), mat('linen'), mat('green')
    rbox('frame', (0, 0, 0.13), (1.5, 2.0, 0.26), 0.06, wood)
    rbox('mattress', (0, 0.02, 0.32), (1.42, 1.90, 0.16), 0.06, wall)
    rbox('headboard', (0, -0.95, 0.25), (1.5, 0.12, 0.50), 0.06, wood)
    rbox('quilt', (0, 0.35, 0.43), (1.38, 1.10, 0.10), 0.05, green)
    for x in (-0.34, 0.34):
        rbox('pillow', (x, -0.68, 0.44), (0.58, 0.30, 0.12), 0.05, linen)
    parent_all(root)
    return 'bed'


def build_chair():
    reset()
    root = make_root('chair', '椅子', (0.8, 0.8, 0.8))
    linen, wall, wood = mat('linen'), mat('wall'), mat('wood')
    rbox('seat', (0, 0, 0.42), (0.68, 0.68, 0.12), 0.05, linen)
    rbox('seat_pad', (0, 0.02, 0.50), (0.60, 0.60, 0.06), 0.03, wall)
    rbox('back', (0, -0.28, 0.58), (0.68, 0.10, 0.40), 0.05, linen)
    for x in (-0.26, 0.26):
        for y in (-0.26, 0.26):
            cyl('leg', (x, y, 0.18), 0.028, 0.36, wood)
    parent_all(root)
    return 'chair'


def build_table():
    reset()
    root = make_root('table', '桌', (1.4, 0.8, 0.75))
    wood = mat('wood')
    rbox('top', (0, 0, 0.71), (1.4, 0.8, 0.08), 0.04, wood)
    rbox('apron', (0, 0, 0.64), (1.28, 0.68, 0.08), 0.03, wood)
    for x in (-0.61, 0.61):
        for y in (-0.31, 0.31):
            cyl('leg', (x, y, 0.335), 0.035, 0.67, wood)
    parent_all(root)
    return 'table'


def build_coffee():
    reset()
    root = make_root('coffee', '茶几', (1.0, 0.6, 0.4))
    wood, yellow = mat('wood'), mat('yellow')
    rbox('top', (0, 0, 0.36), (1.0, 0.6, 0.07), 0.035, wood)
    rbox('shelf', (0, 0, 0.12), (0.88, 0.48, 0.04), 0.02, wood)
    for x in (-0.42, 0.42):
        for y in (-0.22, 0.22):
            cyl('leg', (x, y, 0.17), 0.025, 0.34, wood)
    cyl('tray', (0.26, 0.02, 0.415), 0.07, 0.045, yellow)
    parent_all(root)
    return 'coffee'


def build_wardrobe():
    reset()
    root = make_root('wardrobe', '衣柜', (1.2, 0.6, 2.0))
    wood, linen, dark = mat('wood'), mat('linen'), mat('dark')
    rbox('body', (0, 0, 1.0), (1.2, 0.6, 2.0), 0.05, wood)
    for s in (-1, 1):
        rbox('door_' + str(s), (s * 0.295, -0.31, 1.0), (0.58, 0.035, 1.90), 0.04, linen)
        cyl('handle', (s * 0.06, -0.34, 1.0), 0.015, 0.10, dark, vertices=10)
    parent_all(root)
    return 'wardrobe'


def build_cabinet():
    reset()
    root = make_root('cabinet', '斗柜', (1.0, 0.45, 0.9))
    wood, linen, dark = mat('wood'), mat('linen'), mat('dark')
    rbox('body', (0, 0, 0.45), (1.0, 0.45, 0.9), 0.05, wood)
    for i, z in enumerate((0.16, 0.45, 0.74)):
        rbox('drawer_' + str(i), (0, -0.235, z), (0.92, 0.025, 0.27), 0.035, linen)
        cyl('handle_' + str(i), (0, -0.255, z), 0.014, 0.10, dark, vertices=10)
    parent_all(root)
    return 'cabinet'


def build_shelf():
    reset()
    root = make_root('shelf', '书柜', (0.9, 0.35, 1.8))
    wood, linen = mat('wood'), mat('linen')
    rbox('back', (0, 0.17, 0.9), (0.84, 0.02, 1.74), 0.01, linen)
    for s in (-1, 1):
        rbox('side_' + str(s), (s * 0.42, 0, 0.9), (0.06, 0.35, 1.8), 0.025, wood)
    rbox('top', (0, 0, 1.77), (0.9, 0.35, 0.06), 0.025, wood)
    rbox('bottom', (0, 0, 0.03), (0.9, 0.35, 0.06), 0.025, wood)
    levels = (0.46, 0.90, 1.34)
    for i, z in enumerate(levels):
        rbox('divider_' + str(i), (0, 0, z), (0.84, 0.32, 0.045), 0.02, wood)
    colors = (mat('green'), mat('yellow'), mat('clay'), mat('linen'), mat('wall'))
    for li, z in enumerate((0.08, 0.52, 0.96, 1.40)):
        for bi in range(4):
            x = -0.30 + bi * 0.19
            color = colors[(li * 2 + bi) % len(colors)]
            rbox('book_%d_%d' % (li, bi), (x, 0.01, z + 0.16), (0.11, 0.24, 0.30), 0.015, color)
    parent_all(root)
    return 'shelf'


BUILDERS = [
    (build_sofa, '沙发', (2.0, 0.9, 0.8)),
    (build_bed, '床', (1.5, 2.0, 0.5)),
    (build_chair, '椅子', (0.8, 0.8, 0.8)),
    (build_table, '桌', (1.4, 0.8, 0.75)),
    (build_coffee, '茶几', (1.0, 0.6, 0.4)),
    (build_wardrobe, '衣柜', (1.2, 0.6, 2.0)),
    (build_cabinet, '斗柜', (1.0, 0.45, 0.9)),
    (build_shelf, '书柜', (0.9, 0.35, 1.8)),
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


def main():
    manifest = {
        'version': '2.0',
        'unit': 'meter',
        'up': 'Y',
        'note': 'Blender 5.3 程序化建模；尺寸顺序 [宽, 深, 高]；锚点为底面中心',
        'items': [],
    }
    for builder, name_cn, size in BUILDERS:
        key = builder()
        path = os.path.join(OUT_DIR, key + '.glb')
        bpy.ops.export_scene.gltf(filepath=path, **gltf_params())
        tris = 0
        for o in bpy.context.scene.objects:
            if o.type == 'MESH':
                tris += sum(max(0, len(p.vertices) - 2) for p in o.data.polygons)
        manifest['items'].append({
            'key': key,
            'name': name_cn,
            'file': key + '.glb',
            'size': list(size),
            'anchor': [0, 0, 0],
            'triangles': tris,
            'bytes': os.path.getsize(path),
            'version': '2.0',
            'source': 'Blender 5.3 procedural',
        })
        print('BUILT %-9s %6d tris %8d bytes' % (key, tris, os.path.getsize(path)))
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        import json
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('MANIFEST', os.path.join(OUT_DIR, 'manifest.json'))


main()
