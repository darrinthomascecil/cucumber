#!/usr/bin/env bash
#
# A table of their own for one more person.
#
# The deployed game has one room with three seats, and two of them belong to
# the computer players. So "let someone else play what I am playing" means a
# second table, not a second chair: the same image, the same computer players
# and the same Microsoft sign-in, as its own Container App with its own
# database on the Postgres server that already exists.
#
#   tools/friend-table.sh add    <slug> <email> "<Display Name>" [--skip-guest-invite]
#   tools/friend-table.sh remove <slug> [--yes]
#   tools/friend-table.sh list
#
# <slug> names the table: the app becomes cucumber-<slug> and the database
# cucumber_<slug>. `add` is safe to run again for the same slug — it leaves
# what exists alone and issues a fresh invitation link.
#
# What it never does: change, restart or redeploy the existing app `cucumber`,
# or read or write its database. What it does touch that is shared, and how:
#   - the Postgres server: adds a database; opens the firewall to this
#     machine's address for the length of the run and closes it on exit
#   - the cucumber-sso app registration: adds one redirect URI (remove takes
#     exactly that one away again)
#
set -euo pipefail

RG="rg-cucumber"
SOURCE_APP="cucumber"
ENV_NAME="cucumber-env"
PG_SERVER="cucumber-pg-b491bf98"
IDENTITY_NAME="cucumber-identity"
SSO_APP_ID="77591801-57b5-46f2-a5d5-5563d875eff6"
SSO_SECRET_NAME="microsoft-provider-authentication-secret"
SUBSCRIPTION_ID="b491bf98-6ea2-4a07-a641-200d61d7a735"

FIREWALL_RULE=""
WORKDIR=""

say()  { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   WARNING: %s\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
  local status=$?
  if [[ -n "$FIREWALL_RULE" ]]; then
    if az postgres flexible-server firewall-rule delete -g "$RG" --server-name "$PG_SERVER" \
        --name "$FIREWALL_RULE" --yes -o none 2>/dev/null; then
      info "firewall rule $FIREWALL_RULE removed"
    else
      warn "could not remove firewall rule $FIREWALL_RULE from $PG_SERVER — remove it by hand"
    fi
  fi
  [[ -n "$WORKDIR" && -d "$WORKDIR" ]] && rm -rf "$WORKDIR"
  exit "$status"
}

# ---------------------------------------------------------------- validation

validate_slug() {
  [[ "$1" =~ ^[a-z][a-z0-9]{1,14}$ ]] \
    || die "slug must be 2-15 characters, lowercase letters and digits, starting with a letter: '$1'"
}

# The character sets below exclude quotes and backslashes on purpose: these
# two values are written into SQL.
validate_email() {
  [[ "$1" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "not an email address I can use: '$1'"
}

validate_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9\ ._-]{0,39}$ ]] \
    || die "display name may use letters, digits, spaces, dots, dashes and underscores (max 40): '$1'"
}

require_tools() {
  local tool
  for tool in az python3 openssl sha256sum curl pnpm git; do
    command -v "$tool" >/dev/null 2>&1 || die "'$tool' is required and was not found"
  done
  local current
  current="$(az account show --query id -o tsv 2>/dev/null)" || die "not signed in to Azure — run: az login"
  [[ "$current" == "$SUBSCRIPTION_ID" ]] \
    || die "the active subscription is $current, expected $SUBSCRIPTION_ID — run: az account set -s $SUBSCRIPTION_ID"
}

app_name() { printf 'cucumber-%s' "$1"; }
db_name()  { printf 'cucumber_%s' "$1"; }

app_exists() {
  az containerapp show -g "$RG" -n "$1" --query name -o tsv >/dev/null 2>&1
}

# ------------------------------------------------------------------ database

# The friend's connection string: the existing one with only the database
# name changed. Printed to stdout; never logged.
database_url_for() {
  local source_url
  source_url="$(az containerapp secret show -g "$RG" -n "$SOURCE_APP" --secret-name database-url --query value -o tsv)"
  [[ -n "$source_url" ]] || die "could not read the database-url secret from $SOURCE_APP"
  python3 - "$source_url" "$1" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
url, database = sys.argv[1], sys.argv[2]
parts = urlsplit(url)
print(urlunsplit((parts.scheme, parts.netloc, '/' + database, parts.query, parts.fragment)))
PY
}

