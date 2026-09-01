// node test_fal_fields.js - offline check of the fal tabs' payload shaping.
// The shape() hooks are the only place a flat form turns into fal's nested schema
// (image_size's union type, bria's three [x,y] pairs), so they get a test; a wrong
// shape here is a 422 at best and a silently different render at worst.
const fs = require("fs"), assert = require("assert");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
// end anchor must be unique in the file - the nav's comment banner also appears in the CSS
const src = html.slice(html.indexOf("const AREAS"), html.indexOf("const ALL_GROUPS"));
const API = "https://apireq.enhancor.ai/api";
const ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ENHANCOR_ON = false;   // mirrors the page: Enhancor tabs are switched off
const SERVICES = eval(src + "\nSERVICES");

const names = svc => svc.fields.map(f => f[0]);

// --- Seedream 5 Pro Edit -----------------------------------------------------
const sd = SERVICES.seedream5edit;
assert.strictEqual(sd.fal, "bytedance/seedream/v5/pro/edit", "endpoint id must match fal's");

// Every input fal's OpenAPI lists must be reachable from the form (sync_mode excluded
// on purpose - it returns a data URI and skips request history, breaking save-to-disk).
["image_urls", "prompt", "image_size", "num_images", "output_format", "enable_safety_checker"]
  .forEach(f => assert(names(sd).includes(f), `seedream is missing ${f}`));

// The size chips carry "WxH" and always send the union's object arm.
let b = { image_size: "1152x2048", prompt: "x" };
sd.shape(b);
assert.deepStrictEqual(b.image_size, { width: 1152, height: 2048 }, "chips become the object form");

// A value that is not WxH is left exactly as it is, rather than sent as {NaN, NaN}.
b = { image_size: "auto_2K" };
sd.shape(b);
assert.strictEqual(b.image_size, "auto_2K", "enum sizes pass straight through");
b = {};
sd.shape(b);
assert.strictEqual(b.image_size, undefined, "a missing size stays missing");

// Both Seedream tabs offer the same 12 documented sizes, so an A/B keeps one variable.
const chips = SERVICES.seedream5edit.fields.find(f => f[0] === "image_size")[3];
const dola  = SERVICES.sd5pro.fields.find(f => f[0] === "size")[3];
assert.strictEqual(chips.opts, dola.opts, "both tabs read the one size table");
assert.strictEqual(chips.def, "1152x2048"); assert.strictEqual(dola.def, "1152x2048");

// fal's OpenAPI has no seed on either Seedream v5 Pro endpoint (checked 20/08/2026),
// so the form must not grow one - a field that is silently dropped would read as a
// matched seed in an A/B that is not actually matched.
assert(!names(sd).includes("seed"), "fal's seedream schema has no seed - do not invent one");

// matches SeedreamV5ProEditOutput: { images: [Image] }
assert.deepStrictEqual(sd.results({ images: [{ url: "a" }, { url: "b" }] }), ["a", "b"]);
assert.deepStrictEqual(sd.results({}), [], "a response with no images yields no saves");

// --- Bria Expand -------------------------------------------------------------
const br = SERVICES.briaexpand;
assert.strictEqual(br.fal, "fal-ai/bria/expand", "endpoint id must match fal's");
["image_url", "prompt", "negative_prompt", "seed", "aspect_ratio"]
  .forEach(f => assert(names(br).includes(f), `bria is missing ${f}`));

b = { image_url: "u", canvas_w: 1200, canvas_h: 800 };
br.shape(b);
assert.deepStrictEqual(b.canvas_size, [1200, 800]);
assert(!("original_image_size" in b), "an unset pair must not be sent");
assert(!("original_image_location" in b));
["canvas_w", "canvas_h"].forEach(k => assert(!(k in b), `${k} is form-only`));

b = { image_url: "u", canvas_w: 1200, canvas_h: 800, orig_w: 600, orig_h: 400, orig_x: 0, orig_y: 0 };
br.shape(b);
assert.deepStrictEqual(b.original_image_size, [600, 400]);
// 0,0 is a real corner. It has to survive - which is why a blank number field stays ""
// rather than being coerced through Number("") to 0.
assert.deepStrictEqual(b.original_image_location, [0, 0]);

// The send loop drops "" before shape() runs, so a blanked field arrives as absent.
b = { image_url: "u", canvas_w: 10, canvas_h: 10, orig_w: 5 };
br.shape(b);
assert(!("original_image_size" in b), "width without height must not be sent");

b = { image_url: "u" };   // canvas blanked entirely
br.shape(b);
assert(!("canvas_size" in b), "half a pair must never serialise as [n,null]");

// matches BriaExpandOutput: { image: Image, seed: int }
assert.deepStrictEqual(br.results({ image: { url: "z" }, seed: 1 }), ["z"]);
assert.deepStrictEqual(br.results({}), []);

// fit() fills the placement fields off the measured source: real size, centred, when it
// fits the canvas; a source that overflows doubles the canvas (1080x1920->2160x3840) and
// goes in at half-size, centred.
b = { canvas_w: 1080, canvas_h: 1920 };
br.fit(b, 500, 1000);
assert.deepStrictEqual([b.orig_w, b.orig_h, b.orig_x, b.orig_y], [500, 1000, 290, 460],
  "fits: real size, centred");
assert.strictEqual(b.canvas_w, 1080, "a fitting source leaves the canvas alone");
br.fit(b, 3000, 3000);
assert.deepStrictEqual([b.canvas_w, b.canvas_h, b.orig_w, b.orig_h, b.orig_x, b.orig_y],
  [2160, 3840, 1080, 1920, 540, 960], "overflow: doubled canvas, half-size, centred");

