#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自托管视觉识别服务 —— 三维房间重建 service 模式的参考实现

零依赖启动（Python 3 标准库即可，照片不出本机/内网）：
    python3 recognition-service.py --port 8766 --backend mock

接真实视觉模型（本机 Ollama，先拉一个多模态模型）：
    ollama pull qwen2.5vl:7b
    python3 recognition-service.py --port 8766 --backend ollama --model qwen2.5vl:7b

接任意 OpenAI 兼容的视觉端点：
    python3 recognition-service.py --port 8766 --backend openai \
        --openai-url http://127.0.0.1:11434/v1/chat/completions --model qwen2.5vl:7b

接口契约
    GET  /health
      -> {"ok":true,"backend":"mock|ollama|openai","model":"...","categories":[...]}

    POST /recognize   Content-Type: application/json
      {
        "images": ["data:image/png;base64,....", ...],
        "room": {"w":4.6,"d":4.2,"h":2.8,"type":"bedroom"},
        "photoFeature": {"wallHex":"#d9cfc0","floorHex":"#9a7d5c","domHex":"#8a8272",
                         "colorName":"米色","floorName":"木色","brightU":0.7}
      }
      -> {
        "objects": [
          {"id":"svc-1","category":"床","variantHint":"米色","conf":0.92,
           "u":0.46,"v":0.60,"apparent":0.42,"depthHint":"中","facing":"侧向",
           "anchor":"bed","colorHex":"#8a8272","source":"service_candidate"}
        ],
        "meta": {"backend":"mock","model":"-","note":"..."}
      }

字段说明（与前端 room-reconstruct.html 的识别适配器保持一致）
    category    家具类别；须落在前端模型库 LIB 的类别内，否则前端降级为占位模型
    variantHint 外观档位提示（米色/灰色/白色/木色/深色/深蓝/暖黄/灰纱/米白）
    conf        置信度 0~1；前端对 <0.6 的候选强制人工确认
    u, v        家具中心在照片中的归一化位置，0~1（u 左→右，v 上→下）
    apparent    表观尺寸占比 0~1（仅作估算依据，不直接当真实尺寸）
    depthHint   深度线索：近 / 中 / 远
    facing      朝向：正面 / 侧向 / 无
    anchor      空间关系：bed / bed:headLeft / on:床头柜 / backWall / nearWindow /
                sofa / inFront:沙发 / opposite:沙发 / inFront:餐桌 / side
    colorHex    可选；服务端实测的家具主色，前端优先用它覆盖模型外观
    source      可选；前端据此标注候选来源

隐私约束：本服务须部署在自有服务器或内网；家庭照片不出内网；
          未经用户明确授权，不得将照片用于训练或传给第三方。
"""
import argparse
import json
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CATEGORIES = ["床", "床头柜", "台灯", "窗帘", "软包椅", "躺椅",
              "沙发", "茶几", "电视柜", "衣柜", "餐桌", "椅子", "书架"]
VARIANT_HINTS = ["米色", "灰色", "白色", "木色", "深色", "深蓝", "暖黄", "灰纱", "米白"]
DEPTH = ("近", "中", "远")
FACING = ("正面", "侧向", "无")

# mock 后端模板：与前端预置样本同构，便于验证 service 链路；颜色由照片特征覆盖
MOCK_TEMPLATES = {
    "bedroom": [
        ("床",     "米色", .46, .60, "中", "侧向", "bed",          .94),
        ("床头柜", "白色", .12, .70, "近", "正面", "bed:headLeft", .86),
        ("台灯",   "暖黄", .09, .62, "近", "无",   "on:床头柜",    .81),
        ("窗帘",   "灰纱", .55, .34, "远", "正面", "backWall",     .78),
        ("软包椅", "米白", .50, .42, "远", "正面", "nearWindow",   .63),
        ("躺椅",   "木色", .63, .44, "远", "侧向", "nearWindow",   .52),
    ],
    "living": [
        ("沙发",   "米色", .30, .62, "中", "侧向", "sofa",          .88),
        ("茶几",   "深色", .47, .70, "中", "无",   "inFront:沙发",  .74),
        ("电视柜", "深色", .55, .40, "远", "正面", "opposite:沙发", .69),
        ("餐桌",   "木色", .76, .60, "中", "无",   "side",          .57),
        ("椅子",   "木色", .80, .69, "近", "无",   "inFront:餐桌",  .45),
    ],
}

PROMPT = """你是室内照片家具识别助手。只根据图片中确实可见的内容输出家具候选，不要臆测不可见的物件。

