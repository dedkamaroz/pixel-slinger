// node test_video_fields.js - offline check of the video tab's field gating.
// The gates are what keep an illegal payload off the wire (products on a text-to-video,
// duration on multi_frame), so they get a test; the rest of the page does not.
const fs = require("fs"), assert = require("assert");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
// end anchor must be unique in the file - the nav's comment banner also appears in the CSS
const src = html.slice(html.indexOf("const AREAS"), html.indexOf("const GROUPS"));
const API = "https://apireq.enhancor.ai/api";
const ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const SERVICES = eval(src + "\nSERVICES");

const svc = SERVICES.seedance;
assert.match(svc.base, /enhancor-video-pro\/v1$/, "video tab must target the documented path");

// Names of the fields the form would show for this state, i.e. what gets sent.
const shown = state => svc.fields.filter(([n, t, l, o]) => !o.when || o.when(state)).map(f => f[0]);
const spec = name => svc.fields.find(f => f[0] === name)[3];

const t2v = shown({ type: "text-to-video" });
assert(!t2v.includes("mode"), "mode is image-to-video only");
["images", "videos", "audios", "products", "first_frame_image"].forEach(f =>
  assert(!t2v.includes(f), `${f} must be hidden for text-to-video`));
assert(t2v.includes("prompt") && t2v.includes("duration"));

const ugc = shown({ type: "image-to-video", mode: "ugc" });
["products", "influencers", "prompt", "duration"].forEach(f => assert(ugc.includes(f), `ugc needs ${f}`));
assert(!ugc.includes("images"), "images is not supported in ugc mode");
assert(!ugc.includes("first_frame_image"), "ugc is not a frame mode");

const mf = shown({ type: "image-to-video", mode: "multi_frame" });
assert(mf.includes("multi_frame_prompts"), "multi_frame needs its prompt list");
["prompt", "duration"].forEach(f => assert(!mf.includes(f), `${f} is derived in multi_frame`));

const fnl = shown({ type: "image-to-video", mode: "first_n_last_frames" });
assert(fnl.includes("first_frame_image") && fnl.includes("last_frame_image"));
assert(!fnl.includes("lipsyncing_audio"));

["lipsyncing", "voice_clone"].forEach(m =>
  assert(shown({ type: "image-to-video", mode: m }).includes("lipsyncing_audio"), `${m} needs audio`));

// Enumerations, as the live validator reports them.
assert.deepStrictEqual(spec("resolution").opts, ["480p", "720p", "1080p", "4k"]);
assert.deepStrictEqual(spec("aspect_ratio").opts.slice().sort(),
  ["16:9", "1:1", "21:9", "3:4", "4:3", "9:16"]);
assert.deepStrictEqual(spec("mode").opts.slice().sort(),
  ["extend", "first_n_last_frames", "lipsyncing", "multi_frame", "multi_reference", "ugc", "voice_clone"]);
assert.strictEqual(spec("fast_mode").def, false, "1080p/4k need fast_mode off, so default it off");

// House defaults, not their doc's defaults - vertical, 720p, 12s.
assert.strictEqual(spec("aspect_ratio").def, "9:16");
assert.strictEqual(spec("resolution").def, "720p");
assert.strictEqual(spec("duration").def, 12);
assert(spec("duration").max >= 12 && spec("duration").min <= 12, "default must sit inside the range");

/* ---- the four newer video endpoints, enums read off their live validators ---- */
const shownOf = (s, state) => s.fields.filter(([n, t, l, o]) => !o.when || o.when(state)).map(f => f[0]);
const specOf = (s, name) => s.fields.find(f => f[0] === name)[3];

// Seedance 2.5: mode alone drives the workflow, there is no `type` field.
const sd = SERVICES.seedance25;
assert.match(sd.base, /seedance2\.5\/v1$/);
assert(!sd.fields.some(f => f[0] === "type"), "seedance2.5 has no type field");
assert.deepStrictEqual(specOf(sd, "resolution").opts, ["480p", "720p"]);
assert.deepStrictEqual(specOf(sd, "mode").opts.slice().sort(), ["edit", "extend", "first_n_last_frames",
  "lipsyncing", "multi_frame", "multi_reference", "text_to_video", "ugc", "voice_clone"]);

const t2v25 = shownOf(sd, { mode: "text_to_video" });
["images", "videos", "audios", "first_frame_image", "products", "lipsyncing_audio"].forEach(f =>
  assert(!t2v25.includes(f), `${f} must be hidden for text_to_video`));
