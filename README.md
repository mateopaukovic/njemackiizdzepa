# njemackiudzepu

Voice-first German practice for Balkan adults who need German for Amt, bank, work, doctor, landlord.

The **product UI is Croatian**. Prompts, README, and code are English. German appears only as the practice language.

Display name: **njemackiudzepu**  
Meaning: njemački u džepu (German in the pocket)

## Run locally

Needs Node 18+. Chrome or Edge for microphone + German speech.

```bash
cp .env.example .env
# optional: put XAI_API_KEY in .env (SpaceXAI / xAI)
npm start
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in Chrome (or Edge).

If you run `npm start` inside WSL and Chrome on Windows, keep `HOST=0.0.0.0` (the default). A bind of `127.0.0.1` inside WSL is invisible to Windows Chrome.

Without a key, handwritten dialogues and live scripts still work (typed situation + scoring + Razgovor).

Health check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

The browser never sees the API key. Frontend calls only `/api/chat` and `/api/turn`.

## What works in v0.1.0

- Three modes: Tekst (read + score), Bez teksta (hidden script), Razgovor (live spoken scene)
- Web Speech API: German TTS (`de-DE`) and STT (`de-DE`), lockstep (no TTS+mic at once)
- LocalStorage for last chat, situation, settings, debrief
- LLM optional via SpaceXAI (`XAI_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`)
- A harder variant of each of the 12 saved scenes adds a follow-up question, including without an API key.
- Save individual dialogue sentences with “Spremi za vježbu” and review them under “Spremljene rečenice”. Up to 100 sentences stay in this browser even after deleting their original chat.
- Failed dialogue requests keep their draft and a retry action. Vocabulary and tips start collapsed.

The sentence score compares recognized text with the example; it does not measure pronunciation or judge alternative wording. Saved live scripts check keywords, while AI coaching is prompted to assess meaning and offer one specific correction.

## Checks

Run `npm test` for API validation, all saved scenarios, and chat/speech cancellation regressions. Tests use Node's built-in runner, mock the AI provider, and briefly start a localhost server which they close afterward. Browser microphone permissions, German voices, and layout still need a manual Chrome or Edge check.

For a device check, describe a situation, record a sentence, deny and then restore microphone permission, and pause a live turn while it is speaking. Switch chats during generation and return. Save a sentence, reload, and practise it from the saved list. Check that controls remain reachable with the mobile keyboard open. To check retry, briefly stop the local server, submit a situation, then restart it and use “Ponovi”; the description should remain available.

## What this is not

No signup, no native apps, no Hetzner deploy in this phase, no English UI.

## Later (not this phase)

Ubuntu VPS on Hetzner, Nginx, Let’s Encrypt, `git checkout` of a GitHub Release tag (`v0.1.0`, `v0.2.0`). Same `.env` shape. Do not put secrets in git or in a Release zip.

## Privacy

Speech recognition runs in the browser (Chrome uses Google Speech). Text is sent to the LLM through the local server. Raw audio is not stored. Full transcripts are not logged.
