#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小程序交付质量自动检查打分脚本
依据 ai-miniprogram-delivery Step 6 测试验收 + 码小序交付前自检清单
总分 100，达标线：>= 90 且无阻断项(P0)

维度：
  D1 配置合法性(10) D2 页面四件套(12) D3 JSON合法(8)  D4 JS语法(18)
  D5 WXML事件绑定(12) D6 路由一致性(10) D7 静态资源(8)
  D8 数据层完整性(12) D9 运行时健壮性(10)

用法: python3 qa/check_and_score.py [--json] [--out FILE]
"""
import os, sys, json, subprocess, re, argparse
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MP = os.path.join(ROOT, 'miniprogram')
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'quality-report.json')


def rel(*a): return os.path.join(MP, *a)
def read(*a):
    # 阶段2c 起 room3d 页代码按块拆到同目录模块（mixin 合并进 Page）：
    # 读取 room3d 下任一 .js 时聚合该目录全部 .js，事件绑定/方法定义跨文件可发现。
    p = rel(*a)
    if len(a) == 1 and re.match(r'pages/room3d/[^/]+\.js$', a[0]) and os.path.isdir(rel('pages', 'room3d')):
        parts = []
        d = rel('pages', 'room3d')
        for f in sorted(os.listdir(d)):
            if f.endswith('.js'):
                try:
                    with open(os.path.join(d, f), 'r', encoding='utf-8') as fh: parts.append(fh.read())
                except Exception: pass
        if parts: return '\n'.join(parts)
    try:
        with open(p, 'r', encoding='utf-8') as f: return f.read()
    except Exception: return ''


def load_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f: return json.load(f), None
    except Exception as e: return None, str(e)


def list_files(ext, base=None):
    base = base or MP
    out = []
    for dp, dn, fn in os.walk(base):
        if 'verify-browser' in dp: continue
        for f in fn:
            if f.endswith(ext): out.append(os.path.join(dp, f))
    return out


class Report:
    def __init__(self):
        self.scores = {}
        self.blockers = []
        self.issues = []
        self.details = {}

    def add(self, dim, score, full, issues=None, blockers=None, detail=None):
        self.scores[dim] = {'score': round(score, 1), 'full': full}
        for x in (issues or []):
            self.issues.append({'dim': dim, 'level': 'P1', 'msg': x})
        for x in (blockers or []):
            self.blockers.append({'dim': dim, 'level': 'P0', 'msg': x})
        if detail: self.details[dim] = detail

    @property
    def total(self): return round(sum(v['score'] for v in self.scores.values()), 1)
    @property
    def passed(self): return self.total >= 90 and not self.blockers


def check_d1(app):
    """配置合法性 10"""
    issues, blockers, got = [], [], 10
    if app is None: blockers.append('app.json 缺失或 JSON 非法'); return 0, blockers + issues
    pages = app.get('pages', [])
    if not isinstance(pages, list) or not pages: blockers.append('app.json.pages 为空'); got -= 3
    if not isinstance(app.get('window'), dict): issues.append('缺少 window 配置'); got -= 2
    tb = app.get('tabBar', {})
    tb_list = tb.get('list', []) if isinstance(tb, dict) else []
    if not (2 <= len(tb_list) <= 5): issues.append('tabBar.list 数量不在 2~5'); got -= 2
    for item in tb_list:
        if not item.get('pagePath') or not item.get('text'): issues.append('tabBar 项缺 pagePath/text'); got -= 1; break
    if not app.get('sitemapLocation'): issues.append('未配置 sitemapLocation'); got -= 1
    # 页面路径唯一性
    if len(set(pages)) != len(pages): issues.append('app.json.pages 存在重复路径'); got -= 2
    return max(0, got), issues, blockers


def check_d2(app):
    """页面四件套 12"""
    issues, blockers = [], []
    pages = app.get('pages', []) if app else []
    if not pages: return 0, [], ['无页面可检查']
    missing_total = 0
    for pg in pages:
        miss = [e for e in ('.js', '.wxml', '.wxss', '.json') if not os.path.isfile(rel(pg + e))]
        if miss:
            missing_total += len(miss)
            msg = f'{pg} 缺 {", ".join(miss)}'
            if '.js' in miss or '.wxml' in miss: blockers.append(msg)
            else: issues.append(msg)
    score = 12 * (1 - min(1.0, missing_total / (len(pages) * 4) * 2))
    return round(score, 1), issues, blockers


def check_d3():
    """JSON 合法性 8"""
    issues, blockers = [], []
    files = list_files('.json')
    bad = 0
    for f in files:
        _, err = load_json(f)
        if err:
            bad += 1
            blockers.append(f'{os.path.relpath(f, MP)} JSON 非法: {err[:60]}')
    score = 8 * (1 - min(1.0, bad / 3))
    return round(score, 1), issues, blockers


def check_d4():
    """JS 语法(含 node --check) 18"""
    issues, blockers = [], []
    files = [f for f in list_files('.js')]
    bad = 0
    for f in files:
        try:
            r = subprocess.run(['node', '--check', f], capture_output=True, text=True, timeout=15)
            if r.returncode != 0:
                bad += 1
                first = [l for l in r.stderr.splitlines() if l.strip()][:2]
                blockers.append(f'{os.path.relpath(f, MP)} 语法错误: {" | ".join(first)[:160]}')
        except Exception as e:
            bad += 1; blockers.append(f'{os.path.relpath(f, MP)} 检查失败: {e}')
    score = 18 * (1 - min(1.0, bad / 2))
    return round(score, 1), issues, blockers


EVENT_RE = re.compile(r'(?:bind|catch):?([a-zA-Z][\w]*)\s*=\s*["\']([^"\']+)["\']')
ROUTE_RE = re.compile(r"wx\.(?:navigateTo|redirectTo|switchTab|reLaunch)\s*\(\s*\{[\s\S]{0,300}?url\s*:\s*['\"]([^'\"]+)['\"]")
STORE_REQ_RE = re.compile(r"(\w+)\s*=\s*require\(['\"][^'\"]*store\.js['\"]\)")
STORE_CALL_RE = re.compile(r'\b{var}\.([A-Za-z_$][\w$]*)\s*\(')


def check_d5(app):
    """WXML 事件绑定 → JS 方法 12"""
    issues, blockers = [], []
    pages = app.get('pages', []) if app else []
    miss_cnt = 0
    for pg in pages:
        wxml, js = read(pg + '.wxml'), read(pg + '.js')
        if not wxml or not js: continue
        handlers = set(m.group(2).strip() for m in EVENT_RE.finditer(wxml))
        handlers.discard('')
        for h in handlers:
            if not re.search(r'\b' + re.escape(h) + r'\s*[:(=]', js):
                miss_cnt += 1
                issues.append(f'{pg} 事件 "{h}" 在 JS 中未定义')
    score = 12 * (1 - min(1.0, miss_cnt / 4))
    return round(score, 1), issues, blockers


def check_d6(app):
    """路由一致性 10"""
    issues, blockers = [], []
    pages = set(app.get('pages', [])) if app else set()
    miss = 0
    for f in list_files('.js'):
        txt = ''
        try:
            with open(f, 'r', encoding='utf-8') as fh: txt = fh.read()
        except Exception: continue
        for url in ROUTE_RE.findall(txt):
            path = url.split('?')[0].lstrip('/')
            if not path: continue
            if path not in pages:
                miss += 1
                blockers.append(f'{os.path.relpath(f, MP)} 跳转未注册页面: {path}')
    score = 10 * (1 - min(1.0, miss / 2))
    return round(score, 1), issues, blockers


def check_d7(app):
    """静态资源存在性 8"""
    issues, blockers = [], []
    miss = 0
    if app:
        tb = app.get('tabBar', {})
        for item in (tb.get('list', []) if isinstance(tb, dict) else []):
            for k in ('iconPath', 'selectedIconPath'):
                p = item.get(k)
                if p and not os.path.isfile(rel(p)):
                    miss += 1; blockers.append(f'tabBar 图标缺失: {p}')
    for f in list_files('.wxml'):
        txt = ''
        try:
            with open(f, 'r', encoding='utf-8') as fh: txt = fh.read()
        except Exception: continue
        for src in re.findall(r'\bsrc\s*=\s*["\'](/images/[^"\']+)["\']', txt):
            if not os.path.isfile(rel(src.lstrip('/'))):
                miss += 1; issues.append(f'{os.path.relpath(f, MP)} 图片缺失: {src}')
    score = 8 * (1 - min(1.0, miss / 4))
    return round(score, 1), issues, blockers


def check_d8():
    """数据层完整性 12"""
    issues, blockers = [], []
    store = read('utils', 'store.js')
    if not store:
        return 0, [], ['store.js 缺失']
    m = re.search(r'module\.exports\s*=\s*\{([\s\S]*?)\n\};', store)
    if not m: blockers.append('store.js 未找到 module.exports 对象'); return 0, [], blockers
    exports = set(re.findall(r'(\w+)\s*:', m.group(1)))
    # 页面调用的 store 方法是否都存在
    miss = 0
    for f in list_files('.js'):
        txt = ''
        try:
            with open(f, 'r', encoding='utf-8') as fh: txt = fh.read()
        except Exception: continue
        req = STORE_REQ_RE.search(txt)
        var = req.group(1) if req else None
        if not var: continue
        pattern = STORE_CALL_RE.pattern.format(var=re.escape(var))
        for method in re.findall(pattern, txt):
            if method not in exports:
                miss += 1; issues.append(f'{os.path.relpath(f, MP)} 调用不存在的 store 方法: {var}.{method}()')
    # 核心实体字段覆盖
    blank_m = re.search(r'function\s+blank\s*\([^)]*\)\s*\{([\s\S]*?)\n\}', store)
    fields = blank_m.group(1) if blank_m else ''
    core = ['spaces', 'rooms', 'furniture', 'nodes', 'items', 'movements', 'inventory', 'transactions', 'alerts']
    for k in core:
        if k not in fields:
            miss += 1; issues.append(f'数据层 blank() 缺实体字段: {k}')
    # CR-001 / V1.2 新增能力的方法与字段（T7~T10）：缺失计入 D8，保证方案与测试口径一致
    for method in ['transformFurniture', 'listRoomTemplates', 'applyRoomTemplate',
                   'itemsOfFurniture', 'bindingsOfFurniture']:
        if not re.search(r'\b' + method + r'\s*:', m.group(1)):
            miss += 1; issues.append(f'数据层 store.js 缺 CR-001 方法: {method}()')
    if 'source:' not in store or 'templateKey:' not in store:
        miss += 1; issues.append('数据层缺 CR-001 房间字段 source/templateKey')
    const = read('utils', 'constants.js')
    if 'ROOM_TEMPLATES' not in const:
        miss += 1; issues.append('constants.js 缺 CR-001 典型场景模板 ROOM_TEMPLATES')
    if miss >= 8: blockers.append('数据层存在系统性缺陷（缺失方法/实体过多）')
    score = 12 * (1 - min(1.0, miss / 5))
    return round(score, 1), issues, blockers


def check_d9(app):
    """运行时健壮性 10"""
    issues, blockers = [], []
    pages = app.get('pages', []) if app else []
    got = 0
    # 4分：页面均为 Page/Component 实例
    bad = 0
    for pg in pages:
        js = read(pg + '.js')
        if js and not re.search(r'\b(?:Page|Component)\s*\(', js): bad += 1; issues.append(f'{pg} 未使用 Page()/Component() 构造')
    got += 4 * (1 - min(1.0, bad / 3))
    # 2分：store 底层读写有 try-catch
    store = read('utils', 'store.js')
    got += 2 if store.count('try {') >= 2 else 0
    if store.count('try {') < 2: issues.append('store.js 本地存储读写缺少异常保护')
    # 2分：三维页有失败降级
    r3 = read('pages', 'room3d', 'room3d.js') + read('pages', 'room3d', 'room3d.wxml')
    got += 2 if re.search(r'列表|fallback|降级|listMode', r3) else 0
    if not re.search(r'列表|fallback|降级|listMode', r3): issues.append('三维页缺少列表降级通路')
    # 2分：列表页有空态处理
    listpages = [p for p in pages if any(k in p for k in ('list', 'inventory', 'alerts', 'room', 'space', 'node'))]
    with_empty = 0
    for pg in listpages:
        w = read(pg + '.wxml')
        if w and ('wx:if' in w or 'wx:for' in w): with_empty += 1
    got += 2 * (with_empty / max(1, len(listpages)))
    return round(got, 1), issues, blockers


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true', help='只输出 JSON')
    ap.add_argument('--out', default=DEFAULT_OUT)
    args = ap.parse_args()

    app, app_err = load_json(rel('app.json'))
    r = Report()
    for dim, fn in [
        ('D1 配置合法性', lambda: check_d1(app)),
        ('D2 页面四件套', lambda: check_d2(app)),
        ('D3 JSON合法', check_d3),
        ('D4 JS语法', check_d4),
        ('D5 WXML事件绑定', lambda: check_d5(app)),
        ('D6 路由一致性', lambda: check_d6(app)),
        ('D7 静态资源', lambda: check_d7(app)),
        ('D8 数据层完整性', check_d8),
        ('D9 运行时健壮性', lambda: check_d9(app)),
    ]:
        s, iss, blk = fn()
        r.add(dim, s, {'D1 配置合法性':10,'D2 页面四件套':12,'D3 JSON合法':8,'D4 JS语法':18,
                       'D5 WXML事件绑定':12,'D6 路由一致性':10,'D7 静态资源':8,
                       'D8 数据层完整性':12,'D9 运行时健壮性':10}[dim], iss, blk)

    out = {
        'timestamp': datetime.now().isoformat(timespec='seconds'),
        'project': os.path.basename(ROOT),
        'total': r.total, 'passed': r.passed,
        'threshold': {'score': 90, 'noP0': True},
        'dims': r.scores, 'blockers': r.blockers, 'issues': r.issues,
    }
    with open(args.out, 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False, indent=2)

    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2)); return

    print('\n' + '=' * 62)
    print('  小程序交付质量检查打分表  ' + out['timestamp'])
    print('=' * 62)
    for d, v in r.scores.items():
        bar = '█' * int(v['score'] / v['full'] * 20) + '░' * (20 - int(v['score'] / v['full'] * 20))
        print(f'  {d:<18} {v["score"]:>5.1f}/{v["full"]:<3} {bar}')
    print('-' * 62)
    print(f'  总分: {r.total}/100    判定: {"✅ 达标，可交付" if r.passed else "❌ 未达标，需优化"}')
    print(f'  阻断项(P0): {len(r.blockers)}    改进项(P1): {len(r.issues)}')
    if r.blockers:
        print('\n  【P0 阻断项】')
        for b in r.blockers[:20]: print('   ✗ ' + b)
    if r.issues:
        print('\n  【P1 改进项】')
        for i in r.issues[:25]: print('   ! ' + i['msg'])
    print(f'\n  报告已写入: {args.out}')
    sys.exit(0 if r.passed else 1)


if __name__ == '__main__': main()