严格输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字：
{"objects":[{"category":"类别","variantHint":"外观色","conf":0.9,"u":0.5,"v":0.6,"apparent":0.3,"depthHint":"中","facing":"正面","anchor":"side"}]}

字段约束：
- category 只能取：床、床头柜、台灯、窗帘、软包椅、躺椅、沙发、茶几、电视柜、衣柜、餐桌、椅子、书架
- variantHint 只能取：米色、灰色、白色、木色、深色、深蓝、暖黄、灰纱、米白
- conf 为 0~1 的把握程度；看不清就给低值
- u 是家具中心在照片中的横向归一化位置（0=最左，1=最右）；v 是纵向（0=最上，1=最下）
- apparent 为表观尺寸占比 0~1（不是真实尺寸）
- depthHint 只能是：近、中、远
- facing 只能是：正面、侧向、无
- anchor 空间关系按下面规则填：床=bed；床头柜=bed:headLeft；台灯=on:床头柜；
  窗帘=backWall；窗边椅=nearWindow；沙发=sofa；茶几=inFront:沙发；
  电视柜=opposite:沙发；餐桌=side；餐椅=inFront:餐桌；其他=side

注意：普通照片没有真实尺度，不要输出任何以米为单位的精确尺寸。"""


def _num(d, key, lo, hi, default):
    try:
        v = float(d.get(key, default))
    except (TypeError, ValueError):
        v = default
    return round(max(lo, min(hi, v)), 3)


def normalize_objects(raw):
    """把任意来源的候选规整成前端同结构；库外类别保留，前端会降级占位。"""
    out = []
    items = raw if isinstance(raw, list) else []
    for i, d in enumerate(items):
        if not isinstance(d, dict):
            continue
        cat = str(d.get("category") or "").strip()
        if not cat:
            continue
        vhint = str(d.get("variantHint") or "米色").strip()
        if vhint not in VARIANT_HINTS:
            vhint = "米色"
        dh = d.get("depthHint")
        fh = d.get("facing")
        obj = {
            "id": str(d.get("id") or ("svc-%d" % (i + 1))),
            "category": cat,
            "variantHint": vhint,
            "conf": _num(d, "conf", 0, 1, 0.5),
            "u": _num(d, "u", 0, 1, 0.5),
            "v": _num(d, "v", 0, 1, 0.5),
            "apparent": _num(d, "apparent", 0.02, 1, 0.2),
            "depthHint": dh if dh in DEPTH else "中",
            "facing": fh if fh in FACING else "无",
            "anchor": str(d.get("anchor") or "side"),
            "source": "service_candidate",
        }
        ce = d.get("colorHex")
        if isinstance(ce, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", ce):
            obj["colorHex"] = ce
        out.append(obj)
    return out


def mock_recognize(payload):
    """零依赖后端：用房间类型套模板，用照片实测色覆盖外观，验证 service 全链路。"""
    room = payload.get("room") or {}
    rtype = room.get("type") if room.get("type") in MOCK_TEMPLATES else "bedroom"
    feat = payload.get("photoFeature") or {}
    dom_hex = feat.get("domHex") if re.fullmatch(r"#[0-9a-fA-F]{6}", str(feat.get("domHex", ""))) else None
    bright_u = _num(feat, "brightU", 0, 1, 0.55)
    objects = []
    for i, (cat, hint, u, v, depth, facing, anchor, conf) in enumerate(MOCK_TEMPLATES[rtype]):
        d = {
            "id": "svc-%d" % (i + 1), "category": cat, "variantHint": hint,
            "conf": conf, "u": u, "v": v, "apparent": 0.2,
            "depthHint": depth, "facing": facing, "anchor": anchor,
        }
        if cat == "窗帘":
            d["u"] = bright_u  # 窗位跟随照片亮区
        if dom_hex:
            d["colorHex"] = dom_hex
        objects.append(d)
    return objects


def _b64_images(images):
    """去掉 data URL 前缀，只留裸 base64（Ollama / OpenAI 视觉接口要求）。"""
    out = []
    for im in images[:8]:
        if not isinstance(im, str):
            continue
        if "," in im and im.strip().startswith("data:"):
            im = im.split(",", 1)[1]
        if im.strip():
            out.append(im.strip())
    return out


def _extract_json(text):
    """容忍模型偶发的 ```json 包裹或前后废话。"""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", t)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    raise ValueError("模型输出不是合法 JSON，前 120 字：" + t[:120])


def ollama_recognize(payload, model, base):
    images = _b64_images(payload.get("images") or [])
    if not images:
        raise ValueError("服务模式需要至少一张照片")
    body = json.dumps({
        "model": model, "prompt": PROMPT, "images": images,
        "stream": False, "format": "json",
    }).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + "/api/generate", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        j = json.loads(r.read().decode("utf-8"))
    data = _extract_json(j.get("response", ""))
    objects = normalize_objects(data.get("objects", data if isinstance(data, list) else []))
    if not objects:
        raise ValueError("视觉模型未返回可识别家具")
    return objects


def openai_recognize(payload, model, url, api_key):
    images = _b64_images(payload.get("images") or [])
    if not images:
        raise ValueError("服务模式需要至少一张照片")
    content = [{"type": "text", "text": PROMPT}] + [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b}}
        for b in images
    ]
    body = json.dumps({
        "model": model, "messages": [{"role": "user", "content": content}],
        "temperature": 0,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=180) as r:
        j = json.loads(r.read().decode("utf-8"))
    text = j["choices"][0]["message"]["content"]
    data = _extract_json(text)
    objects = normalize_objects(data.get("objects", data if isinstance(data, list) else []))
    if not objects:
        raise ValueError("视觉服务未返回可识别家具")
    return objects


class Handler(BaseHTTPRequestHandler):
    server_version = "RoomRecognition/1.0"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, status=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            self._json({
                "ok": True,
                "backend": self.server.backend,
                "model": self.server.model,
                "categories": CATEGORIES,
                "privacy": "self-hosted; photos stay in this server",
            })
        else:
            self._json({"error": "not found; try /health or POST /recognize"}, 404)

    def do_POST(self):
        if self.path.split("?")[0] != "/recognize":
            self._json({"error": "not found"}, 404)
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 60 * 1024 * 1024:
                raise ValueError("请求体为空或超过 60MB 上限")
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception as e:
            self._json({"error": "请求解析失败：" + str(e)}, 400)
            return

        try:
            backend = self.server.backend
            if backend == "mock":
                objects = normalize_objects(mock_recognize(payload))
                note = "零依赖 mock 后端：房间类型套模板 + 照片实测色；用于验证 service 链路，非语义识别"
            elif backend == "ollama":
                objects = ollama_recognize(payload, self.server.model, self.server.ollama_base)
                note = "Ollama 本地多模态模型语义识别；照片留在本机"
            else:
                objects = openai_recognize(payload, self.server.model,
                                           self.server.openai_url, self.server.api_key)
                note = "OpenAI 兼容视觉端点语义识别；须为自托管/内网地址"
            self._json({
                "objects": objects,
                "meta": {"backend": backend, "model": self.server.model,
                         "count": len(objects), "note": note},
            })
        except (urllib.error.URLError, ValueError, KeyError, json.JSONDecodeError) as e:
            self._json({"error": "识别失败：" + str(e)}, 502)
        except Exception as e:
            self._json({"error": "服务内部错误：" + str(e)}, 500)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)


def main():
    ap = argparse.ArgumentParser(description="自托管视觉识别服务（三维房间重建 service 模式）")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--backend", choices=["mock", "ollama", "openai"], default="mock")
    ap.add_argument("--model", default="-", help="ollama/openai 后端使用的视觉模型名")
    ap.add_argument("--ollama-base", default="http://127.0.0.1:11434")
    ap.add_argument("--openai-url", default="http://127.0.0.1:11434/v1/chat/completions")
    ap.add_argument("--api-key", default="")
    args = ap.parse_args()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.backend = args.backend
    srv.model = args.model
    srv.ollama_base = args.ollama_base
    srv.openai_url = args.openai_url
    srv.api_key = args.api_key
    print("识别服务已启动: http://%s:%d  backend=%s model=%s" %
          (args.host, args.port, args.backend, args.model), flush=True)
    print("健康检查: http://%s:%d/health" % (args.host, args.port), flush=True)
    if args.backend == "mock":
        print("提示：mock 只验证链路不识语义；真识别请先 ollama pull qwen2.5vl:7b 再用 --backend ollama",
              flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止", flush=True)


if __name__ == "__main__":
    main()
