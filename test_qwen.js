// node test_qwen.js - offline check of the QwenCloud tabs.
// qwenShape() is the only place a flat form turns into DashScope's input / parameters
// envelope, and a knob that lands in `input` (or an input in `parameters`) is not a
// validation error on their side, it is a silently ignored field. The image tab also has
// two wire-level rewrites of its own - "WxH" to "W*H", and agent mode dropped once an
// image is in play - that nothing else exercises.
const fs = require("fs"), assert = require("assert");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const API = "https://apireq.enhancor.ai/api";
const ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const ENHANCOR_ON = false;   // mirrors the page
const src = html.slice(html.indexOf("const AREAS"), html.indexOf("const GROUPS"));
const { SERVICES, PUBLISHERS, ALL_GROUPS } = eval(src + "\n({ SERVICES, PUBLISHERS, ALL_GROUPS })");

const shape = (svc, body) => { const b = Object.assign({}, body); svc.shape(b); return b; };
const img = SERVICES.qwenimg30pro, vid = SERVICES.wan30, prime = SERVICES.wan30prime;
const shown = (svc, state) => svc.fields.filter(([n, t, l, o]) => !o.when || o.when(state)).map(f => f[0]);

// --- transport -----------------------------------------------------------------
// Both paths are relative: the page prefixes the QwenCloud host, and the proxy picks the
// key by that host - an absolute URL here would bypass that.
assert.strictEqual(img.qwenImage, "/services/aigc/multimodal-generation/generation");
assert.strictEqual(vid.qwen, "/services/aigc/video-generation/video-synthesis");
assert.strictEqual(img.model, "qwen-image-3.0-pro");
assert.strictEqual(vid.model, "wan3.0-video");
// prime: same route, same form, different model id - and its own output name.
assert.strictEqual(prime.qwen, vid.qwen);
assert.strictEqual(prime.model, "wan3.0-video-prime");
assert.strictEqual(prime.fields, vid.fields);
assert.strictEqual(prime.shape, vid.shape);
[img, vid, prime].forEach(s => {
  assert(!s.base && !s.fal && !s.ark && !s.arkImage && !s.kling, "one transport only");
  assert(s.abbr, "needs an output abbreviation");
});
const abbrs = Object.values(SERVICES).map(s => typeof s.abbr === "function" ? s.abbr({}) : s.abbr);
[img, vid, prime].forEach(s =>
  assert.strictEqual(abbrs.filter(a => a === s.abbr).length, 1, `${s.model} abbr must be unique`));

// --- image: flat form -> messages / parameters -----------------------------------
let b = shape(img, { prompt: "a menu", size: "1152x2048", n: 2, negative_prompt: "blur",
                     prompt_extend: true, prompt_extend_mode: "agent", enable_thinking: false,
                     seed: 7, watermark: false });
assert.deepStrictEqual(Object.keys(b).sort(), ["input", "parameters"]);
assert.deepStrictEqual(b.input, { messages: [{ role: "user", content: [{ text: "a menu" }] }] });
assert.deepStrictEqual(b.parameters, { size: "1152*2048", n: 2, negative_prompt: "blur",
  prompt_extend: true, prompt_extend_mode: "agent", enable_thinking: false, seed: 7, watermark: false });

// Reference images ride as {image} parts after the text, and force agent -> direct.
b = shape(img, { prompt: "swap the hat", image: ["https://x/a.jpg", "https://x/b.jpg"],
                 size: "1024x1024", prompt_extend_mode: "agent" });
assert.deepStrictEqual(b.input.messages[0].content,
  [{ text: "swap the hat" }, { image: "https://x/a.jpg" }, { image: "https://x/b.jpg" }]);
assert.strictEqual(b.parameters.prompt_extend_mode, "direct");
assert.strictEqual(b.parameters.size, "1024*1024");

// Blank and absent knobs stay off the wire - a "" seed is not seed 0.
b = shape(img, { prompt: "x", seed: "" });
assert.deepStrictEqual(b.parameters, {});

// Thinking requires prompt_extend, and the rewrite mode is moot without it: both fold away
// when the rewrite is off, so neither reaches the body.
assert(shown(img, { prompt_extend: true }).includes("enable_thinking"));
assert(shown(img, { prompt_extend: true }).includes("prompt_extend_mode"));
assert(!shown(img, { prompt_extend: false }).includes("enable_thinking"));
assert(!shown(img, { prompt_extend: false }).includes("prompt_extend_mode"));
assert(img.fields.find(f => f[0] === "prompt_extend")[3].rerender, "the gate has to redraw the form");

// Every chip is a legal size: 512x512 to 2048x2048 of area, and a multiple of 16.
const sizes = img.fields.find(f => f[0] === "size")[3].opts;
Object.values(sizes).flat().forEach(v => {
  const [w, h] = v.split("x").map(Number);
  assert(w * h >= 512 * 512 && w * h <= 2048 * 2048 && w <= 2048 && h <= 2048, v);
  assert(w % 16 === 0 && h % 16 === 0, v + " not a multiple of 16");
});
assert(sizes["9:16"].includes(img.fields.find(f => f[0] === "size")[3].def), "default must be a chip");

// Results: n > 1 may come back as several choices or several parts - both are read.
assert.deepStrictEqual(img.results({ output: { choices: [
  { message: { content: [{ image: "https://r/1.png" }, { image: "https://r/2.png" }] } },
  { message: { content: [{ text: "ignored" }, { image: "https://r/3.png" }] } },
] } }), ["https://r/1.png", "https://r/2.png", "https://r/3.png"]);
assert.deepStrictEqual(img.results({}), []);

