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
const REF_IN = ["reference_image", "reference_video"];
const modeOpts = vid.fields.find(f => f[0] === "mode")[3];
assert.deepStrictEqual(modeOpts.opts, ["text-to-video", "frame-to-video", "reference-to-video"]);
assert(modeOpts.rerender);
assert.strictEqual(modeOpts.def, "reference-to-video");
assert.strictEqual(vid.fields.find(f => f[0] === "resolution")[3].def, "1080P");
["reference_audio", "file", "link", "watermark", "audio", "prompt_extend"].forEach(n =>
  assert(!vid.fields.some(f => f[0] === n), `${n} removed from form`));
let on = shown(vid, { mode: "frame-to-video" });
assert(FRAME_IN.every(n => on.includes(n)) && !REF_IN.some(n => on.includes(n)), "frame mode shows frames only");
on = shown(vid, { mode: "reference-to-video" });
assert(REF_IN.every(n => on.includes(n)) && !FRAME_IN.some(n => on.includes(n)), "reference mode shows references only");
on = shown(vid, { mode: "text-to-video" });
assert(![...FRAME_IN, ...REF_IN].some(n => on.includes(n)), "text mode shows no media input");
// The knobs are there in every mode.
["resolution", "ratio", "seed"].forEach(n =>
  [ "text-to-video", "frame-to-video", "reference-to-video"].forEach(m =>
    assert(shown(vid, { mode: m }).includes(n), `${n} missing in ${m}`)));

// Vertical by default in all modes; adaptive remains an optional choice with inputs.
const ratio = vid.fields.find(f => f[0] === "ratio")[3];
assert.strictEqual(ratio.def, "9:16");
assert(!ratio.optsBy({ mode: "text-to-video" }).includes("adaptive"));
assert(ratio.optsBy({ mode: "reference-to-video" }).includes("adaptive"));
assert(!shown(vid, { mode: "reference-to-video" }).includes("duration"));
assert(shown(vid, { mode: "frame-to-video" }).includes("duration"));
assert.strictEqual(vid.fields.find(f => f[0] === "duration")[3].def, 5);

// --- video: flat form -> input.media / parameters --------------------------------
b = shape(vid, { mode: "frame-to-video", prompt: "she turns", first_frame: "https://x/f.jpg",
                 last_frame: "https://x/l.jpg", resolution: "720P", ratio: "9:16", duration: 5,
                 audio: true, prompt_extend: true, seed: 3, watermark: false });
// `mode` is the form's own switch, never a wire field.
assert.deepStrictEqual(b, {
  input: { prompt: "she turns",
           media: [{ type: "first_frame", url: "https://x/f.jpg" }, { type: "last_frame", url: "https://x/l.jpg" }] },
  parameters: { resolution: "720P", ratio: "9:16", duration: 5, audio: false, prompt_extend: false, seed: 3, watermark: false },
});

// Reference lists keep the form's order, since that order is the numbering the prompt uses.
b = shape(vid, { reference_image: ["https://x/1.jpg", "https://x/2.jpg"], reference_video: ["https://x/v.mp4"],
                 reference_audio: ["https://x/a.mp3"], file: "https://x/d.pdf", link: "https://example.com",
                 duration: -1 });
// Removed media are ignored even if supplied by stale state.
assert.deepStrictEqual(b.input.media.map(m => m.type),
  ["reference_image", "reference_image", "reference_video"]);
assert.strictEqual(shape(vid, { link: "https://example.com" }).input.media, undefined);
assert.strictEqual(b.input.prompt, undefined, "no prompt key when the box is empty");
assert.strictEqual(b.parameters.duration, -1, "-1 is smart duration, not a blank");

// A blank form sends an empty input - the API's own "prompt or media" error is the right one.
b = shape(vid, {});
assert.deepStrictEqual(b, { input: {}, parameters: { audio: false, prompt_extend: false, watermark: false } });

// Enums match the reference: their casing is upper-case P, unlike every other tab here.
const opt = (svc, n) => svc.fields.find(f => f[0] === n)[3].opts;
assert.deepStrictEqual(opt(vid, "resolution"), ["480P", "720P", "1080P"]);

