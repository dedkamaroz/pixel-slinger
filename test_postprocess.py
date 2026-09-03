#!/usr/bin/env python3
"""The post-gen chain: right scripts, right order, each fed what the last one wrote."""
import os
import tempfile
from pathlib import Path

import server


def check_env_parsing():
    """A POSTVIDGEN_<n>/POSTIMGGEN_<n> line becomes one drop-down entry, labelled by its
    own filename, numbered by its suffix. Blank lines are not entries, and neither list
    picks up the other's lines."""
    real, server.load_env = server.load_env, lambda: {
        "POSTVIDGEN_2": r'"D:\Tools\deai-skill\gpuvideo.bat"',
        "POSTVIDGEN_1": r'"C:\scripts\original_rppg\run_rppg.bat" --fast',
        "POSTVIDGEN_3": "",
        "POSTIMGGEN_1": r'"D:\Tools\upscale\img.bat"',
        "FAL_KEY": "not-a-script",
    }
    try:
        vid = [(s["key"], s["label"]) for s in server.postgen_scripts("POSTVIDGEN")]
        img = [(s["key"], s["label"]) for s in server.postgen_scripts("POSTIMGGEN")]
    finally:
        server.load_env = real
    assert vid == [("POSTVIDGEN_1", "run_rppg"), ("POSTVIDGEN_2", "gpuvideo")], vid
    assert img == [("POSTIMGGEN_1", "img")], img


def check_argv():
    """Quotes come off, backslashes stay on, and the video is the last argument
    unless the command says where it goes."""
    assert server._argv(r'"C:\a b\run.bat" --fast') == [r"C:\a b\run.bat", "--fast"]


def check_run_script_streams():
    """Every child line reaches log() as a bodyOnly line, and rc is honoured."""
    events = []
    real_log, server.log = server.log, lambda k, t, m=None: events.append((k, t, m))
    try:
        with tempfile.TemporaryDirectory() as td:
            # Same child, platform-appropriate shell: a .bat only runs under cmd.exe.
            if os.name == "nt":
                bat = Path(td) / "echo2.bat"
                bat.write_text("@echo off\r\necho one\r\necho two\r\nexit /b 3\r\n")
            else:
                bat = Path(td) / "echo2.sh"
                bat.write_text("#!/bin/sh\necho one\necho two\nexit 3\n")
                bat.chmod(0o755)
            assert server.run_script(f'"{bat}"', "x") is False
    finally:
        server.log = real_log
    out = [t for k, t, m in events if k == "out" and m and m.get("bodyOnly")]
    assert out == ["[echo2] one", "[echo2] two"], out
    assert any(k == "err" and "exited 3" in t for k, t, m in events), events


def check_chain():
    """Picked order, sequentially, and script 2 gets the file script 1 wrote - not the
    original. This is the rPPG -> deai case: rPPG writes <stem>_dm<n>.mp4."""
    scripts = [{"key": "POSTVIDGEN_1", "n": 1, "label": "one", "cmd": '"one.bat"'},
               {"key": "POSTVIDGEN_2", "n": 2, "label": "two", "cmd": '"two.bat"'}]
    real = server.postgen_scripts, server.run_script
    server.postgen_scripts = lambda prefix: scripts
    try:
        with tempfile.TemporaryDirectory() as td:
            vid = Path(td) / "bs20_out.mp4"
            vid.write_bytes(b"x")
            (Path(td) / "bs20_out_dm1.mp4").write_bytes(b"x")   # already taken
            calls = []

            def fake_run(cmd, path):
                calls.append((cmd, Path(path)))
                if cmd == '"one.bat"':
                    assert len(calls) == 1, "script 2 ran before script 1 returned"
                    (Path(td) / "bs20_out_dm2.mp4").write_bytes(b"x")
                return True

            server.run_script = fake_run
            server.postprocess(vid, ["POSTVIDGEN_1", "POSTVIDGEN_2"], chain=True)
            assert calls == [('"one.bat"', vid),
                             ('"two.bat"', vid.with_name("bs20_out_dm2.mp4"))], calls

            # A failure stops the chain rather than handing on a half-written file.
            calls.clear()
            server.run_script = lambda cmd, path: calls.append(cmd) or False
            server.postprocess(vid, ["POSTVIDGEN_1", "POSTVIDGEN_2"], chain=True)
            assert calls == ['"one.bat"'], calls

            # Unchained (the default): every script gets the original, in slot order,
            # and one failing does not cost the others their run.
            calls.clear()
            (Path(td) / "bs20_out_dm3.mp4").write_bytes(b"x")   # a fresh "output"
            server.run_script = lambda cmd, path: calls.append((cmd, Path(path))) or False
            server.postprocess(vid, ["POSTVIDGEN_1", "POSTVIDGEN_2"])
            assert calls == [('"one.bat"', vid), ('"two.bat"', vid)], calls

            # Only three run, however many are picked, and an unknown key is skipped.
            calls.clear()
            server.postgen_scripts = lambda prefix: [
                dict(s, key=f"POSTVIDGEN_{i+1}", cmd=f'"{i+1}.bat"')
                for i, s in enumerate([scripts[0]] * 4)]
            server.run_script = lambda cmd, path: calls.append(cmd) or True
            server.postprocess(vid, ["POSTVIDGEN_1", "POSTVIDGEN_2",
                                     "POSTVIDGEN_3", "POSTVIDGEN_4"], chain=True)
            assert calls == ['"1.bat"', '"2.bat"', '"3.bat"'], calls
            calls.clear()
            server.postprocess(vid, ["POSTVIDGEN_9"])
            assert calls == [], calls
    finally:
        server.postgen_scripts, server.run_script = real


def check_kind_split():
    """The saved file picks the list: an image is looked up in POSTIMGGEN, a video in
    POSTVIDGEN, and anything else runs nothing at all."""
    asked, calls = [], []
    real = server.postgen_scripts, server.run_script
    server.postgen_scripts = lambda prefix: asked.append(prefix) or [
        {"key": f"{prefix}_1", "n": 1, "label": "a", "cmd": '"a.bat"'},
        {"key": f"{prefix}_2", "n": 2, "label": "b", "cmd": '"b.bat"'}]
    server.run_script = lambda cmd, path: calls.append(cmd) or True
    try:
        with tempfile.TemporaryDirectory() as td:
            img = Path(td) / "sd5e_dir.jpeg"
            img.write_bytes(b"x")
            server.postprocess(img, ["POSTIMGGEN_1", "POSTIMGGEN_2"])
            assert asked == ["POSTIMGGEN"], asked
            assert calls == ['"a.bat"', '"b.bat"'], calls

            asked.clear(); calls.clear()
            txt = Path(td) / "notes.txt"
            txt.write_bytes(b"x")
            server.postprocess(txt, ["POSTVIDGEN_1"])
            assert (asked, calls) == ([], []), (asked, calls)
    finally:
        server.postgen_scripts, server.run_script = real


def main():
    check_env_parsing()
    check_kind_split()
    check_argv()
    check_run_script_streams()
    check_chain()
    print("ok")


if __name__ == "__main__":
    main()
