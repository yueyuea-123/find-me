"""
样板家具建模脚本（6 件）：床 / 书桌 / 茶几 / 衣柜 / 置物架 / 沙发
沿用 build_furniture.py 的色板、尺寸基准、锚点底面中心、导出参数；
重做造型细节与材质搭配，提升辨识度与观感。
输出 preview/assets/furniture_samples/{key}.glb + manifest.json + thumbs/{key}.png
运行：/Applications/Blender.app/Contents/MacOS/blender -b --python build_samples.py
"""
import bpy
import os
import math
import json
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(HERE, '..', 'assets', 'furniture_samples'))
THUMB_DIR = os.path.join(OUT_DIR, 'thumbs')
os.makedirs(THUMB_DIR, exist_ok=True)

PALETTE = {
    'wall': '#F5EFE3', 'floor': '#D9B98C', 'wood': '#C9A87C',
    'linen': '#E8DED0', 'green': '#9CB49A', 'yellow': '#E3C46B',
    'clay': '#D8A79C', 'dark': '#8A7B6B',
}
_mats = {}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color):
    h = hex_color.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


def mat(key, roughness=0.85):
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
    bsdf.inputs['Metallic'].default_value = 0.0
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
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if radius > 0:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = radius
        b.segments = 2
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
    root['version'] = 'sample-1.0'
    root['source'] = 'Blender procedural sample'
    return root


def parent_all(root):
    for o in bpy.context.scene.objects:
        if o is root or o.parent is not None:
            continue
        o.parent = root


# ---------------- 6 件样板造型 ----------------

def build_sofa():
    reset()
    root = make_root('sofa', '沙发', (2.0, 0.9, 0.8))
    wood, linen, wall, clay, green = mat('wood'), mat('linen'), mat('wall'), mat('clay'), mat('green')
    rbox('plinth', (0, 0, 0.09), (1.90, 0.84, 0.18), 0.04, wood)
    for i, s in enumerate((-0.63, 0, 0.63)):
        rbox('seat_%d' % i, (s, 0.06, 0.28), (0.62, 0.76, 0.22), 0.09, linen)
        rbox('back_%d' % i, (s, -0.37, 0.55), (0.62, 0.18, 0.46), 0.08, linen)
    for s in (-1, 1):
        rbox('arm_%s' % s, (s * 0.92, 0, 0.42), (0.20, 0.88, 0.40), 0.09, linen)
        rbox('armcap_%s' % s, (s * 0.92, 0, 0.63), (0.22, 0.90, 0.06), 0.03, wall)
    rbox('pillow_a', (-0.60, -0.10, 0.60), (0.34, 0.16, 0.32), 0.07, clay, (0, 0, 0.15))
    rbox('pillow_b', (0.60, -0.10, 0.60), (0.34, 0.16, 0.32), 0.07, green, (0, 0, -0.15))
    for x in (-0.82, 0.82):
        for y in (-0.32, 0.32):
            cyl('leg', (x, y, 0.04), 0.028, 0.08, wood)
    parent_all(root)
    return 'sofa', root


def build_bed():
    reset()
    root = make_root('bed', '床', (1.5, 2.0, 0.5))
    wood, linen, wall, green, clay = mat('wood'), mat('linen'), mat('wall'), mat('green'), mat('clay')
    rbox('frame', (0, 0, 0.13), (1.5, 2.0, 0.26), 0.05, wood)
    rbox('mattress', (0, 0.02, 0.32), (1.42, 1.90, 0.16), 0.06, wall)
    rbox('headboard', (0, -0.96, 0.30), (1.5, 0.14, 0.60), 0.06, linen)
    for i, s in enumerate((-0.48, 0, 0.48)):
        rbox('hb_panel_%d' % i, (s, -0.88, 0.33), (0.42, 0.02, 0.46), 0.03, clay if i == 1 else wall)
    rbox('quilt', (0, 0.32, 0.44), (1.38, 1.15, 0.12), 0.05, green)
    rbox('quilt_fold', (0, -0.24, 0.52), (1.38, 0.22, 0.10), 0.04, green)
    for x in (-0.34, 0.34):
        rbox('pillow_%s' % x, (x, -0.68, 0.46), (0.58, 0.32, 0.14), 0.06, linen)
    for x in (-0.66, 0.66):
        for y in (-0.88, 0.88):
            cyl('leg', (x, y, 0.05), 0.03, 0.10, wood)
    parent_all(root)
    return 'bed', root


