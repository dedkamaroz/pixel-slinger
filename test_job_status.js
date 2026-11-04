// node test_job_status.js - offline check of the job-registry pure functions that drive the
// provider badges. svcProvider/svcModel/badgeTint have no DOM, so they are sliced out of the
// page and evalled, same as the other field tests. A wrong badgeTint here is a badge stuck on
// the wrong colour at 3am mid-render.
const fs = require("fs"), assert = require("assert");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const src = html.slice(html.indexOf("/* JOBTEST-START"), html.indexOf("/* JOBTEST-END */"));
// new Function keeps the sliced declarations in their own scope (a direct eval leaks them
// into module scope and clashes with the const below).
const { svcProvider, svcModel, badgeTint } =
  (new Function(src + "\nreturn { svcProvider, svcModel, badgeTint };"))();

// --- svcProvider: each service flag maps to its provider + key-badge id ------
assert.deepStrictEqual(svcProvider({ fal: "x/y" }), ["fal", "b-fal"]);
assert.deepStrictEqual(svcProvider({ bria: "r" }), ["bria", "b-bria"]);
assert.deepStrictEqual(svcProvider({ briav1: "r" }), ["bria", "b-bria"]);
assert.deepStrictEqual(svcProvider({ bfl: "r" }), ["bfl", "b-bfl"]);
assert.deepStrictEqual(svcProvider({ kling: "/v" }), ["kling", "b-kling"]);
assert.deepStrictEqual(svcProvider({ qwen: "/v" }), ["qwen", "b-qwen"]);
assert.deepStrictEqual(svcProvider({ qwenImage: "/v" }), ["qwen", "b-qwen"]);
assert.deepStrictEqual(svcProvider({ ark: "/v" }), ["ark", "b-ark"]);
assert.deepStrictEqual(svcProvider({ arkImage: "/v" }), ["ark", "b-ark"]);
assert.deepStrictEqual(svcProvider({ veo: "m" }), ["gemini", "b-gemini"]);
assert.deepStrictEqual(svcProvider({ omni: "/i" }), ["gemini", "b-gemini"]);
assert.deepStrictEqual(svcProvider({ geminiImage: "m" }), ["gemini", "b-gemini"]);
assert.strictEqual(svcProvider({ base: "..." }), null, "Enhancor (base) is off -> no badge");
assert.strictEqual(svcProvider(null), null);

// --- svcModel: the title without its " - <endpoint>" tail --------------------
assert.strictEqual(svcModel({ title: "Seedance 1.0 pro - seedance-v1-pro" }), "Seedance 1.0 pro");
assert.strictEqual(svcModel({ title: "Kora" }), "Kora");
assert.strictEqual(svcModel({ model: "qwen-image" }), "qwen-image");
assert.strictEqual(svcModel({}), "?");

// --- badgeTint: the badge colour state machine -------------------------------
const J = (provider, state, errAck) => ({ provider, state, errAck: !!errAck });

assert.strictEqual(badgeTint([], "fal", false), null, "no jobs -> idle (key colour)");
assert.strictEqual(badgeTint([J("fal","busy")], "fal", false), "busy", "a running job -> orange");
assert.strictEqual(badgeTint([J("fal","done")], "fal", false), null, "a finished job -> idle");

// an unacknowledged error, nothing else running, viewed from another tab -> red pulse
assert.strictEqual(badgeTint([J("fal","error",false)], "fal", false), "err-blink");
// ...but the same error while another job on that provider is still running -> alternate
assert.strictEqual(badgeTint([J("fal","error",false), J("fal","busy")], "fal", false), "err-alt");
// on the provider's own tab the error is acknowledged, so no red - busy if still running, else idle
assert.strictEqual(badgeTint([J("fal","error",false), J("fal","busy")], "fal", true), "busy");
assert.strictEqual(badgeTint([J("fal","error",false)], "fal", true), null, "on-tab, nothing running -> idle");
// an already-acknowledged error does not tint
assert.strictEqual(badgeTint([J("fal","error",true)], "fal", false), null, "acked error -> idle");
assert.strictEqual(badgeTint([J("fal","error",true), J("fal","busy")], "fal", false), "busy");
// jobs on other providers are ignored
assert.strictEqual(badgeTint([J("bria","busy"), J("bria","error",false)], "fal", false), null);

console.log("test_job_status.js OK");
