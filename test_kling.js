// node test_kling.js - offline check of the Kling AI tabs.
// Two things here can go wrong without anyone noticing. klingShape() is the only place a
// flat form turns into Kling's typed `contents` array plus its settings/options envelope,
// and a part with the wrong `type` is not a validation error, it is a different shot. And
// motion control is a second endpoint on the same model, so the path is a function of form
// state - a stale gate would post a motion-control body to the image-to-video route.
const fs = require("fs"), assert = require("assert");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const API = "https://apireq.enhancor.ai/api";
const ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ENHANCOR_ON = false;   // mirrors the page
const SERVICES = eval(html.slice(html.indexOf("const AREAS"), html.indexOf("const GROUPS")) + "\nSERVICES");

const KLING_MODELS = ["k30", "k30omni", "ko1", "k26", "k25t", "k21m"];
const shown = (svc, state) => svc.fields.filter(([n, t, l, o]) => !o.when || o.when(state)).map(f => f[0]);
const path = (svc, state) => (typeof svc.kling === "function" ? svc.kling(state) : svc.kling);
const abbr = (svc, state) => (typeof svc.abbr === "function" ? svc.abbr(state) : svc.abbr);

// --- endpoints ---------------------------------------------------------------
// The model id lives in the path on the new routes, so a typo is a 404 rather than a
// wrong-model render - but only if the paths are the ones Kling documents.
assert.strictEqual(path(SERVICES.k30, {}), "/image-to-video/kling-3.0");
assert.strictEqual(path(SERVICES.k30, { mode: "motion-control" }), "/motion-control/kling-3.0");
assert.strictEqual(path(SERVICES.k30omni, {}), "/omni-video/kling-3.0-omni");
assert.strictEqual(path(SERVICES.ko1, {}), "/omni-video/kling-o1");
assert.strictEqual(path(SERVICES.k26, {}), "/image-to-video/kling-2.6");
assert.strictEqual(path(SERVICES.k26, { mode: "motion-control" }), "/motion-control/kling-2.6");
assert.strictEqual(path(SERVICES.k25t, {}), "/image-to-video/kling-2.5-turbo");
assert.strictEqual(path(SERVICES.k21m, {}), "/v1/videos/image2video");

// Every Kling tab uses the Kling transport and nothing else, and none of them carries a
// host in the path - the page prefixes KLING, which is the Singapore host this key belongs to.
KLING_MODELS.forEach(id => {
  const s = SERVICES[id];
  assert(s.kling, `${id} must declare the kling transport`);
  assert(!s.base && !s.fal && !s.ark && !s.arkImage, `${id} must not carry a second transport`);
  assert(path(s, {}).startsWith("/"), `${id} path must be relative to the Kling host`);
  // Saved files are named after this, so two tabs sharing one would overwrite each other.
  assert(abbr(s, {}), `${id} needs an output abbreviation`);
});
assert.strictEqual(new Set(KLING_MODELS.map(id => abbr(SERVICES[id], {}))).size, KLING_MODELS.length,
  "output abbreviations must be unique across the Kling tabs");
// Motion control writes a different clip from the same tab, so it gets its own name too.
assert.notStrictEqual(abbr(SERVICES.k30, { mode: "motion-control" }), abbr(SERVICES.k30, {}));

// --- klingShape: flat form -> contents / settings / options -------------------
const shape = (svc, body) => { const b = Object.assign({}, body); svc.shape(b); return b; };
const partsOf = b => b.contents.map(p => p.type);

let b = shape(SERVICES.k30, {
  prompt: "a woman turns to camera",
  first_frame: "https://x/a.jpg", last_frame: "https://x/b.jpg",
  multi_shot: true, audio: "native", resolution: "1080p", duration: 8,
  watermark: false, external_task_id: "job-1",
});
assert.deepStrictEqual(partsOf(b), ["prompt", "first_frame", "last_frame"]);
assert.deepStrictEqual(b.contents[0], { type: "prompt", text: "a woman turns to camera" });
assert.deepStrictEqual(b.contents[1], { type: "first_frame", url: "https://x/a.jpg" });
assert.deepStrictEqual(b.settings,
  { multi_shot: true, audio: "native", resolution: "1080p", duration: 8 });
// A select hands back a string; these routes document duration as an int, so the shape
// has to normalise it rather than send "8".
assert.strictEqual(shape(SERVICES.k30, { duration: "12" }).settings.duration, 12);
assert.deepStrictEqual(b.options, { watermark_info: { enabled: false }, external_task_id: "job-1" });
// Nothing may survive at the top level: Kling ignores unknown keys rather than refusing
// them, so a leftover `prompt` would read as set on the form while doing nothing on the wire.
assert.deepStrictEqual(Object.keys(b).sort(), ["contents", "options", "settings"]);