// --- nav -----------------------------------------------------------------------
// One publisher, two pages, each in the group whose post-gen row it needs.
assert.deepStrictEqual(PUBLISHERS.pubQwenImage.models.map(m => m[0]), ["qwenimg30pro", "qwenimg21pro", "qwenimg21turbo"]);
assert.deepStrictEqual(PUBLISHERS.pubQwenVideo.models.map(m => m[0]), ["wan30prime", "wan30"]);
assert.strictEqual(PUBLISHERS.pubQwenVideo.models[0][0], "wan30prime", "fast model opens by default");
const group = id => ALL_GROUPS.find(g => g.items.some(([n]) => n === id)).label;
assert.strictEqual(group("pubQwenImage"), "IMAGE EDITORS");
assert.strictEqual(group("pubQwenVideo"), "VIDEO GENERATORS");
// Both pages open on the default, and both prompts get the library (a plain textarea).
[img, vid, prime].forEach(s => assert.strictEqual(s.fields.find(f => f[0] === "prompt")[1], "textarea"));

// Existing users also open on Prime, while the standard option still works on selection.
const renderPublisher = new Function("PUBLISHERS", "localStorage", "document", "pane", "esc", "renderService",
  "let FORM_HOST;\n" + html.slice(html.indexOf("function renderPublisher(pid){"), html.indexOf("function render(id){")) + "\nreturn renderPublisher;");
for (const saved of [null, "wan30", "wan30prime", "retired"]){
  const elements = [], opened = [], store = { "pubModel:pubQwenVideo": saved };
  renderPublisher(PUBLISHERS, { getItem:k=>store[k], setItem:(k,v)=>{store[k]=v;} },
    { createElement:tag=>{const e={tag,append(){},appendChild(){}}; elements.push(e); return e;} },
    {appendChild(){}}, s=>s, id=>opened.push(id))("pubQwenVideo");
  assert.deepStrictEqual(opened, ["wan30prime"]);
  const picker=elements.find(e=>e.tag === "select");
  picker.value="wan30"; picker.onchange();
  assert.deepStrictEqual(opened, ["wan30prime", "wan30"]);
}

// Exercise metadata success, failure, cleanup and timeouts without provider requests.
(async () => {
  let duration = 7.2, fail = false, cleaned = 0, src, timerCallback;
  global.blobUrl = url => "/api/blob?url=" + encodeURIComponent(url);
  const realSetTimeout = global.setTimeout;
  global.setTimeout = fn => { timerCallback = fn; return 1; };
  global.document = { createElement: tag => {
    assert.strictEqual(tag, "video");
    return {
      duration,
      set src(url) { src = url; queueMicrotask(() => {
        if (fail === "timeout") timerCallback();
        else if (fail) this.onerror(); else this.onloadedmetadata();
      }); },
      removeAttribute: key => { assert.strictEqual(key, "src"); cleaned++; },
      load() {},
    };
  }};
  try {
    for (const svc of [vid, prime]) {
      const body = { mode: "reference-to-video", reference_video: ["https://x/v.mp4", "https://x/second.mp4"], duration: 30 };
      await svc.prep(body);
      assert.strictEqual(body.duration, 8);
      assert(src.includes(encodeURIComponent("https://x/v.mp4")));
      assert.strictEqual(shape(svc, body).parameters.duration, 8);
    }
    for (const [seconds, expected] of [[1, 2], [8, 8], [15, 15]]) {
      duration = seconds;
      const body = { mode: "reference-to-video", reference_video: ["https://x/v.mp4"] };
      await vid.prep(body); assert.strictEqual(body.duration, expected);
    }
    for (const seconds of [NaN, Infinity, 0, 0.5, 15.1]) {
      duration = seconds;
      await assert.rejects(vid.prep({ mode: "reference-to-video", reference_video: ["https://x/v.mp4"] }));
    }
    for (const failure of [true, "timeout"]) {
      fail = failure;
      await assert.rejects(vid.prep({ mode: "reference-to-video", reference_video: ["https://x/v.mp4"] }));
    }
    const noVideo = { mode: "reference-to-video" }; await vid.prep(noVideo);
    assert.strictEqual(noVideo.duration, -1);
    const frames = { mode: "frame-to-video", duration: 5 }; await vid.prep(frames);
    assert.strictEqual(frames.duration, 5);
    assert.strictEqual(cleaned, 12, "metadata resources cleaned on success and failure");
  } finally { global.setTimeout = realSetTimeout; }
  console.log("test_qwen.js: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
