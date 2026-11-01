// node test_prompt_variables.js - Pro-only templates, controls, label help, library and dispatch.
const fs = require("fs"), assert = require("assert");
const html = fs.readFileSync(__dirname + "/index.html","utf8").replace(/\r\n/g,"\n");
const API="https://api.example", ARK="https://ark.example";
const SERVICES=eval(html.slice(html.indexOf("const AREAS"),html.indexOf("const GROUPS"))+"\nSERVICES");
const pro=SERVICES.nbpro;
assert.strictEqual(typeof pro.promptText,"function","Pro needs template substitution");
const template="At {{time_of_day}}, in the {{location}}, with a subtle {{expression}} expression. Again: {{ time_of_day }}.";
const state={prompt:template,time_of_day:"morning",location:"living room",expression:"happy"};
const expected="At morning, in the living room, with a subtle happy expression. Again: morning.";
assert.strictEqual(pro.promptText(state),expected);
assert.strictEqual(state.prompt,template,"resolving must preserve reusable template");
for (const [key,values] of Object.entries({time_of_day:["morning","day","evening","night"],
  location:["living room","bedroom","kitchen","bathroom","dining room","hallway","backyard","office"],
  expression:["bored","annoyed","impatient","happy","distracted"]})) {
  const field=pro.fields.find(f=>f[0]===key);
  assert(field && field[1]==="select" && field[3].rerender);
  assert.strictEqual(field[3].def,"");
  for (const value of values) {
    assert(field[3].opts.includes(value));
    assert.strictEqual(pro.promptText({prompt:`{{${key}}}`,[key]:value}),value);
  }
  for (const value of [undefined,"","bogus","<script>"]) {
    assert.throws(()=>pro.promptText({prompt:`{{${key}}}`,[key]:value}), /Choose/);
    assert.strictEqual(pro.promptText({prompt:`{{${key}}}`,[key]:value},false),`{{${key}}}`);
  }
}
assert.strictEqual(pro.promptText({prompt:"A happy morning in an office"}),"A happy morning in an office");
assert.strictEqual(pro.promptText({prompt:""}),"");
const wire={...state}; pro.shape(wire);
assert.strictEqual(wire.contents[0].parts[0].text,expected);
for (const key of ["time_of_day","location","expression"]) assert(!(key in wire));
assert.strictEqual(wire.generationConfig.candidateCount,1);
for (const [id,svc] of Object.entries(SERVICES)) if (id!=="nbpro") {
  assert(!svc.promptText,`${id} must not expand templates`);
  assert(!svc.fields.some(f=>["time_of_day","location","expression"].includes(f[0])),`${id} must not gain selectors`);
}
console.log("ok - Pro variable options, replacement, validation, template preservation, wire shape and model isolation");

