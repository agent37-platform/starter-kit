# OPTIONAL — your own Agent37 agent image (the opt-in "bake it into the image" path).
#
# DORMANT by default. The Starter Kit ships running on the built-in system
# templates (`agent37-hermes` / `agent37-openclaw`) — zero Docker, zero GHCR. You
# only need this folder if you want to bake something into your OWN image (a system
# package, a CLI, a skill, custom config). Most forks never touch it.
#
# This is the SIMPLE path: fork the FULL Hermes image, so the managed model + the
# gateway (chat API) work out of the box — you just add your bits on top. If you'd
# rather bring your OWN model (point the agent at your own LLM via a tiny proxy),
# see the more advanced example in `examples/custom-agent-image/`.
#
# The contract (keep these or the image won't run):
#   - build for linux/amd64  (on Apple Silicon, buildx with --platform=linux/amd64;
#     `npm run release:agent` already passes it)
#   - keep the image at most 5 GB
#   - bake into /usr/local or /opt, never /home/node or /home/linuxbrew
#     (both are persistent volumes that mask anything baked there at runtime)
#   - keep the base ENTRYPOINT (it starts Hermes + the gateway that serves chat)
#   - install as root, end as USER node
#
# Publish: the pushed image must be PUBLIC on GHCR (Agent37 pulls it anonymously).
# After editing this file, run `npm run release:agent` (build + push + register the
# workspace template). See template/release.sh for the exact steps.

# The base Hermes tag is injected at build time — release.sh resolves the newest
# date tag from GHCR and passes --build-arg HERMES_TAG=<tag>, so each release pins a
# concrete, immutable tag. The :latest default is only a convenience for ad-hoc
# `docker build` runs without the arg; override with --build-arg HERMES_TAG=YYYY.MM.DD[x].
ARG HERMES_TAG=latest
FROM ghcr.io/agent37-platform/hermes:${HERMES_TAG}

USER root

# --- Add your customizations here (OPTIONAL) -------------------------------------
# Install as root, into /usr/local or /opt (NOT /home — it's a masked volume).
# A skill is a folder with a SKILL.md baked into the default-skills dir; the base
# entrypoint copies it into ~/.hermes/skills on boot.
#
# Example — install a system package:
# RUN sudo apt-get update \
#  && sudo apt-get install -y --no-install-recommends <pkg> \
#  && rm -rf /var/lib/apt/lists/*
#
# Example — bake a skill:
# COPY my-skill /usr/local/share/agent37/default-skills/my-skill
# ---------------------------------------------------------------------------------

# Every listening port is reachable at `{instanceId}-{port}.agent37.app`; templates
# no longer declare a ports array. `template/release.sh` sets the legal default port
# 3737 so the bare instance URL routes to the inherited Hermes gateway.

# Keep the base ENTRYPOINT (do NOT override it — it starts Hermes + the gateway).
USER node
