"""Live check that every Skin-tab combination the UI can build is accepted by Enhancor.

Each payload points img_url at an unresolvable host, so anything that survives
validation dies at image fetch: no render, no credits. A validation error means
the field spec in index.html disagrees with their API.

Run: python test_skin_matrix.py    (needs ENHANCOR_API_KEY in .env)
"""
import json
import urllib.error
import urllib.request

import server

HOST = "https://apireq.enhancor.ai/api/realistic-skin/v1/queue"
IMG = "https://example.invalid/a.png"
HOOK = "https://example.invalid/hook"
FETCH_FAILED = "Failed to process image"

AREAS = {
    "background": False, "skin": False, "nose": False, "eye_g": False, "r_eye": True,
    "l_eye": True, "r_brow": False, "l_brow": False, "r_ear": True, "l_ear": True,
    "mouth": True, "u_lip": True, "l_lip": True, "hair": False, "hat": False,
    "ear_r": False, "neck_l": False, "neck": False, "cloth": False,
}


def post(body):
    req = urllib.request.Request(
        HOST, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-api-key": server.api_key()},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def message(raw):
    try:
        err = json.loads(raw).get("error")
        return err.get("message") if isinstance(err, dict) else str(err)
    except ValueError:
        return raw[:200]


def cases():
    """Mirrors the `when` gates in index.html - keep the two in step."""
    common = {"img_url": IMG, "webhookUrl": HOOK, "enhancementType": "face",
              "skin_refinement_level": 50}
    for mode in ("standard", "heavy"):
        body = {**common, **AREAS, "model_version": "enhancorv1",
                "enhancementMode": mode, "skin_realism_Level": 1.7}
        if mode == "heavy":
            body["portrait_depth"] = 0.3
        yield f"v1/{mode}", body

    yield "v3/standard", {**common, **AREAS, "model_version": "enhancorv3",
                          "enhancementMode": "standard", "skin_realism_Level": 0.1,
                          "portrait_depth": 0.2, "output_resolution": 2048,
                          "mask_expand": 15}

    for strength in ("subtle", "realistic", "pimple", "freckle"):
        body = {**common, "model_version": "enhancorv4",
                "enhancement_strength": strength, "fast_mode": False}
        if strength == "freckle":
            body["freckle_intensity"] = 50
        if strength == "realistic":
            body["fix_lighting_mode"] = True
        yield f"v4/{strength}", body

    yield "v4_base", {**common, "model_version": "enhancorv4_base",
                      "enhancementMode": "standard"}


def test_every_ui_combination_passes_validation():
    assert server.api_key(), "ENHANCOR_API_KEY missing from .env"
    failures = []
    for label, body in cases():
        status, raw = post(body)
        msg = message(raw)
        ok = status == 200 or FETCH_FAILED in str(msg)
        print(f"  {'ok  ' if ok else 'FAIL'} {label:16} {status} {msg}")
        if not ok:
            failures.append((label, msg))
        if status == 200:
            failures.append((label, "queued a real job - img_url was reachable"))
    assert not failures, failures


def test_rejected_combinations_are_gated_out():
    """The UI must not be able to build these; confirm they really are errors."""
    base = {"img_url": IMG, "webhookUrl": HOOK}
    for label, body, expect in [
        ("v3+heavy", {**base, "model_version": "enhancorv3", "enhancementMode": "heavy"}, "Enhancement mode"),
        ("v1+detailed", {**base, "model_version": "enhancorv1", "enhancementMode": "detailed"}, "Enhancement mode"),
        ("enhancorv2", {**base, "model_version": "enhancorv2"}, "Model version"),
    ]:
        status, raw = post(body)
        msg = message(raw)
        print(f"  ok   {label:16} rejected: {msg}")
        assert expect in str(msg), (label, msg)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            print(f"\n{name}")
            fn()
    print("\nall passed")
