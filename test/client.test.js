"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const bank = require("../data/dialogues.json").bank;

function load(context, file) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/js", file), "utf8"), context, { filename: file });
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function turn(overrides = {}) {
  return {
    in_character_de: "Wie kann ich Ihnen helfen?", in_character_hr: "Kako vam mogu pomoći?",
    coach: { heard: "", corrected_de: "", notes_hr: [], say_this_now_de: "Ich möchte ein Konto eröffnen." },
    goal_progress: [], step: 0, misses: 0, scene_complete: false, ...overrides,
  };
}

function conversationHarness({ delayedSpeech = false } = {}) {
  const requests = [];
  const spoken = [];
  const speechJobs = [];
  const listens = [];
  const statuses = [];
  const debriefs = [];
  const window = {
    UI: { sceneEnd: "Gotovo" },
    Chat: { turn(payload, signal) { const job = deferred(); requests.push({ ...job, payload, signal }); return job.promise; } },
    Speech: {
      speak(text) { spoken.push(text); const job = deferred(); speechJobs.push(job); return delayedSpeech ? job.promise : Promise.resolve(true); },
      stopAll() { for (const job of speechJobs) job.resolve(false); },
      stopRecognition() {}, listen(options) { listens.push(options); },
    },
  };
  const context = vm.createContext({ window, AbortController });
  load(context, "conversation.js");
  const scene = window.Conversation.create({
    situation: bank, settings: { autoMic: true, voiceCorrect: true, rate: 1 },
    onStatus: (status) => statuses.push(status), onDebrief: (text) => debriefs.push(text),
  });
  return { scene, requests, spoken, speechJobs, listens, statuses, debriefs };
}

test("pausing aborts a pending turn and ignores a response even if the transport resolves", async () => {
  const h = conversationHarness();
  const pending = h.scene.start();
  h.scene.pause();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve(turn());
  await pending;
  assert.deepEqual(h.spoken, []);
  assert.deepEqual(h.listens, []);
  assert.equal(h.scene.snapshot().turn, 0);
  h.scene.resume();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(turn());
  await tick();
  assert.equal(h.spoken.length, 1);
  h.scene.stop();
});

test("stopping during a spoken correction prevents the next bot line and microphone", async () => {
  const h = conversationHarness({ delayedSpeech: true });
  const pending = h.scene.start();
  h.requests[0].resolve(turn({ coach: { heard: "ein Konto", corrected_de: "Ich möchte ein Konto eröffnen." } }));
  await tick();
  assert.deepEqual(h.spoken, ["Ich möchte ein Konto eröffnen."]);
  h.scene.stop();
  await pending;
  assert.equal(h.spoken.length, 1);
  assert.equal(h.listens.length, 0);
  await h.scene.typed("Hallo");
  assert.equal(h.requests.length, 1);
});

test("speech keeps controls busy; finishing supersedes an outstanding turn", async () => {
  const h = conversationHarness({ delayedSpeech: true });
  const starting = h.scene.start();
  h.requests[0].resolve(turn());
  await tick();
  assert.equal(h.scene.snapshot().busy, true);
  await h.scene.typed("Hallo");
  assert.equal(h.requests.length, 1);
  const ending = h.scene.done();
  h.requests[1].resolve(turn({ scene_complete: true, debrief_hr: "Završeno" }));
  await tick();
  h.speechJobs.at(-1).resolve(true);
  await Promise.all([starting, ending]);
  assert.equal(h.scene.snapshot().complete, true);
  assert.deepEqual(h.debriefs, ["Završeno"]);
  assert.equal(h.listens.length, 0);
  await h.scene.repeat();
  await h.scene.typed("Noch etwas");
  assert.equal(h.requests.length, 2);
});

test("microphone denial remains visible after recognition ends", async () => {
  const h = conversationHarness();
  const pending = h.scene.start();
  h.requests[0].resolve(turn());
  await pending;
  h.listens[0].onerror({ error: "not-allowed" });
  h.listens[0].onend();
  assert.equal(h.statuses.at(-1), "mic-denied");
  h.scene.stop();
});