assert(shownOf(sd, { mode: "edit" }).includes("videos"), "edit needs a source video");
assert(!shownOf(sd, { mode: "multi_frame" }).includes("duration"), "multi_frame duration is derived");
assert(shownOf(sd, { mode: "ugc" }).includes("products") && !shownOf(sd, { mode: "ugc" }).includes("videos"));
// edit is fixed at -1; pinning the range is what makes the renderer clamp a carried-over value.
assert.strictEqual(specOf(sd, "duration").by({ mode: "edit" }).max, -1);
assert.strictEqual(specOf(sd, "duration").by({ mode: "edit" }).def, -1);
assert.strictEqual(specOf(sd, "duration").by({ mode: "multi_reference" }).max, 30, "2.5 goes to 30s");
assert.deepStrictEqual(specOf(sd, "aspect_ratio").optsBy({ mode: "edit" }), ["adaptive"], "edit forces adaptive");
// A narrowed option list needs a default inside it, or the select renders blank: the
// renderer only replaces a stale value with o.def, it never falls back to opts[0].
["edit", "extend", "first_n_last_frames", "multi_reference", "text_to_video"].forEach(mode => {
  const ar = specOf(sd, "aspect_ratio");
  const o = Object.assign({}, ar, ar.by(({ mode })));
  assert(ar.optsBy({ mode }).includes(o.def), `${mode} aspect ratio default must be selectable`);
});

// MiniMax H3: type + mode, and its own resolution set.
const mm = SERVICES.minimax;
assert.match(mm.base, /minimax-h3\/v1$/);
assert.deepStrictEqual(specOf(mm, "resolution").opts, ["768p", "2k"]);
assert.deepStrictEqual(specOf(mm, "mode").opts, ["multi_reference", "first_n_last_frames"]);
assert(!shownOf(mm, { type: "text-to-video" }).includes("mode"), "mode is image-to-video only");
assert(!shownOf(mm, { type: "text-to-video" }).includes("images"));
assert(shownOf(mm, { type: "image-to-video", mode: "first_n_last_frames" }).includes("first_frame_image"));
assert(!shownOf(mm, { type: "image-to-video", mode: "first_n_last_frames" }).includes("images"));

// Seed Mini: type only, no mode at all.
const sm = SERVICES.seedmini;
assert.match(sm.base, /seed-mini\/v1$/);
assert(!sm.fields.some(f => f[0] === "mode"), "seed-mini has no mode field");
assert.deepStrictEqual(specOf(sm, "resolution").opts, ["480p", "720p"]);
const t2vSm = shownOf(sm, { type: "text-to-video" });
["images", "videos", "audios", "first_frame_image", "last_frame_image"].forEach(f =>
  assert(!t2vSm.includes(f), `${f} is rejected outright on a seed-mini text-to-video`));

// Kling 3: multi-shot swaps the prompt and duration for a shot list.
const kl = SERVICES.klingv3;
assert.match(kl.base, /kling-v3\/v1$/);
assert.deepStrictEqual(specOf(kl, "mode").opts, ["pro", "standard"]);
assert.deepStrictEqual(specOf(kl, "aspect_ratio").opts, ["16:9", "9:16", "1:1"]);
const ms = shownOf(kl, { multi_shots: true });
assert(ms.includes("multi_prompt"), "multi-shot needs the shot list");
["prompt", "duration"].forEach(f => assert(!ms.includes(f), `${f} is unused in multi-shot mode`));
const ss = shownOf(kl, { multi_shots: false });
assert(ss.includes("prompt") && ss.includes("duration") && !ss.includes("multi_prompt"));
assert.strictEqual(specOf(kl, "duration").min, 3, "kling floor is 3s, not 4s");
assert.strictEqual(specOf(kl, "kling_elements").def, "", "empty elements must not be sent");

// Every video tab names its own output file, or renders overwrite each other.
const abbrs = ["seedance", "seedance25", "minimax", "seedmini", "klingv3"]
  .map(k => SERVICES[k].abbr).map(a => typeof a === "function" ? a({ mode: "pro" }) : a);
assert.strictEqual(new Set(abbrs).size, abbrs.length, "output abbreviations must be unique");

// "Clear inputs" deletes every file/files value from the state, so any default on one of
// those fields would be re-seeded on the next render and the upload would come back.
Object.entries(SERVICES).forEach(([id, s]) =>
  s.fields.filter(([n, t]) => t === "file" || t === "files").forEach(([n, t, l, o]) =>
    assert.strictEqual(o.def, undefined, `${id}.${n} must not have a default - clear would undo itself`)));

console.log("ok - video field gating");
