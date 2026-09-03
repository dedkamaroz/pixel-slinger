#!/usr/bin/env python3
"""Pixel Slinger - local console + proxy for the Enhancor, fal.ai, BytePlus, Kling and
QwenCloud APIs.

Stdlib only. Serves the UI, hosts drag-dropped files so the providers' servers
can fetch them (via a cloudflared quick tunnel), proxies every API call so the
keys never reach the browser, and streams a full request/response log to the page.

Five providers, five auth schemes, picked per request by hostname:
  Enhancor  apireq.enhancor.ai                x-api-key:     ENHANCOR_API_KEY
  fal.ai    queue.fal.run                     Authorization: Key FAL_KEY
  BytePlus  ark.ap-southeast.bytepluses.com   Authorization: Bearer BYTEPLUS_API_KEY
            (ModelArk is regional - ap-southeast-1 answers on this host alone)
  Kling AI  api-singapore.klingai.com         Authorization: Bearer KLINGAI_API_KEY
            (their open platform takes the api-key-kling-... string as a plain bearer
             token - there is no JWT to sign and no AccessKey/SecretKey pair to hold)
  QwenCloud dashscope-intl.aliyuncs.com       Authorization: Bearer QWENCLOUD_API_KEY
            (qwencloud.com is the international face of Alibaba's Model Studio - an
             sk-ws-... key from there answers on the DashScope-native /api/v1 routes)
"""
import atexit
import base64
import json
import mimetypes
import os
import queue
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PureWindowsPath

ROOT = Path(__file__).parent
UPLOADS = ROOT / "uploads"
OUTPUTS = ROOT / "outputs"
PORT = int(os.environ.get("PORT", "8787"))
AEST = timezone(timedelta(hours=10), "AEST")
MAX_UPLOAD = 200 * 1024 * 1024   # feature videos go to 200 MB on the Kling tabs
# The Enhancor tabs are built and working but switched off - set ENHANCOR=1 in start.bat to
# bring them back. The page carries the same flag as a literal so it can be read without a
# server (test_kling.js does exactly that); this rewrites it on the way out rather than
# making the nav wait on /api/config, which is built before the first fetch resolves.
ENHANCOR_ON = os.environ.get("ENHANCOR", "0").strip().lower() in ("1", "true", "yes", "on")

STATE = {"public_base": "", "tunnel": "off", "results": {}, "history": []}
PIDFILE = ROOT / ".server.pid"
_clients = []
_clients_lock = threading.Lock()
_tunnel_proc = None


def stop_tunnel():
    """Kill the tunnel so it can't outlive the server and keep uploads/ public."""
    global _tunnel_proc
    if _tunnel_proc and _tunnel_proc.poll() is None:
        _tunnel_proc.terminate()
        try:
            _tunnel_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _tunnel_proc.kill()
    _tunnel_proc = None
    PIDFILE.unlink(missing_ok=True)


def load_env(path=ROOT / ".env"):
    """Parse KEY=VALUE lines. Ignores blanks, # comments, and wrapping quotes."""
    env = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def api_key():
    return load_env().get("ENHANCOR_API_KEY", "").strip()


def fal_key():
    return load_env().get("FAL_KEY", "").strip()


def ark_key():
    return load_env().get("BYTEPLUS_API_KEY", "").strip()


def kling_key():
    return load_env().get("KLINGAI_API_KEY", "").strip()


def qwen_key():
    return load_env().get("QWENCLOUD_API_KEY", "").strip()


# fal's queue also answers on fal.run for the sync path; both take the same header.
FAL_HOSTS = ("queue.fal.run", "fal.run")


