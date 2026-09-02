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

const KLING_MODELS = ["k30", "k30omni", "ko1", "k26", "k25t"];
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
// 2.1 Master was dropped ahead of Kling delisting it - nothing may bring the legacy route back.
assert(!SERVICES.k21m, "Kling 2.1 Master must stay gone");

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
  multi_shot: true, resolution: "1080p", duration: 8,
  external_task_id: "job-1",
});
assert.deepStrictEqual(partsOf(b), ["prompt", "first_frame", "last_frame"]);
assert.deepStrictEqual(b.contents[0], { type: "prompt", text: "a woman turns to camera" });
assert.deepStrictEqual(b.contents[1], { type: "first_frame", url: "https://x/a.jpg" });
assert.deepStrictEqual(b.settings,
  { audio: "off", multi_shot: true, resolution: "1080p", duration: 8 });
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

// An empty form must not invent parts or an empty settings block.
b = shape(SERVICES.k25t, {});
assert.deepStrictEqual(b.contents, []);
assert.deepStrictEqual(b.settings, { audio: "off" }, "an empty form still pins audio off");
assert.deepStrictEqual(b.options, { watermark_info: { enabled: false } });

b = shape(SERVICES.k25t, { first_frame: "https://x/a.jpg", duration: "10" });
assert.strictEqual(b.settings.duration, 10);

// --- silent and unwatermarked, on every model, with no control for either ------
// Both platform defaults go the other way: a generated soundtrack on the models that have
// one, and a watermarked copy. So neither can be left out of the body - and neither may
// come back as a form field, because a control here is a control someone eventually flips.
KLING_MODELS.forEach(id => {
  const names = SERVICES[id].fields.map(f => f[0]);
  assert(!names.includes("audio"), `${id} must not offer an audio control`);
  assert(!names.includes("watermark"), `${id} must not offer a watermark control`);
  // A body that tried to ask for either must not reach the wire with it.
  const out = shape(SERVICES[id], { audio: "native", watermark: true });
  assert.strictEqual(out.audio, undefined, `${id} must not pass audio through at the top level`);
  assert.strictEqual(out.watermark, undefined, `${id} must not pass watermark through`);
  assert.deepStrictEqual(out.options.watermark_info, { enabled: false }, `${id} must send watermark_info off`);
  assert.strictEqual(out.settings.audio, "off", `${id} must send audio off`);
});

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
// Voices went with the audio control - they only ever spoke over a native soundtrack,
// so the field could not do anything. Nothing may put it back on a form or on the wire.
KLING_MODELS.forEach(id => {
  assert(!SERVICES[id].fields.some(([n]) => n === "voices"), `${id} must not offer voices`);
  const out = shape(SERVICES[id], { voices: [{ voice_id: "v1", id: "sweet" }] });
  assert(!(out.contents || []).some(p => p.type === "voice"), `${id} must not send a voice part`);
  assert.strictEqual(out.voices, undefined, `${id} must not pass voices through`);
});

// --- enums line up with their defaults ---------------------------------------
// A select whose default is not one of its own options renders blank, and the blank is
// what gets sent. Some lists move with the mode, so check both modes.
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
// House defaults: 10s on every Kling i2v tab (12s on 3.0), not the platform's 5s; 3.0 opens
// single-shot at 720p.
KLING_MODELS.forEach(id => {
  const f = SERVICES[id].fields.find(([n]) => n === "duration");
  assert(f && f[3].def === (id === "k30" ? "12" : "10"), `${id} duration default is off`);
});
assert.strictEqual(SERVICES.k30.fields.find(([n]) => n === "multi_shot")[3].def, false);
assert.strictEqual(SERVICES.k30.fields.find(([n]) => n === "resolution")[3].def, "720p");

// 2.6 and 2.5 Turbo only take a last frame at 1080p: once one is set the resolution select
// narrows to 1080p and its default moves with it, so a carried 720p is replaced rather than
// sent. The last-frame field has to re-render the form for that to take effect.
["k26", "k25t"].forEach(id => {
  const res = SERVICES[id].fields.find(([n]) => n === "resolution")[3];
  const tail = SERVICES[id].fields.find(([n]) => n === "last_frame")[3];
  assert.deepStrictEqual(res.optsBy({}), ["720p", "1080p"], `${id}: no last frame, free choice`);
  assert.deepStrictEqual(res.optsBy({ last_frame: "https://x/b.jpg" }), ["1080p"], `${id}: last frame locks 1080p`);
  assert.strictEqual(res.by({ last_frame: "https://x/b.jpg" }).def, "1080p", `${id}: default must follow the lock`);
  assert.strictEqual(res.by({}).def, undefined, `${id}: static default stands without a last frame`);
  assert(tail.rerender, `${id}: last_frame must re-render the form`);
  assert(res.hint && /1080p/.test(res.hint), `${id}: the resolution hint must say so`);
});

// The Kling page lists exactly these five, newest first, and opens on the newest.
const navSrc = html.slice(html.indexOf("/* ---------- publisher pages ---------- */"),
                          html.indexOf("const SWITCH"));
const { PUBLISHERS } = eval(navSrc + "\n({ PUBLISHERS })");
assert.deepStrictEqual(PUBLISHERS.pubKling.models.map(m => m[0]), KLING_MODELS);
assert.strictEqual(PUBLISHERS.pubKling.models[0][0], "k30",
  "a first visit must open on their newest model");

console.log(`ok - kling tabs (${KLING_MODELS.length} models, shaping + mode gating)`);
