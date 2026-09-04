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

    async function applyTurn(data, { speakBot = true } = {}) {
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
        if (speakBot && data.in_character_de) {
          await window.Speech.speak(data.in_character_de, { rate: ctx.settings.rate });
        }
        if (ctx.onDebrief) ctx.onDebrief(data.debrief_hr || UI().sceneEnd, ctx.goal_progress);
        return;
      }

      const voiceFix = ctx.settings.voiceCorrect && data.coach?.corrected_de && data.coach.heard;
      if (voiceFix) {
        await window.Speech.speak(data.coach.corrected_de, { rate: ctx.settings.rate });
      }
      if (speakBot && data.in_character_de) {
        await window.Speech.speak(data.in_character_de, { rate: ctx.settings.rate });
      }
      if (!ctx.paused && !ctx.complete && ctx.settings.autoMic) {
        listen();
      } else if (!ctx.paused && ctx.onStatus) {
        ctx.onStatus("idle");
      }
    }

    async function call(action, heard) {
      if (ctx.busy && action !== "done") return;
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
        });
        ctx.busy = false;
        await applyTurn(data, { speakBot: action !== "check" });
      } catch {
        ctx.busy = false;
        if (ctx.onStatus) ctx.onStatus("error");
        emit();
      }
    }

    function listen() {
      if (ctx.paused || ctx.complete || ctx.busy) return;
      window.Speech.stopRecognition();
      if (ctx.onStatus) ctx.onStatus("listening");
      window.Speech.listen({
        onresult: (text) => {
          if (ctx.onStatus) ctx.onStatus("idle");
          call("heard", text);
        },
        onerror: (ev) => {
          if (ev && ev.error === "not-allowed" && ctx.onStatus) ctx.onStatus("mic-denied");
          else if (ctx.onStatus) ctx.onStatus("idle");
        },
        onend: () => {
          if (ctx.onStatus) ctx.onStatus("idle");
        },
      });
    }

    return {
      snapshot,
      start: () => call("start", ""),
      heard: (text) => call("heard", text),
      typed: (text) => call("typed", text),
      help: () => call("help", ""),
      dontUnderstand: () => call("dont_understand", ""),
      repeat: async () => {
        window.Speech.stopAll();
        if (ctx.lastBot.de) await window.Speech.speak(ctx.lastBot.de, { rate: ctx.settings.rate });
        if (!ctx.paused && ctx.settings.autoMic) listen();
      },
      done: () => call("done", ""),
      pause: () => {
        ctx.paused = true;
        window.Speech.stopAll();
        if (ctx.onStatus) ctx.onStatus("paused");
        emit();
      },
      resume: () => {
        ctx.paused = false;
        if (ctx.onStatus) ctx.onStatus("idle");
        emit();
        if (ctx.settings.autoMic) listen();
      },
      listen,
      stop: () => {
        ctx.paused = true;
        window.Speech.stopAll();
      },
    };
  }

  return { create };
})();
