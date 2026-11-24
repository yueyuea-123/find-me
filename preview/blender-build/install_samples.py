"""
把已评审通过的 6 件样板家具接入小程序三维分包（阶段三 3.2/3.3/3.5）。
做法：
1) 先整包备份现有白膜资产到 preview/backup/furniture_white_3.0_<日期>/（回退点）；
2) 用 preview/assets/furniture_samples/ 下的 6 件彩色 GLB 覆盖分包同名文件；
3) 生成混合版 manifest：6 件彩色 + chair/cabinet 两件仍是白膜，
   key / name / size / anchor 全部沿用原 manifest，只更新面数、字节数、版本与材质说明。
物品绑定按 category -> GLB key 走（renderer.js 的 CATEGORY_TO_GLB），与模型文件无关，
因此本脚本不触碰任何数据层与物品关联（BR-009）。
运行：python3 install_samples.py
"""
import os
import json
import shutil
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PKG = os.path.join(ROOT, 'iteam', 'miniprogram', 'package3d', 'assets', 'furniture')
SAMPLES = os.path.join(ROOT, 'preview', 'assets', 'furniture_samples')
BACKUP = os.path.join(ROOT, 'preview', 'backup',
                      'furniture_white_3.0_' + date.today().strftime('%Y%m%d'))

COLORED = ['sofa', 'bed', 'table', 'coffee', 'wardrobe', 'shelf']


def main():
    # 1) 回退点
    if os.path.exists(BACKUP):
        shutil.rmtree(BACKUP)
    shutil.copytree(PKG, BACKUP)
    print('BACKUP', BACKUP)

    # 2) 覆盖 6 件彩色 GLB
    sample_manifest = json.load(open(os.path.join(SAMPLES, 'manifest.json'), encoding='utf-8'))
    sample_by_key = {it['key']: it for it in sample_manifest['items']}
    for key in COLORED:
        src = os.path.join(SAMPLES, key + '.glb')
        dst = os.path.join(PKG, key + '.glb')
        shutil.copy2(src, dst)
        print('INSTALLED', key, os.path.getsize(dst))

    # 3) 混合 manifest：结构完全沿用原文件，只替换几何/来源字段
    mpath = os.path.join(PKG, 'manifest.json')
    manifest = json.load(open(mpath, encoding='utf-8'))
    manifest['version'] = '4.0-mixed-sample'
    manifest['material'] = '6 colored PBR samples + 2 white-clay legacy'
    manifest['note'] = ('彩色样板 6 件（沙发/床/书桌/茶几/衣柜/置物架）+ 白膜 2 件（椅子/斗柜）；'
                        '尺寸顺序 [宽,深,高]；锚点底面中心；换模型不动物品绑定')
    for it in manifest['items']:
        key = it['key']
        if key in sample_by_key:
            s = sample_by_key[key]
            it['triangles'] = s['triangles']
            it['bytes'] = os.path.getsize(os.path.join(PKG, s['file']))
            it['version'] = 'sample-1.0'
            it['source'] = 'Blender procedural sample (colored PBR)'
    with open(mpath, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print('MANIFEST', mpath, 'items=', len(manifest['items']))
    print('TOTAL_GLB_BYTES', sum(os.path.getsize(os.path.join(PKG, f))
                                 for f in os.listdir(PKG) if f.endswith('.glb')))


main()
