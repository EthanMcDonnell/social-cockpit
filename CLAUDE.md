# CLAUDE.md

## ⚠️ Production is live

This repo runs in **production**. The build/server currently running is serving real traffic.

- **Do NOT restart, rebuild, redeploy, or otherwise touch the running build/server** unless the user explicitly asks.
- **Do NOT run** commands that could affect the live process (e.g. `npm run build`, `npm start`, dev-server restarts, deploys, migrations against the live DB).
- Editing source files is fine, but code changes must **not** be applied to the running instance until the user says so.
- When a change is ready, hand it off for the user to deploy — don't self-deploy.
