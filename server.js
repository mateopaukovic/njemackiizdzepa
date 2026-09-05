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
};

const dialogues = JSON.parse(fs.readFileSync(path.join(ROOT, "data/dialogues.json"), "utf8"));
const liveScripts = JSON.parse(fs.readFileSync(path.join(ROOT, "data/live-scripts.json"), "utf8"));
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
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeJoin(base, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const p = path.normalize(path.join(base, decoded));
  if (!p.startsWith(base)) return null;
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

function bumpLevel(level) {
  return { A1: "A2", A2: "B1", B1: "B2", B2: "B2" }[level] || "B1";
}

function situationFromDialogue(id, level, formality) {
  const src = dialogues[id] || dialogues.bank;
  const s = applyFormality(src, formality || src.formality);
  s.level = level || src.level || "A2";
  s.chip = id;
  if (s.level === "B1" || s.level === "B2") {
    s.tips_hr = [...(s.tips_hr || []), "Na višoj razini reci cijelu rečenicu, ne samo da/ne."];
  }
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
  const hr = /\b(da|ne|hvala|želim|zelim|imam|molim|dobro|što|sto|kako|zašto|zasto|račun|racun|liječnik|posao)\b/i;
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

function fallbackSituation(userText, level, formality) {
  const id = matchChip(userText);
  const situation = situationFromDialogue(id, level, formality);
  return {
    chat_reply_hr: chatReplyFor(id),
    situation,
    source: "fallback",
  };
}

function questionAt(script, stepIndex) {
  if (stepIndex <= 0) return script.opening;
  const prev = script.steps[stepIndex - 1];
  return { de: prev.reply_de, hr: prev.reply_hr, ask: true };
}

function fallbackTurn(body) {
  const situation = body.situation || {};
  const chip = situation.chip || matchChip(`${situation.title_de || ""} ${situation.title_hr || ""} ${body.user_text || ""}`);
  const script = liveScripts[chip] || liveScripts.bank;
  const action = body.action || "heard";
  const heard = (body.heard || "").trim();
  const stepIndex = Number(body.step || 0);
  const misses = Number(body.misses || 0);
  const progress = Array.isArray(body.goal_progress) ? body.goal_progress.slice() : [];
  const formality = body.formality || situation.formality || "Sie";

  const wrap = (de) => applyFormalityToText(de, formality);
  const asked = questionAt(script, stepIndex);

  if (action === "done") {
    return {
      in_character_de: wrap("Gut. Das war's. Einen schönen Tag!"),
      in_character_hr: "Dobro. To je to. Lijep dan!",
      ask: false,
      goal_progress: progress,
      coach: { heard, corrected_de: "", notes_hr: ["Gotovo. Pogledaj kratki pregled."], say_this_now_de: "" },
      scene_complete: true,
      debrief_hr: script.debrief_hr,
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
    const youLines = (situation.lines || []).filter((l) => l.role === "you").map((l) => l.de);
    const hit = youLines.some((l) => heardHits(heard, l.split(/\s+/).slice(0, 4))) || heardHits(heard, current.want);
    const notes = [];
    if (looksNonGerman(heard)) notes.push("Na njemačkom, ovako.");
    else if (!hit) notes.push("Cilj još nije jasno rečen. Kratka rečenica, kao na šalteru.");
    else notes.push("Super. Tako se kaže.");
    const corrected = wrap(current.help_de);
    if (action === "check") {
      return {
        in_character_de: "",
        in_character_hr: "",
        ask: false,
        goal_progress: hit ? [...new Set(progress.concat(current.goal))] : progress,
        coach: {
          heard,
          corrected_de: corrected,
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

  const ok = heardHits(heard, current.want) || (misses >= 2 && heard.length > 8);
  if (!ok) {
    const notes = ["Još nije to. Reci ovako:"];
    if (misses >= 1) notes.push(current.help_hr);
    return {
      in_character_de: wrap(asked.de),
      in_character_hr: asked.hr,
      ask: true,
      goal_progress: progress,
      coach: {
        heard,
        corrected_de: wrap(current.help_de),
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
        corrected_de: wrap(current.help_de),
        notes_hr: ["Super. Tako se kaže."],
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
      corrected_de: heard.length > 3 ? "" : wrap(current.help_de),
      notes_hr: ["Super. Tako se kaže."],
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
  if (!data || !data.situation || !Array.isArray(data.situation.lines) || data.situation.lines.length < 4) {
    throw new Error("bad situation");
  }
  data.situation.level = data.situation.level || level;
  data.situation.formality = data.situation.formality || formality;
  data.chat_reply_hr = data.chat_reply_hr || "Evo dijaloga. Reci ga naglas.";
  data.source = "llm";
  return data;
}

function validateTurnPayload(data) {
  if (!data || typeof data.in_character_de !== "string") throw new Error("bad turn");
  data.coach = data.coach || {};
  data.coach.heard = data.coach.heard || "";
  data.coach.corrected_de = data.coach.corrected_de || "";
  data.coach.notes_hr = Array.isArray(data.coach.notes_hr) ? data.coach.notes_hr : [];
  data.coach.say_this_now_de = data.coach.say_this_now_de || "";
  data.goal_progress = Array.isArray(data.goal_progress) ? data.goal_progress : [];
  data.ask = data.ask !== false;
  data.scene_complete = !!data.scene_complete;
  data.debrief_hr = data.debrief_hr || "";
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
  const level = body.level || "A2";
  const formality = body.formality || "Sie";
  const harder = !!body.harder;
  const useLevel = harder ? bumpLevel(level) : level;

  if (!userText) return fallbackSituation("banka", useLevel, formality);

  if (XAI_API_KEY) {
    try {
      const userPrompt = promptGenerate
        .replaceAll("{{user_text}}", userText)
        .replaceAll("{{level}}", useLevel)
        .replaceAll("{{formality}}", formality);
      const content = await llmChat([
        { role: "system", content: promptSystem },
        { role: "user", content: userPrompt },
      ]);
      const data = validateSituationPayload(parseJsonLoose(content), useLevel, formality);
      data.situation.chip = matchChip(userText);
      return data;
    } catch {
      // fall through to handwritten scripts — never leak provider errors to the UI
    }
  }
  return fallbackSituation(userText, useLevel, formality);
}

async function handleTurn(body) {
  if (XAI_API_KEY && body.action !== "repeat") {
    try {
      const userPrompt = promptTurn
        .replaceAll("{{situation_json}}", JSON.stringify(body.situation || {}))
        .replaceAll("{{goal_hr}}", body.situation?.goal_hr || "")
        .replaceAll("{{level}}", body.level || body.situation?.level || "A2")
        .replaceAll("{{formality}}", body.formality || body.situation?.formality || "Sie")
        .replaceAll("{{turn}}", String(body.turn || 1))
        .replaceAll("{{action}}", body.action || "heard")
        .replaceAll("{{heard}}", String(body.heard || ""))
        .replaceAll("{{history}}", JSON.stringify(body.history || []).slice(0, 4000));
      const content = await llmChat([
        { role: "system", content: promptSystem },
        { role: "user", content: userPrompt },
      ]);
      const data = validateTurnPayload(parseJsonLoose(content));
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
        app: "njemackuudzepu",
        llm: Boolean(XAI_API_KEY),
      });
      return;
    }
    if (req.method === "POST" && urlPath === "/api/chat") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const data = await handleChat(body);
      sendJson(res, 200, data);
      return;
    }
    if (req.method === "POST" && urlPath === "/api/turn") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const data = await handleTurn(body);
      sendJson(res, 200, data);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }
    send(res, 405, "Method not allowed");
  } catch {
    sendJson(res, 500, { error: "server" });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`njemackuudzepu http://${HOST}:${PORT}\n`);
});