open_firewall() {
  local state ip
  state="$(az postgres flexible-server show -g "$RG" -n "$PG_SERVER" --query state -o tsv)"
  [[ "$state" == "Ready" ]] \
    || die "Postgres server $PG_SERVER is '$state', not Ready — start it: az postgres flexible-server start -g $RG -n $PG_SERVER"
  ip="$(curl -fsS --max-time 15 https://api.ipify.org)" || die "could not determine this machine's public address"
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "unexpected public address: '$ip'"
  FIREWALL_RULE="friend-table-$(date +%s)"
  az postgres flexible-server firewall-rule create -g "$RG" --server-name "$PG_SERVER" \
    --name "$FIREWALL_RULE" --start-ip-address "$ip" --end-ip-address "$ip" -o none
  info "firewall opened to $ip as $FIREWALL_RULE (closed again on exit)"
}

# Runs a prisma command against a database, retrying while the firewall rule
# takes effect. $1 is the database URL; the rest is the prisma command line.
prisma_retry() {
  local url="$1"; shift
  local attempt log="$WORKDIR/prisma.log"
  for attempt in $(seq 1 12); do
    if DATABASE_URL="$url" pnpm --filter @cucumber/database exec prisma "$@" >"$log" 2>&1; then
      return 0
    fi
    # Only a connection problem is worth waiting out; anything else is final.
    grep -qE "P1001|P1002|Can't reach database|timed out|ECONNREFUSED|no pg_hba.conf entry" "$log" || break
    sleep 10
  done
  sed -E 's#(postgres(ql)?://)[^@]*@#\1<credentials>@#g' "$log" >&2
  return 1
}

# The schema the deployed image was built from, not whatever is checked out.
schema_for_image() {
  local image="$1" tag
  tag="${image##*:}"
  git cat-file -e "${tag}^{commit}" 2>/dev/null \
    || die "image tag '$tag' is not a commit in this repository, so I cannot tell which schema it expects"
  git show "${tag}:packages/database/prisma/schema.prisma" >"$WORKDIR/schema.prisma"
  printf '%s' "$WORKDIR/schema.prisma"
}

