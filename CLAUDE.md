Indie web apps in the levelsio sense: one problem, smallest page that works, charge early, run cheap. Vibe-code with Grok, push to GitHub, deploy to the existing Hetzner VPS.
Do
Ship a working URL before architecture.
Change the smallest set of files that completes the request.
Match whatever stack is already in this repo. Do not restack a working app.
Prefer one process, one server, SQLite, until this repo says otherwise.
Keep secrets in .env. Repo only gets .env.example with names, not values.
Payments, auth, and webhooks stay server-side.
Commit in small deployable steps on main. Message says why.
After deploy, hit the live URL or health check and report what actually happened.
Stop local servers you started when the task ends.
Do not
Do not invent server IPs, SSH users, deploy paths, domains, or API keys. Ask or read this repo.
Do not commit .env, keys, tokens, cookies, *.db, or production dumps.
Do not force-push main, run reset --hard, drop data, or overwrite nginx without a copy and an explicit ask.
Do not add a new framework, queue, container platform, or cloud service unless asked.
Do not journal finished work into this file. Git has shipped work. If a lesson is repeatable, put it in a skill or update this file with one line that changes a future decision.
Do not dump inferable stack, generic style rules, or README essays here.
GitHub then Hetzner
Code is in git before it is on the server.
Push to GitHub.
Deploy with this project's documented command (git pull + install + restart). Do not provision a new server unless asked.
Copy nginx config and the SQLite file before touching them. Run nginx -t before reload.

This repo
App: njemackiizdzepa — voice-first German practice (UI is Croatian).
Local: cp .env.example .env && npm start
Opens: http://127.0.0.1:8000
Health: http://127.0.0.1:8000/api/health
Stack: vanilla HTML/JS + one Node process (no extra deps), LocalStorage, Web Speech API, SpaceXAI via /api/chat and /api/turn.
Phase: local only. Hetzner later.