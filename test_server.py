"""Self-check for the non-trivial bits of server.py. Run: python test_server.py"""
import base64
import json
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import server


def test_load_env():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / ".env"
        p.write_text('# comment\n\nENHANCOR_API_KEY="sk-abc123"\nOTHER = plain \nBROKEN\n')
        env = server.load_env(p)
        assert env == {"ENHANCOR_API_KEY": "sk-abc123", "OTHER": "plain"}, env
        assert server.load_env(Path(d) / "nope.env") == {}


def test_redact():
    assert server.redact("key=sk-abcdefghijkl", "sk-abcdefghijkl") == "key=sk-a...ijkl"
    assert server.redact("nothing", "") == "nothing"
    assert server.redact("short", "abc") == "short"  # too short to redact safely


def test_provider_routing():
    """Auth is picked by hostname. Sending a fal body with the Enhancor key - or the
    reverse - would leak one provider's credential to the other."""
    assert server.is_fal("https://queue.fal.run/fal-ai/bria/expand")
    assert server.is_fal("https://fal.run/bytedance/seedream/v5/pro/edit")
    assert not server.is_fal("https://apireq.enhancor.ai/api/kora/v1/queue")
    # a lookalike host must not match
    assert not server.is_fal("https://queue.fal.run.evil.example/x")

    headers, _, secret = server.auth_for("https://queue.fal.run/fal-ai/bria/expand")
    assert secret == "Authorization" and headers["Authorization"].startswith("Key ")
    assert "x-api-key" not in headers

    headers, _, secret = server.auth_for("https://apireq.enhancor.ai/api/kora/v1/queue")
    assert secret == "x-api-key" and "Authorization" not in headers

    # BytePlus ModelArk: Bearer, and only on the account's own region host.
    ark = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks"
    assert server.is_ark(ark) and not server.is_fal(ark) and not server.is_enhancor(ark)
    assert not server.is_ark("https://ark.eu-west.bytepluses.com/api/v3/images/generations")
    assert not server.is_ark("https://ark.ap-southeast.bytepluses.com.evil.example/x")
    headers, _, secret = server.auth_for(ark)
    assert secret == "Authorization" and headers["Authorization"].startswith("Bearer ")
    assert "x-api-key" not in headers
    assert server.key_var(ark) == "BYTEPLUS_API_KEY"
    assert server.key_var("https://queue.fal.run/x") == "FAL_KEY"

    # Kling: Bearer as well, so only the hostname keeps the two Bearer keys apart. Their
    # task ids are regional, so the other host must not match either.
    kl = "https://api-singapore.klingai.com/image-to-video/kling-3.0"
    assert server.is_kling(kl)
    assert not server.is_ark(kl) and not server.is_fal(kl) and not server.is_enhancor(kl)
    assert not server.is_kling("https://api.klingai.com/v1/videos/image2video")
    assert not server.is_kling("https://api-singapore.klingai.com.evil.example/x")
    headers, _, secret = server.auth_for(kl)
    assert secret == "Authorization" and headers["Authorization"].startswith("Bearer ")
    assert "x-api-key" not in headers
    assert server.key_var(kl) == "KLINGAI_API_KEY"
    assert server.key_var("https://apireq.enhancor.ai/api/x") == "ENHANCOR_API_KEY"


def test_tunnel_regex():
    line = "2026-08-05 INF |  https://calm-blue-fox-42.trycloudflare.com   |"
    assert server.TUNNEL_RE.search(line).group(0) == "https://calm-blue-fox-42.trycloudflare.com"
    line = "f50d42eeaef1d1.lhr.life tunneled with tls termination, https://f50d42eeaef1d1.lhr.life"
    assert server.TUNNEL_RE.search(line).group(0) == "https://f50d42eeaef1d1.lhr.life"
    # the localhost.run banner carries its own doc links - none of them may parse as the tunnel
    assert server.TUNNEL_RE.search("see https://localhost.run/docs/ or https://admin.localhost.run") is None
    assert server.TUNNEL_RE.search("no url here") is None


def test_http_roundtrip():
    """Boot the real server, upload a file, hit it back over HTTP, fire a webhook."""
    server.PORT = 8899
    server.UPLOADS.mkdir(exist_ok=True)
    srv = server.ThreadingHTTPServer(("127.0.0.1", 8899), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(0.3)
    base = "http://127.0.0.1:8899"

    def post(path, obj):
        req = urllib.request.Request(base + path, data=json.dumps(obj).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return json.loads(e.read())

    payload = b"PNGDATA-not-really"
    up = post("/api/upload", {"name": "my pic.png",
                              "data": "data:image/png;base64," + base64.b64encode(payload).decode()})
    assert up["size"] == len(payload) and up["name"].endswith("_my_pic.png"), up

    with urllib.request.urlopen(up["local"], timeout=5) as r:
        assert r.read() == payload
        assert r.headers["Content-Type"] == "image/png"

    # The binary path the page uses: the file is the request body, the name rides in the
    # query string - no base64 copy in a JSON document on either side. Brackets and spaces
    # in the name are squashed: Kling 400s on URL-illegal bytes in the fetch URL.
    req = urllib.request.Request(base + "/api/upload?name=raw%20clip%5B1%5D.bin", data=payload,
                                 headers={"Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=5) as r:
        up2 = json.loads(r.read())
    assert up2["size"] == len(payload) and up2["name"].endswith("_raw_clip_1_.bin"), up2
    with urllib.request.urlopen(up2["local"], timeout=5) as r:
        assert r.read() == payload

    # /api/blob hands a result URL's bytes to the page (Source-folder saves) - and only
    # to the local page, through the tunnel it would be an open proxy.
    with urllib.request.urlopen(base + "/api/blob?url=" + urllib.parse.quote(up["local"]),
                                timeout=5) as r:
        assert r.read() == payload
    req = urllib.request.Request(base + "/api/blob?url=" + urllib.parse.quote(up["local"]),
                                 headers={"Host": "x-y.trycloudflare.com"})
    try:
        urllib.request.urlopen(req, timeout=5)
        assert False, "tunneled /api/blob must be refused"
    except urllib.error.HTTPError as e:
        assert e.code == 403, e.code

    hook = post("/webhook/tok123", {"request_id": "r1", "result": "http://x/y.png", "status": "success"})
    assert hook["received"] is True
    assert server.STATE["results"]["tok123"]["result"] == "http://x/y.png"

    with urllib.request.urlopen(base + "/api/results", timeout=5) as r:
        assert "tok123" in json.loads(r.read())["results"]

    # relative urls are refused rather than silently proxied
    assert post("/api/call", {"url": "/etc/passwd"}).get("error")

    # fal takes its callback as a query param, so the webhook keys must not be injected
    # into a fal body - and with no FAL_KEY the call must abort rather than fall back
    # to the Enhancor key.
    body = {"image_url": "https://example.invalid/a.png", "canvas_size": [100, 100]}
    res = post("/api/call", {"url": "https://queue.fal.run/fal-ai/bria/expand", "body": body})
    assert res["webhookToken"] is None, res
    assert "webhookUrl" not in body and "webhook_url" not in body, body

    Path(server.UPLOADS / up["name"]).unlink()
    Path(server.UPLOADS / up2["name"]).unlink()
    srv.shutdown()


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("\nall passed")
