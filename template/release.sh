#!/usr/bin/env bash
# Build, push, and register your custom Agent37 workspace template — run via
# `npm run release:agent`. Reads AGENT37_API_KEY from .env.local.
#
# DORMANT by default — only needed if you ship your own image. The default Starter
# Kit (agent37-hermes / agent37-openclaw) needs NONE of this.
#
# Steps to go live:
#   1) edit IMAGE / TAG / TEMPLATE_NAME below + the Dockerfile in this folder
#   2) docker login ghcr.io, then make the pushed package PUBLIC (first publish only):
#        https://github.com/orgs/<your-org>/packages  (package → Settings → Public)
#   3) npm run release:agent
#   4) uncomment the matching AGENT_TYPES entry in src/config/agents.ts
#      (its `template` must equal TEMPLATE_NAME below)
#
# This forks the FULL Hermes image (managed model + gateway included). To bring your
# OWN model instead, see examples/custom-agent-image/. The Hermes base tag is
# auto-resolved to the newest date tag in GHCR at build time — override with
# HERMES_TAG=YYYY.MM.DD[x] to pin one.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # template/
ROOT="$(dirname "$DIR")"                              # repo root (holds .env.local)

# --- EDIT THESE THREE (placeholders) ---------------------------------------------
IMAGE="${IMAGE:-ghcr.io/your-org/your-agent}"
# Bump every release — image tags are immutable (date + a revision letter: a, b, c…).
TAG="${TAG:-2026.01.01a}"
# Must match the `template` value of the AGENT_TYPES entry you uncomment in
# src/config/agents.ts.
TEMPLATE_NAME="${TEMPLATE_NAME:-your-template-name}"
# ---------------------------------------------------------------------------------

# Pull a single value out of .env.local without sourcing it, so spaces/quotes in
# other vars can't break us. An existing environment variable wins over the file.
read_env() {
  local v
  v="$(grep -E "^$1=." "$ROOT/.env.local" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r')"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

BASE_REPO="${BASE_REPO:-agent37-platform/hermes}"

# Resolve the newest Hermes *date* tag (YYYY.MM.DD[x]) straight from GHCR's tag list —
# the source of truth. The anonymous pull token suffices for the public tag list.
# Prints nothing on failure so the caller can fall back / error out.
resolve_hermes_tag() {
  local token
  token="$(curl -fsSL "https://ghcr.io/token?scope=repository:${BASE_REPO}:pull" \
    | grep -o '"token":"[^"]*"' | cut -d'"' -f4)" || return 1
  [ -n "$token" ] || return 1
  curl -fsSL -H "Authorization: Bearer ${token}" \
    "https://ghcr.io/v2/${BASE_REPO}/tags/list" \
    | grep -oE '"[0-9]{4}\.[0-9]{2}\.[0-9]{2}[a-z]*"' \
    | tr -d '"' | LC_ALL=C sort | tail -1
}

AGENT37_API_KEY="${AGENT37_API_KEY:-$(read_env AGENT37_API_KEY)}"
: "${AGENT37_API_KEY:?not found — set AGENT37_API_KEY in .env.local}"

NAME="${TEMPLATE_NAME}"
HERMES_TAG="${HERMES_TAG:-$(resolve_hermes_tag || true)}"
: "${HERMES_TAG:?could not resolve a Hermes tag from GHCR — set HERMES_TAG explicitly, e.g. HERMES_TAG=2026.06.26b}"
# The Hosting API base is fixed; AGENT37_API only overrides it for local API work.
API="${AGENT37_API:-https://api.agent37.com/v1}"
AUTH="Authorization: Bearer ${AGENT37_API_KEY}"

echo "==> Build + push ${IMAGE}:${TAG} (linux/amd64)"
echo "    base: ghcr.io/${BASE_REPO}:${HERMES_TAG}"
docker buildx build --platform linux/amd64 --pull \
  --build-arg "HERMES_TAG=${HERMES_TAG}" \
  -t "${IMAGE}:${TAG}" --push "${DIR}"

# The bare instance URL routes to default_port. Port 3737 is the legal gateway
# default; every other listening port is derivable as {instanceId}-{port}.agent37.app.
BODY=$(cat <<JSON
{
  "name": "${NAME}",
  "image_ref": "${IMAGE}:${TAG}",
  "description": "Custom Agent37 workspace template (forked from the full Hermes image).",
  "default_port": 3737
}
JSON
)

# Create the template the first time, update it (same name) on every release after.
if [ "$(curl -sS -o /dev/null -w '%{http_code}' -H "${AUTH}" "${API}/templates/${NAME}" || true)" = "200" ]; then
  echo "==> Update template ${NAME} (PATCH)"; method=PATCH; url="${API}/templates/${NAME}"
else
  echo "==> Create template ${NAME} (POST)"; method=POST; url="${API}/templates"
fi

code=$(curl -sS -o /tmp/agent37-template.json -w '%{http_code}' \
  -X "${method}" "${url}" -H "${AUTH}" -H "Content-Type: application/json" -d "${BODY}")
echo "HTTP ${code}"; cat /tmp/agent37-template.json 2>/dev/null || true; echo
case "${code}" in 2*) echo "OK  ${NAME} -> ${IMAGE}:${TAG}";; *) echo "FAILED"; exit 1;; esac
