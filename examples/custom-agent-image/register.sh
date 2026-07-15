#!/usr/bin/env bash
# Register an Agent37 template from either a public image reference or a local
# `docker save` archive, then spawn an instance from it.
#
# Prereqs:
#   - curl and jq installed
#   - AGENT37_API_KEY set
#   - exactly one of IMAGE_REF or IMAGE_ARCHIVE set (see .env.example)
set -euo pipefail

API="${AGENT37_API_BASE:-https://api.agent37.com}"
TEMPLATE="${TEMPLATE_NAME:-my-custom-agent}"
: "${AGENT37_API_KEY:?Set AGENT37_API_KEY (sk_live_...). See .env.example.}"
IMAGE_REF="${IMAGE_REF:-}"
IMAGE_ARCHIVE="${IMAGE_ARCHIVE:-}"

if [ -n "${IMAGE_REF}" ] && [ -n "${IMAGE_ARCHIVE}" ]; then
  echo "Set exactly one of IMAGE_REF or IMAGE_ARCHIVE, not both." >&2
  exit 1
fi
if [ -z "${IMAGE_REF}" ] && [ -z "${IMAGE_ARCHIVE}" ]; then
  echo "Set exactly one of IMAGE_REF or IMAGE_ARCHIVE. See .env.example." >&2
  exit 1
fi
if [ -n "${IMAGE_ARCHIVE}" ] && [ ! -f "${IMAGE_ARCHIVE}" ]; then
  echo "IMAGE_ARCHIVE does not exist: ${IMAGE_ARCHIVE}" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${AGENT37_API_KEY}")

if [ -n "${IMAGE_REF}" ]; then
  image_field="image_ref"
  image_value="${IMAGE_REF}"
  echo "Using public image ${IMAGE_REF}"
else
  echo "Requesting an upload slot for ${IMAGE_ARCHIVE}"
  upload=$(curl -fsS -X POST "${API}/v1/template-uploads" "${auth[@]}")
  upload_id=$(jq -er '.id' <<<"${upload}")
  upload_url=$(jq -er '.upload_url' <<<"${upload}")

  echo "Uploading the docker-save archive"
  curl -fsS --upload-file "${IMAGE_ARCHIVE}" "${upload_url}" >/dev/null
  image_field="upload_id"
  image_value="${upload_id}"
fi

create_body=$(jq -nc \
  --arg name "${TEMPLATE}" --arg field "${image_field}" --arg value "${image_value}" \
  '{name: $name, description: "Custom Agent37 image"} + {($field): $value}')
update_body=$(jq -nc \
  --arg field "${image_field}" --arg value "${image_value}" \
  '{($field): $value}')

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