test("speech cancellation settles playback and also cancels speech waiting for voices", async () => {
  const utterances = [];
  let voices = [];
  let voicesChanged;
  const window = { speechSynthesis: {
    getVoices: () => voices,
    addEventListener(name, callback) { voicesChanged = callback; },
    cancel() {}, speak(utterance) { utterances.push(utterance); },
  } };
  const context = vm.createContext({ window, setTimeout() {}, SpeechSynthesisUtterance: function (text) { this.text = text; } });
  load(context, "speech.js");
  const waiting = window.Speech.speak("Hallo");
  window.Speech.stopAll();
  voices = [{ lang: "de-DE", name: "Test" }];
  voicesChanged();
  assert.equal(await waiting, false);
  assert.equal(utterances.length, 0);
  const playing = window.Speech.speak("Guten Tag");
  await tick();
  window.Speech.cancelSpeak();
  assert.equal(await playing, false);
  const next = window.Speech.speak("Auf Wiedersehen");
  await tick();
  utterances[0].onend();
  assert.equal(window.Speech.isSpeaking(), true);
  utterances[1].onend();
  assert.equal(await next, true);
});

// Minimal DOM adapter for application state tests; it does not simulate layout or browser audio.
function appHarness(initialData, { storageFails = false } = {}) {
  const nodes = new Map();
  const storage = new Map();
  if (initialData) storage.set("njemackiudzepu.v2", JSON.stringify(initialData));
  const requests = [];
  const checks = [];
  const microphones = [];
  let nextId = 0;
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: "", innerHTML: "", textContent: "", hidden: false, style: {}, scrollHeight: 100,
      classList: { remove() {}, add() {}, toggle() {} },
      setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], focus() {},
    });
    return nodes.get(id);
  }
  const document = {
    getElementById: node, activeElement: null, querySelector: node, querySelectorAll: () => [],
    addEventListener() {}, body: node("body"),
  };
  const window = {
    Speech: {
      hasRecognition: () => true, waitVoices() {}, stopAll() {}, stopRecognition() {},
      speak: () => Promise.resolve(true), listen(options) { microphones.push(options); },
    },
    Chat: {
      generateSituation(message, settings, extra, signal) {
        const job = deferred(); requests.push({ ...job, message, extra, signal }); return job.promise;
      },
      turn(payload, signal) { const job = deferred(); checks.push({ ...job, payload, signal }); return job.promise; },
    },
  };
  const context = vm.createContext({
    window, document, AbortController, setTimeout, navigator: {},
    crypto: { randomUUID: () => String(++nextId) },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => {
        if (storageFails) throw new Error("quota");
        storage.set(key, value);
      },
    },
  });
  load(context, "strings.hr.js");
  load(context, "scoring.js");
  load(context, "app.js");
  function send(message) {
    node("composer-input").value = message;
    node("form-composer").onsubmit({ preventDefault() {} });
  }
  function mode(value) {
    return node("card").onclick({ target: { closest: (selector) => selector === "[data-mode]" ? { getAttribute: () => value } : null } });
  }
  const saved = () => JSON.parse(storage.get("njemackiudzepu.v2"));
  return { node, requests, checks, microphones, send, mode, saved, window };
}

test("switching chats aborts generation and discards a stale response without changing the new chat", async () => {
  const h = appHarness();
  h.send("banka");
  h.node("btn-new").onclick();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve({ chat_reply_hr: "Stari odgovor", situation: bank });
  await tick();
  const saved = h.saved();
  assert.equal(saved.chats.find((chat) => chat.id === saved.currentId).messages.length, 0);
  assert.equal(saved.chats.some((chat) => chat.messages.some((message) => message.typing)), false);
  assert.doesNotMatch(h.node("thread").innerHTML, /Stari odgovor/);
});

