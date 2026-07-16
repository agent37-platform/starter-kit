# Custom agent image — example

A self-contained example showing two ways to customize an [Agent37](https://www.agent37.com) agent. It is **not wired into this app** — instances use Agent37's managed model out of the box. It lives here so you (or your customers) can read the pattern and opt in.

Two independent extension points:

1. **Your own Docker image** — bake in CLIs and skills (`Dockerfile`, `hello/`).
2. **Your own model** — point the agent at your own LLM via a tiny proxy (`llm-proxy/`).

> The `cowsay` CLI and `hello` skill are **placeholders** — they show *where* customizations go. Swap them for your own.

## What's in here

| Path | What it does |
| --- | --- |
| `Dockerfile` | `FROM` the Hermes base; installs an example CLI + skill |
| `hello/SKILL.md` | An example skill that teaches the agent a behavior |
| `llm-proxy/proxy.mjs` | A ~40-line example LLM proxy — bring your own model |
| `register.sh` | Creates or updates a template from a public image or a cloud build of this folder, then spawns an instance |
| `.github/workflows/publish.yml` | Reference CI that publishes the image to GHCR (see the note) |

## Track 1 — your own image

1. **Customize** the `Dockerfile`: install your CLI, drop in your skill. Binaries go in `/usr/local/bin`, skills in `/usr/local/share/agent37/default-skills/`.
2. **Choose how to send the image.** Either way Agent37 stores the image privately and pins it by digest.

   - **Cloud build (recommended):** set `CONTEXT_DIR=.` and `register.sh` runs `npx agent37 templates build`, which uploads only the build context (this folder minus `.git` and `.dockerignore` patterns, gzipped, 100 MB cap), builds it on Agent37's `linux/amd64` infrastructure streaming the build log, and publishes the template. Every `FROM`/`RUN` fetch must be publicly reachable — Agent37 does not accept private-registry credentials. No local Docker needed; a plain `docker build .` stays handy as an optional local test. Ctrl-C stops the log, not the server-side build.
   - **Public registry:** copy this folder into its own GitHub repo. The bundled `.github/workflows/publish.yml` builds `linux/amd64` and pushes to GHCR using GitHub's built-in token. Make the package **public** after the first publish, then set `IMAGE_REF` to its pinned `:<sha>` tag.

3. **Register and spawn.** Mint an `sk_live_` key in the [dashboard](https://www.agent37.com/dashboard/cloud), then:
   ```bash
   cp .env.example .env          # set the key and exactly one image source
   set -a; source .env; set +a
   ./register.sh
   ```

> **The workflow is a reference.** GitHub only runs workflows from a repo's root `.github/workflows/`, so the copy here (a subfolder) never fires. It works once this folder is the root of its own repo.

## Track 2 — your own model

The base image is **clean: it boots with no model** (standard Agent37 instances use Agent37's managed model; this base is for bringing your own). The `llm-proxy/` folder is a ~40-line OpenAI-compatible pass-through to OpenRouter — deploy it, then point an instance at it.

```bash
cd llm-proxy
cp .env.example .env     # set OPENROUTER_API_KEY and PROXY_TOKEN
node proxy.mjs           # serves /v1/models and /v1/chat/completions on :8787
```

Deploy it anywhere with an HTTPS URL, then write `~/.hermes/config.yaml` on the instance (over [`exec`](https://www.agent37.com/docs/agents-api/exec) or the terminal):

```yaml
model:
  provider: "custom:MyProxy"
  default: "moonshotai/kimi-k2.7-code"      # the id your /v1/models returns
custom_providers:
  - name: "MyProxy"
    base_url: "https://your-proxy.example.com/v1"   # note the /v1 suffix
    api_key: "demo-proxy-token"                      # = PROXY_TOKEN
    api_mode: "chat_completions"
    model: "moonshotai/kimi-k2.7-code"
```

It lives on the persistent volume, so it survives restarts. Then [message the instance](https://www.agent37.com/docs/agents-api/chat) and it runs on your model.

## The contract

Four rules keep a custom image runnable:

1. **The image must be `linux/amd64`.** Cloud builds and the bundled GitHub Action both take care of this.
2. **Keep the image at most 5 GB.**
3. **Bake outside `/home`.** `/home/node` and `/home/linuxbrew` are persistent volumes that mask anything baked there at build time. Binaries → `/usr/local/bin`, skills → `/usr/local/share/agent37/default-skills/`, other assets → `/opt`.
4. **Keep the base `ENTRYPOINT`.** It starts Hermes and the gateway that serves the chat API.

Don't bind the reserved ports `3737`, `7681`, `8080`, `6080`, `7890`, `6969`, `9119` — they belong to the runtime.

## Costs and cleanup

Spawning an instance debits real compute from your wallet (from a few cents). Delete it when you're done:

```bash
curl -X DELETE https://api.agent37.com/v1/instances/<id> -H "Authorization: Bearer $AGENT37_API_KEY"
```

## Learn more

- [Build your own agent image (guide)](https://www.agent37.com/docs/agents-api/build-your-own-image)
- [Templates → build on the Hermes base image](https://www.agent37.com/docs/agents-api/templates#build-on-the-hermes-base-image)

Licensed under MIT, same as this repo.
