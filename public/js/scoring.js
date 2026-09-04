window.Scoring = (function () {
  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/[.,!?;:„“”"'`´\-–—()/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(s) {
    return normalize(s).split(" ").filter(Boolean);
  }

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const row = new Array(n + 1);
    for (let j = 0; j <= n; j++) row[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = i - 1;
      row[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = row[j];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
        prev = tmp;
      }
    }
    return row[n];
  }

  function diffs(expected, heard) {
    const e = tokens(expected);
    const h = tokens(heard);
    const out = [];
    const n = Math.max(e.length, h.length);
    const used = new Set();
    for (let i = 0; i < e.length; i++) {
      const want = e[i];
      let found = -1;
      for (let j = 0; j < h.length; j++) {
        if (used.has(j)) continue;
        if (h[j] === want || levenshtein(h[j], want) <= 1) {
          found = j;
          break;
        }
      }
      if (found >= 0) {
        used.add(found);
        out.push({ type: h[found] === want ? "ok" : "near", expected: want, heard: h[found] });
      } else {
        out.push({ type: "miss", expected: want, heard: "" });
      }
    }
    for (let j = 0; j < h.length; j++) {
      if (!used.has(j)) out.push({ type: "extra", expected: "", heard: h[j] });
    }
    return { expected: e, heard: h, parts: out, n };
  }

  function score(expected, heard) {
    const a = normalize(expected);
    const b = normalize(heard);
    if (!a) return { score: 0, band: "miss", note: window.UI.bands.miss, diffs: diffs(expected, heard) };
    if (!b) return { score: 0, band: "miss", note: window.UI.bands.miss, diffs: diffs(expected, heard) };
    const lev = levenshtein(a, b);
    const levRatio = 1 - lev / Math.max(a.length, b.length);
    const et = tokens(expected);
    const ht = tokens(heard);
    const setH = new Set(ht);
    const overlap = et.filter((t) => setH.has(t)).length;
    const tokenF1 = et.length ? overlap / et.length : 0;
    const n = Math.round(100 * (0.55 * levRatio + 0.45 * tokenF1));
    const clamped = Math.max(0, Math.min(100, n));
    let band = "miss";
    let note = window.UI.bands.miss;
    if (clamped >= 90) {
      band = "great";
      note = window.UI.bands.great;
    } else if (clamped >= 75) {
      band = "good";
      note = window.UI.bands.good;
    } else if (clamped >= 60) {
      band = "almost";
      note = window.UI.bands.almost;
    }
    const d = diffs(expected, heard);
    const misses = d.parts.filter((p) => p.type === "miss" || p.type === "near").map((p) => p.expected);
    if (band === "good" && misses.length) note = window.UI.bands.good + " " + misses.slice(0, 3).join(", ");
    return { score: clamped, band, note, diffs: d };
  }

  return { normalize, score, diffs };
})();
