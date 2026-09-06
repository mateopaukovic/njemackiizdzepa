"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");

loadEnv(path.join(ROOT, ".env"));

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8000);
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "grok-4.6";
const XAI_API_KEY = process.env.XAI_API_KEY || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const dialogues = JSON.parse(fs.readFileSync(path.join(ROOT, "data/dialogues.json"), "utf8"));
const liveScripts = JSON.parse(fs.readFileSync(path.join(ROOT, "data/live-scripts.json"), "utf8"));
const challenges = JSON.parse(fs.readFileSync(path.join(ROOT, "data/challenges.json"), "utf8"));
const promptSystem = readPrompt("prompts/system.txt");
const promptGenerate = readPrompt("prompts/generate-situation.txt");
const promptTurn = readPrompt("prompts/live-turn.txt");

const CHIP_KEYS = {
  bank: ["bank", "račun", "racun", "konto", "sparkasse", "giro", "ausweis", "šalter", "salter"],
  job: ["posao", "interview", "bewerbung", "vorstellung", "lager", "razgovor za posao", "arbeit"],
  doctor: ["liječnik", "lijecnik", "doktor", "arzt", "bolnic", "grlo", "fieber", "ordinacija"],
  amt: ["prijava", "boravišt", "boravist", "amt", "anmeld", "bürgeramt", "burgeramt", "melde"],
  landlord: ["stan", "stanodav", "wohnung", "miete", "kaution", "vermieter"],
  jobcenter: ["jobcenter", "bürgergeld", "burgergeld", "arbeitslos"],
  train: ["vlak", "zug", "ticket", "deutschlandticket", "bahn", "s-bahn", "karta"],
  abh: ["ausländer", "auslander", "aufenthalt", "behörde", "behorde", "dozvola boravka"],
  kita: ["vrtić", "vrtic", "kita", "dječj", "djecj", "kind"],
  neighbor: ["susjed", "nachbar", "smeće", "smece", "müll", "mull"],
  parcel: ["paket", "dhl", "packstation", "pošt", "post"],
  emergency: ["hitna", "notaufnahme", "bol", "emergency", "urgentni"],
};

