// node test_gemini_video.js [index.html] - Google video picker and retired-model fallback.
const fs = require("fs"), assert = require("assert");
const html = fs.readFileSync(process.argv[2] || __dirname + "/index.html", "utf8").replace(/\r\n/g,"\n");
const API = "https://apireq.enhancor.ai/api", ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const {SERVICES,PUBLISHERS,ALL_GROUPS} = eval(
  html.slice(html.indexOf("const AREAS"),html.indexOf("const GROUPS")) + "\n({SERVICES,PUBLISHERS,ALL_GROUPS})");
assert.deepStrictEqual(PUBLISHERS.pubGoogle.models, [["omni11","Gemini Omni Flash 1.1"]]);
assert(!/veo/i.test(PUBLISHERS.pubGoogle.sub));
const label = ALL_GROUPS.flatMap(g=>g.items).find(([id])=>id==="pubGoogle")[1];
assert(!/veo/i.test(label));
assert.strictEqual(SERVICES.omni11.model,"gemini-omni-1.1-flash");
assert.deepStrictEqual(PUBLISHERS.pubKling.models.map(([id])=>id),["k30","k30omni","ko1","k26","k25t"]);

const source = html.slice(html.indexOf("function renderPublisher(pid){"),html.indexOf("function render(id){"));
const render = new Function("PUBLISHERS","localStorage","document","pane","esc","renderService",
  "let FORM_HOST;\n" + source + "\nreturn renderPublisher;");
for (const saved of [null,"veo31","veo31fast","veo31lite","omni11"]){
  const store = {"pubModel:pubGoogle":saved, "prompts:veo31":"saved Veo prompt"};
  const storage = {getItem:k=>store[k],setItem:(k,v)=>{store[k]=v;}};
  const document = {createElement:()=>({append(){},appendChild(){}})};
  const shown=[];
  render(PUBLISHERS,storage,document,{appendChild(){}},s=>s,id=>shown.push(id))("pubGoogle");
  assert.deepStrictEqual(shown,["omni11"],`saved selection ${saved} should open Omni`);
  assert.strictEqual(store["pubModel:pubGoogle"],"omni11");
  assert.strictEqual(store["prompts:veo31"],"saved Veo prompt","saved prompts must be preserved");
}
new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
console.log("ok - Veo hidden, Omni retained, stale Veo selections fall back, Kling and saved prompts unchanged");

const omni = SERVICES.omni11;
const fields = task => omni.fields.filter(([n,t,l,o]) => !o.when || o.when({task}));
const duration = fields("image_to_video").find(f => f[0] === "duration");
assert(duration, "image-to-video needs a duration control");
assert.strictEqual(duration[1], "select");
assert.deepStrictEqual(duration[3].opts, ["","3","4","5","6","7","8","9","10"]);
assert.strictEqual(duration[3].def, "8", "default Omni clips to 8 seconds");
assert(!omni.fields.some(f => f[0] === "previous_interaction_id"));
const video = fields("reference_to_video").find(f => f[0] === "video");
assert(video && video[1] === "file", "reference-to-video needs the shared file drop control");
assert(!fields("image_to_video").some(f => f[0] === "video"));
assert(!fields("text_to_video").some(f => f[0] === "video"));
assert.strictEqual(omni.fields.find(f => f[0] === "task")[3].rerender, true);

const shape = body => { const b = {...body}; omni.shape(b); return b; };
assert.strictEqual(shape({prompt:"Animate",duration:duration[3].def}).response_format.duration,"8s");
for (const seconds of duration[3].opts.slice(1)) {
  const b = shape({prompt:"Animate", task:"image_to_video", duration:seconds});
  assert.strictEqual(b.response_format.duration, `${seconds}s`);
  assert.strictEqual(b.generation_config.video_config.task, "image_to_video");
}
for (const value of [undefined, ""]) assert(!("duration" in shape({duration:value}).response_format));
for (const value of [0, 2, 11, 3.5, "bad"]) assert.throws(() => shape({duration:value}), /duration/i);
const img = {type:"image",data:"IMAGE",mime_type:"image/png"};
const clip = {type:"video",data:"VIDEO",mime_type:"video/mp4"};
const reference = shape({image:[img],video:clip,prompt:"Follow the reference",task:"reference_to_video",duration:"6"});
assert.deepStrictEqual(reference.input, [img,clip,{type:"text",text:"Follow the reference"}]);
assert.strictEqual(reference.response_format.duration,"6s");
assert(!("video" in reference));
assert.strictEqual(shape({prompt:"Text only"}).input,"Text only");
assert.deepStrictEqual(shape({video:clip}).input,[clip]);

(async () => {
  const calls = [];
  const prepSource = html.slice(html.indexOf("async function omniPrep(b){"),html.indexOf("// bfl's Expand"));
  const prep = new Function("geminiBytes", prepSource + ";return omniPrep;")(async url => {
    calls.push(url);
    return url.endsWith(".png") ? {mime:"image/png",b64:"IMAGE"} : {mime:"video/mp4",b64:"VIDEO"};
  });
  const b = {image:["first.png"],video:"ref.mp4"};
  await prep(b);
  assert.deepStrictEqual(calls,["first.png","ref.mp4"]);
  assert.deepStrictEqual(b,{image:[img],video:clip});
  const request = shape({...b,task:"reference_to_video",duration:"8"});
  assert.deepStrictEqual(request.input,[img,clip]);
  assert.strictEqual(request.response_format.duration,"8s");
  await assert.rejects(() => prep({video:"not-video.png"}), /video/i);
  console.log("ok - Omni duration, mode-gated video drop, inline video prep and request shaping");
})().catch(e => { console.error(e); process.exitCode=1; });
