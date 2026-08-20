// node test_byteplus.js - offline check of the BytePlus ModelArk tabs and of the
// Enhancor kill switch. Two things can go wrong silently here: a body that reaches
// ModelArk in the wrong shape (media has to move out of the form's flat fields and
// into `content`), and an Enhancor tab surviving in the nav after the switch is off.
const fs = require("fs"), assert = require("assert");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const API = "https://apireq.enhancor.ai/api";
const ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ENHANCOR_ON = false;   // mirrors the page
const src = html.slice(html.indexOf("const AREAS"), html.indexOf("const SWITCH"));
const { SERVICES, GROUPS, PUBLISHERS, arkShape } =
  eval(src + "\n({SERVICES, GROUPS, PUBLISHERS, arkShape})");

// --- region ------------------------------------------------------------------
// The account lives in ap-southeast-1 and ModelArk is regional: any other host 404s.
Object.values(SERVICES).filter(s => s.ark || s.arkImage).forEach(s =>
  assert.match(s.ark || s.arkImage, /^https:\/\/ark\.ap-southeast\.bytepluses\.com\/api\/v3\//,
    `${s.title} must call the ap-southeast-1 host`));

// --- model ids ---------------------------------------------------------------
// The id, not the path, is what selects the model, and it carries a release date.
const ids = {
  sd5pro: "dola-seedream-5-0-pro-260628",
  bpsd25: "dreamina-seedance-2-5-260628",
  bpsd20mini: "dreamina-seedance-2-0-mini-260615",
  bpsd20: "dreamina-seedance-2-0-260128",
  bpsd20fast: "dreamina-seedance-2-0-fast-260128",
  bpsd15pro: "seedance-1-5-pro-251215",
};
Object.entries(ids).forEach(([id, model]) =>
  assert.strictEqual(SERVICES[id].model, model, `${id} model id`));

// video tabs queue tasks, the image tab answers synchronously - different endpoints
Object.keys(ids).filter(k => k !== "sd5pro").forEach(k =>
  assert.match(SERVICES[k].ark, /\/contents\/generations\/tasks$/, `${k} endpoint`));
assert.match(SERVICES.sd5pro.arkImage, /\/images\/generations$/);
assert(!SERVICES.sd5pro.ark, "the image tab must not be polled as a task");

// --- request shaping ---------------------------------------------------------
// Flat form fields in, one content array out: every media item typed, and the frames
// tagged with the job they do. An untagged first frame is treated as a loose reference.
const body = {
  prompt: "a cat yawns", first_frame_image: "https://x/a.png", last_frame_image: "https://x/b.png",
  images: ["https://x/1.png", "https://x/2.png"], videos: ["https://x/v.mp4"],
  audios: ["https://x/a.mp3"], resolution: "720p", ratio: "16:9", duration: 8,
};
arkShape(body);
assert.deepStrictEqual(body.content, [
  { type: "text", text: "a cat yawns" },
  { type: "image_url", image_url: { url: "https://x/a.png" }, role: "first_frame" },
  { type: "image_url", image_url: { url: "https://x/b.png" }, role: "last_frame" },
  { type: "image_url", image_url: { url: "https://x/1.png" }, role: "reference_image" },
  { type: "image_url", image_url: { url: "https://x/2.png" }, role: "reference_image" },
  { type: "video_url", video_url: { url: "https://x/v.mp4" }, role: "reference_video" },
  { type: "audio_url", audio_url: { url: "https://x/a.mp3" }, role: "reference_audio" },
]);
// The scalars stay top level, and the fields that became content are gone: sending both
// shapes at once is what makes ModelArk reject the request rather than ignore the extras.
assert.deepStrictEqual(
  Object.keys(body).filter(k => k !== "content").sort(),
  ["duration", "ratio", "resolution"]);

// An empty tab must not ship an empty content array of nothing.
const bare = { prompt: "hello" };
arkShape(bare);
assert.deepStrictEqual(bare.content, [{ type: "text", text: "hello" }]);

// --- results -----------------------------------------------------------------
assert.deepStrictEqual(SERVICES.bpsd20.results({ content: { video_url: "v.mp4" } }), ["v.mp4"]);
assert.deepStrictEqual(SERVICES.bpsd20.results({ content: {} }), [], "nothing to save yet");
assert.deepStrictEqual(SERVICES.sd5pro.results({ data: [{ url: "i.png" }, {}] }), ["i.png"]);

// --- per-model caps ----------------------------------------------------------
const opt = (id, field) => SERVICES[id].fields.find(f => f[0] === field)[3];
const has = (id, field) => SERVICES[id].fields.some(f => f[0] === field);
assert.deepStrictEqual(opt("bpsd20", "resolution").opts, ["480p", "720p", "1080p", "4k"]);
["bpsd20fast", "bpsd20mini", "bpsd25"].forEach(id =>
  assert.deepStrictEqual(opt(id, "resolution").opts, ["480p", "720p"], `${id} tops out at 720p`));
