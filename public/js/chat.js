window.Chat = (function () {
  async function post(url, payload, signal) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const error = new Error("http");
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  function generateSituation(message, settings, extra = {}, signal) {
    return post("/api/chat", {
      message,
      level: settings.level,
      formality: settings.formality,
      ...extra,
    }, signal);
  }

  function turn(payload, signal) {
    return post("/api/turn", payload, signal);
  }

  return { generateSituation, turn };
})();
