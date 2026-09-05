(function () {
  const UI = window.UI;
  const LS = "njemackuudzepu.v1";

  const state = {
    settings: {
      level: "A2",
      formality: "Sie",
      rate: 1,
      autoMic: true,
      voiceCorrect: false,
    },
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

  function load() {
    try {
      const raw = localStorage.getItem(LS);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.settings) state.settings = { ...state.settings, ...data.settings };
      if (Array.isArray(data.messages)) state.messages = data.messages;
      if (data.situation) state.situation = data.situation;
      if (data.debrief) state.debrief = data.debrief;
      if (data.mode) state.mode = data.mode;
    } catch {
      /* ignore bad local data */
    }
  }

  function save() {
    try {
      localStorage.setItem(
        LS,
        JSON.stringify({
          settings: state.settings,
          messages: state.messages.slice(-40),
          situation: state.situation,
          debrief: state.debrief,
          mode: state.mode,
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
    $("tagline").textContent = UI.tagline;
    $("composer-input").placeholder = UI.inputPlaceholder;
    $("btn-send").textContent = UI.send;
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
    $("chips").innerHTML = UI.chips
      .map((c) => `<button type="button" class="chip" data-chip="${esc(c.id)}">${esc(c.label)}</button>`)
      .join("");
  }

  function renderMessages() {
    const box = $("thread");
    if (!state.messages.length) {
      box.innerHTML = `<p class="empty">${esc(UI.emptyChat)}</p>`;
      return;
    }
    box.innerHTML = state.messages
      .map((m) => {
        if (m.role === "user") return `<div class="bubble me">${esc(m.text)}</div>`;
        return `<div class="bubble bot">${esc(m.text)}${m.fallback ? `<div class="muted tiny">${esc(UI.fallbackNote)}</div>` : ""}</div>`;
      })
      .join("");
    box.scrollTop = box.scrollHeight;
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
    $("error").textContent = state.error;
    $("error").hidden = !state.error;
    if (state.mode === "live") bindLive();
  }

  async function sendSituation(text) {
    const message = (text || "").trim();
    if (!message) return;
    state.error = "";
    state.messages.push({ role: "user", text: message });
    state.messages.push({ role: "bot", text: UI.writing });
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

  function bind() {
    $("form-composer").onsubmit = (e) => {
      e.preventDefault();
      const input = $("composer-input");
      const t = input.value;
      input.value = "";
      sendSituation(t);
    };
    $("chips").onclick = (e) => {
      const btn = e.target.closest("[data-chip]");
      if (!btn) return;
      const chip = UI.chips.find((c) => c.id === btn.getAttribute("data-chip"));
      if (chip) sendSituation(chip.label);
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
