window.Chat = (function () {
  async function post(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("http");
    return res.json();
  }

  function generateSituation(message, settings, extra = {}) {
    return post("/api/chat", {
      message,
      level: settings.level,
      formality: settings.formality,
      ...extra,
    });
  }

  function turn(payload) {
    return post("/api/turn", payload);
  }

  return { generateSituation, turn };
})();