test("a newer generation wins when responses arrive out of order", async () => {
  const h = appHarness();
  h.send("stara situacija");
  h.send("nova situacija");
  h.requests[1].resolve({ chat_reply_hr: "Novi odgovor", situation: bank });
  await tick();
  h.requests[0].resolve({ chat_reply_hr: "Stari odgovor", situation: bank });
  await tick();
  assert.match(h.node("thread").innerHTML, /Novi odgovor/);
  assert.doesNotMatch(h.node("thread").innerHTML, /Stari odgovor/);
  assert.equal(h.node("btn-send").disabled, false);
});

test("hidden text can be restored; leaving the mode ignores an outstanding practice check", async () => {
  const h = appHarness();
  h.send("banka");
  h.requests[0].resolve({ chat_reply_hr: "Dijalog", situation: bank });
  await tick();
  await h.mode("hidden");
  assert.match(h.node("card").innerHTML, /data-mode="text"/);
  await h.node("card").onclick({ target: { id: "btn-hidden-talk", closest: () => null } });
  const checking = h.microphones[0].onresult("Ich möchte ein Konto eröffnen");
  await h.mode("text");
  assert.equal(h.checks[0].signal.aborted, true);
  h.checks[0].resolve({ coach: { notes_hr: ["Zastarjela provjera"] } });
  await checking;
  assert.equal(h.saved().chats[0].hiddenCheck, null);
  assert.match(h.node("card").innerHTML, /class="line"/);
});

function actionEvent(attribute, action, index = 0) {
  return { target: { closest: (selector) => selector === `[${attribute}]` ? {
    getAttribute: (name) => name === "data-i" ? String(index) : action,
  } : null } };
}

async function readyApp() {
  const h = appHarness();
  h.send("banka");
  h.requests[0].resolve({ chat_reply_hr: "Dijalog", situation: bank });
  await tick();
  return h;
}

test("a failed generation preserves its draft and retry options without duplicating the user message", async () => {
  const h = await readyApp();
  await h.node("card").onclick({ target: { id: "btn-harder", closest: () => null } });
  const failed = h.requests[1];
  failed.reject(new Error("offline"));
  await tick();
  assert.equal(h.node("composer-input").value, failed.message);
  assert.equal(h.node("btn-retry-failed").hidden, false);
  assert.equal(h.saved().chats[0].failedRequest.extra.difficulty, "harder");
  const messagesBefore = h.saved().chats[0].messages.length;
  h.node("btn-retry-failed").onclick();
  const retried = h.requests[2];
  assert.equal(retried.message, failed.message);
  assert.deepEqual(retried.extra, failed.extra);
  retried.resolve({ chat_reply_hr: "Teža scena", situation: bank });
  await tick();
  assert.equal(h.saved().chats[0].messages.length, messagesBefore + 1);
  assert.equal(h.saved().chats[0].failedRequest, null);
  assert.equal(h.node("btn-retry-failed").hidden, true);
});

test("failure does not overwrite a newer draft; retry survives reload and stays with its chat", async () => {
  const h = appHarness();
  h.send("prvi opis");
  h.node("composer-input").value = "novi nacrt";
  h.requests[0].reject(new Error("offline"));
  await tick();
  assert.equal(h.node("composer-input").value, "novi nacrt");
  const reloaded = appHarness(h.saved());
  assert.equal(reloaded.node("composer-input").value, "novi nacrt");
  assert.equal(reloaded.node("btn-retry-failed").hidden, false);
  reloaded.node("btn-new").onclick();
  assert.equal(reloaded.node("btn-retry-failed").hidden, true);
  assert.equal(reloaded.node("composer-input").value, "");
});