# Writes an invitation exactly as the server's createInvite would: a random
# token, stored only as its SHA-256. Prints the token.
#
# The friend's app runs without ADMIN_EMAIL, so nothing rotates this at boot —
# the link stays good across restarts and scale-to-zero until it is used.
issue_invitation() {
  local url="$1" email="$2" name="$3" token hash
  token="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  hash="$(printf '%s' "$token" | sha256sum | cut -d' ' -f1)"
  [[ ${#token} -ge 40 && ${#hash} -eq 64 ]] || die "token generation failed"
  cat >"$WORKDIR/invite.sql" <<SQL
INSERT INTO users (id, email, display_name, status, is_admin, invite_hash, invite_sent_at)
VALUES (gen_random_uuid()::text, '${email}', '${name}', 'INVITED', false, '${hash}', now())
ON CONFLICT (email) DO UPDATE
SET invite_hash = EXCLUDED.invite_hash,
    invite_sent_at = EXCLUDED.invite_sent_at,
    display_name = EXCLUDED.display_name;
SQL
  prisma_retry "$url" db execute --file "$WORKDIR/invite.sql" --url "$url" || die "could not write the invitation"
  printf '%s' "$token"
}

# ----------------------------------------------------------------------- SSO

redirect_uri_for() { printf 'https://%s/.auth/login/aad/callback' "$1"; }

# Rewrites the registration's redirect list to the current list plus or minus
# one URI. The list is replaced as a whole by the CLI, so it is always rebuilt
# from what is there now.
set_redirect_uris() {
  local mode="$1" uri="$2" current wanted
  current="$(az ad app show --id "$SSO_APP_ID" --query "web.redirectUris" -o json)"
  wanted="$(python3 - "$mode" "$uri" "$current" <<'PY'
import json, sys
mode, uri, current = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
if mode == 'add' and uri not in current:
    current.append(uri)
if mode == 'remove':
    current = [item for item in current if item != uri]
print('\n'.join(current))
PY
)"
  [[ -n "$wanted" ]] || die "refusing to leave the app registration with no redirect URIs"
  if [[ "$wanted" == "$(python3 -c 'import json,sys; print("\n".join(json.loads(sys.argv[1])))' "$current")" ]]; then
    return 0
  fi
  local -a uris
  mapfile -t uris <<<"$wanted"
  az ad app update --id "$SSO_APP_ID" --web-redirect-uris "${uris[@]}"
}

configure_sign_in() {
  local app="$1" fqdn="$2" tenant secret
  tenant="$(az account show --query tenantId -o tsv)"
  secret="$(az containerapp secret show -g "$RG" -n "$SOURCE_APP" --secret-name "$SSO_SECRET_NAME" --query value -o tsv)"
  [[ -n "$secret" ]] || die "could not read the sign-in client secret from $SOURCE_APP"
  set_redirect_uris add "$(redirect_uri_for "$fqdn")"
  az containerapp auth microsoft update -g "$RG" -n "$app" --client-id "$SSO_APP_ID" \
    --client-secret "$secret" --tenant-id "$tenant" --yes -o none
  az containerapp auth update -g "$RG" -n "$app" --enabled true \
    --unauthenticated-client-action RedirectToLoginPage --redirect-provider azureactivedirectory \
    --excluded-paths "/api/health" --require-https true -o none
}

invite_guest() {
  local email="$1" name="$2" url="$3" existing body
  existing="$(az ad user list --filter "mail eq '${email}' or otherMails/any(m:m eq '${email}')" --query "[0].id" -o tsv)"
  if [[ -n "$existing" ]]; then
    info "$email is already in the directory — no guest invitation needed"
    return 0
  fi
  body="$WORKDIR/guest.json"
  python3 - "$email" "$name" "$url" >"$body" <<'PY'
import json, sys
print(json.dumps({
    "invitedUserEmailAddress": sys.argv[1],
    "invitedUserDisplayName": sys.argv[2],
    "inviteRedirectUrl": sys.argv[3],
    "sendInvitationMessage": True,
}))
PY
  if az rest --method POST --url "https://graph.microsoft.com/v1.0/invitations" \
      --headers "Content-Type=application/json" --body "@$body" --query status -o tsv >/dev/null; then
    info "Microsoft guest invitation emailed to $email"
  else
    warn "the guest invitation failed. Invite them by hand: Azure portal > Entra ID > Users > New user > Invite external user"
  fi
}

# -------------------------------------------------------------- verification

wait_for_health() {
  local fqdn="$1" attempt
  for attempt in $(seq 1 36); do
    if curl -fsS --max-time 20 "https://$fqdn/api/health" 2>/dev/null | grep -q '"ok":true'; then
      info "health check passed"
      return 0
    fi
    sleep 5
  done
  die "https://$fqdn/api/health never answered"
}

wait_for_sign_in_wall() {
  local fqdn="$1" attempt target
  for attempt in $(seq 1 24); do
    target="$(curl -s -o /dev/null --max-time 20 -w '%{redirect_url}' \
      -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0' -H 'Accept: text/html' "https://$fqdn/")"
    if [[ "$target" == https://login.microsoftonline.com/* ]]; then
      info "anonymous visitors are sent to Microsoft sign-in"
      return 0
    fi
    sleep 5
  done
  die "https://$fqdn/ is not redirecting anonymous visitors to Microsoft sign-in"
}

check_computer_players() {
  local app="$1" players="$2" attempt logs ready
  ready="computer players ready: ${players//,/, }"
  for attempt in $(seq 1 12); do
    logs="$(az containerapp logs show -g "$RG" -n "$app" --type console --tail 100 --format text 2>/dev/null || true)"
    # They sit down when a person does; at boot they only announce themselves.
    if grep -qF "\"msg\":\"${ready}\"" <<<"$logs"; then
      info "$ready"
      return 0
    fi
    sleep 5
  done
  warn "did not see '$ready' in the log — check: az containerapp logs show -g $RG -n $app --tail 50"
}

# ------------------------------------------------------------------ commands

cmd_add() {
  local slug="${1:-}" email="${2:-}" name="${3:-}" skip_guest="no"
  [[ -n "$slug" && -n "$email" && -n "$name" ]] || die "usage: $0 add <slug> <email> \"<Display Name>\" [--skip-guest-invite]"
  [[ "${4:-}" == "--skip-guest-invite" ]] && skip_guest="yes"
  [[ -z "${4:-}" || "${4:-}" == "--skip-guest-invite" ]] || die "unknown option: $4"
  email="$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')"
  validate_slug "$slug"; validate_email "$email"; validate_name "$name"
  require_tools

  local app db domain fqdn url image players cpu memory identity session token schema
  app="$(app_name "$slug")"; db="$(db_name "$slug")"
  [[ "$app" != "$SOURCE_APP" && "$db" != "cucumber" ]] || die "that slug collides with the existing deployment"
  domain="$(az containerapp env show -g "$RG" -n "$ENV_NAME" --query properties.defaultDomain -o tsv)"
  fqdn="$app.$domain"

  WORKDIR="$(mktemp -d)"
  trap cleanup EXIT

  say "Table $app for $name <$email>"
  url="$(database_url_for "$db")"
  open_firewall

  if app_exists "$app"; then
    info "$app already exists — leaving it as it is and issuing a fresh invitation"
  else
    # "Like the game is right now": copy what the running app runs.
    image="$(az containerapp show -g "$RG" -n "$SOURCE_APP" --query "properties.template.containers[0].image" -o tsv)"
    cpu="$(az containerapp show -g "$RG" -n "$SOURCE_APP" --query "properties.template.containers[0].resources.cpu" -o tsv)"
    memory="$(az containerapp show -g "$RG" -n "$SOURCE_APP" --query "properties.template.containers[0].resources.memory" -o tsv)"
    players="$(az containerapp show -g "$RG" -n "$SOURCE_APP" --query "properties.template.containers[0].env[?name=='COMPUTER_PLAYERS'].value | [0]" -o tsv)"
    [[ -n "$players" ]] || die "$SOURCE_APP has no COMPUTER_PLAYERS, so there is no computer to play against"
    identity="$(az identity show -g "$RG" -n "$IDENTITY_NAME" --query id -o tsv)"

    say "Database $db"
    if [[ -z "$(az postgres flexible-server db list -g "$RG" -s "$PG_SERVER" --query "[?name=='$db'].name" -o tsv)" ]]; then
      az postgres flexible-server db create -g "$RG" -s "$PG_SERVER" --name "$db" -o none
      info "created"
    else
      info "already exists"
    fi
    schema="$(schema_for_image "$image")"
    prisma_retry "$url" db push --schema "$schema" --skip-generate \
      || die "could not push the schema to $db"
    info "schema pushed (as of image $image)"

    say "Container App $app"
    session="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')"
    az containerapp create -g "$RG" -n "$app" --environment "$ENV_NAME" --image "$image" \
      --registry-server "${image%%/*}" --registry-identity "$identity" --user-assigned "$identity" \
      --ingress external --target-port 8080 --transport auto \
      --min-replicas 0 --max-replicas 1 --cpu "$cpu" --memory "$memory" \
      --secrets "database-url=$url" "session-secret=$session" \
      --env-vars NODE_ENV=production PORT=8080 WEB_ROOT=/app/web "WEB_ORIGIN=https://$fqdn" \
        "COMPUTER_PLAYERS=$players" DATABASE_URL=secretref:database-url SESSION_SECRET=secretref:session-secret \
      -o none
    info "created at https://$fqdn"

    say "Microsoft sign-in"
    configure_sign_in "$app" "$fqdn"
    wait_for_health "$fqdn"
    wait_for_sign_in_wall "$fqdn"
    check_computer_players "$app" "$players"
  fi

  say "Invitation"
  token="$(issue_invitation "$url" "$email" "$name")"
  info "written to $db"
  if [[ "$skip_guest" == "yes" ]]; then
    info "guest invitation skipped on request"
  else
    invite_guest "$email" "$name" "https://$fqdn/"
  fi

  cat <<DONE

Ready. Send $name this link:

  https://$fqdn/invite/$token

They open it, sign in with Microsoft as $email (accepting the guest invitation
email first if they have never signed in to your directory), and land at a
table with the computer players. The link works once and survives restarts.
DONE
}

cmd_remove() {
  local slug="${1:-}" confirm="${2:-}"
  [[ -n "$slug" ]] || die "usage: $0 remove <slug> [--yes]"
  validate_slug "$slug"
  require_tools
  local app db domain fqdn typed
  app="$(app_name "$slug")"; db="$(db_name "$slug")"
  [[ "$app" != "$SOURCE_APP" && "$db" != "cucumber" ]] || die "refusing to remove the main deployment"
  if [[ "$confirm" != "--yes" ]]; then
    read -r -p "Delete app $app and database $db, with every match played there? Type the slug to confirm: " typed
    [[ "$typed" == "$slug" ]] || die "not confirmed"
  fi
  domain="$(az containerapp env show -g "$RG" -n "$ENV_NAME" --query properties.defaultDomain -o tsv)"
  fqdn="$app.$domain"

  say "Removing $app"
  if app_exists "$app"; then
    az containerapp delete -g "$RG" -n "$app" --yes -o none
    info "app deleted"
  else
    info "app not found"
  fi
  set_redirect_uris remove "$(redirect_uri_for "$fqdn")"
  info "redirect URI removed from the sign-in registration"

  local attempt
  if [[ -n "$(az postgres flexible-server db list -g "$RG" -s "$PG_SERVER" --query "[?name=='$db'].name" -o tsv)" ]]; then
    for attempt in $(seq 1 6); do
      if az postgres flexible-server db delete -g "$RG" -s "$PG_SERVER" --name "$db" --yes -o none 2>/dev/null; then
        info "database deleted"
        return 0
      fi
      sleep 10   # the app's last connections take a moment to drain
    done
    die "could not delete database $db — try again in a minute"
  else
    info "database not found"
  fi
}

cmd_list() {
  require_tools
  az containerapp list -g "$RG" \
    --query "[?starts_with(name, 'cucumber-')].{table:name, url:properties.configuration.ingress.fqdn, replicas:properties.template.scale.maxReplicas}" -o table
}

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  local command="${1:-}"
  shift || true
  case "$command" in
    add)    cmd_add "$@" ;;
    remove) cmd_remove "$@" ;;
    list)   cmd_list ;;
    *)      sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
