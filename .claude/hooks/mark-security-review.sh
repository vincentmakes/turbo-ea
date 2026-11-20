#!/bin/bash
# Claude reports Skill use. Codex reports the sealed result read by the PR owner.
set -euo pipefail

if [[ ${1:-} == codex ]]; then
  timestamp=$(node -e '
    const fs = require("node:fs");
    const { createHash } = require("node:crypto");
    const event = JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
    const response = event.tool_response;
    if (event.hook_event_name !== "PostToolUse" ||
        event.tool_name !== "mcp__codex_security__get_codex_security_completed_scan" ||
        !response || response.isError) process.exit(0);

    let result = response.structuredContent;
    if (!result && response.content?.length === 1 && response.content[0].type === "text") {
      try { result = JSON.parse(response.content[0].text); } catch { process.exit(0); }
    }
    const scan = result?.manifest?.scan;
    if (!scan || result.manifest.documentType !== "codex-security.scan-manifest" ||
        !scan.id || scan.id !== result.scanId || scan.id !== event.tool_input?.scanId ||
        scan.status !== "completed" || scan.target?.kind !== "git_diff" ||
        !["diff", "branch_diff", "working_tree", "commit"].includes(scan.mode)) process.exit(0);

    // Codex Security stable_target_id hashes the native, absolute checkout path.
    const root = fs.realpathSync.native(process.cwd());
    const digest = createHash("sha256").update("local-workspace\0" + root).digest("hex");
    if (scan.target.targetId !== "target_sha256_" + digest) process.exit(0);

    const completed = Date.parse(scan.completedAt);
    const sealed = Date.parse(scan.sealedAt);
    if (Number.isFinite(completed) && completed > 0 && completed <= sealed && sealed <= Date.now()) {
      console.log(Math.floor(completed / 1000));
    }
  ')
  [[ -n $timestamp ]] || exit 0
else
  grep -Eq '"skill"[[:space:]]*:[[:space:]]*"security-review"' || exit 0
  timestamp=$(date -u +%s)
fi

marker="${CLAUDE_PROJECT_DIR:-.}/.claude/.security-review-marker"
mkdir -p "$(dirname "$marker")"
# A reread must never replace a newer review with an older completion.
if [[ -f $marker ]]; then
  previous=$(cat "$marker")
  if [[ $previous =~ ^[0-9]{1,10}$ ]] && (( 10#$previous >= timestamp && 10#$previous <= $(date -u +%s) )); then
    exit 0
  fi
fi
tmp=$(mktemp "${marker}.XXXXXX")
trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$timestamp" > "$tmp"
mv -f "$tmp" "$marker"
