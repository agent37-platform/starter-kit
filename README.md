# Agent37 Starter Kit

A full-stack starter for building your own agent app on the [Agent37](https://www.agent37.com) Cloud API — auth, chat, files, integrations, and fleet management, with your choice of Hermes or OpenClaw. Fork it, rebrand it, ship it.

<p align="center">
  <img src="screenshots/demo.gif" alt="Demo of the Agent37 Starter Kit dashboard and agent workspace" width="100%" />
</p>

## Setup

**1. Get two keys** (both behind a login, so only you can fetch them):

- `AGENT37_API_KEY` — Agent37 dashboard → **Cloud → API keys**, then **fund the wallet** (Cloud → Billing).
- `SUPABASE_ACCESS_TOKEN` — [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

**2. Hand it to your coding agent.** Open this folder in Claude Code / Codex and paste:

```
Set this repo up and run it locally, end to end — follow SETUP.md. Ask me for the two
login-gated keys it needs, then do everything else and tell me the local URL.
```

It writes your keys, configures Supabase, and starts the app. Prefer to do it yourself?
**[SETUP.md](SETUP.md)** has the four-command path and deploy steps too.
