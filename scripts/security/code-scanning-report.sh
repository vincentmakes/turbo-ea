#!/usr/bin/env bash
# List the repository's open code-scanning alerts (CodeQL + Trivy + Scout) as a
# table, so you can triage them without opening the GitHub Security tab.
#
# Usage:
#   ./scripts/security/code-scanning-report.sh             # table to stdout
#   ./scripts/security/code-scanning-report.sh --json      # raw JSON to stdout
#
# Requires: gh (authenticated via `gh auth login`) and jq.
# The CI equivalent is the "Code Scanning Report" workflow
# (.github/workflows/code-scanning-report.yml).
set -euo pipefail

REPO="${REPO:-vincentmakes/turbo-ea}"

for bin in gh jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' is required but not installed." >&2
    exit 1
  fi
done

alerts="$(gh api --paginate \
  "repos/$REPO/code-scanning/alerts?state=open&per_page=100")"

if [[ "${1:-}" == "--json" ]]; then
  echo "$alerts"
  exit 0
fi

count="$(jq 'length' <<<"$alerts")"
echo "Open code-scanning alerts for $REPO: $count"
echo

jq -r '.[] | [
  (.number | tostring),
  .tool.name,
  .rule.id,
  (.rule.security_severity_level // .rule.severity // "n/a"),
  "\(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line)",
  (.rule.description // .most_recent_instance.message.text | gsub("\n"; " "))
] | @tsv' <<<"$alerts" | column -t -s "$(printf '\t')"
