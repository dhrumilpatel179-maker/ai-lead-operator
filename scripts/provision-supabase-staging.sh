#!/usr/bin/env bash
set -euo pipefail

API_ROOT="https://api.supabase.com/v1"
PROJECT_NAME="${STAGING_PROJECT_NAME:-ai-lead-operator-staging}"
REGION="${STAGING_PROJECT_REGION:-us-east-2}"
OPERATION="${STAGING_OPERATION:-validate}"

require_secret() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required GitHub Environment secret: $name" >&2
    exit 1
  fi
  printf '::add-mask::%s\n' "${!name}"
}

for name in SUPABASE_ACCESS_TOKEN SUPABASE_ORGANIZATION_SLUG \
  STAGING_OWNER_PASSWORD STAGING_STAFF_PASSWORD STAGING_VIEWER_PASSWORD; do
  require_secret "$name"
done

if [[ "$OPERATION" != "provision" && "$OPERATION" != "validate" ]]; then
  echo "Unsupported operation: $OPERATION" >&2
  exit 1
fi

api() {
  local method="$1" path="$2" body_file="${3:-}" output_file="$4"
  local args=(--silent --show-error --fail-with-body --request "$method"
    --header "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
    --header "Content-Type: application/json" --output "$output_file")
  if [[ -n "$body_file" ]]; then args+=(--data-binary "@$body_file"); fi
  curl "${args[@]}" "$API_ROOT$path"
}

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

api GET /projects "" "$work_dir/projects.json"
mapfile -t matching_refs < <(jq -r --arg name "$PROJECT_NAME" --arg org "$SUPABASE_ORGANIZATION_SLUG" \
  '.[] | select(.name == $name and .organization_slug == $org) | .ref' \
  "$work_dir/projects.json")

if (( ${#matching_refs[@]} > 1 )); then
  echo "More than one staging project has the reserved name; refusing an ambiguous target." >&2
  exit 1
fi
project_ref="${matching_refs[0]:-}"

if [[ "$OPERATION" == "provision" ]]; then
  if [[ -n "$project_ref" ]]; then
    echo "Staging already exists. Re-run with operation=validate; no new project was created." >&2
    exit 1
  fi
  if [[ "${CONFIRM_FREE_PROJECT:-}" != "I CONFIRM THIS ORGANIZATION IS FREE" ]]; then
    echo "Provisioning stopped. Confirm in Supabase that the organization plan is Free, then enter the exact confirmation." >&2
    exit 1
  fi

  database_password="$(openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-32)Aa1!"
  printf '::add-mask::%s\n' "$database_password"
  jq -n --arg organization_slug "$SUPABASE_ORGANIZATION_SLUG" --arg name "$PROJECT_NAME" \
    --arg region "$REGION" --arg db_pass "$database_password" \
    '{organization_slug:$organization_slug,name:$name,region:$region,db_pass:$db_pass}' \
    > "$work_dir/create-project.json"

  # Supabase billing is organization-level and its deprecated project `plan`
  # field is ignored. The manual attestation above is therefore mandatory.
  # Paid compute size and high-availability fields are intentionally omitted.
  api POST /projects "$work_dir/create-project.json" "$work_dir/created.json"
  project_ref="$(jq -r '.ref // empty' "$work_dir/created.json")"
  if [[ ! "$project_ref" =~ ^[a-z]{20}$ ]]; then
    echo "Supabase did not return a valid project reference." >&2
    exit 1
  fi
elif [[ -z "$project_ref" ]]; then
  echo "No existing staging project was found. Run operation=provision once." >&2
  exit 1
fi

printf '::add-mask::%s\n' "$project_ref"
project_url="https://${project_ref}.supabase.co"
printf '::add-mask::%s\n' "$project_url"

healthy=false
for _ in $(seq 1 60); do
  api GET /projects "" "$work_dir/projects-current.json"
  status="$(jq -r --arg ref "$project_ref" '.[] | select(.ref == $ref) | .status // empty' "$work_dir/projects-current.json")"
  case "$status" in
    ACTIVE_HEALTHY) healthy=true; break ;;
    INACTIVE|REMOVED|PAUSED|UNKNOWN)
      echo "Staging entered a non-runnable state: $status" >&2
      exit 1 ;;
  esac
  sleep 10
done
if [[ "$healthy" != true ]]; then
  echo "Staging did not become healthy within ten minutes." >&2
  exit 1
fi

if [[ "$OPERATION" == "provision" ]]; then
  jq -Rs '{query:("begin;\n" + . + "\ncommit;")}' db/supabase-production.sql > "$work_dir/migration.json"
  api POST "/projects/$project_ref/database/query" "$work_dir/migration.json" "$work_dir/migration-result.json"
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'project_ref=%s\nproject_url=%s\n' "$project_ref" "$project_url" >> "$GITHUB_OUTPUT"
fi
echo "Supabase staging is healthy and the production schema is ready for hosted validation."
