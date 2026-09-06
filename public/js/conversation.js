window.Conversation = (function () {
  const UI = () => window.UI;

  function create(opts) {
    const ctx = {
      situation: opts.situation,
      settings: opts.settings,
      onRender: opts.onRender,
      onDebrief: opts.onDebrief,
      onStatus: opts.onStatus,
      paused: false,
      busy: false,
      step: 0,
      misses: 0,
      turn: 0,
      history: [],
      lastBot: { de: "", hr: "" },
      goal_progress: [],
      lastCoach: null,
      complete: false,
    };
    let version = 0;
    let request = null;
    let stopped = false;
    const active = (id) => id === version && !stopped && !ctx.paused;

    function cancel() {
      version += 1;
      if (request) request.abort();
      request = null;
      ctx.busy = false;
      window.Speech.stopAll();
    }

    function emit() {
      if (ctx.onRender) ctx.onRender(snapshot());
    }

    function snapshot() {
      return {
        lastBot: ctx.lastBot,
        lastCoach: ctx.lastCoach,
        paused: ctx.paused,
        busy: ctx.busy,
        complete: ctx.complete,
        goal_progress: ctx.goal_progress,
        turn: ctx.turn,
      };
    }

    async function applyTurn(data, id, { speakBot = true } = {}) {
      if (!active(id)) return;
      ctx.turn += 1;
      ctx.step = data.step != null ? data.step : ctx.step;
      ctx.misses = data.misses != null ? data.misses : ctx.misses;
      ctx.goal_progress = data.goal_progress || ctx.goal_progress;
      ctx.lastCoach = data.coach || null;
      ctx.complete = !!data.scene_complete;
      if (data.in_character_de) ctx.lastBot = { de: data.in_character_de, hr: data.in_character_hr || "" };
      ctx.history.push({
        bot: data.in_character_de || "",
        heard: data.coach?.heard || "",
      });
      if (ctx.history.length > 12) ctx.history.shift();
      emit();

      if (ctx.complete) {
        if (ctx.onDebrief) ctx.onDebrief(data.debrief_hr || UI().sceneEnd, ctx.goal_progress);
        if (speakBot && data.in_character_de) {
          await window.Speech.speak(data.in_character_de, { rate: ctx.settings.rate });
        }
        return;
      }

      const voiceFix = ctx.settings.voiceCorrect && data.coach?.corrected_de && data.coach.heard;
      if (voiceFix) {
        await window.Speech.speak(data.coach.corrected_de, { rate: ctx.settings.rate });
        if (!active(id)) return;
      }
      if (speakBot && data.in_character_de) {
        await window.Speech.speak(data.in_character_de, { rate: ctx.settings.rate });
      }
    }

    async function call(action, heard) {
      if (stopped || ctx.complete || (ctx.paused && action !== "done")) return;
      if (ctx.busy && action !== "done") return;
      cancel();
      ctx.paused = false;
      const id = version;
      request = new AbortController();
      ctx.busy = true;
      if (ctx.onStatus) ctx.onStatus(action === "start" ? "talking" : "thinking");
      emit();
      try {
        const data = await window.Chat.turn({
          action,
          heard: heard || "",
          situation: ctx.situation,
          level: ctx.settings.level,
          formality: ctx.settings.formality,
          step: ctx.step,
          misses: ctx.misses,
          turn: ctx.turn,
          history: ctx.history,
          goal_progress: ctx.goal_progress,
          last_bot_de: ctx.lastBot.de,
          last_bot_hr: ctx.lastBot.hr,
        }, request.signal);
        if (!active(id)) return;
        if (ctx.onStatus) ctx.onStatus("talking");
        await applyTurn(data, id, { speakBot: action !== "check" });
        if (!active(id)) return;
        ctx.busy = false;
        request = null;
        emit();
        if (ctx.complete) {
          if (ctx.onStatus) ctx.onStatus("complete");
        } else if (ctx.settings.autoMic) listen();
        else if (ctx.onStatus) ctx.onStatus("idle");
      } catch (error) {
        if (!active(id) || error.name === "AbortError") return;
        ctx.busy = false;
        if (ctx.onStatus) ctx.onStatus("error");
        emit();
      }
    }

    function listen() {
      if (stopped || ctx.paused || ctx.complete || ctx.busy) return;
      if (!ctx.lastBot.de) return call("start", "");
      const id = version;
      let failed = false;
      window.Speech.stopRecognition();
      if (ctx.onStatus) ctx.onStatus("preparing");
      window.Speech.listen({
        onstart: () => {
          if (active(id) && !ctx.busy && ctx.onStatus) ctx.onStatus("listening");
        },
        onspeechend: () => {
          if (active(id) && !ctx.busy && ctx.onStatus) ctx.onStatus("processing");
        },
        onresult: (text) => {
          if (!active(id)) return;
          if (ctx.onStatus) ctx.onStatus("idle");
          call("heard", text);
        },
        onerror: (ev) => {
          if (!active(id) || ctx.busy) return;
          failed = true;
          if (ev && ev.error === "not-allowed" && ctx.onStatus) ctx.onStatus("mic-denied");
          else if (ctx.onStatus) ctx.onStatus("speech-" + (ev?.error || "unknown"));
        },
        onend: () => {
          if (!active(id) || ctx.busy || failed) return;
          if (ctx.onStatus) ctx.onStatus("speech-no-speech");
        },
      });
    }

    async function say(text) {
      if (stopped || ctx.paused || ctx.complete || ctx.busy) return;
      if (!ctx.lastBot.de) return call("start", "");
      cancel();
      const id = version;
      ctx.busy = true;
      emit();
      if (ctx.onStatus) ctx.onStatus("talking");
      await window.Speech.speak(text, { rate: ctx.settings.rate });
      if (!active(id)) return;
      ctx.busy = false;
      emit();
      if (ctx.settings.autoMic) listen();
      else if (ctx.onStatus) ctx.onStatus("idle");
    }

    return {
      snapshot,
      start: () => call("start", ""),
      heard: (text) => call("heard", text),
      typed: (text) => call("typed", text),
      help: () => call("help", ""),
      dontUnderstand: () => call("dont_understand", ""),
      repeat: () => say(ctx.lastBot.de),
      say,
      done: () => call("done", ""),
      pause: () => {
        if (stopped || ctx.complete) return;
        ctx.paused = true;
        cancel();
        if (ctx.onStatus) ctx.onStatus("paused");
        emit();
      },
      resume: () => {
        if (stopped || ctx.complete) return;
        ctx.paused = false;
        if (ctx.onStatus) ctx.onStatus("idle");
        emit();
        if (!ctx.lastBot.de) call("start", "");
        else if (ctx.settings.autoMic) listen();
      },
      listen,
      stop: () => {
        stopped = true;
        ctx.paused = true;
        cancel();
      },
    };
  }

  return { create };
})();
