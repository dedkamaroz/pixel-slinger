// node test_gemini_images.js - offline Gemini image schema and request-path checks.
const fs = require("fs"), assert = require("assert");
const html = fs.readFileSync(__dirname + "/index.html", "utf8").replace(/\r\n/g,"\n");
const API = "https://apireq.enhancor.ai/api", ARK = "https://ark.ap-southeast.bytepluses.com/api/v3";
const src = html.slice(html.indexOf("const AREAS"), html.indexOf("const GROUPS"));
const { SERVICES, PUBLISHERS, ALL_GROUPS, geminiImageResults: imageResults } = eval(src + "\n({SERVICES,PUBLISHERS,ALL_GROUPS,geminiImageResults})");
const {pVideoFields, pPrepareVideos} = new Function(
  html.slice(html.indexOf("const PSEL"), html.indexOf("// `apply` writes")) +
  "\nreturn {pVideoFields, pPrepareVideos};")();
const models = [
  ["nb21", "gemini-nano-banana-2.1", ["1K","2K","4K"], ["","MINIMAL","MEDIUM","HIGH"]],
  ["nb2", "gemini-3.1-flash-image", ["512","1K","2K","4K"], ["","MINIMAL","HIGH"]],
  ["nb2lite", "gemini-3.1-flash-lite-image", ["1K"], ["","MINIMAL","HIGH"]],
  ["nbpro", "gemini-3-pro-image", ["1K","2K","4K"], null],
  ["nb", "gemini-2.5-flash-image", null, null],
];
const spec = (s,n) => s.fields.find(f => f[0] === n)?.[3];
assert(ALL_GROUPS[0].items.some(([id]) => id === "pubGoogleImage"));
assert.deepStrictEqual(PUBLISHERS.pubGoogleImage.models.map(m => m[0]), models.map(m => m[0]));
for (const [id, model, sizes, thinking] of models) {
  const s = SERVICES[id];
  assert.strictEqual(s.geminiImage, model);
  for (const n of ["prompt","image","images","aspectRatio","seed",
    ...(id === "nbpro" ? [] : ["responseModalities","candidateCount","temperature","topP","topK","maxOutputTokens","stopSequences","presencePenalty",
      "frequencyPenalty","systemInstruction","safetySettings","generationConfig","requestOptions","history"])])
    assert(spec(s,n), `${id} missing ${n}`);
  assert.deepStrictEqual(spec(s,"imageSize")?.opts, sizes || undefined);
  assert.deepStrictEqual(spec(s,"thinkingLevel")?.opts, thinking || undefined);
  s.fields.forEach(([n,t,,o]) => { if (t === "select") assert(o.opts.includes(o.def), `${id}.${n} default`); });
  const b = {prompt:"Make it blue", image:{inlineData:{mimeType:"image/png",data:"AA=="}},
    images:[{inlineData:{mimeType:"image/jpeg",data:"AQ=="}}], aspectRatio:"9:16", seed:0,
    temperature:0, topP:0.9, responseModalities:"TEXT,IMAGE", systemInstruction:"Keep texture",
    safetySettings:[], history:[{role:"model",parts:[{text:"previous",thoughtSignature:"sig"}]}],
    generationConfig:{stopSequences:["END"]}, requestOptions:{labels:{test:"yes"}}};
  s.shape(b);
  assert.strictEqual(b.contents[1].parts[0].inlineData.data,"AA==");
  assert.strictEqual(b.contents[1].parts[1].inlineData.data,"AQ==");
  assert.deepStrictEqual(b.contents[1].parts[2],{text:"Make it blue"});
  assert.strictEqual(b.contents[0].parts[0].thoughtSignature,"sig");
  assert.deepStrictEqual(b.generationConfig.imageConfig,{aspectRatio:"9:16"});
  assert.strictEqual(b.generationConfig.seed,0);
  assert.strictEqual(b.generationConfig.temperature,0);
  assert.deepStrictEqual(b.generationConfig.responseModalities,id === "nbpro" ? ["IMAGE"] : ["TEXT","IMAGE"]);
  assert.deepStrictEqual(b.generationConfig.stopSequences,["END"]);
  assert.deepStrictEqual(b.systemInstruction,{parts:[{text:"Keep texture"}]});
  assert.deepStrictEqual(b.labels,{test:"yes"});
  assert(!("prompt" in b) && !("images" in b));
  for (const bad of [{generationConfig:[]},{requestOptions:1},{history:{}},{safetySettings:{}}])
    assert.throws(()=>s.shape({prompt:"x",...bad}), /JSON|array|object/);
}
const pro = SERVICES.nbpro;
assert.deepStrictEqual(pro.fields.map(f=>f[0]), ["prompt","time_of_day","location","expression","image","images","aspectRatio","imageSize",
  "seed"]);
