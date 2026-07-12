#!/usr/bin/env bash
# Bootstraps and runs `terraform apply` for the R2 infra in this directory.
#
# Reads CLOUDFLARE_API_TOKEN from the shell env if already exported, otherwise
# falls back to the CLOUDFLARE_API_TOKEN= line in the repo's .env (added there
# purely as a record — Next.js and this script are the only things that ever
# read it; nothing in the running app depends on it). Never echoes the token.
#
# On success, also upserts R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID /
# R2_SECRET_ACCESS_KEY into .env — only those four lines are touched; every
# other line in the file (Instagram token, etc.) is left exactly as-is.
# R2_CAP_BYTES isn't infra-derived, so it's untouched too — set it yourself.
#
# Usage: ./infra/setup.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT_ENV="../.env"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ROOT_ENV" ]; then
  CLOUDFLARE_API_TOKEN="$(grep -m1 '^CLOUDFLARE_API_TOKEN=' "$ROOT_ENV" | cut -d= -f2-)"
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set and not found in $ROOT_ENV." >&2
  echo "Create a TEMPORARY bootstrap token (Account -> Workers R2 Storage: Edit" >&2
  echo "+ Account -> API Tokens: Edit — see the comment in main.tf for why), then either:" >&2
  echo "  export CLOUDFLARE_API_TOKEN=...      # for this shell session, or" >&2
  echo "  add CLOUDFLARE_API_TOKEN=... to $ROOT_ENV" >&2
  exit 1
fi
export CLOUDFLARE_API_TOKEN

if [ ! -f terraform.tfvars ]; then
  cp terraform.tfvars.example terraform.tfvars
fi

# Sets/replaces the `account_id = "..."` line in a Terraform vars file,
# leaving everything else in the file untouched.
set_tfvars_account_id() {
  local id="$1" file="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v id="$id" '
    /^account_id[[:space:]]*=/ { print "account_id = \"" id "\""; done=1; next }
    { print }
    END { if (!done) print "account_id = \"" id "\"" }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# Auto-detect account_id from the bootstrap token itself — GET /accounts lists
# exactly the account(s) it has access to, so if there's only one, there's no
# need to go find the ID in the dashboard by hand.
if grep -q 'your-cloudflare-account-id' terraform.tfvars 2>/dev/null; then
  echo "No account_id set yet — attempting to auto-detect it from your token..."
  ACCOUNTS_JSON="$(curl -sf -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    https://api.cloudflare.com/client/v4/accounts || true)"
  ACCOUNT_COUNT="$(printf '%s' "$ACCOUNTS_JSON" | python3 -c '
import json, sys
try:
    print(len(json.load(sys.stdin).get("result") or []))
except Exception:
    print(0)
' 2>/dev/null || echo 0)"

  if [ "$ACCOUNT_COUNT" = "1" ]; then
    ACCOUNT_ID="$(printf '%s' "$ACCOUNTS_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"][0]["id"])')"
    set_tfvars_account_id "$ACCOUNT_ID" terraform.tfvars
    echo "Auto-detected account_id and wrote it to terraform.tfvars."
  else
    echo "Could not auto-detect a single account (found: ${ACCOUNT_COUNT:-0})." >&2
    if [ "${ACCOUNT_COUNT:-0}" -gt 1 ] 2>/dev/null; then
      echo "Your token has access to multiple accounts — pick one:" >&2
      printf '%s' "$ACCOUNTS_JSON" | python3 -c '
import json, sys
for a in json.load(sys.stdin)["result"]:
    print("  " + a["id"] + "  " + a["name"])
' >&2
    fi
    echo "Set account_id in terraform.tfvars yourself, then re-run this script." >&2
    exit 1
  fi
fi

terraform init

echo
echo "Plan — review before approving anything:"
terraform plan

echo
read -r -p "Proceed to terraform apply? [y/N] " CONFIRM || CONFIRM=""
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *)
    echo "Aborted — nothing was applied." >&2
    exit 1
    ;;
esac

echo
echo "terraform apply will show this same plan again and pause for its own"
echo "'yes' confirmation too — this is a second, independent gate, not a duplicate."
terraform apply

# Upsert KEY=value into a .env file — updates the line in place if the key
# already exists, otherwise appends it. Every other line is left untouched.
# Never echoes $value to stdout/stderr.
upsert_env() {
  local key="$1" value="$2" file="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" -F= 'BEGIN{OFS="="} $1==k{$0=k"="v} {print}' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

echo
echo "Writing R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY into $ROOT_ENV ..."
upsert_env "R2_ACCOUNT_ID" "$(terraform output -raw account_id)" "$ROOT_ENV"
upsert_env "R2_BUCKET" "$(terraform output -raw bucket)" "$ROOT_ENV"
upsert_env "R2_ACCESS_KEY_ID" "$(terraform output -raw access_key_id)" "$ROOT_ENV"
upsert_env "R2_SECRET_ACCESS_KEY" "$(terraform output -raw secret_access_key)" "$ROOT_ENV"
echo "Done. R2_CAP_BYTES isn't infra-derived — set that one yourself if it's not already there."
echo
echo "Now go revoke the bootstrap CLOUDFLARE_API_TOKEN in the dashboard — it's done its job."
