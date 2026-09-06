window.Speech = (function () {
  const synth = window.speechSynthesis;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let currentRec = null;
  let speaking = false;
  let voicesReady = false;
  let speechVersion = 0;
  let settleSpeech = null;

  function hasRecognition() {
    return Boolean(SR);
  }

  function waitVoices() {
    if (!synth) return Promise.resolve([]);
    const have = synth.getVoices();
    if (have.length || voicesReady) return Promise.resolve(have);
    return new Promise((resolve) => {
      const done = () => {
        voicesReady = true;
        resolve(synth.getVoices());
      };
      synth.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 800);
    });
  }

  function pickDeVoice(voices) {
    const list = voices || synth.getVoices();
    return (
      list.find((v) => /^de-DE/i.test(v.lang) && /google/i.test(v.name)) ||
      list.find((v) => /^de-DE/i.test(v.lang)) ||
      list.find((v) => /^de/i.test(v.lang)) ||
      null
    );
  }

  function stopRecognition() {
    if (currentRec) {
      try {
        currentRec.onresult = null;
        currentRec.onend = null;
        currentRec.onerror = null;
        currentRec.onstart = null;
        currentRec.onspeechend = null;
        currentRec.stop();
      } catch {
        /* already stopped */
      }
      currentRec = null;
    }
  }

  function cancelSpeak() {
    speechVersion += 1;
    speaking = false;
    if (settleSpeech) settleSpeech(false);
    if (synth) synth.cancel();
  }

  function stopAll() {
    stopRecognition();
    cancelSpeak();
  }

  function speak(text, opts = {}) {
    stopRecognition();
    cancelSpeak();
    const version = speechVersion;
    const de = String(text || "").trim();
    if (!de || !synth) return Promise.resolve(false);
    return waitVoices().then(
      (voices) =>
        new Promise((resolve) => {
          if (version !== speechVersion) return resolve(false);
          const u = new SpeechSynthesisUtterance(de);
          u.lang = "de-DE";
          const voice = pickDeVoice(voices);
          if (voice) u.voice = voice;
          u.rate = opts.slow ? Math.min(0.72, opts.rate || 0.7) : opts.rate || 1;
          u.pitch = 1;
          let finished = false;
          const finish = (completed) => {
            if (finished) return;
            finished = true;
            if (settleSpeech === finish) settleSpeech = null;
            speaking = false;
            resolve(completed);
            if (completed && opts.onend) opts.onend();
          };
          settleSpeech = finish;
          u.onend = () => finish(true);
          u.onerror = () => finish(false);
          speaking = true;
          try { synth.speak(u); } catch { finish(false); }
        })
    );
  }

  function listen(opts = {}) {
    cancelSpeak();
    stopRecognition();
    if (!SR) {
      if (opts.onerror) opts.onerror({ error: "no-speech-api" });
      return () => {};
    }
    const rec = new SR();
    currentRec = rec;
    rec.lang = opts.lang || "de-DE";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onstart = () => {
      if (currentRec === rec && opts.onstart) opts.onstart();
    };
    rec.onspeechend = () => {
      if (currentRec === rec && opts.onspeechend) opts.onspeechend();
    };
    rec.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript || "";
      if (opts.onresult) opts.onresult(text);
    };
    rec.onerror = (ev) => {
      if (opts.onerror) opts.onerror(ev);
    };
    rec.onend = () => {
      if (currentRec === rec) currentRec = null;
      if (opts.onend) opts.onend();
    };
    try {
      rec.start();
    } catch (e) {
      if (opts.onerror) opts.onerror(e);
    }
    return stopRecognition;
  }

  return {
    hasRecognition,
    waitVoices,
    speak,
    listen,
    stopAll,
    stopRecognition,
    cancelSpeak,
    isSpeaking: () => speaking,
  };
})();
