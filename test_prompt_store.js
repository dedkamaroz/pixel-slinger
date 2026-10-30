// node test_prompt_store.js - offline check of the per-model prompt library.
// The store is the only thing in the page that persists user data, so a wrong id match in
// edit/delete silently overwrites or removes the wrong prompt. Ordering matters too: the
// picker's top entry is what a tab loads on open.
const fs = require("fs"), assert = require("assert");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");

// Fake the two globals the store block touches. localStorage is the real contract here.
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

// wrapped in a function, or eval's declarations land in this scope and collide
const { pList, pAdd, pSet, pDel, pVideo, pLoadVideo, pVideoFields, pPrepareVideos, promptBar } =
  eval("(function(){" + html.slice(html.indexOf("const PSEL"), html.indexOf("/* ---------- service form")) +
    "\nreturn { pList, pAdd, pSet, pDel, pVideo, pLoadVideo, pVideoFields, pPrepareVideos, promptBar };})")();

// --- ordering ----------------------------------------------------------------
assert.deepStrictEqual(pList("skin"), [], "an untouched model has no prompts");

const a = pAdd("kora", "First", "body one");
const b = pAdd("kora", "Second", "body two");
assert.notStrictEqual(a, b, "two prompts saved in the same millisecond must not share an id");
assert.deepStrictEqual(pList("kora").map(p => p.title), ["Second", "First"],
  "newest first - the top entry is what the tab loads on open");

// --- isolation between models ------------------------------------------------
pAdd("seedance", "Video prompt", "v");
assert.deepStrictEqual(pList("seedance").map(p => p.title), ["Video prompt"]);
assert.strictEqual(pList("kora").length, 2, "one model's prompts must not leak into another");

// --- edit --------------------------------------------------------------------
pSet("kora", a, "First renamed", "body one edited");
const edited = pList("kora").find(p => p.id === a);
assert.strictEqual(edited.title, "First renamed");
assert.strictEqual(edited.body, "body one edited");
assert.strictEqual(pList("kora").find(p => p.id === b).body, "body two",
  "editing one prompt must leave its siblings alone");

// --- delete ------------------------------------------------------------------
pDel("kora", a);
assert.deepStrictEqual(pList("kora").map(p => p.id), [b], "only the named prompt is removed");
pDel("kora", b);
assert.deepStrictEqual(pList("kora"), []);

// corrupt payload (hand-edited storage, older format) must not blank the whole tab
store["prompts:kora"] = "{not json";
assert.deepStrictEqual(pList("kora"), [], "unparseable storage reads as empty, not a throw");