assert.deepStrictEqual(["aspectRatio","imageSize"].map(n=>spec(pro,n).def),
  ["9:16","2K"]);
const proDefaults = Object.fromEntries(pro.fields.filter(f=>f[3].def !== undefined && f[3].def !== "").map(f=>[f[0],f[3].def]));
pro.shape(Object.assign(proDefaults,{prompt:"Edit"}));
assert.deepStrictEqual(proDefaults.generationConfig.imageConfig,{aspectRatio:"9:16",imageSize:"2K"});
assert.deepStrictEqual(proDefaults.generationConfig.responseModalities,["IMAGE"]);
assert.strictEqual(proDefaults.generationConfig.candidateCount,1);
assert.strictEqual(proDefaults.generationConfig.thinkingConfig.includeThoughts,false);
const stalePro = {prompt:"Edit",candidateCount:4,responseModalities:"TEXT,IMAGE",includeThoughts:true};
pro.shape(stalePro);
assert.strictEqual(stalePro.generationConfig.candidateCount,1);
assert.deepStrictEqual(stalePro.generationConfig.responseModalities,["IMAGE"]);
assert.strictEqual(stalePro.generationConfig.thinkingConfig.includeThoughts,false);
for (const [id] of models.filter(([id])=>id!=="nbpro")) {
  assert.strictEqual(spec(SERVICES[id],"aspectRatio").def,"");
  assert.strictEqual(spec(SERVICES[id],"responseModalities").def,"TEXT,IMAGE");
  assert.strictEqual(spec(SERVICES[id],"candidateCount").def,"");
}
const shape = b => { SERVICES.nb21.shape(b); return b; };
assert.deepStrictEqual(shape({prompt:"x", includeThoughts:false, thinkingLevel:"HIGH"}).generationConfig.thinkingConfig,
  {includeThoughts:false,thinkingLevel:"HIGH"});
assert.deepStrictEqual(shape({prompt:"x"}).generationConfig.responseModalities,["TEXT","IMAGE"]);
const response = {candidates:[{content:{parts:[{thought:true,inlineData:{mimeType:"image/png",data:"thought"}},
  {text:"Done"},{inlineData:{mimeType:"image/png",data:"AA=="}}]}}]};
assert.deepStrictEqual(imageResults(response),["data:image/png;base64,AA=="]);
assert.deepStrictEqual(imageResults({promptFeedback:{blockReason:"SAFETY"}}),[]);
assert.deepStrictEqual(imageResults({candidates:[{content:{parts:[{inlineData:{mimeType:"text/html",data:"AA=="}}]}}]}),[]);