ARK_HOST = "ark.ap-southeast.bytepluses.com"
ENHANCOR_HOST = "apireq.enhancor.ai"
# api.klingai.com answers too, but this account was issued in Singapore and task ids are
# regional - a task created on one host is not visible from the other.
KLING_HOST = "api-singapore.klingai.com"
# QwenCloud's own model pages name this host. The workspace-scoped
# {id}.ap-southeast-1.maas.aliyuncs.com hosts in Alibaba's docs are the Model Studio
# console's keys, not the sk-ws- ones qwencloud.com issues.
QWEN_HOST = "dashscope-intl.aliyuncs.com"


def _host(url):
    return urllib.parse.urlsplit(url).hostname or ""


def is_fal(url):
    return _host(url) in FAL_HOSTS


def is_ark(url):
    return _host(url) == ARK_HOST


def is_enhancor(url):
    return _host(url) == ENHANCOR_HOST


def is_kling(url):
    return _host(url) == KLING_HOST


def is_qwen(url):
    return _host(url) == QWEN_HOST


def key_var(url):
    return ("FAL_KEY" if is_fal(url) else "BYTEPLUS_API_KEY" if is_ark(url)
            else "KLINGAI_API_KEY" if is_kling(url) else "QWENCLOUD_API_KEY" if is_qwen(url)
            else "ENHANCOR_API_KEY")


def auth_for(url):
    """(headers, key, name-of-the-secret-header) for whichever provider owns this URL."""
    if is_fal(url):
        key = fal_key()
        return {"Content-Type": "application/json", "Authorization": f"Key {key}"}, key, "Authorization"
    if is_ark(url):
        key = ark_key()
        return {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}, key, "Authorization"
    if is_kling(url):
        key = kling_key()
        return {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}, key, "Authorization"
    if is_qwen(url):
        key = qwen_key()
        return {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}, key, "Authorization"
    key = api_key()
    return {"Content-Type": "application/json", "x-api-key": key}, key, "x-api-key"


def redact(s, key):
    return s.replace(key, key[:4] + "..." + key[-4:]) if key and len(key) > 8 else s


def log(kind, text, meta=None):
    ev = {
        "t": datetime.now(AEST).strftime("%H:%M:%S.%f")[:-3],
        "kind": kind,
        "text": text,
        "meta": meta or {},
    }
    with _clients_lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait(ev)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _clients.remove(q)
    print(f"[{ev['t']}] {kind.upper():8} {text}", flush=True)


# --- cloudflared quick tunnel -------------------------------------------------

