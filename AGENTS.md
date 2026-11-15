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
(open signup, no verification), a multi-agent fleet, and, for each agent, native
in-dashboard **Chat**, a **Files** browser, **Messaging** (connect the agent to
Telegram, WhatsApp, Slack, Discord and two dozen more), **Integrations** (Composio),
and a **Settings** tab. Forkers rebrand it (`src/config/branding.ts`) and ship it; their
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
| [Run commands](https://www.agent37.com/docs/agents-api/exec) | exec a command inside an instance | ✅ (Messaging) |
| [Errors](https://www.agent37.com/docs/agents-api/errors) | machine-readable error codes | ✅ (mapped in `Agent37Error`) |

The **Integrations** tab is also control plane: it manages a per-agent Composio
entity through `/instances/{id}/integrations/*` (toolkits / connect / connections).

The **Messaging** tab is control plane too, but through `exec`: messaging channels are
configured *inside* the agent, not by our API, so the tab drives the agent's own
messaging API (loopback port `9119`) over `POST /v1/instances/{id}/exec`. The agent
reports the channel catalog, each channel's fields, and its live connection state, so
the UI renders a form it did not write and a channel a later image adds needs no change
here. See [Messaging channels](https://www.agent37.com/docs/agents-api/messaging).

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
- **Yelema fork: one client per deployment, roles, one agent per member.** The back-office creates
  the deployment's single workspace and its admin; there is no open sign-up (only on the way to an
  invitation) and no workspace creation or deletion (`403`). Roles are `admin` and `member`
  (`0002_roles_owner.sql`); an admin sees the members list, and like any member reaches only
  their OWN agent and its experts. The back-office creates every member and
  their agent, one per member (`agents.owner_user_id`, unique index); the app creates neither.
  All clients share ONE Supabase project: `WORKSPACE_ID` pins a deployment to its workspace and
  `getRole` answers null for any other (`docs/decisions/supabase-projet-partage.md`), so
  migrations must stay additive. `requireAgentAccess` lets in the
  agent's OWNER only — anyone else, workspace admins included, gets a `404`; `"admin"` access
  (resize, budget) is the owner again, and only if they are an admin. Configuration is read at runtime (`src/lib/runtime-config.ts`).
- **One deployment per client, or one for every client.** With `WORKSPACE_ID` a deployment serves
  that client. Without it, and with `BACKOFFICE_URL` and `APP_RESOLVER_TOKEN`, ONE deployment serves
  every client: the request's host (`<client>.app.yelema.ai`) says whose it is, and the back office
  resolves it (`GET /api/v1/app/tenant`, `src/lib/tenant-resolver.ts`). The proxy answers a host
  that is no client's, or a suspended one, with its own page; `pinnedWorkspaceId()`
  (`src/lib/tenant.ts`) is the workspace a request is confined to, and no route reads the host
  itself. Sign-in is then always the back office's. Plan: `docs/plans/app-unique-resolver.md`.
- **`src/lib/agent37.ts` is the only thing that calls the Agent37 API**
  (`server-only`) — both the control-plane base and each instance's data-plane host.
  Internal `src/app/api/**` routes are this app's BFF: the browser calls them, they
  authenticate + check workspace ownership in TS, then call `agent37.ts` and/or the DB via the
  service-role client. The browser never calls the upstream API or the DB directly.
- **The UI is one shell around the member's experts.** An **expert** is a Hermes profile
  (`client__expert`) installed on the member's instance. The shell (`src/components/app`) lists
  them; `/` is the home, `/recruter` the gallery of every expert Yelema offers, and
  `/experts/{agentId}/{profileId}/{tab}` the expert's workspace (Discussion / Livrables /
  Routines / Outils). Without a profile segment the page is the instance's default Hermes home.
  Intégrations (`/integrations`) holds what plugs into the experts. For everyone, acting on the
  signed-in user's OWN instance, for all of its experts: Connecteurs and Canaux
  (`src/components/MyInstance.tsx`). Where the back office signs users in, also E-mails for admins
  (who may make each expert write), Modèles for everyone (the account of model the experts run on:
  an admin sets it for the company or for a member, a member for themself, any provider, without
  asking their admin), and MCP beside it, at the same scopes (the client's own tool servers, plugged
  on its experts). Paramètres (`/parametres`, opened from the account menu, as in ChatGPT) has two
  parts (`src/components/settings/settings-nav.ts`): Personnel for everyone (Général: language and
  time zone; Apparence; Voix: each expert's call voice, a personal choice; Notifications on this
  device; Profil), then Entreprise: two read-only lists for admins (the workspace's members, and its
  instances by name and member: no id, no state, no way in), plus, where the back office signs users
  in, Facturation, Consommation and Organigramme for admins and Entreprise for everyone. It replaced
  Administration: every old `/administration/*` address redirects (`next.config.ts`). The app
  creates neither members nor agents.
- **Two ways to know the user, one switch.** With `AUTH_VIA_BACKOFFICE=true` the Yelema back office
  signs users in and says what they see (`/api/v1/app/*`, `src/lib/backoffice.ts`): the session is
  one httpOnly cookie bound to its host (`__Host-`, `src/lib/session.ts`), renewed by the proxy, and the user's role, workspace,
  instance and installed experts come from the back office on every read, so a suspended member or
  client is stopped there. Without the switch the app uses Supabase Auth and its own tables. The
  helpers in `src/lib/auth.ts` carry both branches; routes do not know which is on.
- **Talking to an expert is the Agent37 API's `profile`**, not an image feature: `profile` on
  `POST /v1/responses` and `?profile=` on every session read, sent on EVERY turn. The profile is
  checked against what is installed on that instance (`src/lib/profiles.ts`), never a fixed list.
- **Nothing about experts is written in this repo**, bar two stopgaps: the hover videos in
  `public/experts/vid` (looked up by first name, never listed in code) and the three faces of the
  sign-in pitch (`AuthShell`). The gallery's themes are the catalogue's `category`, ordered by its
  `order`, and the job sheet is its `sheet` (label, pronoun, intro, mission, inAction, daily, skills,
  deliverables, templates, routines, approval, needs; null until the expert's pack has one). Names, roles, photos, sheets come from the
  back office's public catalogue (`BACKOFFICE_URL`, `src/lib/catalogue.ts`), joined to installed
  profiles by the part of the profile name after `__`. Which experts a member HAS is what is
  installed (`agents.profiles`, written by the back office; the instance itself as a fallback).
- **A member may rename their expert and change its picture** (`src/lib/expert-looks.ts`,
  `/api/v1/app/experts/{key}`): the back office keeps both and writes the name in the expert's
  SOUL.md itself, so it introduces itself and signs that way; the app only relays. The name and
  picture come back in the instance view and win over the catalogue's. The drive folder and the
  e-mail sender keep the catalogue's name; the catalogue (Recruter) keeps its own names and faces.
- **The drive is `~/Livrables` on the member's instance**, and every files route refuses a path
  outside it (`src/lib/drive.ts`): the files API can otherwise read `~/.hermes` and `~/.yelema`.
- **Connectors belong to the member.** An instance wired by the back office
  (`agents.apps_token_hash`) uses Yelema's own Composio under its owner's identity, and its
  experts reach their tools through `/api/composio-mcp`; any other instance keeps Agent37's
  managed Composio (`src/lib/integrations.ts`).
- **Every tool execution is declared to the back office, which prices and stores it.** Once
  Composio has answered, the proxy sends the names of the tools the request executed
  (`POST /api/v1/app/composio-calls`, signed with the instance's own token), without waiting and
  never in the expert's way; a declaration that does not get through is lost. The app holds no
  table, no price and no reading of that data. Plan: `docs/plans/composio-suivi-appels.md`.
- **Naming:** the upstream API calls these resources **instances**; this app brands
  them **agents**. Paths stay `/instances`; the client methods read `agent…`.

## Where things live

| Path | What |
|---|---|
| `src/lib/agent37.ts` | The Agent37 `/v1` client — the single egress to both planes |
| `src/app/api/**` | This app's own API routes (BFF); enforce auth + ownership |
| `src/app/api/agents/[id]/{chat,files}/**` | Data-plane BFF: native Chat + Files proxied to the instance |
| `src/app/api/agents/[id]/integrations/**` | Connecteurs BFF: Yelema's Composio or Agent37's managed one, per instance (`src/lib/integrations.ts`) |
| `src/lib/composio.ts`, `src/app/api/composio-mcp/` | Yelema's Composio (server-only key) and the experts' tool proxy; identity = the instance's owner |
| `src/lib/composio-usage.ts` (+ `.test.ts`) | The tool executions inside one request to Composio (a multi-execution counts once per tool), by name only: what the proxy declares to the back office |
| `src/lib/profile-id.ts`, `src/lib/profiles.ts` | The profile a chat targets: shape, `?profile=`, and the check against the instance's real profiles |
| `src/lib/tenant-resolver.ts`, `src/lib/tenant.ts`, `src/app/espace-*` | The client a request is for when one deployment serves every client: host lookup at the back office, the workspace a request is confined to, and the pages for an unknown or suspended client |
| `src/lib/memo.ts` (+ `.test.ts`) | The one server cache: one load in flight per key, failures never kept, a bound, a stuck load not shared; stale-while-revalidate and last-known-value-on-outage as options. Used by the session, the host resolver, the catalogue, capabilities, channels, dashboards, the tool proxy |
| `src/lib/tenant-header.ts` (+ `.test.ts`) | The client the proxy resolved, handed to the route in `x-yelema-tenant`: always rewritten by the proxy, sealed with `APP_RESOLVER_TOKEN` and bound to the host, so a route never asks the back office again |
| `src/lib/jwt.ts` (+ `.test.ts`) | The session's Supabase token checked locally (ES256 only, the project's JWKS at `SUPABASE_URL`, `exp`/`iss`/`aud`): who is signed in without a call. Admission stays the back office's (`/instance`, `/me`) |
| `src/lib/poll.ts` (+ `.test.ts`), `src/components/usePoll.ts` | Every poll: nothing while the tab is hidden, one run when it shows again (if due), one run at a time, backoff and deadline |
| `src/lib/client-cache.ts`, `src/lib/drive-store.ts`, `src/app/api/agents/[id]/files/tree/` | What the browser already read (`cachedFetch`: one read shared, a TTL), and the drive tree in one call, read again when a turn or a routine ends |
| `src/lib/backoffice.ts`, `src/lib/session.ts`, `src/app/api/auth/**` | Sign-in through the back office: its client, the cookie session, and the login / logout / forgot / accept routes |
| `src/app/api/billing/**`, `src/components/BillingView.tsx`, `src/app/(app)/parametres/facturation/` | Facturation, for admins, signed in through the back office: plan, next due date, invoices and their PDF, read from the back office (`/api/v1/app/billing/*`). "Payer" opens the back office's own payment link; the app creates no payment |
| `src/lib/llm.ts`, `llm-accounts.ts`, `model-options.ts` (+ `.test.ts`), `src/app/api/llm/**`, `src/components/models/**`, `src/app/(app)/integrations/modeles/` | Modèles, signed in through the back office (`/api/v1/app/llm/*`). Page order: the instance's accounts (keys, sign-ins, private endpoints; drag order = backup chain, Yelema engine as last resort; an admin picks the instance and may share an account with the company), the experts' model (all experts + per expert, `layout.profiles`; with no account, Yelema's models via `PUT /api/llm/own/model`), the Yelema engine, then per member. `ModelPicker.tsx`: searchable model list fed by `GET /api/llm/models`. The back office checks, keeps and installs; the app turns each refusal code into a French sentence |
| `src/lib/mcp-servers.ts` (+ `.test.ts`), `src/app/api/mcp/**`, `src/components/integrations/McpView.tsx`, `McpServerDialog.tsx`, `src/app/(app)/integrations/mcp/` | MCP, signed in through the back office: the client's own tool servers, for the company, a member or oneself (`/api/v1/app/mcp/*`). A name, a public https address, and no token or a Bearer one (no OAuth 2.0). The back office checks, keeps the token, writes the server on the instances and never calls the address; the app shows what it serves and turns each refusal code into a French sentence. `state` says whether the writing went through, not whether the server answers |
| `src/app/api/composio-usage/**`, `src/components/integrations/UsageView.tsx`, `src/app/(app)/parametres/consommation/` | Consommation d’outils hors tokens, for admins, signed in through the back office: how many tool calls the experts made over a month, in all, by member, by application and call by call (downloadable as CSV), read from the back office (`/api/v1/app/composio-usage`). The client sees volumes only: the BFF drops the amounts the back office sends (Yelema's own costs) |
| `src/lib/catalogue.ts`, `src/app/api/catalogue/**` | The back office's expert catalogue, cached, and its join with installed profiles |
| `src/lib/org-chart.ts` (+ `.test.ts`), `src/app/api/org/**`, `src/components/memory/OrgChartView.tsx`, `src/components/memory/org-chart/` | Organigramme, for admins, signed in through the back office (`/api/v1/app/org/*`): « départements » on screen (« units » in the API): two views, remembered per browser: one card per department with its people (heads first) and its experts placed alone, or the tree from the company down (`OrgTree.tsx`, a department dragged onto another moves under it, actions in a « … » menu, beside it the palette of members and their experts to drag onto a box (`PeoplePalette.tsx`) and, on a click on a box, its panel: who is in it, member or head for a person as for an expert, every gesture without dragging (`UnitPanel.tsx`)); a dialog to create, rename or move one, the members without one apart, a person or an expert dragged or picked onto a card (taken from a card, the same place moves: `PATCH` with `unit`), an expert placed alone made head or member on its card, access exceptions folded at the bottom. The tree logic is a port of the back office's board model; the back office keeps the chart and refuses loops and duplicates |
| `src/lib/expert-looks.ts` (+ `.test.ts`), `src/app/api/experts/[key]/**`, `src/components/experts/ExpertEditModal.tsx`, `AvatarConfigModal.tsx`, `avatarContracts.ts` | A member's own name and picture for an expert of their team, signed in through the back office: the name rule and the refusal sentences, the relay routes (rename, picture, portrait drawn by the studio from four choices, kept only when applied), and the two dialogs |
| `src/components/experts/ExpertImage.tsx`, `images` in `next.config.ts` | Expert pictures resized by the image optimizer (the catalogue serves them full size); only Yelema hosts are optimized |
| `src/components/experts/ExpertMedia.tsx`, `public/experts/vid/` | A card's picture, swapped for the expert's looping video on hover. The video is the catalogue's when it lists one (`loopVideoUrl`), else the file named after the expert's first name in `public/experts/vid`: a stopgap to delete once the back office serves them |
| `src/app/globals.css`, `src/components/ui/**` | The Yelema skin: tokens (light and `.dark`), radii, Onest and Bricolage Grotesque, and the primitives that follow them |
| `src/lib/installed-experts.ts`, `src/app/api/experts/` | The profiles installed on the instances a user can see, and where their installation stands (`running`, `ready`, `failed`, as the back office says): the home waits, or names what failed |
| `src/app/api/catalogue/[key]/request/` | A member asks for an expert they do not have: passed on to the back office, which tells Yelema's team. The app installs nothing |
| `src/lib/drive.ts`, `src/lib/drive-paths.ts` | The drive (`~/Livrables`) and the path guard every files route applies |
| `src/lib/drive-order.ts` (+ `.test.ts`) | The order of a drive folder on screen: the memory folder pinned first, then folders and files together, newest change first |
| `src/lib/drive-links.ts` (+ `.test.ts`) | Which drive documents belong to a chat reply: paths cited in the text first (but not one missing from a folder the listing covers: a made-up path), then files the Expert changed during the turn (window from the user message, 30 min max), memory and hidden files excluded |
| `src/lib/call-turns.ts`, `src/lib/mic-tap.ts` (+ `.test.ts`), `src/components/voice/` | Voice calls with an expert, as on the mobile app: a wide white window, the expert on the left and what is said live on the right (Aethex's RTVI captions and tool events, read on the call's data channel), the halo around the picture (violet while the expert speaks, picks up, thinks or searches, green on the member's turn with three dots, grey picture and a turning arc while connecting, a loupe while a tool runs, a red badge when the microphone is cut), « réfléchit » read from the member's microphone (the stream the SDK opened) and the expert's voice level, « Réfléchis plus longtemps » and « Laisse-moi finir » kept in the call hook but no longer on screen (Leslie, 23/10), the face preloaded from « Appeler », the ringback and the end tone, and the history as in Fireflies: the list across the page, a call opening its own page (« ‹ Appels », « Rappeler »; one surface: the summary in document style on the left, in sections when the back office serves them (`summarySections`), the transcript in a full-height side panel on the right with avatars and times, its search highlighting and walking the matches without hiding a line (`findInText`); one under the other on a phone; French non-breaking spaces with `frenchSpacing`), a transcript only when the back office serves one, never the raw one |
| `src/components/chat/DocumentCards.tsx` | Under each finished reply: an inline preview (first PDF page with page count via pdfjs-dist, first rows of a CSV or xlsx via jszip, start of a Word file via mammoth, images as is, format thumbnail otherwise, pptx included) that opens FilePreview, then the file row with Télécharger. Renderers load on demand, any failure falls back to the thumbnail; a file over 30 MB is not previewed, its size read from the listing or, when unknown, from the response (given up past it), and a workbook part over 20 MB once unzipped is not read |
| `src/lib/hermes-cron.ts`, `src/app/api/agents/[id]/routines/**` | Routines: Hermes's scheduler through its API server (port 8642, `yelema-hermes` image). A profile installed after the instance's start has no key: on a `401` the module runs the image's own key script in the instance, then asks again |
| `src/lib/routines.ts` (runs), `src/app/api/agents/[id]/routines/[routineId]/runs/` | A routine's past runs: the conversations Hermes opens for it, its preamble and `[SILENT]` answers recognised |
| `src/components/experts/RoutinesTable.tsx`, `RoutineDialog.tsx`, `RoutineHistoryDialog.tsx` | Routines as one table, the expert's own then the ones it proposes (« Proposée », « Activer »), five rows then « Voir plus », with bulk selection (Activer / Mettre en pause / Tout activer, `src/lib/bulk.ts`: three PATCH at a time), the create/edit form, a routine's run history |
| `src/lib/jour-zero.ts` (+ `.test.ts`), `src/app/api/agents/[id]/experts/[profile]/jour-zero/`, `src/components/experts/ExpertReadiness.tsx` | The expert's day-zero preparation (`~/Livrables/<Expert>/_memoire/jour-zero.json`, written by the expert), validated, as a chip on its page and its checks behind it |
| `src/lib/expert-tools.ts` (+ `.test.ts`), `src/app/api/agents/[id]/experts/[profile]/outils/`, `src/components/experts/ExpertTools.tsx` | Outils tab: the pack's `outils-recommandes.json` read from the profile, validated, matched to the member's connectors and MCP servers (to connect / ready / included) |
| `src/lib/tool-steps.ts` (+ `.test.ts`), `src/components/chat/ChatSteps.tsx` | What the expert is doing, in plain French, from the chat stream's tool calls: the live line and the folded « Étapes » |
| `src/lib/chat-queue.ts` (+ `.test.ts`) | Messages sent during an answer, sent together as the next turn |
| `src/lib/frame-batch.ts`, `src/lib/paragraph-cache.ts` (+ `.test.ts`) | A streaming reply: deltas applied once per frame (`useChat`), its finished paragraphs linked once (`Markdown`) |
| `src/lib/once-per.ts` (+ `.test.ts`), `src/components/app/wake.ts` | The instance woken as an expert's chat opens or its composer gets focus, at most once per 5 minutes (and by `ReadAhead`) |
| `src/lib/paginate.ts` (+ `.test.ts`), `src/components/Pager.tsx` | One page of a list, and the pager under it |
| `src/lib/fr-dates.ts` (+ `.test.ts`) | Relative and full French dates, in the routines' time zone |
| `src/components/memory/MemoryGroups.tsx` | Enterprise memory deposits, one folding block per compartment |
| `src/components/home`, `src/components/experts`, `src/components/integrations` | Home, gallery, sheet, routines, connectors |
| `src/app/api/agents/[id]/computer/`, `src/components/experts/ComputerProvider.tsx`, `ExpertComputer.tsx` | "Son ordinateur": the instance's screen live beside the chat (noVNC, 60-second signed URL), and taking over mouse and keyboard |
| `src/app/api/agents/[id]/channels/**` | Messaging channels BFF (list + Teams address / write / disconnect, Telegram checks, WhatsApp pairing) |
| `src/lib/hermes-messaging.ts` | The agent's own messaging API, reached over `exec`; the only module that speaks it |
| `src/lib/telegram.ts` | Telegram Bot API calls made BEFORE anything is written into the agent (token check, owner lookup) |
| `src/lib/channels.ts` | Channel types + the featured list, shared by the BFF and the Messaging tab |
| `src/lib/channel-rules.ts` | What a channel write may carry: allowlist required and shaped per channel, allow-all / Teams port / Google HTTP callback never written |
| `src/lib/channel-checks.ts` + `teams.ts`, `slack.ts`, `discord.ts`, `google-chat.ts`, `telegram.ts` | Each provider's credential check, run before a write (French message, provider text to the log only) |
| `src/components/channels/**` | Canaux: channel list, Telegram flow, WhatsApp QR, Teams (Azure Bot + address from the back office), Slack (manifest), generic credentials form |
| `src/app/(app)/parametres/**`, `src/components/settings/**`, `src/app/(app)/integrations/**`, `src/components/MyInstance.tsx`, `src/components/useMyAgents.ts` | Paramètres (Personnel, then Entreprise: Membres and Instances for admins, and the back office's) and the Intégrations tabs (Connecteurs and Canaux for everyone, then E-mails, Modèles, MCP), and the signed-in user's own instance Connecteurs and Canaux act on |
| `src/app/(app)/experts/[agentId]/[[...onglet]]/`, `src/lib/expert-tabs.ts` | The expert workspace route and its URL grammar (instance, profile, tab) |
| `src/config/agents.ts` | `SHAPE_PRESETS`, `DEFAULT_AGENT`, the `AGENT_TYPES` catalog, `PORT_LABELS` (labels only), and `templateAppPorts` — the per-template openable app ports (the API no longer reports per-instance ports) |
| `src/config/branding.ts` | `appName` / `logoUrl` code constants (branding lives here, not in env) |
| `src/lib/types.ts` | App + upstream `/v1` types |
| `supabase/migrations/0001_init.sql` | Schema, RLS policies (dormant backstop), SECURITY DEFINER RPCs; grants tables to the service role only (clients have no direct DB access) |
| `supabase/migrations/0003_agent_backoffice_columns.sql` | Columns the back office fills on `agents`: `profiles`, `ready`, `apps_token_hash` |
| `docs/plans/experts-profils-vercel.md` | The current plan and the contract with the back office |
| `docs/plans/composio-suivi-appels.md` | Composio usage: the declaration route and the back office's reading routes |
| `docs/plans/app-unique-resolver.md` | One deployment for every client: the resolver and its contract with the back office |
| `src/lib/supabase/admin.ts` | Service-role client (server-only, bypasses RLS) — the DB egress |
| `scripts/setup.mjs` | One-command Supabase setup (`npm run setup`) |

## Commands

```bash
npm install
npm run setup       # configure Supabase end-to-end (idempotent; needs SUPABASE_ACCESS_TOKEN)
npm run dev         # http://localhost:3000
npm run build
npm run typecheck   # tsc --noEmit
npm test            # node --test on src/**/*.test.ts (no dependency; needs a Node that runs TypeScript)
```

Tests are few and cover pure modules only (a tested file imports nothing from `@/` nor
`server-only`); the gate before shipping is a clean `npm run typecheck`, `npm test`
and `npm run build`. Setup is "paste two keys + `npm run setup`" — no manual
dashboard steps.

## Custom agent image (out of scope here)

Nothing here builds or pushes an agent image. Yelema's agent image lives in its own repo,
**`Yelema-ai/yelema-hermes`**, with a `versions.json` registry the back office reads to pin each
instance. This app only relies on what that image provides: the `apps` tool server wired from
`~/.yelema/apps-mcp.json` (Connecteurs) and Hermes's API server on port 8642 with its key in
`~/.yelema/api-server-key` (Routines), and the screen streamed on port 6901 ("Son ordinateur",
image v1.1.0 and later). Chat by profile needs no custom image.

The root `Dockerfile` builds **this app** for the older per-client containers (see
`docs/plans/yelema-single-tenant.md`). Clients run on Vercel, deployed by the back office from a
git tag (`vercel.json` turns automatic deployments off): one project per client so far, moving to
one project for every client behind `*.app.yelema.ai` (`docs/plans/app-unique-resolver.md`). The
Dockerfile goes away once every client is on Vercel.

- [Build a custom image](https://www.agent37.com/docs/agents-api/custom-image) — the guide.

## House rules

- **The API is the final authority.** Shapes, disks, templates, budgets — the
  `/v1` API can reject anything your account's tier disallows, regardless of what
  `src/config` lists. Check the docs before assuming a capability exists.
- **Never expose `AGENT37_API_KEY` to the browser.** It stays server-side; all
  agent calls go through `src/app/api/**` → `src/lib/agent37.ts`.
- **A messaging channel is a door into the agent, so fill its allowlist.** Every channel
  takes an allowed-users field; empty means anyone who finds the bot reaches the agent,
  its files, and its connected accounts. `PUT …/channels/[channel]` refuses to switch a
  channel on with an empty one, and never sends `*_ALLOW_ALL_USERS`. The Telegram flow
  learns the owner from the first message sent to the bot rather than asking for a
  numeric id nobody knows. Ids: Telegram digits, Teams Entra object ids, Slack member ids
  (`U…`), Discord user ids, Google Chat e-mails.
- **Check a channel credential before writing it** (`src/lib/channel-checks.ts`: Telegram
  `getMe`, Microsoft Entra token, Slack `auth.test` + `apps.connections.open`, Discord
  `users/@me`, Google service-account token). The agent's messaging gateway refuses to
  start on a bad token, which takes every other channel on that agent down with it.
- **Teams listens on the port the back office opened** (`channels.teams.endpoint` in
  `/app/instance`, the default profile's address); the app shows it and never writes
  `TEAMS_PORT`/`TEAMS_HOST`. Google Chat receives over Pub/Sub only.
- **An id from the browser is checked before it goes into an Agent37 URL** (`urlId` in
  `src/lib/agent37.ts`): the key sent with the call is workspace-wide, so `../` in an id would aim
  it at another instance.
- **A member never reads Agent37's, the instance's or the database's own error text.** It is
  English and written for the operator. `handleError` (`src/lib/http.ts`) and `upstreamErrorMessage`
  log it and answer a French sentence written here; a new route does the same.
- **A file served from the drive cannot run script with the member's session.** Anything but a
  picture, a PDF, audio, video or plain text is answered with `Content-Security-Policy: sandbox`.
- **A file sent from the browser is at most 4 MB** (`src/lib/upload-limit.ts`): the host refuses a
  larger request before any route sees it.
- **A file path from the browser is checked before it reaches the instance** (`assertInDrive`). The attachments of a chat turn are such paths too.
  Server code that must read outside the drive (the routines key file) does so itself, never
  through a path the caller supplied.
- **A member never reaches the instance's own dashboard, terminal or files UI.** There is no
  settings tab and no route that mints a signed URL for an arbitrary port; running the instance is
  Yelema's job, from the back office. The one exception is "Son ordinateur", whose route signs
  the screen's port only.
- **The app sets no model key and no tool on an instance.** A key, an endpoint or a subscription
  for the experts' model is asked of the back office (`/api/v1/app/llm/*`), which alone writes on
  the instance: no `exec` and no files call here for it, and no list of providers. A key goes
  through the app once, on its way in, and never comes back: only its last four characters. The
  same holds for a tool server (MCP) the client plugs on its experts (`/api/v1/app/mcp/*`): its
  token goes in once and never comes back, and its tools are the client's own, which Yelema does
  not check.
- **The app cannot act on an instance.** No route starts, stops, restarts, updates, resizes or
  re-budgets one, and `src/lib/agent37.ts` no longer has those calls: the app holds Yelema's
  workspace-wide key, so any such route would let a signed-in user change an instance behind the
  back office's back.
- **The app never changes an instance's sleep or size.** The back office creates each member's
  instance (2 vCPU, auto-sleep after 30 idle minutes). A sleeping instance wakes on any request
  from the app, but hears no Telegram/WhatsApp message and runs no Hermes routine until then.
- **"Son ordinateur" hands out full control of the instance.** The signed URL for the screen lets
  its holder click and type on the member's machine and cannot be revoked: it is minted only for
  the instance's owner, for 60 seconds, and never logged.
- **Payments are intentionally excluded.** Add Stripe (or anything) yourself when
  you're ready to charge your own customers — the create route (`src/app/api/agents/route.ts`)
  has a commented `canCreateAgent()` seam marking where an entitlement gate would go.
- **Branding lives in `src/config/branding.ts`** (`appName` / `logoUrl` constants),
  not in env. The old `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_LOGO_URL` vars are gone;
  keep it code-side.
- Keep changes small and focused; don't add unrequested features or touch
  unrelated code.
