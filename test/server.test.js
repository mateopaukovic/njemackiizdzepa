"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// Never use a developer's provider credentials or make external calls in tests.
process.env.XAI_API_KEY = "test-key";
process.env.LLM_BASE_URL = "https://provider.invalid/v1";
let providerReply;
const originalFetch = global.fetch;
global.fetch = async () => {
  if (providerReply === undefined) throw new Error("offline");
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(providerReply) } }] }) };
};
const { server } = require("../server");
const dialogues = require("../data/dialogues.json");
const scripts = require("../data/live-scripts.json");
const challenges = require("../data/challenges.json");

before(() => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
}));
after(async () => {
  global.fetch = originalFetch;
  if (server.listening) await new Promise((resolve) => server.close(resolve));
});

function request(path, body, raw = false) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : raw ? body : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port: server.address().port, path,
      method: data === null ? "GET" : "POST",
      headers: data === null ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text, data: res.headers["content-type"]?.includes("application/json") ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

test("health and static assets are served; malformed paths are rejected", async () => {
  assert.equal((await request("/api/health")).data.ok, true);
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/js/app.js")).status, 200);
  assert.equal((await request("/%ZZ")).status, 400);
  assert.equal((await request("/../public-private/file")).status, 403);
});

test("invalid JSON, types, oversized input, and unsupported actions return client errors", async () => {
  for (const input of [null, [], {}, { message: 12 }, { message: " " }, { message: "x".repeat(2001) }, { message: "bank", chip: "__proto__" }]) {
    assert.equal((await request("/api/chat", input)).status, 400, JSON.stringify(input).slice(0, 100));
  }
  assert.equal((await request("/api/chat", "{", true)).data.error, "invalid_json");
  assert.equal((await request("/api/chat", "x".repeat(1000001), true)).status, 413);
  for (const change of [
    { action: "unknown" }, { step: -1 }, { step: 1.5 }, { misses: "2" },
    { history: {} }, { history: [null] }, { goal_progress: [4] }, { heard: "" },
    { situation: { ...dialogues.bank, lines: [null, null, null, null] } },
    { situation: { ...dialogues.bank, vocab: {} } },
    { situation: { ...dialogues.bank, chip: ["bank"] } },
    { situation: { ...dialogues.bank, difficulty: {} } },
    { situation: { ...dialogues.bank, tips_hr: false } },
  ]) {
    assert.equal((await request("/api/turn", { action: "heard", heard: "Hallo", situation: dialogues.bank, ...change })).status, 400);
  }
});

test("every fallback scene completes with its suggested answers, including the harder follow-up", async () => {
  for (const chip of Object.keys(dialogues)) {
    for (const difficulty of ["standard", "harder"]) {
      const generated = await request("/api/chat", { message: dialogues[chip].title_hr, chip, difficulty });
      assert.equal(generated.status, 200);
      const situation = generated.data.situation;
      assert.equal(situation.formality, "Sie");
      assert.equal(situation.level, "B1");
      assert.equal(situation.lines.length, dialogues[chip].lines.length + (difficulty === "harder" ? 2 : 0));
      if (difficulty === "harder") assert.equal(situation.lines.at(-1).de, challenges[chip].help_de);
      let response = await request("/api/turn", { action: "start", situation });
      let turns = 0;
      const questions = [];
      while (!response.data.scene_complete && turns < 10) {
        const turn = response.data;
        questions.push(turn.in_character_de);
        response = await request("/api/turn", {
          action: "heard", situation, step: turn.step, misses: turn.misses,
          goal_progress: turn.goal_progress, heard: turn.coach.say_this_now_de,
        });
        assert.equal(response.status, 200);
        turns += 1;
      }
      assert.equal(response.data.scene_complete, true, `${chip}/${difficulty}`);
      assert.equal(turns, scripts[chip].steps.length + (difficulty === "harder" ? 1 : 0), chip);
      if (difficulty === "harder") assert.ok(questions.includes(challenges[chip].question_de), chip);
    }
  }
});

test("fallback feedback does not treat repeated unrelated speech as success", async () => {
  const result = await request("/api/turn", {
    action: "heard", situation: { ...dialogues.bank, chip: "bank" },
    heard: "Ich mag sonniges Wetter", misses: 3,
  });
  assert.equal(result.data.step, 0);
  assert.deepEqual(result.data.goal_progress, []);
  assert.equal(result.data.coach.corrected_de, "");
  const checked = await request("/api/turn", { action: "check", situation: dialogues.bank, heard: "Ich habe Hunger" });
  assert.deepEqual(checked.data.goal_progress, []);
  assert.match(checked.data.coach.notes_hr[0], /ipak može biti ispravan/);
});

test("out-of-range fallback steps finish safely", async () => {
  const result = await request("/api/turn", { action: "heard", heard: "Danke", situation: dialogues.bank, step: 100 });
  assert.equal(result.status, 200);
  assert.equal(result.data.scene_complete, true);
  const done = await request("/api/turn", { action: "done", situation: dialogues.bank });
  assert.match(done.data.debrief_hr, /Još nema prepoznatih ciljeva/);
});

test("malformed provider payloads fall back; valid alternate wording is preserved", async () => {
  try {
    for (const broken of [
      { situation: { ...dialogues.bank, vocab: {} }, chat_reply_hr: "Primjer" },
      { situation: { ...dialogues.bank, tips_hr: [null] }, chat_reply_hr: "Primjer" },
      { situation: { ...dialogues.bank, lines: [null, null, null, null] }, chat_reply_hr: "Primjer" },
    ]) {
      providerReply = broken;
      assert.equal((await request("/api/chat", { message: "banka" })).data.source, "fallback");
    }
    providerReply = { in_character_de: "Hallo", in_character_hr: "Bok", coach: { notes_hr: {} }, ask: true, scene_complete: false };
    assert.equal((await request("/api/turn", { action: "start", situation: dialogues.bank })).data.source, "fallback");
    providerReply = {
      in_character_de: "Welche Unterlagen haben Sie dabei?", in_character_hr: "Koje dokumente imate kod sebe?",
      ask: true, scene_complete: false, debrief_hr: "", goal_progress: ["račun"],
      coach: { heard: "wrong echo", corrected_de: "", notes_hr: ["Jasno si rekao što trebaš."], say_this_now_de: "Hier ist mein Pass." },
    };
    const heard = "Ich würde gern ein Girokonto eröffnen.";
    const valid = await request("/api/turn", { action: "heard", heard, situation: dialogues.bank });
    assert.equal(valid.data.source, "llm");
    assert.equal(valid.data.coach.heard, heard);
    assert.equal(valid.data.coach.corrected_de, "");
    const check = await request("/api/turn", { action: "check", heard, situation: dialogues.bank });
    assert.equal(check.data.in_character_de, "");
    assert.equal(check.data.ask, false);
  } finally { providerReply = undefined; }
});
