#!/usr/bin/env bash
# Create the realm roles the expense desk needs.
# Role ASSIGNMENT still goes through the admin quorum in the tide-console.
set -euo pipefail

TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-$(jq -r .realm tidecloak.json)}"
KC_USER="${KC_USER:-admin}"
KC_PASSWORD="${KC_PASSWORD:-password}"

ROLES=(
  "expense-submitter|Can submit expenses"
  "expense-approver|Can approve or reject expenses"
  "expense-finance|Can manage payee bank details and release payments"
  "_tide_payee.selfencrypt|Can encrypt payee bank details"
  "_tide_payee.selfdecrypt|Can decrypt payee bank details"
)

token=$(curl -s -X POST "${TIDECLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli \
  --data-urlencode "username=${KC_USER}" --data-urlencode "password=${KC_PASSWORD}" | jq -r .access_token)

for entry in "${ROLES[@]}"
do
  name="${entry%%|*}"
  description="${entry#*|}"
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/roles" \
    -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \
    -d "{\"name\":\"${name}\",\"description\":\"${description}\"}")
  echo "  ${name} -> ${code}"
done