// --- video: mode gate ------------------------------------------------------------
// Frames and references cannot share a request, so the form never offers both sides.
const FRAME_IN = ["first_frame", "last_frame"];
const REF_IN = ["reference_image", "reference_video", "reference_audio", "file", "link"];
const modeOpts = vid.fields.find(f => f[0] === "mode")[3];
assert.deepStrictEqual(modeOpts.opts, ["text-to-video", "frame-to-video", "reference-to-video"]);
assert(modeOpts.rerender);
let on = shown(vid, { mode: "frame-to-video" });
assert(FRAME_IN.every(n => on.includes(n)) && !REF_IN.some(n => on.includes(n)), "frame mode shows frames only");
on = shown(vid, { mode: "reference-to-video" });
assert(REF_IN.every(n => on.includes(n)) && !FRAME_IN.some(n => on.includes(n)), "reference mode shows references only");
on = shown(vid, { mode: "text-to-video" });
assert(![...FRAME_IN, ...REF_IN].some(n => on.includes(n)), "text mode shows no media input");
// The knobs are there in every mode.
["resolution", "ratio", "duration", "audio", "prompt_extend", "seed", "watermark"].forEach(n =>
  [ "text-to-video", "frame-to-video", "reference-to-video"].forEach(m =>
    assert(shown(vid, { mode: m }).includes(n), `${n} missing in ${m}`)));

// adaptive is only offered when there is an input to adapt to, and is then the default;
// smart duration is the default for references, since edits keep the clip's own length.
const ratio = vid.fields.find(f => f[0] === "ratio")[3];
assert.deepStrictEqual(ratio.optsBy({ mode: "text-to-video" }), ["16:9", "4:3", "1:1", "3:4", "9:16"]);
assert.deepStrictEqual(ratio.optsBy({ mode: "frame-to-video" }), ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]);
// A fresh form seeds off the static def, so that is the one that has to be adaptive; text
// mode needs its own, or a carried adaptive would be replaced by a value not in the list.
assert.strictEqual(ratio.def, "adaptive");
assert.strictEqual(ratio.by({ mode: "frame-to-video" }).def, undefined);
assert.strictEqual(ratio.by({ mode: "text-to-video" }).def, "9:16");
assert(ratio.optsBy({ mode: "text-to-video" }).includes(ratio.by({ mode: "text-to-video" }).def));
const dur = vid.fields.find(f => f[0] === "duration")[3];
assert.strictEqual(dur.by({ mode: "reference-to-video" }).def, -1);
assert.strictEqual(dur.by({ mode: "frame-to-video" }).def, 5);
assert.strictEqual(dur.min, -1); assert.strictEqual(dur.max, 30);

// --- video: flat form -> input.media / parameters --------------------------------
b = shape(vid, { mode: "frame-to-video", prompt: "she turns", first_frame: "https://x/f.jpg",
                 last_frame: "https://x/l.jpg", resolution: "720P", ratio: "9:16", duration: 5,
                 audio: true, prompt_extend: true, seed: 3, watermark: false });
// `mode` is the form's own switch, never a wire field.
assert.deepStrictEqual(b, {
  input: { prompt: "she turns",
           media: [{ type: "first_frame", url: "https://x/f.jpg" }, { type: "last_frame", url: "https://x/l.jpg" }] },
  parameters: { resolution: "720P", ratio: "9:16", duration: 5, audio: true, prompt_extend: true, seed: 3, watermark: false },
});

// Reference lists keep the form's order, since that order is the numbering the prompt uses.
b = shape(vid, { reference_image: ["https://x/1.jpg", "https://x/2.jpg"], reference_video: ["https://x/v.mp4"],
                 reference_audio: ["https://x/a.mp3"], file: "https://x/d.pdf", link: "https://example.com",
                 duration: -1 });
// A document and a web page are one or the other - the document wins.
assert.deepStrictEqual(b.input.media.map(m => m.type),
  ["reference_image", "reference_image", "reference_video", "reference_audio", "file"]);
assert.deepStrictEqual(shape(vid, { link: "https://example.com" }).input.media, [{ type: "link", url: "https://example.com" }]);
assert.strictEqual(b.input.prompt, undefined, "no prompt key when the box is empty");
assert.strictEqual(b.parameters.duration, -1, "-1 is smart duration, not a blank");

// A blank form sends an empty input - the API's own "prompt or media" error is the right one.
b = shape(vid, {});
assert.deepStrictEqual(b, { input: {}, parameters: {} });

// Enums match the reference: their casing is upper-case P, unlike every other tab here.
const opt = (svc, n) => svc.fields.find(f => f[0] === n)[3].opts;
assert.deepStrictEqual(opt(vid, "resolution"), ["480P", "720P", "1080P"]);

// --- nav -----------------------------------------------------------------------
// One publisher, two pages, each in the group whose post-gen row it needs.
assert.deepStrictEqual(PUBLISHERS.pubQwenImage.models, [["qwenimg30pro", "Qwen-Image-3.0-Pro"]]);
assert.deepStrictEqual(PUBLISHERS.pubQwenVideo.models.map(m => m[0]), ["wan30", "wan30prime"]);
assert.strictEqual(PUBLISHERS.pubQwenVideo.models[0][0], "wan30", "the standard model opens first - prime is twice the price");
const group = id => ALL_GROUPS.find(g => g.items.some(([n]) => n === id)).label;
assert.strictEqual(group("pubQwenImage"), "IMAGE EDITORS");
assert.strictEqual(group("pubQwenVideo"), "VIDEO GENERATORS");
// Both pages open on the default, and both prompts get the library (a plain textarea).
[img, vid, prime].forEach(s => assert.strictEqual(s.fields.find(f => f[0] === "prompt")[1], "textarea"));

console.log("test_qwen.js: ok");
