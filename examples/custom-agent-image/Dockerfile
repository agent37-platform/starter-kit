# Build your own Agent37 agent image.
#
# This is an EXAMPLE. The two customizations below — a CLI (cowsay) and a skill
# (hello/) — are placeholders that show you WHERE and HOW to add your own. Swap
# them for the tools, skills, and config your agent actually needs.
#
# The contract (see README.md → "The contract"):
#   - the image must be linux/amd64 (the GitHub Action and Agent37 cloud builds both are)
#   - keep the image at most 5 GB
#   - bake into /usr/local or /opt, never /home/node or /home/linuxbrew
#     (both are persistent volumes that mask anything baked there at runtime)
#   - keep the base ENTRYPOINT (it starts Hermes + the gateway/chat API)
#   - install as root, end as USER node
#
# This example uses :latest so it tracks new base releases automatically — handy for
# getting started. For reproducible PRODUCTION builds, pin a date tag (e.g.
# :2026.06.16a) instead; the current tag is in the docs:
#   https://www.agent37.com/docs/agents-api/templates#build-on-the-hermes-base-image
FROM ghcr.io/agent37-platform/hermes-base:latest

USER root

# (1) EXAMPLE CLI — a tiny tool installed into /usr/local/bin, which is on PATH and
#     survives the persistent home volume. Anything here is callable by the agent's
#     shell and by `exec`. Replace cowsay with whatever your agent should be able to run.
RUN apt-get update \
 && apt-get install -y --no-install-recommends cowsay \
 && ln -sf /usr/games/cowsay /usr/local/bin/cowsay \
 && rm -rf /var/lib/apt/lists/*

# (2) EXAMPLE SKILL — baked into the default-skills dir (NOT /home, which is masked).
#     The base entrypoint copies it into ~/.hermes/skills on boot, where Hermes loads it.
#     A skill is a folder with a SKILL.md. Replace hello/ with your own skill.
COPY hello /usr/local/share/agent37/default-skills/hello

USER node
