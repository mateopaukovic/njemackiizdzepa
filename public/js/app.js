(function () {
  const UI = window.UI;
  const LS = "njemackiudzepu.v2";
  const LS_OLD = ["njemackuudzepu.v2", "njemackuudzepu.v1", "njemackiizdzepa.v1"];
  let generation = null;
  let practiceVersion = 0;
  let practiceRequest = null;
  let lastThreadRender = "";

  const state = {
    settings: {
      level: "B1",
      formality: "Sie",
      rate: 1,
      autoMic: true,
      voiceCorrect: false,
    },
    chats: [],
    currentId: "",
    messages: [],
    situation: null,
    mode: "text",
    lineResults: {},
    hiddenCheck: null,
    live: null,
    liveView: null,
    liveStatus: "idle",
    debrief: null,
    onlyMine: false,
    panel: "home",
    error: "",
    chromeOk: true,
    dictating: false,
    failedRequest: null,
    savedSentences: [],
    reviewResults: {},
    practice: null,
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function blankChat() {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title: UI.untitled,
      messages: [],
      situation: null,
      mode: "text",
      debrief: null,
      lineResults: {},
      hiddenCheck: null,
      onlyMine: false,
      updatedAt: Date.now(),
    };
  }

  function snapshotChat() {
    const c = state.chats.find((x) => x.id === state.currentId);
    if (!c) return;
    c.messages = state.messages.filter((m) => !m.typing).slice(-40);
    c.situation = state.situation;
    c.mode = state.mode;
    c.debrief = state.debrief;
    c.lineResults = state.lineResults;
    c.hiddenCheck = state.hiddenCheck;
    c.onlyMine = state.onlyMine;
    c.failedRequest = state.failedRequest;
    c.draft = $("composer-input").value;
    c.updatedAt = Date.now();
    const first = c.messages.find((m) => m.role === "user");
    if (first) c.title = first.text.slice(0, 42);
  }

  function hydrateChat(c) {
    state.currentId = c.id;
    state.messages = c.messages || [];
    state.situation = c.situation || null;
    state.mode = c.mode === "hidden" ? "hidden" : "text";
    state.debrief = c.debrief || null;
    state.lineResults = c.lineResults || {};
    state.hiddenCheck = c.hiddenCheck || null;
    state.onlyMine = !!c.onlyMine;
    state.live = null;
    state.liveView = null;
    state.liveStatus = "idle";
    state.failedRequest = c.failedRequest || null;
    state.error = state.failedRequest ? UI.generationFailed : "";
    $("composer-input").value = c.draft || state.failedRequest?.message || "";
    growComposer();
  }

  function load() {
    try {
      const keys = [LS].concat(LS_OLD);
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (Array.isArray(data.savedSentences)) {
          const seen = new Set();
          state.savedSentences = data.savedSentences.filter((line) => {
            if (!line || typeof line.de !== "string" || !line.de.trim() || typeof line.hr !== "string" || seen.has(line.de)) return false;
            seen.add(line.de);
            return true;
          }).slice(0, 100).map((line) => ({ de: line.de, hr: line.hr }));
        }
        if (data.settings) state.settings = { ...state.settings, ...data.settings };
        if (Array.isArray(data.chats) && data.chats.length) {
          state.chats = data.chats;
          const cur = data.chats.find((c) => c.id === data.currentId) || data.chats[0];
          hydrateChat(cur);
          return;
        }
        if (Array.isArray(data.messages) && data.messages.length) {
          const c = blankChat();
          c.messages = data.messages;
          c.situation = data.situation || null;
          c.mode = data.mode || "text";
          c.debrief = data.debrief || null;
          const first = c.messages.find((m) => m.role === "user");
          if (first) c.title = first.text.slice(0, 42);
          state.chats = [c];
          hydrateChat(c);
          return;
        }
      }
    } catch {
      /* ignore bad local data */
    }
    const c = blankChat();
    state.chats = [c];
    hydrateChat(c);
  }

  function save() {
    try {
      snapshotChat();
      localStorage.setItem(
        LS,
        JSON.stringify({
          settings: state.settings,
          chats: state.chats.slice(0, 40),
          currentId: state.currentId,
          savedSentences: state.savedSentences,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(el, text, cls) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "status " + (cls || "");
  }

  function renderChrome() {
    $("wordmark").textContent = UI.name;
    $("side-wordmark").textContent = UI.name;
    $("composer-input").placeholder = UI.inputPlaceholder;
    $("btn-send").setAttribute("aria-label", UI.send);
    $("btn-dictate").setAttribute("aria-label", UI.dictate);
    $("btn-new-label").textContent = UI.newChat;
    $("btn-retry-failed").textContent = UI.retry;
    $("label-chats").textContent = UI.chats;
    $("btn-settings-label").textContent = UI.settings;
    $("btn-about-label").textContent = UI.about;
    $("btn-profile-label").textContent = UI.profile;
    $("btn-profile-sub").textContent = UI.name;
    $("chrome-warning").textContent = UI.chromeWarning;
    $("chrome-warning").hidden = state.chromeOk;
  }

  function renderSidebar() {
    const list = $("chat-list");
    list.innerHTML = state.chats
      .map(
        (c) => `<div class="chat-item${c.id === state.currentId ? " on" : ""}">
          <button type="button" class="open" data-open="${esc(c.id)}">${esc(c.title || UI.untitled)}</button>
          <button type="button" class="del" data-del="${esc(c.id)}" aria-label="${esc(UI.deleteChat)}">×</button>
        </div>`
      )
      .join("");
  }

  function renderMessages() {
    const box = $("thread");
    const threadKey = state.currentId + JSON.stringify(state.messages);
    const changed = lastThreadRender !== threadKey;
    lastThreadRender = threadKey;
    if (!state.messages.length) {
      const steps = (UI.heroSteps || [])
        .map((s, i) => `<li><b>${i + 1}</b> ${esc(s)}</li>`)
        .join("");
      const examples = (UI.examples || [])
        .map((t) => `<button type="button" class="example" data-example="${esc(t)}">${esc(t)}</button>`)
        .join("");
      box.innerHTML = `<div class="hero">
        <p class="hero-lead">${esc(UI.heroLead)}</p>
        <ol class="hero-steps">${steps}</ol>
        <div class="hero-examples">${examples}</div>
      </div>`;
      return;
    }
    const last = state.messages.length - 1;
    box.innerHTML = state.messages
      .map((m, i) => {
        if (m.role === "user") {
          return `<div class="row-msg me"><div class="bubble me">${esc(m.text)}</div></div>`;
        }
        if (m.typing) {
          return `<div class="row-msg"><div class="typing" aria-label="${esc(UI.writing)}"><i></i><i></i><i></i></div></div>`;
        }
        return `<div class="row-msg">
          <div class="bubble bot">${esc(m.text)}${m.fallback ? `<div class="muted tiny">${esc(UI.fallbackNote)}</div>` : ""}</div>
          <div class="msg-actions">
            <button type="button" data-copy="${i}">${esc(UI.copy)}</button>
            ${i === last ? `<button type="button" data-retry="${i}">${esc(UI.retry)}</button>` : ""}
          </div>
        </div>`;
      })
      .join("");
    const sc = document.querySelector(".scroll");
    if (sc && changed && state.panel === "home") sc.scrollTop = sc.scrollHeight;
  }

  function lineButtons(i, line) {
    return `
      <div class="line-actions">
        <button type="button" data-act="play" data-i="${i}">${esc(UI.play)}</button>
        ${line.role === "you" ? `<button type="button" class="primary" data-act="recite" data-i="${i}">${esc(UI.recite)}</button>` : ""}
        <button type="button" data-act="slow" data-i="${i}">${esc(UI.slow)}</button>
        <button type="button" data-act="save" data-i="${i}" aria-pressed="${state.savedSentences.some((saved) => saved.de === line.de)}">${esc(state.savedSentences.some((saved) => saved.de === line.de) ? UI.sentenceSaved : UI.saveSentence)}</button>
      </div>`;
  }

  function practiceStatus(target) {
    const status = state.practice?.target === target ? state.practice : null;
    return `<p id="${target}-status" class="practice-status ${esc(status?.kind || "")}" role="status" aria-live="polite">${esc(status?.text || "")}</p>
      <button type="button" id="${target}-stop" data-stop-practice ${status?.active ? "" : "hidden"}>${esc(UI.stop)}</button>`;
  }

  function setPracticeStatus(target, text, kind = "", active = false) {
    const previous = state.practice?.target;
    if (previous && previous !== target) {
      if ($(`${previous}-status`)) $(`${previous}-status`).textContent = "";
      if ($(`${previous}-stop`)) $(`${previous}-stop`).hidden = true;
    }
    state.practice = text ? { target, text, kind, active } : null;
    const el = $(`${target}-status`);
    if (el) {
      el.textContent = text;
      el.className = "practice-status " + kind;
    }
    if ($(`${target}-stop`)) $(`${target}-stop`).hidden = !active;
  }

  function renderResult(res) {
    if (!res) return "";
    return `<div class="result">
      <p>${esc(UI.heard)} <em>${esc(res.heard)}</em></p>
      <p>${esc(UI.score)}: <strong>${res.score}%</strong></p>
      <p class="muted tiny">${esc(UI.scoreExplanation)}</p>
      <p class="band ${esc(res.band)}">${esc(res.note)}</p>
      ${renderDiffs(res.diffs)}
    </div>`;
  }

  function renderReview() {
    $("review").innerHTML = `<h2 id="review-title">${esc(UI.review)}</h2>
      <p class="muted">${esc(UI.reviewLocal)}</p>
      <button type="button" id="btn-review-back">${esc(UI.backToPractice)}</button>
      ${state.savedSentences.length ? state.savedSentences.map((line, i) => `<article class="line">
        <p class="de">${esc(line.de)}</p><p class="hr">${esc(line.hr)}</p>
        <div class="line-actions">
          <button type="button" data-review-act="play" data-i="${i}">${esc(UI.play)}</button>
          <button type="button" data-review-act="recite" data-i="${i}">${esc(UI.recite)}</button>
          <button type="button" data-review-act="remove" data-i="${i}">${esc(UI.removeSentence)}</button>
        </div>
        ${practiceStatus(`review-${i}`)}
        ${renderResult(state.reviewResults[i])}
      </article>`).join("") : `<p>${esc(UI.reviewEmpty)}</p>`}`;
  }

  function toggleSaved(line) {
    if (!line) return;
    const previous = state.savedSentences;
    const exists = previous.some((saved) => saved.de === line.de);
    if (!exists && previous.length >= 100) {
      state.error = UI.reviewFull;
      render();
      return;
    }
    stopLive();
    state.savedSentences = exists ? previous.filter((saved) => saved.de !== line.de) : [...previous, { de: line.de, hr: line.hr }];
    state.reviewResults = {};
    if (!save()) {
      state.savedSentences = previous;
      state.error = UI.storageFull;
    } else state.error = "";
    render();
  }

  function renderDiffs(diff) {
    if (!diff) return "";
    return `<p class="diffs">${diff.parts
      .map((p) => {
        if (p.type === "ok") return `<span class="ok">${esc(p.expected)}</span>`;
        if (p.type === "near") return `<span class="near">${esc(p.heard)}→${esc(p.expected)}</span>`;
        if (p.type === "miss") return `<span class="miss">${esc(p.expected)}</span>`;
        return `<span class="extra">${esc(p.heard)}</span>`;
      })
      .join(" ")}</p>`;
  }

  function renderCard() {
    const host = $("card");
    const openHelp = new Set(Array.from(host.querySelectorAll("details[data-help][open]"), (el) => el.getAttribute("data-help")));
    const typedValue = $("typed-input")?.value || "";
    const typedFocused = document.activeElement === $("typed-input");
    const s = state.situation;
    if (!s) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    const lines = s.lines || [];
    const showLines = state.mode === "text" && !state.onlyMine;
    const mine = lines.filter((l) => l.role === "you");
    const visibleLines = state.onlyMine ? mine : lines;

    let body = "";
    if (state.mode === "live") {
      body = renderLive();
    } else if (state.mode === "hidden") {
      body = `
        <p class="goal"><strong>${esc(UI.goal)}.</strong> ${esc(s.goal_hr)}</p>
        <p class="muted">${esc(s.role_other_hr)} · ${esc(s.formality)} · ${esc(s.level)}</p>
        <button type="button" class="primary big" id="btn-hidden-talk">${esc(UI.recite)}</button>
        <button type="button" id="btn-free">${esc(UI.freeTalk)}</button>
        ${practiceStatus("hidden-practice")}
        ${state.hiddenCheck ? renderCoach(state.hiddenCheck) : ""}`;
    } else {
      const list = (state.onlyMine ? mine : visibleLines)
        .map((line, i) => {
          const idx = state.onlyMine ? lines.indexOf(line) : i;
          const res = state.lineResults[idx];
          const who = line.role === "you" ? UI.you : UI.otherPerson;
          return `<article class="line" data-i="${idx}">
            <div class="who">${esc(who)}</div>
            <p class="de">${esc(line.de)}</p>
            <p class="hr">${esc(line.hr)}</p>
            ${lineButtons(idx, line)}
            ${practiceStatus(`line-${idx}`)}
            ${renderResult(res)}
          </article>`;
        })
        .join("");
      body = `
        <p class="goal"><strong>${esc(UI.goal)}.</strong> ${esc(s.goal_hr)}</p>
        <details class="practice-help" data-help="vocab" ${openHelp.has("vocab") ? "open" : ""}><summary>${esc(UI.vocab)}</summary><div class="vocab">${(s.vocab || [])
          .map((v) => `<span><b>${esc(v.de)}</b> ${esc(v.hr)}</span>`)
          .join("")}</div></details>
        <details class="practice-help" data-help="tips" ${openHelp.has("tips") ? "open" : ""}><summary>${esc(UI.tips)}</summary><ul>${(s.tips_hr || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>
        ${state.mode === "text" && !state.onlyMine ? `<button type="button" id="btn-hide">${esc(UI.hideScript)}</button>` : ""}
        ${state.onlyMine ? `<h3>${esc(UI.yourLines)}</h3>` : ""}
        ${showLines || state.onlyMine ? list : ""}`;
    }

    host.innerHTML = `
      <header class="card-head">
        <h2>${esc(s.title_de)}</h2>
        <p class="hr">${esc(s.title_hr)} · ${esc(s.role_other_hr)}</p>
        ${state.mode !== "live" ? `<button type="button" class="primary" id="btn-start-live">${esc(UI.startLive)}</button>` : ""}
      </header>
      <nav class="mode-controls" aria-label="${esc(UI.practiceModes)}">
        ${Object.entries(UI.modes).map(([mode, label]) => `<button type="button" data-mode="${mode}" aria-pressed="${state.mode === mode}" ${generation ? "disabled" : ""}>${esc(label)}</button>`).join("")}
      </nav>
      ${body}
      ${renderDebrief()}`;
    if ($("typed-input")) {
      $("typed-input").value = typedValue;
      if (typedFocused && !$("typed-input").disabled) $("typed-input").focus();
    }
  }

  function renderCoach(coach) {
    if (!coach) return "";
    const notes = (coach.notes_hr || []).map((n) => `<li>${esc(n)}</li>`).join("");
    return `<div class="coach">
      ${coach.heard ? `<p>${esc(UI.heard)} <em>${esc(coach.heard)}</em></p>` : ""}
      ${notes ? `<ul>${notes}</ul>` : ""}
      ${coach.say_this_now_de ? `<p class="say">${esc(UI.sayThis)} <button type="button" class="link" data-act="say-now" ${state.mode === "live" && (state.liveView?.busy || state.liveView?.paused || state.liveView?.complete) ? "disabled" : ""}>${esc(coach.say_this_now_de)}</button></p>` : ""}
      ${coach.corrected_de && coach.corrected_de !== coach.say_this_now_de ? `<p class="de">${esc(coach.corrected_de)}</p>` : ""}
    </div>`;
  }

  function renderLive() {
    const v = state.liveView || { lastBot: { de: "", hr: "" }, lastCoach: null };
    const st = state.liveStatus;
    const complete = !!v.complete;
    const disabled = v.busy || v.paused || complete ? "disabled" : "";
    const statusText =
      complete ? UI.sceneEnd : st === "error" ? UI.genericError
        : st === "preparing" ? UI.preparingMic
        : st === "processing" ? UI.processing
        : st.startsWith("speech-") ? (UI.speechErrors[st.slice(7)] || UI.speechFailed)
        : st === "listening"
        ? UI.listening
        : st === "mic-denied"
          ? UI.speechErrors["not-allowed"]
          : st === "paused"
            ? UI.pause
            : st === "thinking"
              ? UI.thinking
              : st === "talking"
                ? UI.play
                : UI.waitingMic;
    const paused = v.paused;
    return `
      <p class="goal"><strong>${esc(UI.goal)}.</strong> ${esc(state.situation.goal_hr)}</p>
      <div class="live-line">
        <div class="kicker">${esc(UI.otherPerson)}</div>
        <p class="de big-de">${esc(v.lastBot.de || "…")}</p>
        <details>
          <summary>${esc(UI.translation)}</summary>
          <p class="hr">${esc(v.lastBot.hr || "")}</p>
        </details>
      </div>
      ${renderCoach(v.lastCoach)}
      <p class="status ${esc(st)}" role="status" aria-live="polite">${esc(statusText)}</p>
      <div class="live-controls">
        <button type="button" class="mic" id="btn-answer" ${disabled}>${esc(UI.answer)}</button>
        <button type="button" id="btn-live-pause" ${complete ? "disabled" : ""}>${esc(paused ? UI.resume : UI.pause)}</button>
        <button type="button" data-live="repeat" ${disabled}>${esc(UI.repeat)}</button>
        <button type="button" data-live="help" ${disabled}>${esc(UI.help)}</button>
        <button type="button" data-live="huh" ${disabled}>${esc(UI.dontUnderstand)}</button>
        <button type="button" data-live="done" ${complete ? "disabled" : ""}>${esc(UI.done)}</button>
      </div>
      <form id="typed-form" class="typed">
        <label>${esc(UI.typeFallback)}</label>
        <input id="typed-input" autocomplete="off" maxlength="2000" ${disabled} />
        <button type="submit" ${disabled}>${esc(UI.send)}</button>
      </form>`;
  }

  function renderDebrief() {
    if (!state.debrief) return "";
    return `<section class="debrief">
      <h3>${esc(UI.debrief)}</h3>
      <p>${esc(state.debrief.text)}</p>
      ${state.debrief.progress?.length ? `<p class="muted">${esc(UI.goal)}: ${esc(state.debrief.progress.join(" · "))}</p>` : ""}
      <div class="row">
        <button type="button" id="btn-same">${esc(UI.sameScene)}</button>
        <button type="button" id="btn-harder">${esc(UI.harder)}</button>
        <button type="button" id="btn-mine">${esc(UI.onlyMine)}</button>
      </div>
    </section>`;
  }

  function renderSettings() {
    $("dlg-settings-title").textContent = UI.settings;
    $("set-rate-label").textContent = UI.voiceSpeed;
    $("set-mic-label").textContent = UI.autoMic;
    $("set-voice-label").textContent = UI.correctAloud;
    $("set-rate").value = state.settings.rate;
    $("set-mic").checked = state.settings.autoMic;
    $("set-voice").checked = state.settings.voiceCorrect;
  }

  function renderAbout() {
    $("dlg-about-title").textContent = UI.about;
    $("about-body").innerHTML = `
      <p><strong>${esc(UI.name)}</strong></p>
      <p>${esc(UI.aboutBody.meaning)}</p>
      <p>${esc(UI.aboutBody.who)}</p>
      <p>${esc(UI.aboutBody.privacy)}</p>`;
  }

  function render() {
    renderMessages();
    renderCard();
    renderSidebar();
    renderReview();
    const review = state.panel === "review";
    $("review").hidden = !review;
    $("thread").hidden = review;
    $("card").hidden = review || !state.situation;
    document.querySelector(".dock").hidden = review;
    $("btn-review-label").textContent = `${UI.review} (${state.savedSentences.length})`;
    $("btn-review").setAttribute("aria-pressed", String(review));
    $("error-message").textContent = state.error;
    $("error").hidden = !state.error;
    $("btn-retry-failed").hidden = review || !state.failedRequest || !!generation;
    $("btn-send").disabled = !!generation;
    $("card").querySelectorAll("button, input").forEach((el) => {
      if (generation) el.disabled = true;
    });
    if (state.mode === "live") bindLive();
  }

  function cancelGeneration() {
    if (!generation) return;
    generation.abort();
    generation = null;
    state.messages = state.messages.filter((m) => !m.typing);
  }

  async function sendSituation(text, extra = {}, retry = false) {
    const message = (text || "").trim();
    if (!message) return;
    cancelGeneration();
    stopLive();
    state.mode = "text";
    state.panel = "home";
    const request = new AbortController();
    const chatId = state.currentId;
    generation = request;
    state.error = "";
    state.failedRequest = null;
    if (!retry || lastUserText() !== message) state.messages.push({ role: "user", text: message });
    state.messages.push({ role: "bot", typing: true, text: "" });
    state.debrief = null;
    state.hiddenCheck = null;
    state.lineResults = {};
    state.onlyMine = false;
    render();
    try {
      const data = await window.Chat.generateSituation(message, state.settings, extra, request.signal);
      if (generation !== request || state.currentId !== chatId) return;
      state.messages.pop();
      state.messages.push({
        role: "bot",
        text: data.chat_reply_hr,
        fallback: data.source === "fallback",
      });
      state.situation = data.situation;
      state.mode = "text";
      save();
    } catch (error) {
      if (generation !== request || state.currentId !== chatId || error.name === "AbortError") return;
      state.messages.pop();
      state.failedRequest = { message, extra };
      state.error = error.status === 400 ? UI.invalidInput : UI.generationFailed;
      if (!$("composer-input").value) {
        $("composer-input").value = message;
        growComposer();
      }
      save();
    }
    generation = null;
    render();
  }

  async function playLine(i, slow, review = false) {
    const line = review ? state.savedSentences[i] : state.situation?.lines?.[i];
    if (!line) return;
    stopLive();
    const version = practiceVersion;
    const target = `${review ? "review" : "line"}-${i}`;
    setPracticeStatus(target, UI.play, "", true);
    const completed = await window.Speech.speak(line.de, { rate: state.settings.rate, slow: !!slow });
    if (version !== practiceVersion) return;
    setPracticeStatus(target, completed ? "" : UI.voiceFailed, completed ? "" : "error");
  }

  async function reciteLine(i, review = false) {
    const line = review ? state.savedSentences[i] : state.situation?.lines?.[i];
    if (!line) return;
    stopLive();
    const target = `${review ? "review" : "line"}-${i}`;
    if (!window.Speech.hasRecognition()) {
      setPracticeStatus(target, UI.chromeWarning, "error");
      return;
    }
    const version = practiceVersion;
    setPracticeStatus(target, UI.play, "", true);
    const completed = await window.Speech.speak(line.de, { rate: state.settings.rate });
    if (version !== practiceVersion) return;
    if (!completed) {
      setPracticeStatus(target, UI.voiceFailed, "error");
      return;
    }
    listenForPractice(target, (heard) => {
      const scored = window.Scoring.score(line.de, heard);
      (review ? state.reviewResults : state.lineResults)[i] = { heard, ...scored };
      save();
      render();
    });
  }

  function listenForPractice(target, onResult, lang = "de-DE") {
    const version = practiceVersion;
    let settled = false;
    const current = () => version === practiceVersion;
    const finishDictation = () => {
      if (target !== "composer") return;
      state.dictating = false;
      $("btn-dictate").classList.remove("on");
    };
    setPracticeStatus(target, UI.preparingMic, "", true);
    window.Speech.listen({
      lang,
      onstart: () => {
        if (current() && !settled) setPracticeStatus(target, UI.listening, "listening", true);
      },
      onspeechend: () => {
        if (current() && !settled) setPracticeStatus(target, UI.processing, "", true);
      },
      onresult: async (heard) => {
        if (!current() || settled) return;
        settled = true;
        window.Speech.stopRecognition();
        finishDictation();
        if (!heard.trim()) {
          setPracticeStatus(target, UI.noSpeech, "error");
          return;
        }
        setPracticeStatus(target, UI.processing, "", true);
        try {
          await onResult(heard);
          if (current()) setPracticeStatus(target, target === "composer" ? "" : UI.practiceComplete);
        } catch (error) {
          if (!current() || error.name === "AbortError") return;
          setPracticeStatus(target, UI.genericError, "error");
        }
      },
      onerror: (ev) => {
        if (!current() || settled) return;
        settled = true;
        window.Speech.stopRecognition();
        finishDictation();
        setPracticeStatus(target, UI.speechErrors[ev?.error] || UI.speechFailed, "error");
      },
      onend: () => {
        if (!current() || settled) return;
        settled = true;
        finishDictation();
        setPracticeStatus(target, UI.noSpeech, "error");
      },
    });
  }

  async function hiddenTalk() {
    stopLive();
    if (!window.Speech.hasRecognition()) {
      setPracticeStatus("hidden-practice", UI.chromeWarning, "error");
      return;
    }
    const version = practiceVersion;
    listenForPractice("hidden-practice", async (heard) => {
      practiceRequest = new AbortController();
      const data = await window.Chat.turn({
        action: "check",
        heard,
        situation: state.situation,
        level: state.settings.level,
        formality: state.settings.formality,
        step: 0,
        misses: 0,
        turn: 1,
        history: [],
      }, practiceRequest.signal);
      if (version !== practiceVersion) return;
      state.hiddenCheck = data.coach;
      save();
      render();
    });
  }

  function stopLive() {
    if (state.practice) setPracticeStatus(state.practice.target, "");
    practiceVersion += 1;
    if (practiceRequest) practiceRequest.abort();
    practiceRequest = null;
    if (state.live) state.live.stop();
    window.Speech.stopAll();
    state.dictating = false;
    $("btn-dictate").classList.remove("on");
    state.live = null;
    state.liveView = null;
    state.liveStatus = "idle";
  }

  function startLive() {
    if (!state.situation || generation) return;
    stopLive();
    state.mode = "live";
    state.debrief = null;
    state.live = window.Conversation.create({
      situation: state.situation,
      settings: state.settings,
      onRender: (snap) => {
        state.liveView = snap;
        renderCard();
        bindLive();
      },
      onDebrief: (text, progress) => {
        state.debrief = { text, progress };
        save();
        render();
      },
      onStatus: (s) => {
        state.liveStatus = s;
        if (s === "mic-denied") state.error = UI.micDenied;
        renderCard();
        bindLive();
      },
    });
    render();
    bindLive();
    state.live.start();
  }

  function bindLive() {
    const answer = $("btn-answer");
    if (answer) answer.onclick = () => {
      stopDictation();
      if (state.live) state.live.listen();
    };
    const pause = $("btn-live-pause");
    if (pause)
      pause.onclick = () => {
        if (!state.live) return;
        stopDictation();
        if (state.liveView?.paused) state.live.resume();
        else state.live.pause();
      };
    document.querySelectorAll("[data-live]").forEach((btn) => {
      btn.onclick = () => {
        if (!state.live) return;
        const a = btn.getAttribute("data-live");
        if (a === "repeat") state.live.repeat();
        if (a === "help") state.live.help();
        if (a === "huh") state.live.dontUnderstand();
        if (a === "done") state.live.done();
      };
    });
    const form = $("typed-form");
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const input = $("typed-input");
        const t = input.value.trim();
        if (!t || !state.live) return;
        input.value = "";
        state.live.typed(t);
      };
    }
  }

  function bindCard() {
    $("card").onclick = async (e) => {
      if (generation) return;
      const modeButton = e.target.closest("[data-mode]");
      if (modeButton) {
        const mode = modeButton.getAttribute("data-mode");
        if (mode === state.mode) return;
        if (mode === "live") startLive();
        else {
          stopLive();
          state.mode = mode;
          state.onlyMine = false;
          save();
          render();
        }
        return;
      }
      const act = e.target.closest("[data-act]");
      if (act) {
        const i = Number(act.getAttribute("data-i"));
        const a = act.getAttribute("data-act");
        if (a === "play") playLine(i, false);
        if (a === "slow") playLine(i, true);
        if (a === "recite") reciteLine(i);
        if (a === "save") toggleSaved(state.situation?.lines?.[i]);
        if (a === "say-now") {
          const de = act.textContent;
          if (state.live) state.live.say(de);
          else {
            stopLive();
            window.Speech.speak(de, { rate: state.settings.rate });
          }
        }
        return;
      }
      if (e.target.closest("[data-stop-practice]")) {
        const target = state.practice?.target;
        stopLive();
        if (target) setPracticeStatus(target, UI.stopped);
        return;
      }
      if (e.target.id === "btn-hidden-talk") hiddenTalk();
      if (e.target.id === "btn-start-live") startLive();
      if (e.target.id === "btn-free") startLive();
      if (e.target.id === "btn-hide") {
        stopLive();
        state.mode = "hidden";
        save();
        render();
      }
      if (e.target.id === "btn-same" && state.situation) {
        state.debrief = null;
        state.lineResults = {};
        startLive();
      }
      if (e.target.id === "btn-harder") {
        const title = state.situation ? `${state.situation.title_hr} (${UI.harder})` : UI.harder;
        sendSituation(title, { difficulty: "harder", chip: state.situation?.chip });
      }
      if (e.target.id === "btn-mine") {
        state.onlyMine = true;
        state.mode = "text";
        stopLive();
        render();
      }
    };
  }

  function growComposer() {
    const el = $("composer-input");
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }

  function stopDictation() {
    if (!state.dictating) return;
    practiceVersion += 1;
    window.Speech.stopRecognition();
    state.dictating = false;
    $("btn-dictate").classList.remove("on");
    setPracticeStatus("composer", "");
  }

  function lastUserText() {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === "user") return state.messages[i].text;
    }
    return "";
  }

  function newChat() {
    cancelGeneration();
    stopLive();
    snapshotChat();
    state.panel = "home";
    const empty = state.chats.find((c) => !c.messages.length);
    if (empty) {
      hydrateChat(empty);
    } else {
      const c = blankChat();
      state.chats.unshift(c);
      hydrateChat(c);
    }
    save();
    render();
    $("composer-input").focus();
  }

  function openChat(id) {
    if (id === state.currentId && state.panel === "home") return;
    cancelGeneration();
    stopLive();
    snapshotChat();
    state.panel = "home";
    const c = state.chats.find((x) => x.id === id);
    if (!c) return;
    hydrateChat(c);
    save();
    render();
  }

  function deleteChat(id) {
    if (state.currentId === id) {
      cancelGeneration();
      stopLive();
    }
    state.chats = state.chats.filter((c) => c.id !== id);
    if (!state.chats.length) {
      const c = blankChat();
      state.chats = [c];
      hydrateChat(c);
    } else if (state.currentId === id) {
      hydrateChat(state.chats[0]);
    }
    save();
    render();
  }

  function bind() {
    $("form-composer").onsubmit = (e) => {
      e.preventDefault();
      const input = $("composer-input");
      const t = input.value;
      input.value = "";
      growComposer();
      sendSituation(t);
    };
    $("composer-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("form-composer").requestSubmit();
      }
    });
    $("composer-input").addEventListener("input", growComposer);
    $("btn-dictate").onclick = () => {
      if (!window.Speech.hasRecognition()) {
        state.error = UI.chromeWarning;
        render();
        return;
      }
      if (state.dictating) {
        stopDictation();
        setPracticeStatus("composer", UI.stopped);
        return;
      }
      if (state.live) {
        state.live.pause();
        practiceVersion += 1;
      }
      else stopLive();
      state.dictating = true;
      $("btn-dictate").classList.add("on");
      listenForPractice("composer", (text) => {
        const el = $("composer-input");
        el.value = (el.value ? el.value + " " : "") + text;
        growComposer();
      }, "hr-HR");
    };
    function closeSidebar() {
      document.body.classList.remove("side-open");
      $("sidebar-backdrop").hidden = true;
    }

    function setProfileMenu(open) {
      const menu = $("profile-menu");
      const btn = $("btn-profile");
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("on", open);
    }

    $("btn-new").onclick = () => {
      newChat();
      closeSidebar();
    };
    $("btn-retry-failed").onclick = () => {
      if (!state.failedRequest || generation) return;
      const { message, extra } = state.failedRequest;
      if ($("composer-input").value === message) {
        $("composer-input").value = "";
        growComposer();
      }
      sendSituation(message, extra, true);
    };
    $("btn-review").onclick = () => {
      cancelGeneration();
      stopLive();
      if (state.mode === "live") state.mode = "text";
      save();
      state.panel = "review";
      render();
      closeSidebar();
    };
    $("review").onclick = (e) => {
      if (e.target.id === "btn-review-back") {
        stopLive();
        state.panel = "home";
        render();
        return;
      }
      if (e.target.closest("[data-stop-practice]")) {
        const target = state.practice?.target;
        stopLive();
        if (target) setPracticeStatus(target, UI.stopped);
        return;
      }
      const act = e.target.closest("[data-review-act]");
      if (!act) return;
      const i = Number(act.getAttribute("data-i"));
      const action = act.getAttribute("data-review-act");
      if (action === "play") playLine(i, false, true);
      if (action === "recite") reciteLine(i, true);
      if (action === "remove") toggleSaved(state.savedSentences[i]);
    };
    $("btn-sidebar").onclick = () => {
      document.body.classList.toggle("side-open");
      $("sidebar-backdrop").hidden = !document.body.classList.contains("side-open");
    };
    $("sidebar-backdrop").onclick = closeSidebar;
    $("chat-list").onclick = (e) => {
      const open = e.target.closest("[data-open]");
      const del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        deleteChat(del.getAttribute("data-del"));
        return;
      }
      if (open) {
        openChat(open.getAttribute("data-open"));
        closeSidebar();
      }
    };
    $("thread").onclick = async (e) => {
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        const i = Number(copy.getAttribute("data-copy"));
        const t = state.messages[i]?.text || "";
        try {
          await navigator.clipboard.writeText(t);
          copy.textContent = UI.copied;
          setTimeout(() => {
            copy.textContent = UI.copy;
          }, 1200);
        } catch {
          /* ignore */
        }
        return;
      }
      const retry = e.target.closest("[data-retry]");
      if (retry) {
        const t = lastUserText();
        if (t) sendSituation(t);
        return;
      }
      const example = e.target.closest("[data-example]");
      if (example) sendSituation(example.getAttribute("data-example"));
    };
    $("btn-profile").onclick = (e) => {
      e.stopPropagation();
      setProfileMenu($("profile-menu").hidden);
    };
    $("btn-settings").onclick = () => {
      setProfileMenu(false);
      closeSidebar();
      renderSettings();
      $("dlg-settings").showModal();
    };
    $("btn-about").onclick = () => {
      setProfileMenu(false);
      closeSidebar();
      renderAbout();
      $("dlg-about").showModal();
    };
    document.addEventListener("click", (e) => {
      if ($("profile-menu").hidden) return;
      if (!e.target.closest(".side-foot")) setProfileMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setProfileMenu(false);
    });
    $("form-settings").onsubmit = (e) => {
      e.preventDefault();
      state.settings.rate = Number($("set-rate").value);
      state.settings.autoMic = $("set-mic").checked;
      state.settings.voiceCorrect = $("set-voice").checked;
      save();
      $("dlg-settings").close();
    };
    document.querySelectorAll("[data-close]").forEach((b) => {
      b.onclick = () => b.closest("dialog").close();
    });
    bindCard();
  }

  load();
  state.settings.level = "B1";
  state.settings.formality = "Sie";
  state.chromeOk = window.Speech.hasRecognition();
  renderChrome();
  renderSettings();
  renderAbout();
  render();
  bind();
  window.Speech.waitVoices();
})();
