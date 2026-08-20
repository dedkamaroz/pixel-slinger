#!/usr/bin/env python3
"""Naming + destination-folder rules for /api/save. Run: python test_save_naming.py"""
import tempfile
from pathlib import Path

import server


class FakeHandler(server.Handler):
    """Only _dest_dir and _save's naming path are exercised - no socket involved."""

    def __init__(self, host="127.0.0.1:8787"):
        self.headers = {"Host": host}


def main():
    h = FakeHandler()
    with tempfile.TemporaryDirectory() as tmp:
        # local request, real absolute folder -> honoured
        assert h._dest_dir(tmp) == Path(tmp)
        # blank / missing / relative / non-existent -> outputs/
        assert h._dest_dir("") == server.OUTPUTS
        assert h._dest_dir(None) == server.OUTPUTS
        assert h._dest_dir("relative/path") == server.OUTPUTS
        assert h._dest_dir(tmp + "/nope") == server.OUTPUTS
        # tunnelled request may not choose a folder
        assert FakeHandler("abc-def.trycloudflare.com")._dest_dir(tmp) == server.OUTPUTS

    # filename = <abbr>_<destination folder> + the *output's* extension
    name = server.Handler._out_name
    mp4 = "https://cdn.x/out/abc123.mp4?sig=xyz"
    assert name(Path(r"C:\new\dir"), mp4, "sd2") == "sd2_dir.mp4"
    assert name(Path(r"D:\Photos\shoot-01"), "https://cdn.x/a/b.png", "ev4") == "ev4_shoot-01.png"
    assert name(server.OUTPUTS, mp4, "kp") == "kp_outputs.mp4"
    # a drive root has no name component
    assert name(Path("C:\\"), mp4, "sd2") == "sd2_C.mp4"
    # no abbr (gallery re-saves) keeps the timestamped original name
    assert name(Path(r"C:\new\dir"), mp4, None).endswith("_abc123.mp4")
    # abbr is sanitised - it reaches the filename directly
    assert name(Path(r"C:\new\dir"), mp4, "../../evil") == "evil_dir.mp4"
    # an extensionless result URL still produces a usable file
    assert name(Path(r"C:\new\dir"), "https://cdn.x/out/abc123", "sd2") == "sd2_dir.bin"
    print("ok")


if __name__ == "__main__":
    main()
