"""Offline HTTP checks: python -m pytest -q test_reference_video.py"""
import json
import threading
import urllib.error
import urllib.request

import server


def test_reference_video_http(tmp_path, monkeypatch):
    refs = tmp_path / "video_reference"
    uploads = tmp_path / "uploads"
    monkeypatch.setattr(server, "VIDEO_REFERENCES", refs)
    monkeypatch.setattr(server, "UPLOADS", uploads)
    monkeypatch.setitem(server.STATE, "tunnel", "up")
    monkeypatch.setitem(server.STATE, "public_base", "https://tunnel.example")
    srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    monkeypatch.setattr(server, "PORT", srv.server_port)
    worker = threading.Thread(target=srv.serve_forever, daemon=True)
    worker.start()

    def request(path, data=None, auth=True):
        headers = {"X-Local-Token": server.LOCAL_TOKEN} if auth else {}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"http://127.0.0.1:{srv.server_port}" + path,
            data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as e:
            response = e
        with response:
            return response.code, json.loads(response.read())

    try:
        assert request("/api/video-references") == (200, [])
        assert request("/api/video-references", auth=False)[0] == 403
        assert request("/api/video-reference", {"name":"1.mp4"}, auth=False)[0] == 403
        refs.mkdir()
        for name in ["10.mp4", "2.mov", "1.mp4", "3.WEBM", "named.mp4", "4.txt"]:
            (refs / name).write_bytes(b"fixture video bytes")
        (refs / "5.mp4").mkdir()
        assert request("/api/video-references") == (200, ["1.mp4", "2.mov", "3.WEBM", "10.mp4"])
        status, staged = request("/api/video-reference", {"name":"1.mp4"})
        assert status == 200 and staged["reachable"]
        assert staged["url"].startswith("https://tunnel.example/files/")
        assert (uploads / staged["name"]).read_bytes() == (refs / "1.mp4").read_bytes()
        with urllib.request.urlopen(staged["local"], timeout=5) as response:
            assert response.read() == b"fixture video bytes"
            assert response.headers.get_content_type() == "video/mp4"
        for name in ["../1.mp4", "..\\1.mp4", "/1.mp4", "named.mp4", "4.txt", "999.mp4", None]:
            assert request("/api/video-reference", {"name":name})[0] == 404
        assert request("/api/video-reference", ["1.mp4"])[0] == 400
        with (refs / "9.mp4").open("wb") as f:
            f.truncate(server.MAX_UPLOAD + 1)
        assert request("/api/video-reference", {"name":"9.mp4"})[0] == 413
        (refs / "1.mp4").unlink()
        assert request("/api/video-reference", {"name":"1.mp4"})[0] == 404
    finally:
        srv.shutdown()
        srv.server_close()
        worker.join()