// --- coverage: the library is keyed on the field, not on a list of models -----
// renderService attaches the picker and the counter to any field literally named `prompt`,
// so a model added later inherits both. Guard that hook and the field name together.
assert(/if \(name === "prompt"\)\{/.test(html),
  "the prompt library must stay hooked on the field name, or new models miss out");

const API = "https://apireq.enhancor.ai/api";
const ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const SERVICES = eval(html.slice(html.indexOf("const AREAS"), html.indexOf("const GROUPS")) + "\nSERVICES");
const withPrompt = Object.entries(SERVICES)
  .filter(([, s]) => s.fields.some(([n, t]) => n === "prompt" && t === "textarea"))
  .map(([id]) => id);
["seedream5edit", "flux3edit", "fiboexpand", "imgeditor", "kora", "seedance", "seedance25",
 "minimax", "seedmini", "klingv3", "seedance15fal", "kling26fal", "kling25tfal",
 "k30", "k30omni", "ko1", "k26", "k25t"]
  .forEach(id => assert(withPrompt.includes(id), `${id} should get the prompt library`));
// A prompt field typed as anything but textarea would render without the bar.
Object.entries(SERVICES).forEach(([id, s]) => s.fields.forEach(([n, t]) => {
  if (n === "prompt") assert.strictEqual(t, "textarea", `${id}: prompt must be a textarea`);
}));

console.log(`ok - prompt store (${withPrompt.length} models carry a prompt library)`);

const svc = SERVICES.k30;
const state = {mode:"motion-control", video:"/video_reference/1.mp4"};
const video = pVideo(svc, state);
assert.deepStrictEqual(video, {name:"1.mp4", field:"video", mode:{mode:"motion-control"}});
const pid = pAdd("k30", "Motion", "move", "negative", video);
assert.deepStrictEqual(pList("k30")[0].video, video);
const loaded = {mode:"image-to-video"};
pLoadVideo(svc, loaded, pList("k30")[0]);
assert.strictEqual(loaded.mode, "motion-control");
assert.strictEqual(loaded.video, "/video_reference/1.mp4");
assert.strictEqual(pVideoFields(svc, loaded).length, 1);
assert.strictEqual(pVideoFields(svc, {mode:"image-to-video"}).length, 0);
pSet("k30", pid, "No video", "text", "negative");
assert(!("video" in pList("k30")[0]), "Edit can remove the optional video");
pLoadVideo(svc, loaded, pList("k30")[0]);
assert(!loaded.video, "loading a text-only preset clears a previous library video");
assert.strictEqual(pVideo(svc, {mode:"motion-control", video:"https://example.com/1.mp4"}), undefined);
const plural = {videos:["/video_reference/2.mov"]};
const pluralVideo = pVideo(SERVICES.bpsd20, plural);
assert(pluralVideo, "multi-video inputs support a saved file");
assert.strictEqual(pVideo(SERVICES.bpsd20, {videos:["https://cdn.example/manual.mp4", ...plural.videos]}).name,
  "2.mov", "manual URL ordering must not lose the saved-video association");
const restored = {};
pLoadVideo(SERVICES.bpsd20, restored, {video:pluralVideo});
assert.deepStrictEqual(restored.videos, plural.videos);
assert(!pVideoFields(SERVICES.imgeditor, {}).length, "image editors have no saved-video picker");
pLoadVideo(svc, loaded, {video:{name:"../secret",field:"video",mode:{mode:"motion-control"}}});
assert(!loaded.video, "invalid filenames are ignored");
let videoModes=0;
for (const model of Object.values(SERVICES)){
  let variants=[Object.fromEntries(model.fields.filter(f=>f[3].def!==undefined).map(f=>[f[0],f[3].def]))];
  for (const [key,type,,o] of model.fields){
    if (type==="select" && ["type","mode","task"].includes(key) && o.opts)
      variants=variants.flatMap(s=>o.opts.map(value=>({...s,[key]:value})));
  }
  for (const variant of variants) for (const [field,type] of pVideoFields(model,variant)){
    const selected={...variant,[field]:type==="files"?["/video_reference/1.mp4"]:"/video_reference/1.mp4"};
    const record=pVideo(model,selected), target={};
    assert(record, `${model.title}: video profile should be detectable`);
    pLoadVideo(model,target,{video:record});
    assert.deepStrictEqual(target[field],selected[field],`${model.title}: mode and video round trip`);
    videoModes++;
  }
}
console.log(`ok - video field/mode round trips (${videoModes} combinations across all services)`);
console.log("ok - optional video presets, modes, plural fields and legacy prompts");

(async () => {
  const calls = [];
  global.post = async (path, data) => {
    calls.push([path,data]);
    return {url:"https://tunnel.example/files/staged_" + data.name, reachable:true};
  };
  const form = {videos:["/video_reference/2.mov", "https://cdn.example/other.mp4"]};
  const body = {...form};
  await pPrepareVideos(SERVICES.bpsd20, body);
  assert.deepStrictEqual(calls, [["/api/video-reference", {name:"2.mov"}]]);
  assert.deepStrictEqual(body.videos, ["https://tunnel.example/files/staged_2.mov", "https://cdn.example/other.mp4"]);
  assert.strictEqual(form.videos[0], "/video_reference/2.mov", "queuing must retain the form's saved-file association");
  const motion = {mode:"motion-control", video:"/video_reference/1.mp4"};
  await pPrepareVideos(svc, motion);
  assert.strictEqual(motion.video, "https://tunnel.example/files/staged_1.mp4");
  global.post = async () => ({error:"reference video not found"});
  await assert.rejects(pPrepareVideos(svc, {mode:"motion-control", video:"/video_reference/9.mp4"}), /not found/);
  console.log("ok - saved video staging, manual URLs preserved, missing file blocks generation");

  // Minimal DOM exercises the real prompt-bar handlers without a browser dependency.
  class Element {
    constructor(tag){ this.tagName=tag; this.children=[]; this.value=""; }
    appendChild(el){ this.children.push(el); return el; }
    setAttribute(name,value){ this[name]=value; }
    set innerHTML(value){
      this.children=[];
      for (const m of value.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)){
        const opt=new Element("option"); opt.value=m[1]; opt.textContent=m[2]; this.appendChild(opt);
      }
      this.value=this.children[0]?.value || "";
    }
  }
  global.document={createElement:tag=>new Element(tag)};
  global.esc=s=>s;
  global.local=()=>{};
  global.LOCAL_TOKEN="test";
  global.fetch=async()=>({ok:true,json:async()=>["1.mp4","2.mov"]});
  const titles=["UI motion","UI no video"];
  global.window={prompt:()=>titles.shift()};
  const uiState={mode:"motion-control"}, ta={value:"UI body"};
  const ctx={svc,state:uiState,redraw:()=>{}};
  const bar=promptBar("ui",ta,()=>{},false,ctx);
  await new Promise(resolve=>setImmediate(resolve));
  const videoSel=bar.children.find(el=>el["aria-label"]==="Saved reference video (optional)");
  assert(videoSel && !videoSel.disabled);
  assert.deepStrictEqual(videoSel.children.map(el=>el.textContent), ["No saved reference video","1.mp4","2.mov"]);
  videoSel.value="video:1.mp4"; videoSel.onchange();
  assert.strictEqual(uiState.video,"/video_reference/1.mp4");
  bar.children.find(el=>el.className==="p-new").onclick();
  assert.strictEqual(pList("ui")[0].video.name,"1.mp4");
  uiState.mode="image-to-video"; delete uiState.video;
  bar.children.find(el=>el.className==="p-load").onclick();
  assert.strictEqual(uiState.mode,"motion-control");
  assert.strictEqual(uiState.video,"/video_reference/1.mp4");
  videoSel.value=""; videoSel.onchange();
  bar.children.find(el=>el.className==="p-edit").onclick();
  assert(!pList("ui")[0].video);
  console.log("ok - prompt dropdown selection, New, Load with mode restore, None and Edit handlers");

  const page=html.replace(/\r\n/g,"\n");
  new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const start=page.indexOf("send.onclick = async ()=>{");
  const handler=page.slice(start+"send.onclick = async ()=>{".length,page.indexOf("\n  };\n}",start));
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=new AsyncFunction("svc","state","send","status","out","local","callApi","KLING",
    "pVideoFields","pPrepareVideos",handler);
  const queued=[];
  const api=async(url,body)=>{queued.push({url,body});return {ok:false,status:400};};
  global.post=async()=>({url:"https://tunnel.example/files/clip.mp4",reachable:true});
  const motionForm={mode:"motion-control",prompt:"move",video:"/video_reference/1.mp4"};
  await run(svc,motionForm,{}, {},{},()=>{},api,"https://api.example",pVideoFields,pPrepareVideos);
  assert.match(queued[0].url,/motion-control/);
  assert(queued[0].body.contents.some(part=>part.type==="video" && part.url==="https://tunnel.example/files/clip.mp4"));
  assert.strictEqual(motionForm.video,"/video_reference/1.mp4");
  global.post=async()=>({error:"missing video"});
  const status={}, send={};
  await run(svc,motionForm,send,status,{},()=>{},api,"https://api.example",pVideoFields,pPrepareVideos);
  assert.strictEqual(queued.length,1,"missing video must stop before a provider call");
  assert.strictEqual(status.textContent,"input prep failed");
  assert.strictEqual(send.disabled,false);
  console.log("ok - real queue handler stages before shaping; missing files stop dispatch; page syntax valid");
})().catch(e => { console.error(e); process.exitCode = 1; });
