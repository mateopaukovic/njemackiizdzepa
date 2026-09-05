# njemackuudzepu

Voice-first German practice for Balkan adults who need German for Amt, bank, work, doctor, landlord.

The **product UI is Croatian**. Prompts, README, and code are English. German appears only as the practice language.

Display name: **njemackuudzepu**  
Meaning: njemačku u džepu (German in the pocket)

## Run locally

Needs Node 18+. Chrome or Edge for microphone + German speech.

```bash
cp .env.example .env
# optional: put XAI_API_KEY in .env (SpaceXAI / xAI)
npm start
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in Chrome (or Edge).

If you run `npm start` inside WSL and Chrome on Windows, keep `HOST=0.0.0.0` (the default). A bind of `127.0.0.1` inside WSL is invisible to Windows Chrome.

Without a key, handwritten dialogues and live scripts still work (chips + scoring + Razgovor).

Health check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

The browser never sees the API key. Frontend calls only `/api/chat` and `/api/turn`.

## What works in v0.1.0

- Three modes: Tekst (read + score), Bez teksta (hidden script), Razgovor (live spoken scene)
- Web Speech API: German TTS (`de-DE`) and STT (`de-DE`), lockstep (no TTS+mic at once)
- LocalStorage for last chat, situation, settings, debrief
- LLM optional via SpaceXAI (`XAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`)

## What this is not

No signup, no native apps, no Hetzner deploy in this phase, no English UI.

## Later (not this phase)

Ubuntu VPS on Hetzner, Nginx, Let’s Encrypt, `git checkout` of a GitHub Release tag (`v0.1.0`, `v0.2.0`). Same `.env` shape. Do not put secrets in git or in a Release zip.

## Privacy

Speech recognition runs in the browser (Chrome uses Google Speech). Text is sent to the LLM through the local server. Raw audio is not stored. Full transcripts are not logged.
