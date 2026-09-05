(function () {
  const UI = window.UI;
  const LS = "njemackiudzepu.v2";
  const LS_OLD = ["njemackuudzepu.v2", "njemackuudzepu.v1", "njemackiizdzepa.v1"];

  const state = {
    settings: {
      level: "A2",
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
    c.messages = state.messages.slice(-40);
    c.situation = state.situation;
    c.mode = state.mode;
    c.debrief = state.debrief;
    c.lineResults = state.lineResults;
    c.hiddenCheck = state.hiddenCheck;
    c.onlyMine = state.onlyMine;
    c.updatedAt = Date.now();
    const first = c.messages.find((m) => m.role === "user");
    if (first) c.title = first.text.slice(0, 42);
  }

  function hydrateChat(c) {
    state.currentId = c.id;
    state.messages = c.messages || [];
    state.situation = c.situation || null;
    state.mode = c.mode || "text";
    state.debrief = c.debrief || null;
    state.lineResults = c.lineResults || {};
    state.hiddenCheck = c.hiddenCheck || null;
    state.onlyMine = !!c.onlyMine;
    state.live = null;
    state.liveView = null;
    state.liveStatus = "idle";
  }

  function load() {
    try {
      const keys = [LS].concat(LS_OLD);
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
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
        })
      );
    } catch {
      /* quota */
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
    $("composer-input").placeholder = UI.inputPlaceholder;
    $("btn-send").setAttribute("aria-label", UI.send);
    $("btn-dictate").setAttribute("aria-label", UI.dictate);
    $("btn-new").textContent = UI.newChat;
    $("label-chats").textContent = UI.chats;
    $("enter-hint").textContent = UI.enterHint;
    $("btn-settings").textContent = UI.settings;
    $("btn-about").textContent = UI.about;
    $("chrome-warning").textContent = UI.chromeWarning;
    $("chrome-warning").hidden = state.chromeOk;
    $("label-level").textContent = UI.level;
    $("label-formality").textContent = UI.formality;
    $("sel-level").innerHTML = UI.levels
      .map((l) => `<option value="${l}"${l === state.settings.level ? " selected" : ""}>${l}</option>`)
      .join("");
    $("sel-formality").innerHTML = `
      <option value="Sie"${state.settings.formality === "Sie" ? " selected" : ""}>${esc(UI.formalitySie)}</option>
      <option value="du"${state.settings.formality === "du" ? " selected" : ""}>${esc(UI.formalityDu)}</option>`;
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
    if (!state.messages.length) {
      box.innerHTML = `<div class="hero"><h1>${esc(UI.tagline)}</h1><p>${esc(UI.emptyChat)}</p></div>`;
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
        const follow =
          i === last && state.situation
            ? `<div class="follow">
                <button type="button" class="chip" data-follow="live">${esc(UI.startLive)}</button>
                <button type="button" class="chip" data-follow="hidden">${esc(UI.modes.hidden)}</button>
                <button type="button" class="chip" data-follow="harder">${esc(UI.harder)}</button>
              </div>`
            : "";
        return `<div class="row-msg">
          <div class="bubble bot">${esc(m.text)}${m.fallback ? `<div class="muted tiny">${esc(UI.fallbackNote)}</div>` : ""}</div>
          <div class="msg-actions">
            <button type="button" data-copy="${i}">${esc(UI.copy)}</button>
            ${i === last ? `<button type="button" data-retry="${i}">${esc(UI.retry)}</button>` : ""}
          </div>
          ${follow}
        </div>`;
      })
      .join("");
    const sc = document.querySelector(".scroll");
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  function lineButtons(i, line) {
    return `
      <div class="line-actions">
        <button type="button" data-act="play" data-i="${i}">${esc(UI.play)}</button>
        ${line.role === "you" ? `<button type="button" class="primary" data-act="recite" data-i="${i}">${esc(UI.recite)}</button>` : ""}
        <button type="button" data-act="slow" data-i="${i}">${esc(UI.slow)}</button>
      </div>`;
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

    const modes = ["text", "hidden", "live"]
      .map((m) => {
        const label = UI.modes[m];
        return `<button type="button" class="mode${state.mode === m ? " on" : ""}" data-mode="${m}">${esc(label)}</button>`;
      })
      .join("");

    let body = "";
    if (state.mode === "live") {
      body = renderLive();
    } else if (state.mode === "hidden") {
      body = `
        <p class="goal"><strong>${esc(UI.goal)}.</strong> ${esc(s.goal_hr)}</p>
        <p class="muted">${esc(s.role_other_hr)} · ${esc(s.formality)} · ${esc(s.level)}</p>
        <button type="button" class="primary big" id="btn-hidden-talk">${esc(UI.recite)}</button>
        <button type="button" id="btn-free">${esc(UI.freeTalk)}</button>
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
            ${
              res
                ? `<div class="result">
                    <p>${esc(UI.heard)} <em>${esc(res.heard)}</em></p>
                    <p>${esc(UI.score)}: <strong>${res.score}</strong></p>
                    <p class="band ${res.band}">${esc(res.note)}</p>
                    ${renderDiffs(res.diffs)}
                  </div>`
                : ""
            }
          </article>`;
        })
        .join("");
      body = `
        <p class="goal"><strong>${esc(UI.goal)}.</strong> ${esc(s.goal_hr)}</p>
        <div class="vocab"><div class="kicker">${esc(UI.vocab)}</div>${(s.vocab || [])
          .map((v) => `<span><b>${esc(v.de)}</b> ${esc(v.hr)}</span>`)
          .join("")}</div>
        <div class="tips"><div class="kicker">${esc(UI.tips)}</div><ul>${(s.tips_hr || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
        ${state.mode === "text" && !state.onlyMine ? `<button type="button" id="btn-hide">${esc(UI.hideScript)}</button>` : ""}
        ${state.onlyMine ? `<h3>${esc(UI.yourLines)}</h3>` : ""}
        ${showLines || state.onlyMine ? list : ""}`;
    }

    host.innerHTML = `
      <header class="card-head">
        <h2>${esc(s.title_de)}</h2>
        <p class="hr">${esc(s.title_hr)} · ${esc(s.role_other_hr)}</p>
        <div class="modes" role="tablist">${modes}</div>
        ${state.mode !== "live" ? `<button type="button" class="primary" id="btn-start-live">${esc(UI.startLive)}</button>` : ""}
      </header>
      ${body}
      ${renderDebrief()}`;
  }

  function renderCoach(coach) {
    if (!coach) return "";
    const notes = (coach.notes_hr || []).map((n) => `<li>${esc(n)}</li>`).join("");
    return `<div class="coach">
      ${coach.heard ? `<p>${esc(UI.heard)} <em>${esc(coach.heard)}</em></p>` : ""}
      ${notes ? `<ul>${notes}</ul>` : ""}
      ${coach.say_this_now_de ? `<p class="say">${esc(UI.sayThis)} <button type="button" class="link" data-act="say-now">${esc(coach.say_this_now_de)}</button></p>` : ""}
      ${coach.corrected_de && coach.corrected_de !== coach.say_this_now_de ? `<p class="de">${esc(coach.corrected_de)}</p>` : ""}
    </div>`;
  }

  function renderLive() {
    const v = state.liveView || { lastBot: { de: "", hr: "" }, lastCoach: null };
    const st = state.liveStatus;
    const statusText =
      st === "listening"
        ? UI.listening
        : st === "mic-denied"
          ? UI.micDenied
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
      <p class="status ${esc(st)}">${esc(statusText)}</p>
      <div class="live-controls">
        <button type="button" class="mic" id="btn-answer">${esc(UI.answer)}</button>
        <button type="button" id="btn-live-pause">${esc(paused ? UI.resume : UI.pause)}</button>
        <button type="button" data-live="repeat">${esc(UI.repeat)}</button>
        <button type="button" data-live="help">${esc(UI.help)}</button>
        <button type="button" data-live="huh">${esc(UI.dontUnderstand)}</button>
        <button type="button" data-live="done">${esc(UI.done)}</button>
      </div>
      <form id="typed-form" class="typed">
        <label>${esc(UI.typeFallback)}</label>
        <input id="typed-input" autocomplete="off" />
        <button type="submit">${esc(UI.send)}</button>
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
    $("set-level-label").textContent = UI.level;
    $("set-form-label").textContent = UI.formality;
    $("set-rate-label").textContent = UI.voiceSpeed;
    $("set-mic-label").textContent = UI.autoMic;
    $("set-voice-label").textContent = UI.correctAloud;
    $("set-level").innerHTML = UI.levels
      .map((l) => `<option value="${l}"${l === state.settings.level ? " selected" : ""}>${l}</option>`)
      .join("");
    $("set-form").innerHTML = `
      <option value="Sie"${state.settings.formality === "Sie" ? " selected" : ""}>${esc(UI.formalitySie)}</option>
      <option value="du"${state.settings.formality === "du" ? " selected" : ""}>${esc(UI.formalityDu)}</option>`;
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
    $("error").textContent = state.error;
    $("error").hidden = !state.error;
    if (state.mode === "live") bindLive();
  }

  async function sendSituation(text) {
    const message = (text || "").trim();
    if (!message) return;
    state.error = "";
    state.messages.push({ role: "user", text: message });
    state.messages.push({ role: "bot", typing: true, text: "" });
    state.debrief = null;
    state.hiddenCheck = null;
    state.lineResults = {};
    state.onlyMine = false;
    render();
    try {
      const data = await window.Chat.generateSituation(message, state.settings);
      state.messages.pop();
      state.messages.push({
        role: "bot",
        text: data.chat_reply_hr,
        fallback: data.source === "fallback",
      });
      state.situation = data.situation;
      state.mode = "text";
      save();
    } catch {
      state.messages.pop();
      state.error = UI.serverDown;
    }
    render();
  }

  async function playLine(i, slow) {
    const line = state.situation?.lines?.[i];
    if (!line) return;
    window.Speech.stopAll();
    await window.Speech.speak(line.de, { rate: state.settings.rate, slow: !!slow });
  }

  async function reciteLine(i) {
    const line = state.situation?.lines?.[i];
    if (!line) return;
    if (!window.Speech.hasRecognition()) {
      state.error = UI.chromeWarning;
      render();
      return;
    }
    await playLine(i, false);
    setLiveStatusLabel(i, UI.listening);
    window.Speech.listen({
      onresult: (heard) => {
        const scored = window.Scoring.score(line.de, heard);
        state.lineResults[i] = { heard, ...scored };
        save();
        render();
      },
      onerror: (ev) => {
        if (ev && ev.error === "not-allowed") {
          state.error = UI.micDenied;
          render();
        }
      },
    });
  }

  function setLiveStatusLabel(i, text) {
    const el = document.querySelector(`.line[data-i="${i}"] .result`);
    if (el) el.textContent = text;
  }

  async function hiddenTalk() {
    if (!window.Speech.hasRecognition()) {
      state.error = UI.chromeWarning;
      render();
      return;
    }
    window.Speech.stopAll();
    window.Speech.listen({
      onresult: async (heard) => {
        try {
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
          });
          state.hiddenCheck = data.coach;
          render();
        } catch {
          state.error = UI.genericError;
          render();
        }
      },
      onerror: (ev) => {
        if (ev && ev.error === "not-allowed") {
          state.error = UI.micDenied;
          render();
        }
      },
    });
  }

  function stopLive() {
    if (state.live) state.live.stop();
    state.live = null;
    state.liveView = null;
    state.liveStatus = "idle";
  }

  function startLive() {
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
    if (answer) answer.onclick = () => state.live && state.live.listen();
    const pause = $("btn-live-pause");
    if (pause)
      pause.onclick = () => {
        if (!state.live) return;
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
      const modeBtn = e.target.closest("[data-mode]");
      if (modeBtn) {
        const m = modeBtn.getAttribute("data-mode");
        if (m !== "live") stopLive();
        state.mode = m;
        state.onlyMine = false;
        if (m === "live") startLive();
        else {
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
        if (a === "say-now") {
          const de = act.textContent;
          window.Speech.speak(de, { rate: state.settings.rate });
        }
        return;
      }
      if (e.target.id === "btn-hidden-talk") hiddenTalk();
      if (e.target.id === "btn-start-live") startLive();
      if (e.target.id === "btn-free") startLive();
      if (e.target.id === "btn-hide") {
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
        sendSituation(title);
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

  function lastUserText() {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === "user") return state.messages[i].text;
    }
    return "";
  }

  function newChat() {
    stopLive();
    snapshotChat();
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
    if (id === state.currentId) return;
    stopLive();
    snapshotChat();
    const c = state.chats.find((x) => x.id === id);
    if (!c) return;
    hydrateChat(c);
    save();
    render();
  }

  function deleteChat(id) {
    stopLive();
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
        window.Speech.stopRecognition();
        state.dictating = false;
        $("btn-dictate").classList.remove("on");
        return;
      }
      state.dictating = true;
      $("btn-dictate").classList.add("on");
      window.Speech.listen({
        lang: "hr-HR",
        onresult: (text) => {
          const el = $("composer-input");
          el.value = (el.value ? el.value + " " : "") + text;
          growComposer();
        },
        onerror: (ev) => {
          state.dictating = false;
          $("btn-dictate").classList.remove("on");
          if (ev && ev.error === "not-allowed") {
            state.error = UI.micDenied;
            render();
          }
        },
        onend: () => {
          state.dictating = false;
          $("btn-dictate").classList.remove("on");
        },
      });
    };
    $("btn-new").onclick = newChat;
    $("btn-sidebar").onclick = () => {
      document.body.classList.toggle("side-open");
      $("sidebar-backdrop").hidden = !document.body.classList.contains("side-open");
    };
    $("sidebar-backdrop").onclick = () => {
      document.body.classList.remove("side-open");
      $("sidebar-backdrop").hidden = true;
    };
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
        document.body.classList.remove("side-open");
        $("sidebar-backdrop").hidden = true;
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
      const follow = e.target.closest("[data-follow]");
      if (!follow) return;
      const a = follow.getAttribute("data-follow");
      if (a === "live") startLive();
      if (a === "hidden") {
        state.mode = "hidden";
        save();
        render();
      }
      if (a === "harder") {
        const title = state.situation ? `${state.situation.title_hr} (${UI.harder})` : UI.harder;
        sendSituation(title);
      }
    };
    $("sel-level").onchange = (e) => {
      state.settings.level = e.target.value;
      save();
    };
    $("sel-formality").onchange = (e) => {
      state.settings.formality = e.target.value;
      save();
    };
    $("btn-settings").onclick = () => {
      renderSettings();
      $("dlg-settings").showModal();
    };
    $("btn-about").onclick = () => {
      renderAbout();
      $("dlg-about").showModal();
    };
    $("form-settings").onsubmit = (e) => {
      e.preventDefault();
      state.settings.level = $("set-level").value;
      state.settings.formality = $("set-form").value;
      state.settings.rate = Number($("set-rate").value);
      state.settings.autoMic = $("set-mic").checked;
      state.settings.voiceCorrect = $("set-voice").checked;
      $("sel-level").value = state.settings.level;
      $("sel-formality").value = state.settings.formality;
      save();
      $("dlg-settings").close();
    };
    document.querySelectorAll("[data-close]").forEach((b) => {
      b.onclick = () => b.closest("dialog").close();
    });
    bindCard();
  }

  load();
  state.chromeOk = window.Speech.hasRecognition();
  renderChrome();
  renderSettings();
  renderAbout();
  render();
  bind();
  window.Speech.waitVoices();
})();