(async()=>{
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  // Exercise the actual send handler, not a reimplementation of dispatch.
  const handler = html.slice(html.indexOf("send.onclick = async ()=>{") + "send.onclick = async ()=>{".length,
    html.indexOf("\n  };\n}", html.indexOf("send.onclick = async ()=>{")));
  for (const [id, model] of models) {
    const svc = SERVICES[id], status={}, send={}, out={}, calls=[], shown=[];
    const state = {prompt:"Edit", aspectRatio:"1:1", imageSize:spec(svc,"imageSize")?.def};
    const run = new AsyncFunction("svc","state","send","status","out","local","callApi","GEMINI",
      "outAbbr","inputName","showResult","storeGeminiImage","showGeminiImageInfo","pVideoFields","pPrepareVideos", handler);
    await run(svc,state,send,status,out,()=>{},async(url,body)=>{calls.push({url,body});return {ok:true,json:response};},
      "https://generativelanguage.googleapis.com/v1beta",()=>id,()=>"source",
      (...args)=>shown.push(args),async u=>{assert.match(u,/^data:image\/png/);return "http://127.0.0.1/files/output.png";},()=>{},pVideoFields,pPrepareVideos);
    assert.strictEqual(calls[0].url,`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    assert.strictEqual(shown[0][1],"http://127.0.0.1/files/output.png");
    assert.strictEqual(send.disabled,false);
    assert.match(status.textContent,/DONE/);
  }
  let fetches=[];
  const prepSrc = html.slice(html.indexOf("async function geminiImagePrep"),html.indexOf("function geminiImageShape"));
  const prep = new Function("geminiBytes",prepSrc+";return geminiImagePrep;")(async u=>{fetches.push(u);return {mime:"image/png",b64:"AA=="};});
  const b={image:"first",images:["second"]}; await prep(b);
  assert.deepStrictEqual(fetches,["first","second"]);
  assert.strictEqual(b.image.inlineData.data,"AA==");
  assert.strictEqual(b.images[0].inlineData.mimeType,"image/png");
  await assert.rejects(()=>prep({images:Array(15).fill("x")}),/14/);
  const badPrep = new Function("geminiBytes",prepSrc+";return geminiImagePrep;")(async()=>({mime:"video/mp4",b64:"AA=="}));
  await assert.rejects(()=>badPrep({image:"x"}),/PNG/);
  assert.throws(()=>shape({prompt:"x",images:[{inlineData:{data:"x".repeat(20000000)}}]}),/20 MB/);
  const nodes=[];
  const document={createElement:tag=>{const el={tag,attrs:{},setAttribute(k,v){this.attrs[k]=v;},append(){}};nodes.push(el);return el;}};
  const info=new Function("document","API","ARK",src+";return showGeminiImageInfo;")(document,API,ARK);
  info({prepend(){}},{candidates:[{content:{parts:[{text:"<script>literal text</script>"}]},groundingMetadata:{
    searchEntryPoint:{renderedContent:"<script>untrusted</script>"},groundingChunks:[{web:{uri:"javascript:bad"}},{web:{uri:"https://example.org",title:"Source"}}]}}]});
  assert.strictEqual(nodes[0].textContent,"<script>literal text</script>");
  assert(!nodes.find(n=>n.tag==="iframe").attrs.sandbox.includes("allow-scripts"));
  assert.deepStrictEqual(nodes.filter(n=>n.tag==="a").map(n=>n.href),["https://example.org"]);
  const originStore=new Function("post","API","ARK","location",src+";return storeGeminiImage;")(
    async()=>({url:"https://tunnel.example/files/out.png",local:"http://127.0.0.1:8787/files/out.png"}),API,ARK,{origin:"https://app.example"});
  assert.strictEqual(await originStore("data:image/png;base64,AA==","nb21"),"https://app.example/files/out.png");

  if (process.env.GEMINI_TEST_BASE) {
    const base=process.env.GEMINI_TEST_BASE, png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=";
    const served=await (await fetch(base)).text();
    const token=served.match(/const LOCAL_TOKEN = "([^"]+)"/)[1];
    const post=async(path,body)=> (await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json","X-Local-Token":token},body:JSON.stringify(body)})).json();
    const store=new Function("post","API","ARK","location",src+";return storeGeminiImage;")(post,API,ARK,{origin:base});
    const url=await store("data:image/png;base64,"+png,"nb21");
    assert(Buffer.from(await (await fetch(url)).arrayBuffer()).equals(Buffer.from(png,"base64")));
    const result=await post("/api/save",{url,dir:__dirname+"/.gemini-work/save-check",abbr:"nb21",input:"fixture",scripts:[]});
    assert(result.path,JSON.stringify(result));
    assert(fs.readFileSync(result.path).equals(Buffer.from(png,"base64")));
    console.log("Local inline output upload, HTTP preview and save: byte-for-byte PASS");
  }
  console.log("Gemini image editors: 5 models, fields, shaping, prep, output filtering and real dispatch PASS");
})().catch(e=>{console.error(e);process.exitCode=1;});