assert.deepStrictEqual(opt("bpsd15pro", "resolution").opts, ["480p", "720p", "1080p"]);
assert.strictEqual(opt("bpsd25", "duration").max, 30, "2.5 runs to 30s");
assert.strictEqual(opt("bpsd25", "duration").min, -1, "-1 is auto, and is what edits require");
assert.strictEqual(opt("bpsd20", "duration").max, 15);
assert.strictEqual(opt("bpsd15pro", "duration").max, 12);
// The 4k caveat belongs to resolution, not to duration.
assert.match(opt("bpsd20", "resolution").hint, /4k/);
assert(!/4k/.test(opt("bpsd20", "duration").hint || ""), "duration hint must not carry it");

// --- fields the model does not accept ----------------------------------------
// 1.5-pro takes a first and an optional last frame and nothing else: reference lists are
// mutually exclusive with the frames on that model, so offering them invites a rejection.
["images", "videos", "audios"].forEach(f =>
  assert(!has("bpsd15pro", f), `1.5-pro has no ${f} input`));
["first_frame_image", "last_frame_image", "prompt", "resolution", "ratio", "duration",
 "generate_audio", "watermark", "seed"].forEach(f =>
  assert(has("bpsd15pro", f), `1.5-pro still needs ${f}`));
// The 2.x models keep the full multimodal envelope.
["bpsd25", "bpsd20", "bpsd20fast", "bpsd20mini"].forEach(id =>
  ["images", "videos", "audios", "first_frame_image"].forEach(f =>
    assert(has(id, f), `${id} needs ${f}`)));

// --- the 1.5-pro A/B pair ----------------------------------------------------
// The two 1.5-pro tabs (ModelArk and fal) are run back to back on identical settings,
// so every shared default has to agree. A silent drift here reads as a model difference.
assert(has("bpsd15pro", "camera_fixed"), "1.5-pro is the tab that carries camera_fixed");
["bpsd25", "bpsd20", "bpsd20fast", "bpsd20mini"].forEach(id =>
  assert(!has(id, "camera_fixed"),
    `${id} has no confirmed camera_fixed - ModelArk ignores unknown fields silently`));
assert.strictEqual(opt("bpsd15pro", "camera_fixed").def, true);
assert.strictEqual(opt("bpsd15pro", "generate_audio").def, false);
["bpsd25", "bpsd20", "bpsd20fast", "bpsd20mini"].forEach(id =>
  assert.strictEqual(opt(id, "generate_audio").def, true, `${id} keeps audio on`));

// --- seedream size -----------------------------------------------------------
// Two rows of chips - aspect ratio, then the three resolutions Seedream documents for it.
// Every one stays inside the ceiling the validator itself quotes: "image area must be at
// most 4624220 pixels", and the ratio is recoverable from the stored "WxH" alone.
const size = opt("sd5pro", "size");
assert.strictEqual(SERVICES.sd5pro.fields.find(f => f[0] === "size")[1], "sizepick");
assert.strictEqual(size.def, "1152x2048");
const all = Object.values(size.opts).flat();
assert.strictEqual(all.length, 12);
assert.strictEqual(new Set(all).size, 12, "a repeated size would make the ratio ambiguous");
assert(all.includes(size.def), "the default must be one of the chips");
Object.entries(size.opts).forEach(([r, list]) => {
  const [a, b] = r.split(":").map(Number);
  list.forEach(o => {
    const [w, h] = o.split("x").map(Number);
    assert(w * h <= 4624220, `${o} is over the pixel cap`);
    assert(Math.abs((w / h) / (a / b) - 1) < 0.01, `${o} is not ${r}`);
  });
});

// Watermark left the form, so it has to be pinned off on the wire instead of defaulting on.
const wm = {};
SERVICES.sd5pro.shape(wm);
assert.strictEqual(wm.watermark, false, "watermark must be sent as false, not left to default");
assert(!SERVICES.sd5pro.fields.some(f => f[0] === "watermark"), "no watermark control on the form");
assert.strictEqual(opt("sd5pro", "output_format").def, "png");

// --- the Enhancor switch -----------------------------------------------------
// Off means unreachable: neither a nav entry nor a model behind a publisher page's
// drop-down may point at a tab that posts to Enhancor.
const navIds = GROUPS.flatMap(g => g.items.flatMap(([id]) =>
  PUBLISHERS[id] ? PUBLISHERS[id].models.map(([m]) => m) : [id]));
navIds.forEach(id => assert(!SERVICES[id].base, `${id} posts to Enhancor and must be hidden`));
assert(!GROUPS.some(g => g.label === "PORTRAIT ENHANCORS"),
  "a group with only Enhancor tabs must drop out of the nav entirely");
assert(GROUPS.some(g => g.label === "GALLERY"), "GALLERY has no items by design and must stay");
// The tabs still exist - this is a switch, not a deletion.
["skin", "portrait", "kora", "seedance25"].forEach(id =>
  assert(SERVICES[id], `${id} must still be defined, ready for ENHANCOR_ON = true`));
Object.keys(ids).forEach(id => assert(navIds.includes(id), `${id} is not reachable from the nav`));
// Every ModelArk video model sits behind the one BytePlus page rather than its own tab.
assert.deepStrictEqual(PUBLISHERS.pubSeedance.models.map(m => m[0]).sort(),
  Object.keys(ids).filter(id => id !== "sd5pro").sort(),
  "the BytePlus page must list every ModelArk video model and nothing else");

console.log(`ok - byteplus tabs (${Object.keys(ids).length} models) + enhancor switch off`);