// Minimal DOM runs the actual form renderer and saved-prompt handlers.
class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.value="";this.style={};this.attrs={};}
  appendChild(el){this.children.push(el);return el;}
  append(...els){els.forEach(el=>this.appendChild(el));}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k];}
  set innerHTML(text){
    this.children=[];
    if(text.includes('class="lbl"')) {const label=new Element("div");label.className="lbl";this.appendChild(label);}
    for(const m of text.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)) {
      const opt=new Element("option");opt.value=m[1];opt.textContent=m[2];this.appendChild(opt);
    }
  }
  querySelectorAll(selector){
    const matches=el=>selector.startsWith(".") ? el.className===selector.slice(1) : selector.split(",").includes(el.tagName);
    return this.children.flatMap(el=>[...(matches(el)?[el]:[]),...el.querySelectorAll(selector)]);
  }
  querySelector(selector){return this.querySelectorAll(selector)[0];}
}
(async()=>{
  const store={};const localStorage={getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v};
  const document={createElement:tag=>new Element(tag)}, host=new Element("div");
  let title="Template";const window={prompt:()=>title};const calls=[],errors=[];
  const block=html.slice(html.indexOf("const PSEL"),html.indexOf("/* ---------- output naming"));
  const ui=new Function("SERVICES","AREAS","document","FORM_HOST","localStorage","window","esc","local",
    "dropZone","callApi","GEMINI","outAbbr","inputName","confirm",block+
    "\nreturn {renderService,FORMS,pList};")(
    SERVICES,{},document,host,localStorage,window,s=>s,(...x)=>errors.push(x),()=>new Element("div"),
    async(url,body)=>{calls.push({url,body});return {ok:false,status:400,json:{error:"test response"}};},
    "https://generativelanguage.googleapis.com/v1beta",()=>"nbpro",()=>"",()=>true);
  const find=label=>host.querySelectorAll("input,select,textarea,div").find(el=>el.getAttribute("aria-label")===label);
  const button=label=>host.querySelectorAll("button").find(el=>el.textContent===label);
  const change=(label,value)=>{const el=find(label);assert(el,`missing ${label}`);el.value=value;el.onchange();};
  ui.renderService("nbpro");
  const help="Use {{time_of_day}}, {{location}}, {{expression}}. Use the selectors below to choose their values.";
  const hasLabelHelp=()=>host.querySelectorAll(".lbl").some(label=>label.children.some(el=>el.tagName==="small" && el.textContent===help));
  assert(hasLabelHelp(),"variable instructions belong in the left prompt label");
  assert(!find("Prompt preview"),"duplicate prompt preview must be removed");
  assert.strictEqual(host.querySelectorAll("small").filter(el=>el.textContent===help).length,1);
  let ta=find("Prompt template");assert(ta);
  ta.value=template;ta.oninput();
  assert(!find("Prompt preview"));
  // A missing used selection stops the actual queue handler before any provider request.
  await button("Queue request").onclick();
  assert.strictEqual(calls.length,0);assert(errors.some(x=>String(x).includes("Choose time of day")));
  change("Time of day","morning");change("Location","living room");change("Subtle face expression","happy");
  assert(!find("Prompt preview"));
  assert.strictEqual(find("Prompt template").value,template);
  assert(host.querySelectorAll("span").some(el=>el.textContent===expected.length+" characters"));
  button("New").onclick();
  assert.strictEqual(ui.pList("nbpro")[0].body,template,"New saves the reusable template");
  await button("Queue request").onclick();
  assert.strictEqual(calls.length,1);assert.match(calls[0].url,/gemini-3-pro-image:generateContent$/);
  assert.strictEqual(calls[0].body.contents[0].parts[0].text,expected);
  for (const key of ["time_of_day","location","expression"]) assert(!(key in calls[0].body));
  assert.strictEqual(ui.FORMS.nbpro.prompt,template);
  change("Time of day","night");
  assert(pro.promptText(ui.FORMS.nbpro).includes("At night,"));
  ta=find("Prompt template");ta.value="Edited: "+template;ta.oninput();title="Edited template";
  button("Edit").onclick();
  assert.strictEqual(ui.pList("nbpro")[0].body,"Edited: "+template);
  ta.value="discard unsaved text";ta.oninput();button("Load").onclick();
  assert.strictEqual(find("Prompt template").value,"Edited: "+template);
  assert(pro.promptText(ui.FORMS.nbpro).includes("Edited: At night,"));
  ui.renderService("nb2");
  assert(!find("Prompt preview"));assert(!find("Time of day"));assert(!hasLabelHelp());
  ui.renderService("nbpro");
  assert.strictEqual(find("Time of day").value,"night","selections survive switching models");
  button("Clear inputs").onclick();
  assert.strictEqual(find("Time of day").value,"");
  assert.strictEqual(find("Prompt template").value,"Edited: "+template,"fresh open loads saved template");
  assert(!find("Prompt preview"));assert(hasLabelHelp());
  // Legacy literal prompts still save, load and queue with all selectors unset.
  ta=find("Prompt template");ta.value="Keep this literal prompt";ta.oninput();title="Literal";button("New").onclick();
  await button("Queue request").onclick();
  assert.strictEqual(calls[1].body.contents[0].parts[0].text,"Keep this literal prompt");
  button("Clear inputs").onclick();
  assert.strictEqual(find("Prompt template").value,"Keep this literal prompt");
  // Prompt markup stays in the input and creates no extra view.
  ta=find("Prompt template");ta.value="<img src=x onerror=alert(1)> {{expression}}";ta.oninput();
  assert(find("Prompt template").value.includes("<img src=x onerror=alert(1)>"));
  assert(!find("Prompt preview"));
  console.log("ok - actual form selectors, label help without duplicate preview, count, New/Edit/Load, tab retention, reset, legacy prompts and real queue validation/dispatch");
})().catch(e=>{console.error(e);process.exitCode=1;});