function readPrompt(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(httpError(413, "body_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (size <= 1e6) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value, max = 2000, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw httpError(400, "invalid_input");
  }
  return value.trim();
}

function strings(value, maxItems = 16) {
  if (!Array.isArray(value) || value.length > maxItems) throw httpError(400, "invalid_input");
  return value.map((item) => string(item, 500));
}

function validateSituation(value) {
  if (!object(value) || !Array.isArray(value.lines) || value.lines.length < 4 || value.lines.length > 40) {
    throw httpError(400, "invalid_situation");
  }
  if (value.difficulty !== undefined && !["standard", "harder"].includes(value.difficulty)) {
    throw httpError(400, "invalid_situation");
  }
  const result = {
    title_de: string(value.title_de, 200, true),
    title_hr: string(value.title_hr, 200, true),
    goal_hr: string(value.goal_hr, 1000, true),
    role_other_hr: string(value.role_other_hr, 200, true),
    level: "B1",
    formality: "Sie",
    difficulty: value.difficulty === "harder" ? "harder" : "standard",
    tips_hr: strings(value.tips_hr ?? []),
    lines: value.lines.map((line) => {
      if (!object(line) || !["you", "other"].includes(line.role)) throw httpError(400, "invalid_situation");
      return { role: line.role, de: string(line.de, 1000, true), hr: string(line.hr, 1000, true) };
    }),
  };
  if (value.chip !== undefined) {
    if (typeof value.chip !== "string" || !Object.hasOwn(dialogues, value.chip)) throw httpError(400, "invalid_situation");
    result.chip = value.chip;
  }
  if (!Array.isArray(value.vocab ?? []) || (value.vocab ?? []).length > 20) throw httpError(400, "invalid_situation");
  result.vocab = (value.vocab ?? []).map((word) => {
    if (!object(word)) throw httpError(400, "invalid_situation");
    return { de: string(word.de, 200, true), hr: string(word.hr, 200, true) };
  });
  return result;
}

async function readRequest(req, endpoint) {
  let body;
  const raw = await readBody(req);
  try { body = JSON.parse(raw); } catch { throw httpError(400, "invalid_json"); }
  if (!object(body)) throw httpError(400, "invalid_input");
  if (endpoint === "chat") {
    const message = string(body.message ?? body.text, 2000, true);
    const difficulty = body.difficulty ?? "standard";
    if (!["standard", "harder"].includes(difficulty)) throw httpError(400, "invalid_input");
    if (body.chip !== undefined && (typeof body.chip !== "string" || !Object.hasOwn(dialogues, body.chip))) {
      throw httpError(400, "invalid_input");
    }
    return { message, difficulty, chip: body.chip };
  }
  const action = body.action ?? "heard";
  if (!["start", "heard", "typed", "help", "dont_understand", "repeat", "done", "check", "free"].includes(action)) {
    throw httpError(400, "invalid_action");
  }
  const result = { action, situation: validateSituation(body.situation), heard: string(body.heard ?? "") };
  if (["heard", "typed", "check", "free"].includes(action) && !result.heard) throw httpError(400, "invalid_input");
  for (const key of ["step", "misses", "turn"]) {
    result[key] = body[key] ?? 0;
    if (!Number.isSafeInteger(result[key]) || result[key] < 0 || result[key] > 1000) throw httpError(400, "invalid_input");
  }
  result.goal_progress = strings(body.goal_progress ?? []);
  result.last_bot_de = string(body.last_bot_de ?? "");
  result.last_bot_hr = string(body.last_bot_hr ?? "");
  if (!Array.isArray(body.history ?? []) || (body.history ?? []).length > 12) throw httpError(400, "invalid_input");
  result.history = (body.history ?? []).map((turn) => {
    if (!object(turn)) throw httpError(400, "invalid_input");
    return { bot: string(turn.bot), heard: string(turn.heard) };
  });
  return result;
}

function safeJoin(base, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split("?")[0]); }
  catch { throw httpError(400, "invalid_path"); }
  const p = path.normalize(path.join(base, decoded));
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  const file = safeJoin(PUBLIC, urlPath);
  if (!file) return send(res, 403, "Forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(file);
    fs.readFile(file, (e2, data) => {
      if (e2) return send(res, 500, "Error");
      send(res, 200, data, { "Content-Type": MIME[ext] || "application/octet-stream" });
    });
  });
}

