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