TUNNEL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def start_tunnel():
    exe = shutil.which("cloudflared")
    if not exe:
        STATE["tunnel"] = "missing"
        log("warn", "cloudflared not found - uploads will not be reachable by providers. "
                    "Run setup.bat, or: winget install --id Cloudflare.cloudflared")
        return
    STATE["tunnel"] = "starting"
    log("sys", "starting cloudflared quick tunnel...")
    global _tunnel_proc
    proc = subprocess.Popen(
        [exe, "tunnel", "--url", f"http://127.0.0.1:{PORT}", "--no-autoupdate"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    _tunnel_proc = proc
    # Windows does not kill children with the parent. An orphaned tunnel keeps serving
    # uploads/ to the internet after this process is gone, so record the pid for stop.bat
    # and tear it down on any clean exit.
    PIDFILE.write_text(json.dumps({"server": os.getpid(), "cloudflared": proc.pid}))
    atexit.register(stop_tunnel)

    def reader():
        for line in proc.stdout:
            m = TUNNEL_RE.search(line)
            if m and not STATE["public_base"]:
                STATE["public_base"] = m.group(0)
                STATE["tunnel"] = "up"
                log("sys", f"tunnel up: {m.group(0)}")
        STATE["tunnel"] = "down"
        log("warn", "cloudflared exited")

    threading.Thread(target=reader, daemon=True).start()


def public_base():
    return STATE["public_base"] or f"http://127.0.0.1:{PORT}"


# --- outbound API call --------------------------------------------------------

def call_api(method, url, body, extra_headers=None):
    headers, key, secret_hdr = auth_for(url)
    if not key:
        var = key_var(url)
        log("err", f"{method} {url} aborted - {var} missing from .env")
        return {"ok": False, "status": 0, "error": f"{var} missing from .env"}
    headers.update(extra_headers or {})
    payload = json.dumps(body).encode() if body is not None else None

    log("req", f"{method} {url}", {
        "headers": {k: (redact(v, key) if k == secret_hdr else v) for k, v in headers.items()},
        "body": body,
    })
    started = time.time()
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            raw, status = r.read().decode("utf-8", "replace"), r.status
            resp_headers = dict(r.headers)
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode("utf-8", "replace"), e.code
        resp_headers = dict(e.headers)
    except Exception as e:
        ms = int((time.time() - started) * 1000)
        log("err", f"{method} {url} -> transport error after {ms}ms: {e}")
        return {"ok": False, "status": 0, "error": str(e), "ms": ms}

    ms = int((time.time() - started) * 1000)
    try:
        parsed = json.loads(raw)
    except ValueError:
        parsed = None
    log("res" if status < 400 else "err", f"{status} {method} {url} ({ms}ms)",
        {"headers": resp_headers, "body": parsed if parsed is not None else raw[:4000]})
    return {"ok": status < 400, "status": status, "ms": ms,
            "json": parsed, "text": raw[:20000], "headers": resp_headers}


# --- post-save script chain ---------------------------------------------------

VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
MAX_POSTGEN = 3          # video slots to chain; an image gets IMG_POSTGEN
IMG_POSTGEN = 1
VID_PREFIX, IMG_PREFIX = "POSTVIDGEN", "POSTIMGGEN"


def media_kind(path):
    """(env prefix, extensions to look for downstream, slots) for a saved file, or a
    triple of Nones if it is neither video nor image. Videos and images have separate
    script lists so a video filter is never handed a still, or the other way round.
    """
    ext = Path(path).suffix.lower()
    if ext in VIDEO_EXTS:
        return VID_PREFIX, VIDEO_EXTS, MAX_POSTGEN
    if ext in IMAGE_EXTS:
        return IMG_PREFIX, IMAGE_EXTS, IMG_POSTGEN
    return None, None, None


def _argv(cmd):
    """Split a .env command line. posix=False keeps Windows backslashes intact, but it
    also keeps the quotes, so strip those off each token."""
    return [t.strip('"') for t in shlex.split(cmd.strip(), posix=False) if t]


def postgen_scripts(prefix):
    """Every <prefix>_<n> line in .env, in numeric order - POSTVIDGEN_<n> for videos,
    POSTIMGGEN_<n> for images.

    One line adds a script and it appears in the drop-downs - nothing else to register.
    The label is the command's own filename, so there is no second name to keep in sync.
    """
    out = []
    for k, v in load_env().items():
        m = re.fullmatch(rf"{prefix}_(\d+)", k.strip())
        if not m or not v.strip():
            continue
        argv = _argv(v)
        if not argv:
            continue
        out.append({"key": k.strip(), "n": int(m.group(1)),
                    "label": PureWindowsPath(argv[0]).stem, "cmd": v.strip()})
    return sorted(out, key=lambda s: s["n"])


def run_script(cmd, path):
    """Run one post-gen command to completion with the video as its argument.

    cwd is the command's own folder - these scripts activate a relative venv - and
    stdin=DEVNULL so a trailing `pause` gets EOF instead of waiting on a keypress that
    will never come. The path is appended as the last argument, or substituted for {}
    if the command names a place for it.

    Output is streamed line by line: always to the terminal, and to the page as bodyOnly
    lines so the console only carries it when Bodies is on.
    """
    argv = _argv(cmd)
    exe, rest = Path(argv[0]), argv[1:]
    args = ([a.replace("{}", str(path)) for a in rest] if any("{}" in a for a in rest)
            else rest + [str(path)])
    log("sys", f"{exe.stem} <- {path}")
    p = subprocess.Popen([str(exe), *args], cwd=str(exe.parent),
                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True,
                         encoding="utf-8", errors="replace", bufsize=1)
    for line in p.stdout:
        line = line.rstrip()
        if line:
            log("out", f"[{exe.stem}] {line}", {"bodyOnly": True})
    rc = p.wait()
    if rc:
        log("err", f"{exe.stem} exited {rc}")
        return False
    log("sys", f"{exe.stem} done")
    return True


def chain_output(path, before, exts):
    """What the next script in the chain gets: the newest file of the same kind this one
    wrote beside the input, or the same file if it wrote none in place.

    ponytail: newest-new-file heuristic. The scripts share no output-naming convention
    (rPPG writes <stem>_dm<n>.mp4, others write their own), so there is nothing to key
    on. If a script ever writes several videos at once, give .env a per-script output
    pattern instead.
    """
    new = [f for f in path.parent.iterdir()
           if f.is_file() and f not in before and f.suffix.lower() in exts]
    return max(new, key=lambda f: f.stat().st_mtime) if new else path


def postprocess(path, keys):
    """Run the picked scripts in the picked order, each on what the one before produced.

    Which list a key may name is decided by the saved file itself, so a stale pick from
    the page can never run a video script on an image.

    Strictly sequential: these encoders open their output file as soon as encoding
    starts, so the file existing means nothing - only the process exiting means the
    output is finished and safe to hand on. A failure stops the chain rather than
    feeding the next script a half-written file.
    """
    prefix, exts, slots = media_kind(path)
    if not prefix:
        log("warn", f"{path.name} is neither video nor image - no post-gen script run")
        return
    scripts = {s["key"]: s for s in postgen_scripts(prefix)}
    for key in list(keys)[:slots]:
        spec = scripts.get(key)
        if not spec:
            log("warn", f"post-gen script {key} is not defined in .env - skipping")
            continue
        before = set(path.parent.iterdir())
        if not run_script(spec["cmd"], path):
            log("err", f"{spec['label']} failed - stopping the post-gen chain")
            return
        path = chain_output(path, before, exts)


# --- the page -----------------------------------------------------------------

ENHANCOR_FLAG = "const ENHANCOR_ON = "


def page_html():
    """index.html as served. The single substitution is the Enhancor switch: the file on
    disk always reads false, so it stays readable without a server (test_kling.js evals it
    straight off the filesystem), and ENHANCOR=1 flips it here on the way out."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    if ENHANCOR_ON:
        html, n = re.subn(re.escape(ENHANCOR_FLAG) + "false;",
                          ENHANCOR_FLAG + "true;", html, count=1)
        if not n:
            log("warn", "ENHANCOR=1 but the page has no ENHANCOR_ON switch to flip")
    return html.encode("utf-8")


# --- HTTP handler -------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json")

    def _read_json(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n > MAX_UPLOAD:
            raise ValueError("payload too large")
        return json.loads(self.rfile.read(n) or b"{}")

    # -- GET
    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path in ("/", "/index.html"):
            return self._send(200, page_html(), "text/html; charset=utf-8")

        if path == "/api/config":
            key, fkey, akey, kkey, qkey = api_key(), fal_key(), ark_key(), kling_key(), qwen_key()
            hint = lambda k: (k[:4] + "..." + k[-4:]) if len(k) > 8 else ""
            return self._json(200, {
                "hasKey": bool(key),
                "keyHint": hint(key),
                "hasFalKey": bool(fkey),
                "falKeyHint": hint(fkey),
                "hasArkKey": bool(akey),
                "arkKeyHint": hint(akey),
                "hasKlingKey": bool(kkey),
                "klingKeyHint": hint(kkey),
                "hasQwenKey": bool(qkey),
                "qwenKeyHint": hint(qkey),
                # Read per request, so editing .env shows up in the drop-downs on the
                # next poll without restarting the server.
                "postgenVideo": [{"key": x["key"], "label": x["label"]}
                                 for x in postgen_scripts(VID_PREFIX)],
                "postgenImage": [{"key": x["key"], "label": x["label"]}
                                 for x in postgen_scripts(IMG_PREFIX)],
                "maxPostgen": MAX_POSTGEN,
                "publicBase": public_base(),
                "tunnel": STATE["tunnel"],
                "port": PORT,
            })

        if path == "/api/results":
            return self._json(200, {"results": STATE["results"], "history": STATE["history"][-200:]})

        if path == "/api/blob":
            return self._blob()

        if path == "/events":
            return self._sse()

        if path.startswith("/files/"):
            f = UPLOADS / os.path.basename(path[7:])
            if not f.exists():
                return self._json(404, {"error": "not found"})
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            # no-store: these are the user's source images on a world-readable tunnel.
            # Nothing downstream should keep a copy longer than the fetch itself.
            return self._send(200, f.read_bytes(), ctype,
                              {"Cache-Control": "no-store, private"})

        self._json(404, {"error": "not found"})

    def do_HEAD(self):
        self.do_GET()

    def _blob(self):
        """Hand a result URL's bytes to the local page, which writes them into the folder
        the user picked with the File System Access API. Provider CDNs send no CORS
        headers, so the page cannot fetch them itself. Local page only: through the
        tunnel this endpoint would be an open proxy."""
        if not self._local_request():
            return self._json(403, {"error": "local page only"})
        url = urllib.parse.parse_qs(
            urllib.parse.urlsplit(self.path).query).get("url", [""])[0]
        if not url.startswith("http"):
            return self._json(400, {"error": "bad url"})
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                blob, ctype = r.read(), r.headers.get_content_type()
        except Exception as e:
            return self._json(502, {"error": str(e)})
        return self._send(200, blob, ctype)

    def _sse(self):
        q = queue.Queue(maxsize=1000)
        with _clients_lock:
            _clients.append(q)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            while True:
                try:
                    ev = q.get(timeout=15)
                    self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with _clients_lock:
                if q in _clients:
                    _clients.remove(q)

    # -- POST
    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path.startswith("/webhook/"):
            token = os.path.basename(path)
            try:
                body = self._read_json()
            except Exception as e:
                body = {"parse_error": str(e)}
            STATE["results"][token] = body
            log("hook", f"webhook {token} <- {json.dumps(body)[:300]}", {"body": body})
            return self._json(200, {"received": True})

        # The page posts files as raw bytes with the name in the query string - a 200 MB
        # video must never become a base64 JSON document. Anything else here is JSON.
        if path == "/api/upload" and "?" in self.path:
            return self._upload_raw(self.path.split("?", 1)[1])

        try:
            data = self._read_json()
        except Exception as e:
            return self._json(400, {"error": str(e)})

        if path == "/api/upload":
            return self._upload(data)
        if path == "/api/call":
            return self._call(data)
        if path == "/api/save":
            return self._save(data)

        self._json(404, {"error": "not found"})

    def _upload(self, data):
        name = os.path.basename(data.get("name", "file.bin")).replace(" ", "_")
        raw = base64.b64decode(data.get("data", "").split(",")[-1])
        return self._store_upload(name, raw)

    def _upload_raw(self, query):
        name = os.path.basename(
            urllib.parse.parse_qs(query).get("name", ["file.bin"])[0]).replace(" ", "_")
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD:
            return self._json(413, {"error": "file too large"})
        return self._store_upload(name, self.rfile.read(length))

    def _store_upload(self, name, raw):
        # Kling's fetcher 400s on URL-illegal bytes in the filename ([ ] et al.) with a
        # misleading "not valid base64" - keep names to the unreserved set from the start.
        name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
        if len(raw) > MAX_UPLOAD:
            return self._json(413, {"error": "file too large"})
        UPLOADS.mkdir(exist_ok=True)
        fname = f"{uuid.uuid4().hex[:8]}_{name}"
        (UPLOADS / fname).write_bytes(raw)
        url = f"{public_base()}/files/{fname}"
        log("sys", f"uploaded {name} ({len(raw)//1024} KB) -> {url}")
        return self._json(200, {"url": url, "name": fname, "size": len(raw),
                                "local": f"http://127.0.0.1:{PORT}/files/{fname}",
                                "reachable": STATE["tunnel"] == "up"})

    def _call(self, data):
        url = data.get("url", "")
        if not url.startswith("http"):
            return self._json(400, {"error": "url must be absolute"})
        body = data.get("body")
        token = None
        # fal takes its callback as a ?fal_webhook= query param and BytePlus takes a
        # callback_url only when asked; the console polls both - so only Enhancor bodies
        # get the webhook keys injected.
        if isinstance(body, dict) and data.get("autoWebhook", True) and is_enhancor(url):
            token = uuid.uuid4().hex[:12]
            hook = f"{public_base()}/webhook/{token}"
            # Their services disagree on the field name: the image APIs use webhookUrl, the
            # video queue (enhancor-video-pro) requires webhook_url and 400s without it. Send both.
            body.setdefault("webhookUrl", hook)
            body.setdefault("webhook_url", hook)
        res = call_api(data.get("method", "POST"), url, body, data.get("headers"))
        res["webhookToken"] = token
        j = res.get("json")
        # Enhancor returns requestId, fal returns request_id, BytePlus returns id. Kling
        # wraps the task in data{} and QwenCloud in output{} - and both top-level
        # request_ids name the HTTP call, not the job, so the nested id has to win or
        # history records the wrong thing.
        d = (j.get("data") or j.get("output")) if isinstance(j, dict) else None
        rid = (d.get("id") or d.get("task_id")) if isinstance(d, dict) else None
        rid = rid or ((j.get("requestId") or j.get("request_id") or j.get("id"))
                      if isinstance(j, dict) else None)
        STATE["history"].append({
            "ts": datetime.now(AEST).isoformat(timespec="seconds"),
            "url": url, "status": res["status"], "requestId": rid, "token": token,
        })
        return self._json(200, res)

    def _local_request(self):
        """The local page, as opposed to something that came in over the tunnel. The
        trycloudflare Host header is what separates them."""
        host = self.headers.get("Host", "").rsplit(":", 1)[0].strip("[]")
        return host in ("127.0.0.1", "localhost", "::1")

    def _dest_dir(self, raw):
        """Resolve the caller's save folder, falling back to outputs/.

        /api/save is reachable through the public tunnel, so a caller-named directory
        is an arbitrary-file-write primitive. Tunnelled requests arrive with the
        trycloudflare Host header - that is what separates them from the local page,
        and only the local page gets to pick a path.
        """
        if not raw:
            return OUTPUTS
        if not self._local_request():
            log("warn", "ignoring save folder from a non-local request -> outputs/")
            return OUTPUTS
        d = Path(raw)
        # Must already exist and be absolute: no creating trees from a typo in a text box.
        if not d.is_absolute() or not d.is_dir():
            log("warn", f"save folder unusable ({raw}) -> outputs/")
            return OUTPUTS
        return d

    @staticmethod
    def _out_name(dest_dir, url, abbr):
        """<abbr>_<destination folder>.<output ext>, e.g. C:\\new\\dir -> sd2_dir.mp4.

        Built from the *resolved* folder, so a rejected save path is named after the
        outputs/ it actually landed in rather than the one that was asked for.
        """
        src = os.path.basename(url.split("?")[0]) or f"{uuid.uuid4().hex[:8]}.bin"
        ext = os.path.splitext(src)[1] or ".bin"
        abbr = re.sub(r"[^A-Za-z0-9_-]", "", abbr or "")
        if not abbr:
            return f"{datetime.now(AEST).strftime('%Y%m%d_%H%M%S')}_{src}"
        # A drive root (C:\) has no name component. PureWindowsPath reads both slash
        # styles, so a Windows folder named on a Mac still yields its last component.
        p = PureWindowsPath(dest_dir)
        folder = p.name or p.drive.rstrip(":\\/") or "out"
        return f"{abbr}_{folder}{ext}"

    def _save(self, data):
        url = data.get("url", "")
        if not url.startswith("http"):
            return self._json(400, {"error": "bad url"})
        OUTPUTS.mkdir(exist_ok=True)
        dest_dir = self._dest_dir(data.get("dir"))
        # Fetched before the name is settled: a signed result URL can carry no extension
        # at all, and the .bin that falls out of that matches neither the video nor the
        # image script list, so the post-gen chain would quietly run nothing.
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                blob, ctype = r.read(), r.headers.get_content_type()
        except Exception as e:
            log("err", f"save failed: {e}")
            return self._json(502, {"error": str(e)})
        stem, ext = os.path.splitext(self._out_name(dest_dir, url, data.get("abbr")))
        if ext == ".bin":
            ext = mimetypes.guess_extension(ctype) or ".bin"
        dest = dest_dir / (stem + ext)
        # Never silently overwrite a previous render of the same input.
        n = 2
        while dest.exists():
            dest = dest.with_name(f"{stem}_{n}{ext}")
            n += 1
        dest.write_bytes(blob)
        log("sys", f"saved -> {dest}")
        # Which scripts run is the local page's call, the same as the save folder is.
        keys = data.get("scripts") or []
        if not self._local_request():
            keys = []
        # Off-thread: the chain is minutes of encoding, the page is waiting on this response.
        if keys:
            threading.Thread(target=postprocess, args=(dest, keys), daemon=True).start()
        return self._json(200, {"path": str(dest)})


class Server(ThreadingHTTPServer):
    allow_reuse_address = False  # so a second instance fails loudly instead of stealing traffic
    daemon_threads = True

    def handle_error(self, request, client_address):
        """SSE clients dropping mid-stream is normal - don't dump a traceback for it."""
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main():
    UPLOADS.mkdir(exist_ok=True)
    OUTPUTS.mkdir(exist_ok=True)
    if not (ROOT / ".env").exists():
        (ROOT / ".env").write_text("ENHANCOR_API_KEY=\nFAL_KEY=\nBYTEPLUS_API_KEY=\n"
            "KLINGAI_API_KEY=\nQWENCLOUD_API_KEY=\n"
            "POSTVIDGEN_1=\nPOSTVIDGEN_2=\nPOSTVIDGEN_3=\nPOSTIMGGEN_1=\n", encoding="utf-8")
    try:
        srv = Server(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"\n  port {PORT} is already in use - another console is running.\n  {e}\n")
        return
    threading.Thread(target=start_tunnel, daemon=True).start()
    print(f"\n  PIXEL SLINGER  ->  http://127.0.0.1:{PORT}\n")
    print(f"  enhancor key: {'set' if api_key() else 'MISSING - add ENHANCOR_API_KEY to .env'}")
    print(f"  fal key:      {'set' if fal_key() else 'MISSING - add FAL_KEY to .env'}")
    print(f"  byteplus key: {'set' if ark_key() else 'MISSING - add BYTEPLUS_API_KEY to .env'}")
    print(f"  kling key:    {'set' if kling_key() else 'MISSING - add KLINGAI_API_KEY to .env'}")
    print(f"  qwen key:     {'set' if qwen_key() else 'MISSING - add QWENCLOUD_API_KEY to .env'}\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  shutting down...")
    finally:
        stop_tunnel()
        print("  tunnel closed, uploads/ is no longer reachable.\n")


if __name__ == "__main__":
    main()
