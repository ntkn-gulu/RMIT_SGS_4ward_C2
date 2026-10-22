#!/usr/bin/env bash
# Admin helper for the demo realm. Every change here is only a PROPOSAL:
# TideCloak parks it as a change request until enough realm admins approve
# it in the tide-console ("QEA Approvals").
#
#   bash scripts/desk_admin.sh pending                 list pending change requests
#   bash scripts/desk_admin.sh invite alice bob carol  propose new users
#   bash scripts/desk_admin.sh link alice              print a Tide enrollment link
#   bash scripts/desk_admin.sh grant alice expense-submitter [more roles]
#   bash scripts/desk_admin.sh make-admin bob          propose bob as a realm admin
set -euo pipefail

TIDECLOAK_URL="${TIDECLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-$(jq -r .realm tidecloak.json)}"
KC_USER="${KC_USER:-admin}"
KC_PASSWORD="${KC_PASSWORD:-password}"

adminToken()
{
  curl -s -X POST "${TIDECLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli \
    --data-urlencode "username=${KC_USER}" --data-urlencode "password=${KC_PASSWORD}" | jq -r .access_token
}

userId()
{
  curl -s "${TIDECLOAK_URL}/admin/realms/${REALM}/users?username=$1&exact=true" \
    -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0].id // empty'
}

TOKEN="$(adminToken)"
command="${1:-pending}"
shift || true

case "${command}" in
  pending)
    curl -s "${TIDECLOAK_URL}/admin/realms/${REALM}/iga/change-requests?status=PENDING" \
      -H "Authorization: Bearer ${TOKEN}" \
      | jq -r '.[] | "\(.actionType)\t\(.authorizationCount)/\(.threshold) approvals\t\(.rows[0].NAME // .rows[0].USERNAME // .entityId)"'
    ;;

  invite)
    for name in "$@"
    do
      code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/users" \
        -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
        -d "{\"username\":\"${name}\",\"email\":\"${name}@twokeys.example\",\"firstName\":\"${name^}\",\"enabled\":true,\"emailVerified\":false,\"attributes\":{\"tideInvitable\":[\"true\"]}}")
      echo "  invite ${name} -> ${code}"
    done
    ;;

  link)
    id="$(userId "$1")"
    [[ -z "${id}" ]] && { echo "User $1 not found (is the CREATE_USER request approved?)" >&2; exit 1; }
    curl -s -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/tideAdminResources/get-required-action-link?userId=${id}&lifespan=3600" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -H "Accept: text/plain" \
      -d '["link-tide-account-action"]'
    echo
    ;;

  grant)
    name="$1"
    shift
    id="$(userId "${name}")"
    [[ -z "${id}" ]] && { echo "User ${name} not found" >&2; exit 1; }
    roles_json="["
    for role in "$@"
    do
      rep=$(curl -s "${TIDECLOAK_URL}/admin/realms/${REALM}/roles/${role}" -H "Authorization: Bearer ${TOKEN}")
      roles_json+="${rep},"
    done
    roles_json="${roles_json%,}]"
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${id}/role-mappings/realm" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d "${roles_json}")
    echo "  grant ${name}: $* -> ${code}"
    ;;

  make-admin)
    # tide-realm-admin is a client role of realm-management.
    id="$(userId "$1")"
    [[ -z "${id}" ]] && { echo "User $1 not found" >&2; exit 1; }
    rm_uuid=$(curl -s "${TIDECLOAK_URL}/admin/realms/${REALM}/clients?clientId=realm-management" \
      -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0].id')
    role_rep=$(curl -s "${TIDECLOAK_URL}/admin/realms/${REALM}/clients/${rm_uuid}/roles/tide-realm-admin" \
      -H "Authorization: Bearer ${TOKEN}")
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${TIDECLOAK_URL}/admin/realms/${REALM}/users/${id}/role-mappings/clients/${rm_uuid}" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d "[${role_rep}]")
    echo "  make-admin $1 -> ${code}"
    ;;

  *)
    echo "Unknown command: ${command}" >&2
    exit 1
    ;;
esac
