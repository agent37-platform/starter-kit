# AGENTS.md

Guidance for AI coding agents (and humans) working in the **Agent37 Starter Kit**.
`CLAUDE.md` imports this file via `@AGENTS.md`, so this is the single source of
truth — edit here, not there.

## First-time setup

Setting this up from a fresh clone? Follow **[`SETUP.md`](SETUP.md)** — the complete runbook
(it's what the README tells adopters to hand you). Two login-gated secrets are human-supplied:
`AGENT37_API_KEY` (plus a **funded** Agent37 wallet) and `SUPABASE_ACCESS_TOKEN`;
`npm run setup` does the rest. Never print or commit the `sk_live_` key.

## What this project is

A full-stack starter for building your own agent app, built entirely on top of the
public **[Agent37](https://www.agent37.com) B2B Agents API**: email + password auth
(open signup, no verification), a multi-agent fleet, and — for each agent — native
in-dashboard **Chat**, a **Files** browser, **Integrations** (Composio), and a
**Settings** tab. Forkers rebrand it (`src/config/branding.ts`) and ship it; their
end users sign up, get workspaces, invite teammates, and create / manage agents.

Everything this app can do is a **subset of the Agent37 `/v1` API** — control plane
*and* data plane. This repo is a *client* of that API — it does not implement agent
infrastructure itself. So **the API docs, not this code, are the authority on what an
agent can and cannot do.**

## The API this is built on — read the docs first

This product is built on top of our public API. **Before adding or changing any
agent capability, consult the docs** — they define the full surface and its
limits. Two machine-readable entry points are designed for you (an AI agent) to
fetch directly:

- **<https://www.agent37.com/docs/llms.txt>** — concise index of every doc page.
  *Start here* to find the right page.
- **<https://www.agent37.com/docs/llms-full.txt>** — the entire documentation
  inlined into one file. Use for deep reference.
- Human-browsable docs: **<https://www.agent37.com/docs>**
  (append `.md` to any page URL to get raw markdown.)

### Documented capability map

Two planes, one `sk_live_` key — and this template now drives **both**. The
**control plane** manages instances (and the per-agent Composio integrations); the
**data plane** powers the native Chat and Files tabs.

**Control plane — `https://api.agent37.com/v1/*`** (the `sk_live_` key this app holds):

| Page | Covers | Used here |
|---|---|---|
| [Core concepts](https://www.agent37.com/docs/agents-api/concepts) | the model, auth, the two planes | read first |
| [Instances](https://www.agent37.com/docs/agents-api/instances) | create / list / get / start / stop / restart / update / resize / delete | ✅ |
| [Instance URLs](https://www.agent37.com/docs/agents-api/urls) | short-lived signed URLs to open an agent's ports | ✅ |
| [Templates](https://www.agent37.com/docs/agents-api/templates) | the agent images you can provision | ✅ |
| [Managed services & budgets](https://www.agent37.com/docs/agents-api/budgets) | per-agent managed-spend cap | ✅ |
| [Billing](https://www.agent37.com/docs/agents-api/billing) | wallet, compute prepay, usage | ✅ (usage) |
| [Run commands](https://www.agent37.com/docs/agents-api/exec) | exec a command inside an instance | available, not used |
| [Errors](https://www.agent37.com/docs/agents-api/errors) | machine-readable error codes | ✅ (mapped in `Agent37Error`) |

The **Integrations** tab is also control plane: it manages a per-agent Composio
entity through `/instances/{id}/integrations/*` (toolkits / connect / connections).

**Data plane — `https://{instanceId}.agent37.app/v1/*`** (talk to one agent's
gateway). Data-plane requests authenticate with the `X-Agent37-Key: sk_live_...`
header (raw key, no Bearer prefix; `Authorization` passes through to the app inside
the instance), while the control plane stays `Authorization: Bearer`. The native
**Chat** and **Files** tabs call these endpoints directly
(through this app's BFF). The signed-URL "open in new tab" shortcuts still exist
too — they just complement the in-dashboard UIs now rather than replace them:

| Page | Covers | Used here |
|---|---|---|
| [Send a message](https://www.agent37.com/docs/agents-api/chat) | post a message, get a response (`/v1/responses`) | ✅ (Chat) |
| [Streaming](https://www.agent37.com/docs/agents-api/streaming) | stream responses (SSE) | ✅ (Chat) |
| [Sessions & models](https://www.agent37.com/docs/agents-api/sessions) | conversation state, model selection | ✅ (Chat) |
| [Files](https://www.agent37.com/docs/agents-api/files) | list / read / write / archive files | ✅ (Files) |
| [Build a chat app](https://www.agent37.com/docs/agents-api/chat-app) | end-to-end guide for a chat UI | reference |

So: **what's possible** = the whole map above, and this template now exercises most
of it: the control-plane rows marked ✅, the native data-plane Chat and Files tabs,
the per-agent Integrations tab, *and* the signed-URL buttons that open each agent's
own dashboard / terminal / files UI in a new tab.

## How this app fits together

```
Browser ─▶ Next.js (this app) ─▶ control plane  https://api.agent37.com/v1   (instances, integrations)
   │            │              └▶ data plane     https://{instance}.agent37.app/v1   (chat, files)
   │            │                                 (one server-side sk_live_ key, both planes:
   │            │                                  Bearer on the control plane, X-Agent37-Key on the instance)
   │            │
   │            └─▶ Supabase: Auth (browser, anon key) + Postgres (server-only, service-role key):
   │                          users, workspaces, members, agent mirror
   │
   └──────────────▶ https://{instance}.agent37.app  (agent's own UI, via short-lived signed URLs)
```

- **One key, many app workspaces.** A single `sk_live_` key, server-side only, is
  shared by the whole app. Every agent is created under your one Agent37 workspace
  and tagged `metadata.app_workspace`; a Supabase mirror table is the source of
  truth for which app-workspace owns which agent.
- **Isolation is enforced in the server (BFF), not in the browser.** Clients have **no**
  direct table access — the schema migration (`0001_init.sql`) grants tables only to the
  service role, so the browser only uses Supabase for *auth*. Every read and write
  goes through `src/app/api/**` using the **service-role** client (`src/lib/supabase/admin.ts`,
  which bypasses RLS); the TypeScript checks in `src/lib/auth.ts` (`requireUser` /
  `requireMember` / `requireAdmin` / `requireAgentAccess`) are the authorization boundary. RLS
  policies stay enabled as a backstop but are dormant (clients can't reach the tables). Neither
  the `sk_live_` key nor the service-role key ever reaches the browser.
- **`src/lib/agent37.ts` is the only thing that calls the Agent37 API**
  (`server-only`) — both the control-plane base and each instance's data-plane host.
  Internal `src/app/api/**` routes are this app's BFF: the browser calls them, they
  authenticate + check workspace ownership in TS, then call `agent37.ts` and/or the DB via the
  service-role client. The browser never calls the upstream API or the DB directly.
- **The UI is a fleet + a per-agent workspace.** The `(fleet)` route group is the
  multi-agent dashboard (agents, members, invitations, workspace settings). Clicking
  an agent opens `/dashboard/agents/{agentId}/{tab}` — a tabbed workspace (Chat /
  Files / Integrations / Settings) where the active agent is bound to the URL and
  switchable from a dropdown. Creating an agent is one screen: pick a type from the
  curated catalog (`AGENT_TYPES`) and an optional name; shape and budget are fixed
  server-side (`DEFAULT_AGENT`).
- **Naming:** the upstream API calls these resources **instances**; this app brands
  them **agents**. Paths stay `/instances`; the client methods read `agent…`.

## Where things live

| Path | What |
|---|---|
| `src/lib/agent37.ts` | The Agent37 `/v1` client — the single egress to both planes |
| `src/app/api/**` | This app's own API routes (BFF); enforce auth + ownership |
| `src/app/api/agents/[id]/{chat,files}/**` | Data-plane BFF: native Chat + Files proxied to the instance |
| `src/app/api/agents/[id]/integrations/**` | Composio integrations BFF (control plane) |
| `src/app/dashboard/agents/[agentId]/[[...tab]]/` | The per-agent tabbed workspace route (Chat / Files / Integrations / Settings) |
| `src/config/agents.ts` | `SHAPE_PRESETS`, `DEFAULT_AGENT`, the `AGENT_TYPES` catalog, and `PORT_LABELS` (labels only — ports come from the live instance) |
| `src/config/branding.ts` | `appName` / `logoUrl` code constants (branding lives here, not in env) |
| `template/` | Opt-in custom-image scaffold (Dockerfile `FROM` Hermes + `release.sh`); unused unless you build your own image |
| `src/lib/types.ts` | App + upstream `/v1` types |
| `supabase/migrations/0001_init.sql` | Schema, RLS policies (dormant backstop), SECURITY DEFINER RPCs; grants tables to the service role only (clients have no direct DB access) |
| `src/lib/supabase/admin.ts` | Service-role client (server-only, bypasses RLS) — the DB egress |
| `scripts/setup.mjs` | One-command Supabase setup (`npm run setup`) |

## Commands

```bash
npm install
npm run setup       # configure Supabase end-to-end (idempotent; needs SUPABASE_ACCESS_TOKEN)
npm run dev         # http://localhost:3000
npm run build
npm run typecheck   # tsc --noEmit
```

There is no test suite; the gate before shipping is a clean `npm run typecheck`
and `npm run build`. Setup is "paste two keys + `npm run setup`" — no manual
dashboard steps.

## Custom agent image (opt-in)

By default no Docker or GHCR is involved — the catalog ships Hermes and OpenClaw,
which run on Agent37's stock images. To offer **your own** image, use the top-level
`template/` folder: edit its `Dockerfile` (it starts `FROM` Hermes), then publish +
register the image with `npm run release:agent` (`template/release.sh`). Finally,
uncomment the `custom` entry in `src/config/agents.ts`, matching its `template` to
the `TEMPLATE_NAME` in `template/release.sh`. The new card then appears on the create
screen. For the more advanced "bring your own image **and** your own model" path
(including a minimal LLM proxy), see [`examples/custom-agent-image/`](examples/custom-agent-image/).

## House rules

- **The API is the final authority.** Shapes, disks, templates, budgets — the
  `/v1` API can reject anything your account's tier disallows, regardless of what
  `src/config` lists. Check the docs before assuming a capability exists.
- **Never expose `AGENT37_API_KEY` to the browser.** It stays server-side; all
  agent calls go through `src/app/api/**` → `src/lib/agent37.ts`.
- **Payments are intentionally excluded.** Add Stripe (or anything) yourself when
  you're ready to charge your own customers — the create route (`src/app/api/agents/route.ts`)
  has a commented `canCreateAgent()` seam marking where an entitlement gate would go.
- **Branding lives in `src/config/branding.ts`** (`appName` / `logoUrl` constants),
  not in env. The old `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_LOGO_URL` vars are gone;
  keep it code-side.
- Keep changes small and focused; don't add unrequested features or touch
  unrelated code.
