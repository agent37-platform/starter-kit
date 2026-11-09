# Agent37 Starter Kit

A full-stack starter for building your own agent app on the [Agent37](https://www.agent37.com) Cloud API: auth, chat, files, messaging apps (Telegram, WhatsApp, Slack, Discord), integrations, and fleet management, with your choice of Hermes or OpenClaw. Fork it, rebrand it, ship it.

<p align="center">
  <img src="screenshots/demo.gif" alt="Demo of the Agent37 Starter Kit dashboard and agent workspace" width="100%" />
</p>

## Setup

Auth and Postgres run on your choice of **[Supabase](https://supabase.com)** (default) or
**[Neon](https://neon.com)**. [SETUP.md](SETUP.md) compares the two setups.

**1. Get your keys** (behind a login, so only you can fetch them):

- `AGENT37_API_KEY` — Agent37 dashboard → **Cloud → API keys**, then **fund the wallet** (Cloud → Billing).
- Supabase: `SUPABASE_ACCESS_TOKEN` — [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
- Neon: no second key. `npm run setup:neon` creates a temporary project that you claim into your Neon
  account within 72 hours.

**2. Hand it to your coding agent.** Open this folder in Claude Code / Codex and paste:

```
Set this repo up and run it locally, end to end — follow SETUP.md. Ask me for the
login-gated keys it needs, then do everything else and tell me the local URL.
```

For Neon, say "on the Neon backend" in the prompt.

It writes your keys, sets up the backend, and starts the app. Prefer to do it yourself?
**[SETUP.md](SETUP.md)** has the by-hand commands and deploy steps for both backends.