test("first sentence attempt shows microphone startup, listening, processing, and a score", async () => {
  const h = await readyApp();
  await h.node("card").onclick(actionEvent("data-act", "recite", 1));
  await tick();
  const status = h.node("line-1-status");
  assert.equal(status.textContent, h.window.UI.preparingMic);
  const mic = h.microphones[0];
  mic.onstart();
  assert.equal(status.textContent, h.window.UI.listening);
  mic.onspeechend();
  assert.equal(status.textContent, h.window.UI.processing);
  await mic.onresult(bank.lines[1].de);
  mic.onend();
  assert.equal(status.textContent, h.window.UI.practiceComplete);
  assert.equal(h.saved().chats[0].lineResults[1].score, 100);
});

test("microphone errors remain visible after onend and the next attempt can recover", async () => {
  const h = await readyApp();
  for (const code of ["not-allowed", "audio-capture", "network", "no-speech"]) {
    await h.node("card").onclick(actionEvent("data-act", "recite", 1));
    await tick();
    const mic = h.microphones.at(-1);
    mic.onerror({ error: code });
    mic.onend();
    assert.equal(h.node("line-1-status").textContent, h.window.UI.speechErrors[code]);
    assert.equal(h.node("line-1-stop").hidden, true);
  }
  await h.node("card").onclick(actionEvent("data-act", "recite", 1));
  await tick();
  h.microphones.at(-1).onstart();
  assert.equal(h.node("line-1-status").textContent, h.window.UI.listening);
});

test("stopping practice ignores late recognition callbacks and keeps prior scores", async () => {
  const h = await readyApp();
  await h.node("card").onclick(actionEvent("data-act", "recite", 1));
  await tick();
  const mic = h.microphones[0];
  await h.node("card").onclick(actionEvent("data-stop-practice", ""));
  await mic.onresult(bank.lines[1].de);
  mic.onend();
  assert.equal(h.node("line-1-status").textContent, h.window.UI.stopped);
  assert.equal(h.saved().chats[0].lineResults[1], undefined);
});

test("hidden practice keeps processing status until its server check finishes", async () => {
  const h = await readyApp();
  await h.mode("hidden");
  await h.node("card").onclick({ target: { id: "btn-hidden-talk", closest: () => null } });
  const mic = h.microphones[0];
  const pending = mic.onresult("Ich brauche ein Konto");
  mic.onend();
  assert.equal(h.node("hidden-practice-status").textContent, h.window.UI.processing);
  h.checks[0].resolve({ coach: { notes_hr: ["Prepoznate riječi"] } });
  await pending;
  assert.equal(h.node("hidden-practice-status").textContent, h.window.UI.practiceComplete);
});

test("saved sentences survive reload and chat deletion, can be practised and explicitly removed", async () => {
  const h = await readyApp();
  await h.node("card").onclick(actionEvent("data-act", "save", 1));
  assert.deepEqual(h.saved().savedSentences, [{ de: bank.lines[1].de, hr: bank.lines[1].hr }]);
  const reloaded = appHarness(h.saved());
  reloaded.node("chat-list").onclick({
    ...actionEvent("data-del", h.saved().currentId), stopPropagation() {},
  });
  assert.equal(reloaded.saved().savedSentences.length, 1);
  reloaded.node("btn-review").onclick();
  assert.equal(reloaded.node("review").hidden, false);
  assert.equal(reloaded.node("thread").hidden, true);
  reloaded.node("review").onclick(actionEvent("data-review-act", "recite", 0));
  await tick();
  await reloaded.microphones[0].onresult(bank.lines[1].de);
  assert.match(reloaded.node("review").innerHTML, /100%/);
  reloaded.node("review").onclick(actionEvent("data-review-act", "remove", 0));
  assert.equal(reloaded.saved().savedSentences.length, 0);
  assert.match(reloaded.node("review").innerHTML, /Spremi za vježbu/);
});

test("failed sentence storage reports the failure and rolls back the saved state", async () => {
  const source = await readyApp();
  const h = appHarness(source.saved(), { storageFails: true });
  await h.node("card").onclick(actionEvent("data-act", "save", 1));
  assert.equal(h.node("error-message").textContent, h.window.UI.storageFull);
  assert.equal(h.node("btn-review-label").textContent, `${h.window.UI.review} (0)`);
});