// The omni tabs address their references from the prompt as @image_1 / @video_1, so the
// ids the shape assigns are load-bearing, not decoration.
b = shape(SERVICES.k30omni, {
  prompt: "@image_1 walks past @image_2",
  refer_image: ["https://x/1.jpg", "https://x/2.jpg"],
  feature_video: "https://x/v.mp4",
  elements: [{ element_id: "77", id: "Zhang" }],
  aspect_ratio: "9:16", duration: 5,
});
assert.deepStrictEqual(b.contents.filter(p => p.type === "refer_image").map(p => p.id),
  ["image_1", "image_2"], "reference images must be numbered from 1 in form order");
assert.strictEqual(b.contents.find(p => p.type === "feature_video").id, "video_1");
assert.deepStrictEqual(b.contents.find(p => p.type === "element"),
  { type: "element", element_id: "77", id: "Zhang" });

// 2.6's voices ride in contents as well, not in settings.
b = shape(SERVICES.k26, { prompt: "she says hello", first_frame: "https://x/a.jpg",
  voices: [{ voice_id: "v1", id: "sweet" }], audio: "native" });
assert.deepStrictEqual(b.contents.find(p => p.type === "voice"),
  { type: "voice", voice_id: "v1", id: "sweet" });

// An empty form must not invent parts or an empty settings block.
b = shape(SERVICES.k25t, {});
assert.deepStrictEqual(b.contents, []);
assert.strictEqual(b.settings, undefined, "no settings block when nothing is set");
assert.deepStrictEqual(b.options, { watermark_info: { enabled: false } });

// --- 2.1 Master keeps the legacy flat body -----------------------------------
// It is the odd one out: no contents envelope, and the model rides in model_name.
b = shape(SERVICES.k21m, { image: "https://x/a.jpg", prompt: "p", cfg_scale: 0.5,
  mode: "pro", duration: "5", watermark: true });
assert.strictEqual(b.model_name, "kling-v2-1-master");
assert.strictEqual(b.contents, undefined, "the legacy route takes a flat body");
assert.strictEqual(b.image, "https://x/a.jpg");
assert.deepStrictEqual(b.watermark_info, { enabled: true });
assert.strictEqual(b.watermark, undefined, "the form's bool must not reach the wire as-is");
// duration is a string enum on this route - a number comes back rejected.
SERVICES.k21m.fields.filter(f => f[0] === "duration").forEach(([, , , o]) =>
  assert(!o.num, "2.1 Master's duration must stay a string"));

// --- field gating ------------------------------------------------------------
// A hidden field is not sent, so the gates are what keep a motion-control body off the
// image-to-video route and the other way round.
const i2v = shown(SERVICES.k30, { mode: "image-to-video" });
["first_frame", "last_frame", "multi_shot", "duration"].forEach(f =>
  assert(i2v.includes(f), `image-to-video needs ${f}`));
["image", "video", "character_orientation"].forEach(f =>
  assert(!i2v.includes(f), `${f} is motion control only`));

const mc = shown(SERVICES.k30, { mode: "motion-control" });
["image", "video", "character_orientation"].forEach(f =>
  assert(mc.includes(f), `motion control needs ${f}`));
["first_frame", "last_frame", "multi_shot", "duration"].forEach(f =>
  assert(!mc.includes(f), `${f} must be hidden in motion control`));
assert(!shown(SERVICES.k26, { mode: "motion-control" }).includes("voices"),
  "voices belong to 2.6's image-to-video mode only");

// --- enums line up with their defaults ---------------------------------------
// A select whose default is not one of its own options renders blank, and the blank is
// what gets sent. The audio and resolution lists move with the mode, so check both modes.
KLING_MODELS.forEach(id => {
  const svc = SERVICES[id];
  [{}, { mode: "motion-control" }].forEach(state => {
    svc.fields.forEach(([n, t, , o]) => {
      if (t !== "select" || (o.when && !o.when(state))) return;
      const opts = o.optsBy ? o.optsBy(state) : o.opts;
      const def = (o.by ? Object.assign({}, o, o.by(state)) : o).def;
      assert(opts.map(String).includes(String(def)),
        `${id}: ${n} default ${def} is not one of ${opts.join("/")}`);
    });
  });
});

// --- what the user asked to see ----------------------------------------------
// The Kling page lists exactly these six, newest first, and opens on the newest.
const navSrc = html.slice(html.indexOf("/* ---------- publisher pages ---------- */"),
                          html.indexOf("const SWITCH"));
const { PUBLISHERS } = eval(navSrc + "\n({ PUBLISHERS })");
assert.deepStrictEqual(PUBLISHERS.pubKling.models.map(m => m[0]), KLING_MODELS);
assert.strictEqual(PUBLISHERS.pubKling.models[0][0], "k30",
  "a first visit must open on their newest model");

console.log(`ok - kling tabs (${KLING_MODELS.length} models, shaping + mode gating)`);