def build_table():
    reset()
    root = make_root('table', '书桌', (1.4, 0.8, 0.75))
    wood, linen, dark, green = mat('wood'), mat('linen'), mat('dark'), mat('green')
    rbox('top', (0, 0, 0.71), (1.4, 0.8, 0.07), 0.035, wood)
    rbox('drawer_unit', (-0.45, 0, 0.35), (0.44, 0.70, 0.66), 0.03, linen)
    for i, z in enumerate((0.18, 0.40, 0.61)):
        rbox('drawer_%d' % i, (-0.45, -0.36, z), (0.40, 0.02, 0.19), 0.02, wood)
        rbox('handle_%d' % i, (-0.45, -0.38, z), (0.12, 0.03, 0.025), 0.01, dark)
    for y in (-0.30, 0.30):
        cyl('leg_r_%s' % y, (0.62, y, 0.34), 0.038, 0.68, wood)
    rbox('stretcher', (0.10, 0, 0.12), (1.0, 0.06, 0.05), 0.02, wood)
    rbox('book', (0.32, 0.02, 0.765), (0.30, 0.22, 0.035), 0.006, green)
    parent_all(root)
    return 'table', root


def build_coffee():
    reset()
    root = make_root('coffee', '茶几', (1.0, 0.6, 0.4))
    wood, linen, clay, dark = mat('wood'), mat('linen'), mat('clay'), mat('dark')
    rbox('top', (0, 0, 0.36), (1.0, 0.6, 0.07), 0.05, wood)
    rbox('shelf', (0, 0, 0.14), (0.86, 0.50, 0.04), 0.02, linen)
    for x in (-0.42, 0.42):
        for y in (-0.22, 0.22):
            cyl('leg', (x, y, 0.18), 0.028, 0.36, wood)
    rbox('tray', (0.20, 0, 0.415), (0.32, 0.24, 0.02), 0.01, dark)
    cyl('cup', (0.16, 0, 0.46), 0.045, 0.07, clay, vertices=12)
    parent_all(root)
    return 'coffee', root


def build_wardrobe():
    reset()
    root = make_root('wardrobe', '衣柜', (1.2, 0.6, 2.0))
    wood, linen, dark, wall = mat('wood'), mat('linen'), mat('dark'), mat('wall')
    rbox('body', (0, 0, 1.0), (1.2, 0.6, 1.94), 0.04, wood)
    rbox('cornice', (0, 0, 1.98), (1.28, 0.66, 0.08), 0.02, wood)
    rbox('plinth', (0, 0, 0.05), (1.16, 0.56, 0.10), 0.02, dark)
    for s in (-1, 1):
        rbox('door_%s' % s, (s * 0.295, -0.31, 1.02), (0.57, 0.04, 1.82), 0.03, linen)
        rbox('panel_%s' % s, (s * 0.295, -0.335, 1.02), (0.45, 0.012, 1.62), 0.02, wall)
        rbox('handle_%s' % s, (s * 0.055, -0.36, 1.05), (0.025, 0.03, 0.22), 0.01, dark)
    parent_all(root)
    return 'wardrobe', root


def build_shelf():
    reset()
    root = make_root('shelf', '置物架', (0.9, 0.35, 1.8))
    wood, linen, green, yellow, clay = mat('wood'), mat('linen'), mat('green'), mat('yellow'), mat('clay')
    for s in (-1, 1):
        rbox('side_%s' % s, (s * 0.42, 0, 0.9), (0.06, 0.35, 1.8), 0.02, wood)
    rbox('back', (0, 0.16, 0.9), (0.84, 0.02, 1.74), 0.01, linen)
    for i, z in enumerate((0.04, 0.48, 0.92, 1.36, 1.77)):
        rbox('level_%d' % i, (0, 0, z), (0.84, 0.33, 0.045), 0.015, wood)
    colors = (green, yellow, clay, linen)
    for bi in range(5):
        x = -0.28 + bi * 0.13
        rbox('book_%d' % bi, (x, 0.02, 0.72), (0.10, 0.22, 0.40), 0.012, colors[bi % 4])
    rbox('box_a', (-0.20, 0, 1.12), (0.32, 0.26, 0.22), 0.02, clay)
    rbox('box_b', (0.24, 0, 1.12), (0.30, 0.26, 0.22), 0.02, green)
    parent_all(root)
    return 'shelf', root


