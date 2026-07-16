#!/usr/bin/env bash
# Register an Agent37 template from either a public image reference or a cloud
# build of a local Dockerfile folder, then spawn an instance from it.
#
# Prereqs:
#   - curl and jq installed (the CONTEXT_DIR path also needs Node for npx)
#   - AGENT37_API_KEY set
#   - exactly one of IMAGE_REF or CONTEXT_DIR set (see .env.example)
set -euo pipefail

API="${AGENT37_API_BASE:-https://api.agent37.com}"
TEMPLATE="${TEMPLATE_NAME:-my-custom-agent}"
: "${AGENT37_API_KEY:?Set AGENT37_API_KEY (sk_live_...). See .env.example.}"
IMAGE_REF="${IMAGE_REF:-}"
CONTEXT_DIR="${CONTEXT_DIR:-}"

if [ -n "${IMAGE_REF}" ] && [ -n "${CONTEXT_DIR}" ]; then
  echo "Set exactly one of IMAGE_REF or CONTEXT_DIR, not both." >&2
  exit 1
fi
if [ -z "${IMAGE_REF}" ] && [ -z "${CONTEXT_DIR}" ]; then
  echo "Set exactly one of IMAGE_REF or CONTEXT_DIR. See .env.example." >&2
  exit 1
fi
if [ -n "${CONTEXT_DIR}" ] && [ ! -f "${CONTEXT_DIR}/Dockerfile" ]; then
  echo "CONTEXT_DIR has no Dockerfile: ${CONTEXT_DIR}" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${AGENT37_API_KEY}")

if [ -n "${CONTEXT_DIR}" ]; then
  # The cloud build publishes the template itself (new name = revision 1, existing
  # name = next revision), so no create/PATCH call is needed on this path.
  echo "Building '${TEMPLATE}' from ${CONTEXT_DIR} on Agent37's linux/amd64 builders"
  AGENT37_API_KEY="${AGENT37_API_KEY}" npx agent37 templates build "${CONTEXT_DIR}" \
    --name "${TEMPLATE}"
else
  echo "Using public image ${IMAGE_REF}"
  create_body=$(jq -nc --arg name "${TEMPLATE}" --arg ref "${IMAGE_REF}" \
    '{name: $name, description: "Custom Agent37 image", image_ref: $ref}')
  update_body=$(jq -nc --arg ref "${IMAGE_REF}" '{image_ref: $ref}')

  existing=$(curl -sS -o /dev/null -w '%{http_code}' \
    "${auth[@]}" "${API}/v1/templates/${TEMPLATE}" || true)
  case "${existing}" in
    200)
      echo "Updating template '${TEMPLATE}'"
      curl -fsS -X PATCH "${API}/v1/templates/${TEMPLATE}" "${auth[@]}" \
        -H "Content-Type: application/json" -d "${update_body}" >/dev/null
      ;;
    404)
      echo "Creating template '${TEMPLATE}'"
      curl -fsS -X POST "${API}/v1/templates" "${auth[@]}" \
        -H "Content-Type: application/json" -d "${create_body}" >/dev/null
      ;;
    *)
      echo "Could not check template '${TEMPLATE}' (HTTP ${existing})." >&2
      exit 1
      ;;
  esac
fi

echo "Creating an instance from '${TEMPLATE}'"
# credit_micros gives $1 of managed-spend headroom. It is harmless on the clean base
# (which uses no managed model) and ready if you switch to the full image.
instance_body=$(jq -nc --arg template "${TEMPLATE}" \
  '{template: $template, budget: {credit_micros: 1000000}}')
instance=$(curl -fsS -X POST "${API}/v1/instances" "${auth[@]}" \
  -H "Content-Type: application/json" -d "${instance_body}")
id=$(jq -er '.id' <<<"${instance}")
url=$(jq -r '.url // empty' <<<"${instance}")

cat <<EOF

Done. Instance ${id} is running your image.
  URL:  ${url}

Confirm your baked-in CLI shipped (control-plane exec — no model needed):
  curl -sS -X POST ${API}/v1/instances/${id}/exec \\
    -H "Authorization: Bearer \$AGENT37_API_KEY" -H "Content-Type: application/json" \\
    -d '{"command":"cowsay hello from my own image"}'

See your seeded skill:
  curl -sS -X POST ${API}/v1/instances/${id}/exec \\
    -H "Authorization: Bearer \$AGENT37_API_KEY" -H "Content-Type: application/json" \\
    -d '{"command":"ls ~/.hermes/skills"}'

Delete it when you are done (this stops billing):
  curl -sS -X DELETE ${API}/v1/instances/${id} -H "Authorization: Bearer \$AGENT37_API_KEY"
EOF