function matchChip(text) {
  const t = (text || "").toLowerCase();
  let best = "bank";
  let score = 0;
  for (const [id, keys] of Object.entries(CHIP_KEYS)) {
    const n = keys.reduce((acc, k) => acc + (t.includes(k) ? 1 : 0), 0);
    if (n > score) {
      score = n;
      best = id;
    }
  }
  return best;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function applyFormalityToText(text, formality) {
  if (formality !== "du" || !text) return text;
  return text
    .replace(/\bKönnen Sie\b/g, "Kannst du")
    .replace(/\bKönnten Sie\b/g, "Könntest du")
    .replace(/\bHaben Sie\b/g, "Hast du")
    .replace(/\bMöchten Sie\b/g, "Möchtest du")
    .replace(/\bWollen Sie\b/g, "Willst du")
    .replace(/\bSind Sie\b/g, "Bist du")
    .replace(/\bBitte setzen Sie sich\b/g, "Setz dich bitte")
    .replace(/\bIhnen\b/g, "dir")
    .replace(/\bIhren\b/g, "deinen")
    .replace(/\bIhre\b/g, "deine")
    .replace(/\bIhr\b/g, "dein")
    .replace(/\bSie schauen\b/g, "Du schaust")
    .replace(/\bGuten Tag\b/g, "Hallo");
}

function applyFormality(situation, formality) {
  const s = clone(situation);
  s.formality = formality || s.formality || "Sie";
  if (s.formality !== "du") return s;
  s.title_de = applyFormalityToText(s.title_de, "du");
  s.lines = (s.lines || []).map((line) => ({
    ...line,
    de: applyFormalityToText(line.de, "du"),
  }));
  return s;
}

function situationFromDialogue(id) {
  const src = dialogues[id] || dialogues.bank;
  const s = clone(src);
  s.level = "B1";
  s.chip = id;
  s.formality = src.formality || "Sie";
  s.tips_hr = [...(s.tips_hr || []), "Reci cijelu rečenicu, ne samo da/ne."];
  return s;
}

function chatReplyFor(id) {
  const map = {
    bank: "Evo kratkog dijaloga za banku. Reci rečenicu naglas, pa prijeđi na razgovor.",
    job: "Evo razgovora za posao. Kratko tko si, iskustvo, kad možeš.",
    doctor: "Kod liječnika: što boli, od kad, trebaš li bolovanje.",
    amt: "Prijava boravišta. Termin, papiri, adresa — bez priče.",
    landlord: "Stan i stanodavac. Pitaj za režije i kauciju.",
    jobcenter: "Jobcenter. Ime, da tražiš posao, koje papire donijeti.",
    train: "Karta i Deutschlandticket. Pitaj gdje vrijedi.",
    abh: "Ausländerbehörde. Termin, putovnica, što još trebaju.",
    kita: "Vrtić. Dijete, od kada, cijeli dan, cijepljenje.",
    neighbor: "Susjedi. Predstavi se, tišina, smeće.",
    parcel: "Paket. Iskaznica, kod, potpis.",
    emergency: "Hitna. Što boli, od kad, kartica, alergije.",
  };
  return map[id] || "Evo dijaloga. Reci situaciju naglas.";
}

function looksNonGerman(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (/[čćžšđČĆŽŠĐ]/.test(t)) return true;
  const hr = /\b(ne|hvala|želim|zelim|imam|molim|dobro|što|sto|kako|zašto|zasto|račun|racun|liječnik|posao)\b/i;
  const en = /\b(i want|please|hello|my name|yes|thank you|doctor|account)\b/i;
  const de = /\b(ich|sie|du|haben|bin|ist|möchte|mochte|bitte|danke|und|nicht|ein|eine|der|die|das)\b/i;
  if (de.test(t)) return false;
  return hr.test(t) || en.test(t);
}

function heardHits(heard, want) {
  const t = (heard || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return (want || []).some((w) => t.includes(w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
}

function fallbackSituation(userText, difficulty = "standard", chip) {
  const id = chip || matchChip(userText);
  const situation = situationFromDialogue(id);
  situation.difficulty = difficulty;
  if (difficulty === "harder") {
    const challenge = challenges[id];
    situation.lines.push(
      { role: "other", de: challenge.question_de, hr: challenge.question_hr },
      { role: "you", de: challenge.help_de, hr: challenge.help_hr });
    situation.goal_hr += " " + challenge.goal_hr;
    situation.tips_hr.push("Teža verzija: odgovori na dodatno pitanje punom rečenicom.");
  }
  return {
    chat_reply_hr: chatReplyFor(id) + (difficulty === "harder" ? " Dodano je zahtjevnije pitanje za vježbu." : ""),
    situation,
    source: "fallback",
  };
}

function questionAt(script, stepIndex) {
  if (stepIndex <= 0) return script.opening;
  const prev = script.steps[Math.min(stepIndex - 1, script.steps.length - 1)];
  return { de: prev.reply_de, hr: prev.reply_hr, ask: true };
}

function fallbackTurn(body) {
  const situation = body.situation || {};
  const chip = situation.chip || matchChip(`${situation.title_de || ""} ${situation.title_hr || ""} ${body.user_text || ""}`);
  const script = clone(liveScripts[chip] || liveScripts.bank);
  if (situation.difficulty === "harder") {
    const challenge = challenges[chip] || challenges.bank;
    const previous = script.steps[script.steps.length - 2];
    script.steps.splice(-1, 0, {
      want: challenge.want, goal: challenge.goal_hr,
      help_de: challenge.help_de, help_hr: challenge.help_hr,
      reply_de: previous.reply_de, reply_hr: previous.reply_hr,
    });
    previous.reply_de = challenge.question_de;
    previous.reply_hr = challenge.question_hr;
    script.debrief_hr += " " + challenge.goal_hr;
  }
  const action = body.action || "heard";
  const heard = (body.heard || "").trim();
  const stepIndex = Number(body.step || 0);
  const misses = Number(body.misses || 0);
  const progress = Array.isArray(body.goal_progress) ? body.goal_progress.slice() : [];
  const formality = body.formality || situation.formality || "Sie";

  const wrap = (de) => applyFormalityToText(de, formality);
  const asked = questionAt(script, stepIndex);

  if (action === "done" || (stepIndex >= script.steps.length && action !== "start")) {
    return {
      in_character_de: wrap("Gut. Das war's. Einen schönen Tag!"),
      in_character_hr: "Dobro. To je to. Lijep dan!",
      ask: false,
      goal_progress: progress,
      coach: { heard, corrected_de: "", notes_hr: ["Gotovo. Pogledaj kratki pregled."], say_this_now_de: "" },
      scene_complete: true,
      debrief_hr: action === "done"
        ? "Vježba je završena. " + (progress.length ? "Prepoznate stavke: " + progress.join(", ") + "." : "Još nema prepoznatih ciljeva. Možeš ponovno pokušati uz ponuđene primjere.")
        : script.debrief_hr,
      step: stepIndex,
      misses: 0,
      source: "fallback",
    };
  }

  if (action === "start") {
    const open = script.opening;
    return {
      in_character_de: wrap(open.de),
      in_character_hr: open.hr,
      ask: true,
      goal_progress: [],
      coach: { heard: "", corrected_de: "", notes_hr: ["Odgovori naglas, kratkom njemačkom rečenicom."], say_this_now_de: script.steps[0].help_de },
      scene_complete: false,
      debrief_hr: "",
      step: 0,
      misses: 0,
      source: "fallback",
    };
  }

  const steps = script.steps;
  const current = steps[Math.min(stepIndex, steps.length - 1)];

  if (action === "repeat") {
    return {
      in_character_de: body.last_bot_de || wrap(asked.de),
      in_character_hr: body.last_bot_hr || asked.hr,
      ask: true,
      goal_progress: progress,
      coach: { heard, corrected_de: "", notes_hr: ["Isto pitanje, još jednom."], say_this_now_de: wrap(current.help_de) },
      scene_complete: false,
      debrief_hr: "",
      step: stepIndex,
      misses,
      source: "fallback",
    };
  }

  if (action === "dont_understand") {
    return {
      in_character_de: wrap("Natürlich. Langsamer: " + asked.de),
      in_character_hr: "Naravno. Sporije: " + asked.hr,
      ask: true,
      goal_progress: progress,
      coach: {
        heard,
        corrected_de: wrap(current.help_de),
        notes_hr: ["Slušaj sporije, pa reci svoju repliku."],
        say_this_now_de: wrap(current.help_de),
      },
      scene_complete: false,
      debrief_hr: "",
      step: stepIndex,
      misses,
      source: "fallback",
    };
  }

  if (action === "help") {
    return {
      in_character_de: wrap("Kein Problem. Sagen Sie das bitte."),
      in_character_hr: "Nema problema. Reci ovo, molim.",
      ask: true,
      goal_progress: progress,
      coach: {
        heard,
        corrected_de: wrap(current.help_de),
        notes_hr: ["Reci ovako, pa idemo dalje."],
        say_this_now_de: wrap(current.help_de),
      },
      scene_complete: false,
      debrief_hr: "",
      step: stepIndex,
      misses,
      source: "fallback",
    };
  }

  if (action === "check" || action === "free") {
    const matched = script.steps.filter((step) => heardHits(heard, step.want.filter((word) =>
      !["ja", "nein", "bitte", "danke", "hier", "wie", "was", "kann", "nur", "nicht"].includes(word))));
    const hit = !looksNonGerman(heard) && matched.length > 0;
    const notes = [];
    if (looksNonGerman(heard)) notes.push("Na njemačkom, ovako.");
    else if (!hit) notes.push("Nisam prepoznao ključne riječi ove situacije. Odgovor ipak može biti ispravan.");
    else notes.push("Prepoznate su ključne riječi situacije. Spremljena vježba ne provjerava gramatiku ni puno značenje.");
    const corrected = wrap(current.help_de);
    if (action === "check") {
      return {
        in_character_de: "",
        in_character_hr: "",
        ask: false,
        goal_progress: hit ? [...new Set(progress.concat(matched.map((step) => step.goal)))] : progress,
        coach: {
          heard,
          corrected_de: "",
          notes_hr: notes,
          say_this_now_de: corrected,
        },
        scene_complete: false,
        debrief_hr: "",
        step: stepIndex,
        misses,
        source: "fallback",
      };
    }
  }

  if (looksNonGerman(heard)) {
    return {
      in_character_de: wrap(asked.de),
      in_character_hr: asked.hr,
      ask: true,
      goal_progress: progress,
      coach: {
        heard,
        corrected_de: wrap(current.help_de),
        notes_hr: ["Na njemačkom, ovako.", current.help_hr],
        say_this_now_de: wrap(current.help_de),
      },
      scene_complete: false,
      debrief_hr: "",
      step: stepIndex,
      misses: misses + 1,
      source: "fallback",
    };
  }

  const ok = heardHits(heard, current.want);
  if (!ok) {
    const notes = ["Nisam prepoznao očekivane riječi. Pokušaj s ponuđenim primjerom."];
    if (misses >= 1) notes.push(current.help_hr);
    return {
      in_character_de: wrap(asked.de),
      in_character_hr: asked.hr,
      ask: true,
      goal_progress: progress,
      coach: {
        heard,
        corrected_de: "",
        notes_hr: notes,
        say_this_now_de: wrap(current.help_de),
      },
      scene_complete: false,
      debrief_hr: "",
      step: stepIndex,
      misses: misses + 1,
      source: "fallback",
    };
  }

  const nextIndex = stepIndex + 1;
  progress.push(current.goal);
  if (nextIndex >= steps.length) {
    return {
      in_character_de: wrap(current.reply_de),
      in_character_hr: current.reply_hr,
      ask: false,
      goal_progress: [...new Set(progress)],
      coach: {
        heard,
        corrected_de: "",
        notes_hr: ["Prepoznate su očekivane riječi. Gramatika nije provjerena."],
        say_this_now_de: "",
      },
      scene_complete: true,
      debrief_hr: script.debrief_hr,
      step: nextIndex,
      misses: 0,
      source: "fallback",
    };
  }

  const next = steps[nextIndex];
  return {
    in_character_de: wrap(current.reply_de),
    in_character_hr: current.reply_hr,
    ask: true,
    goal_progress: [...new Set(progress)],
    coach: {
      heard,
      corrected_de: "",
      notes_hr: ["Prepoznate su očekivane riječi. Gramatika nije provjerena."],
      say_this_now_de: wrap(next.help_de),
    },
    scene_complete: false,
    debrief_hr: "",
    step: nextIndex,
    misses: 0,
    source: "fallback",
  };
}

function parseJsonLoose(text) {
  const t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : t;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no json");
  return JSON.parse(raw.slice(start, end + 1));
}

function validateSituationPayload(data, level, formality) {
  if (!object(data)) {
    throw new Error("bad situation");
  }
  data.situation = validateSituation(data.situation);
  data.chat_reply_hr = string(data.chat_reply_hr, 2000, true);
  data.source = "llm";
  return data;
}

function validateTurnPayload(data) {
  if (!object(data) || !object(data.coach) || typeof data.ask !== "boolean" || typeof data.scene_complete !== "boolean") throw new Error("bad turn");
  data.in_character_de = string(data.in_character_de);
  data.in_character_hr = string(data.in_character_hr);
  for (const key of ["heard", "corrected_de", "say_this_now_de"]) data.coach[key] = string(data.coach[key]);
  data.coach.notes_hr = strings(data.coach.notes_hr, 2);
  data.goal_progress = strings(data.goal_progress);
  data.debrief_hr = string(data.debrief_hr);
  if (data.scene_complete) data.ask = false;
  data.source = "llm";
  return data;
}

async function llmChat(messages, timeoutMs = 18000) {
  if (!XAI_API_KEY) throw new Error("no key");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.4,
        messages,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error("llm http");
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty llm");
    return content;
  } finally {
    clearTimeout(t);
  }
}

async function handleChat(body) {
  const userText = String(body.message || body.text || "").slice(0, 2000);

  if (!userText) return fallbackSituation("banka");

  if (XAI_API_KEY) {
    try {
      const userPrompt = promptGenerate
        .replaceAll("{{user_text}}", userText)
        .replaceAll("{{level}}", "B1")
        .replaceAll("{{formality}}", "Sie") + (body.difficulty === "harder" ? "\nAdd a realistic complication and a response explaining a reason or an alternative. Keep B1 and Sie." : "");
      const content = await llmChat([
        { role: "system", content: promptSystem },
        { role: "user", content: userPrompt },
      ]);
      const data = validateSituationPayload(parseJsonLoose(content), "B1", "Sie");
      data.situation.chip = body.chip || matchChip(userText);
      data.situation.difficulty = body.difficulty || "standard";
      return data;
    } catch {
      // fall through to handwritten scripts — never leak provider errors to the UI
    }
  }
  return fallbackSituation(userText, body.difficulty, body.chip);
}

async function handleTurn(body) {
  if (XAI_API_KEY && !["repeat", "done"].includes(body.action)) {
    try {
      const userPrompt = promptTurn
        .replaceAll("{{situation_json}}", JSON.stringify(body.situation || {}))
        .replaceAll("{{goal_hr}}", body.situation?.goal_hr || "")
        .replaceAll("{{level}}", "B1")
        .replaceAll("{{formality}}", body.situation?.formality || "Sie")
        .replaceAll("{{turn}}", String(body.turn || 1))
        .replaceAll("{{action}}", body.action || "heard")
        .replaceAll("{{heard}}", String(body.heard || ""))
        .replaceAll("{{history}}", JSON.stringify(body.history || []).slice(0, 4000));
      const content = await llmChat([
        { role: "system", content: promptSystem },
        { role: "user", content: userPrompt },
      ]);
      const data = validateTurnPayload(parseJsonLoose(content));
      data.coach.heard = body.heard || "";
      if (body.action === "check") {
        data.in_character_de = "";
        data.in_character_hr = "";
        data.ask = false;
        data.scene_complete = false;
      } else if (!data.in_character_de || (!data.scene_complete && !data.ask)) {
        throw new Error("missing question");
      }
      data.step = body.step;
      data.misses = body.misses;
      return data;
    } catch {
      // handwritten live script
    }
  }
  return fallbackTurn(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url.split("?")[0];
    if (req.method === "GET" && (urlPath === "/api/health" || urlPath === "/health")) {
      sendJson(res, 200, {
        ok: true,
        app: "njemackiudzepu",
        llm: Boolean(XAI_API_KEY),
      });
      return;
    }
    if (req.method === "POST" && urlPath === "/api/chat") {
      const body = await readRequest(req, "chat");
      const data = await handleChat(body);
      sendJson(res, 200, data);
      return;
    }
    if (req.method === "POST" && urlPath === "/api/turn") {
      const body = await readRequest(req, "turn");
      const data = await handleTurn(body);
      sendJson(res, 200, data);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }
    send(res, 405, "Method not allowed");
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.status ? error.message : "server" });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`njemackiudzepu http://${HOST}:${PORT}\n`);
  });
}

module.exports = { server };