BUILDERS = [
    (build_sofa, '沙发', (2.0, 0.9, 0.8)),
    (build_bed, '床', (1.5, 2.0, 0.5)),
    (build_table, '书桌', (1.4, 0.8, 0.75)),
    (build_coffee, '茶几', (1.0, 0.6, 0.4)),
    (build_wardrobe, '衣柜', (1.2, 0.6, 2.0)),
    (build_shelf, '置物架', (0.9, 0.35, 1.8)),
]


def gltf_params():
    allowed = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    wanted = {
        'export_format': 'GLB', 'use_selection': False, 'export_apply': True,
        'export_yup': True, 'export_materials': 'EXPORT',
        'export_cameras': False, 'export_lights': False, 'export_extras': True,
    }
    return {k: v for k, v in wanted.items() if k in allowed}


def render_thumb(key, size):
    scene = bpy.context.scene
    w, d, h = size
    cz = h * 0.5
    R = max(w, d, h) * 1.4
    bpy.ops.object.camera_add(location=(R, -R, cz + R * 0.8))
    cam = bpy.context.object
    cam.name = 'THUMB_CAM'
    direction = mathutils.Vector((0, 0, cz)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(w, d, h) * 2.0
    scene.camera = cam
    bpy.ops.object.light_add(type='AREA', location=(w, -w, h * 2 + 2))
    key_light = bpy.context.object
    key_light.name = 'KEY_LIGHT'
    key_light.data.energy = 220
    key_light.data.shape = 'DISK'
    key_light.data.size = 4.0
    bpy.ops.object.light_add(type='AREA', location=(-w, w, h + 1.5))
    fill = bpy.context.object
    fill.name = 'FILL_LIGHT'
    fill.data.energy = 100
    fill.data.shape = 'DISK'
    fill.data.size = 4.0
    world = scene.world or bpy.data.worlds.new('SampleWorld')
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    bg = nodes.get('Background')
    if bg is None:
        bg = nodes.new('ShaderNodeBackground')
    out = nodes.get('World Output')
    if out is None:
        out = nodes.new('ShaderNodeOutputWorld')
    links.new(bg.outputs['Background'], out.inputs['Surface'])
    bg.inputs['Color'].default_value = rgba(PALETTE['wall'])
    bg.inputs['Strength'].default_value = 1.0
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    try:
        scene.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = os.path.join(THUMB_DIR, key + '.png')
    bpy.ops.render.render(write_still=True)


def main():
    manifest = {
        'version': 'sample-1.0', 'unit': 'meter', 'up': 'Y',
        'note': '样板件：沿用色板/尺寸/锚点，重做造型与材质；未接入主包',
        'items': [],
    }
    for builder, name_cn, size in BUILDERS:
        key, root = builder()
        path = os.path.join(OUT_DIR, key + '.glb')
        bpy.ops.export_scene.gltf(filepath=path, **gltf_params())
        tris = 0
        for o in bpy.context.scene.objects:
            if o.type == 'MESH' and o.parent == root:
                tris += sum(max(0, len(p.vertices) - 2) for p in o.data.polygons)
        manifest['items'].append({
            'key': key, 'name': name_cn, 'file': key + '.glb',
            'size': list(size), 'anchor': [0, 0, 0], 'triangles': tris,
            'bytes': os.path.getsize(path), 'version': 'sample-1.0',
            'source': 'Blender procedural sample',
        })
        print('BUILT %-9s %6d tris %8d bytes' % (key, tris, os.path.getsize(path)))
        render_thumb(key, size)
        print('THUMB %s' % os.path.join(THUMB_DIR, key + '.png'))
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('MANIFEST', os.path.join(OUT_DIR, 'manifest.json'))


main()
