#!/usr/bin/env bash
#
# ci/scripts/run-track.sh <job-id>
#
# Executes every command defined for a job in ci/tracks.json.
# Used by ci/workflows/test.yml and runnable locally:
#
#   bash ci/scripts/run-track.sh contract
#
# Requires: bash, jq, bun (and gitleaks for the security job).
set -euo pipefail

JOB="${1:-}"
if [ -z "$JOB" ]; then
  echo "usage: ci/scripts/run-track.sh <job-id>"
  echo "job ids: $(jq -r '.jobs | keys | join(", ")' "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tracks.json")"
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TRACKS="$ROOT/ci/tracks.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 2
fi

if jq -e --arg job "$JOB" '.jobs[$job].disabled == true' "$TRACKS" >/dev/null 2>&1; then
  status=$(jq -r --arg job "$JOB" '.jobs[$job].status // "disabled"' "$TRACKS")
  echo "::warning::[$JOB] $status"
  exit 0
fi

COUNT=$(jq --arg job "$JOB" '.jobs[$job].commands | length' "$TRACKS")
if [ "$COUNT" = "null" ] || [ "$COUNT" = "0" ]; then
  echo "error: unknown or empty job '$JOB' in ci/tracks.json" >&2
  exit 2
fi

NAME=$(jq -r --arg job "$JOB" '.jobs[$job].name' "$TRACKS")
echo "==> $NAME ($COUNT command(s))"

for ((i = 0; i < COUNT; i++)); do
  LABEL=$(jq -r --arg job "$JOB" ".jobs[\$job].commands[$i].label" "$TRACKS")
  CWD=$(jq -r --arg job "$JOB" ".jobs[\$job].commands[$i].cwd // \".\"" "$TRACKS")
  RUN=$(jq -r --arg job "$JOB" ".jobs[\$job].commands[$i].run" "$TRACKS")
  TIMEOUT=$(jq -r --arg job "$JOB" ".jobs[\$job].commands[$i].timeoutMinutes // 30" "$TRACKS")
  ENV_JSON=$(jq -c --arg job "$JOB" ".jobs[\$job].commands[$i].env // {}" "$TRACKS")

  echo ""
  echo "::group::[$JOB] $LABEL"
  echo "==> cwd: $CWD"
  echo "==> run: $RUN"

  ENV_EXPORTS=$(jq -r 'to_entries[] | "export \(.key)=\(.value)"' <<<"$ENV_JSON")

  set +e
  (
    cd "$ROOT/$CWD"
    if [ -n "$ENV_EXPORTS" ]; then
      eval "$ENV_EXPORTS"
    fi
    timeout "${TIMEOUT}m" bash -euo pipefail -c "$RUN"
  )
  STATUS=$?
  set -e
  echo "::endgroup::"
  if [ "$STATUS" -ne 0 ]; then
    echo "::error::[$JOB] '$LABEL' failed with status $STATUS"
    exit "$STATUS"
  fi
done

echo ""
echo "==> [$JOB] all commands passed"
