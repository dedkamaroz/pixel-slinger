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

const src = html.slice(html.indexOf("const PSEL"), html.indexOf("// `apply` writes"));
// wrapped in a function, or eval's declarations land in this scope and collide
const { pList, pAdd, pSet, pDel } =
  eval("(function(){" + src + "\nreturn { pList, pAdd, pSet, pDel };})")();

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
["seedream5edit", "briaexpand", "imgeditor", "kora", "seedance", "seedance25",
 "minimax", "seedmini", "klingv3", "seedance15fal", "kling26fal",
 "k30", "k30omni", "ko1", "k26", "k25t", "k21m"]
  .forEach(id => assert(withPrompt.includes(id), `${id} should get the prompt library`));
// A prompt field typed as anything but textarea would render without the bar.
Object.entries(SERVICES).forEach(([id, s]) => s.fields.forEach(([n, t]) => {
  if (n === "prompt") assert.strictEqual(t, "textarea", `${id}: prompt must be a textarea`);
}));

console.log(`ok - prompt store (${withPrompt.length} models carry a prompt library)`);