// --- Seedance 1.5 Pro i2v / Kling 2.6 Pro i2v --------------------------------
// No shape() on either - they are flat. What can break instead is the duration field:
// fal types it as a string enum on both, so a "number" field would send 5 and 422.
const spec = (svc, name) => svc.fields.find(f => f[0] === name);

const s15 = SERVICES.seedance15fal;
assert.strictEqual(s15.fal, "fal-ai/bytedance/seedance/v1.5/pro/image-to-video");
["image_url", "prompt", "end_image_url", "duration", "resolution", "aspect_ratio",
 "generate_audio", "camera_fixed", "seed", "enable_safety_checker"]
  .forEach(f => assert(names(s15).includes(f), `seedance 1.5 is missing ${f}`));

// This tab is run back to back against the ModelArk tab of the same model, so its
// defaults are pinned to ModelArk's rather than to fal's own (16:9, audio on, camera
// free). Drift here reads as a model difference in the comparison.
const o15 = n => spec(s15, n)[3];
assert.strictEqual(o15("aspect_ratio").def, "9:16");
assert.strictEqual(o15("generate_audio").def, false);
assert.strictEqual(o15("camera_fixed").def, true);
assert.strictEqual(o15("resolution").def, "720p");
// The seed is the point of the A/B: present, blank by default, and -1 reachable.
assert.strictEqual(o15("seed").def, "");
assert.strictEqual(o15("seed").min, -1);
assert.strictEqual(o15("seed").max, 2147483647);

const k26 = SERVICES.kling26fal;
assert.strictEqual(k26.fal, "fal-ai/kling-video/v2.6/pro/image-to-video");
["start_image_url", "prompt", "end_image_url", "duration", "negative_prompt",
 "generate_audio", "voice_ids"]
  .forEach(f => assert(names(k26).includes(f), `kling 2.6 is missing ${f}`));
// This endpoint has neither in its schema; offering them would 422 the request.
["aspect_ratio", "seed"].forEach(f =>
  assert(!names(k26).includes(f), `kling 2.6 has no ${f} in fal's schema`));

[[s15, ["4","5","6","7","8","9","10","11","12"]], [k26, ["5","10"]]].forEach(([svc, opts]) => {
  const [, type, , o] = spec(svc, "duration");
  assert.strictEqual(type, "select", `${svc.title}: duration must be a select, not a number`);
  assert.deepStrictEqual(o.opts, opts, `${svc.title}: duration enum must match fal's`);
  o.opts.forEach(v => assert.strictEqual(typeof v, "string", "durations are strings to fal"));
  assert.strictEqual(o.def, "5");
});

// Every select's default has to be one of its own options, or the field renders blank.
[s15, k26].forEach(svc => svc.fields.forEach(([n, t, , o]) => {
  if (t === "select") assert(o.opts.includes(o.def), `${svc.title}: ${n} default is not an option`);
}));

// both outputs are { video: File }, unlike the image tabs' images[] / image
[s15, k26].forEach(svc => {
  assert.deepStrictEqual(svc.results({ video: { url: "v.mp4" } }), ["v.mp4"]);
  assert.deepStrictEqual(svc.results({}), [], "no video means nothing to save");
});

// --- transport separation ----------------------------------------------------
// A fal tab carrying `base` would queue the fal body against Enhancor with the wrong key.
[sd, br].forEach(s => assert(!s.base, `${s.title} must not define base`));
// Five transports now, still exactly one each: fal, Enhancor (base), BytePlus (ark), Kling,
// QwenCloud (qwen / qwenImage).
Object.entries(SERVICES).forEach(([id, s]) =>
  assert([s.fal, s.base, s.ark, s.arkImage, s.kling, s.qwen, s.qwenImage].filter(Boolean).length === 1,
    `${id} must have exactly one of fal/base/ark/arkImage/kling/qwen/qwenImage`));

// --- nav wiring --------------------------------------------------------------
// A nav id with no matching service latches the switch and renders an empty pane - no
// error, no tab, nothing to notice until someone goes looking for the model. A nav id may
// now also name a publisher page, in which case what has to resolve is the models behind
// its drop-down.
const navSrc = html.slice(html.indexOf("/* ---------- publisher pages ---------- */"),
                          html.indexOf("const SWITCH"));
const { GROUPS, PUBLISHERS } = eval(navSrc + "\n({ GROUPS, PUBLISHERS })");
GROUPS.forEach(g => g.items.forEach(([id, label]) =>
  assert(SERVICES[id] || PUBLISHERS[id], `nav "${label}" points at unknown target ${id}`)));
Object.entries(PUBLISHERS).forEach(([pid, p]) => p.models.forEach(([id, label]) =>
  assert(SERVICES[id], `${pid} lists unknown model ${id} ("${label}")`)));
// Reachable = a nav id, or a model on a page some nav id opens.
const reachable = new Set(GROUPS.flatMap(g => g.items.flatMap(([id]) =>
  PUBLISHERS[id] ? PUBLISHERS[id].models.map(([m]) => m) : [id])));
["seedance15fal", "kling26fal"].forEach(id =>
  assert(reachable.has(id), `${id} is not reachable from the nav`));
// Both fal tabs sit behind the one fal page - that is the point of consolidating them.
assert.deepStrictEqual(PUBLISHERS.pubFal.models.map(m => m[0]), ["seedance15fal", "kling26fal"]);

console.log("ok - fal field shaping");
