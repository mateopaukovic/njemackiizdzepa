window.Speech = (function () {
  const synth = window.speechSynthesis;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let currentRec = null;
  let speaking = false;
  let voicesReady = false;

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
        currentRec.stop();
      } catch {
        /* already stopped */
      }
      currentRec = null;
    }
  }

  function cancelSpeak() {
    speaking = false;
    if (synth) synth.cancel();
  }

  function stopAll() {
    stopRecognition();
    cancelSpeak();
  }

  function speak(text, opts = {}) {
    stopRecognition();
    cancelSpeak();
    const de = String(text || "").trim();
    if (!de || !synth) return Promise.resolve();
    return waitVoices().then(
      (voices) =>
        new Promise((resolve) => {
          const u = new SpeechSynthesisUtterance(de);
          u.lang = "de-DE";
          const voice = pickDeVoice(voices);
          if (voice) u.voice = voice;
          u.rate = opts.slow ? Math.min(0.72, opts.rate || 0.7) : opts.rate || 1;
          u.pitch = 1;
          const finish = () => {
            speaking = false;
            resolve();
            if (opts.onend) opts.onend();
          };
          u.onend = finish;
          u.onerror = finish;
          speaking = true;
          synth.speak(u);
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
    rec.lang = "de-DE";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
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
