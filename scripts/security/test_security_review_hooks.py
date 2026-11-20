"""Exercise the configured hooks with synthetic events in an isolated Git checkout."""

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
READ_SCAN = "mcp__codex_security__get_codex_security_completed_scan"


class SecurityReviewHooks(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name).resolve()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        hooks_dir = self.repo / ".claude/hooks"
        hooks_dir.mkdir(parents=True)
        for script in ("mark-security-review.sh", "check-security-review.sh"):
            shutil.copyfile(ROOT / ".claude/hooks" / script, hooks_dir / script)
        self.marker = self.repo / ".claude/.security-review-marker"
        self.hooks = json.loads((ROOT / ".codex/hooks.json").read_text("utf-8"))[
            "hooks"
        ]

    def run_hook(self, event, script):
        commands = [
            h["command"]
            for group in self.hooks[event["hook_event_name"]]
            if re.fullmatch(group["matcher"], event["tool_name"])
            for h in group["hooks"]
            if script in h["command"]
        ]
        self.assertEqual(len(commands), 1)
        return subprocess.run(
            commands[0],
            shell=True,
            cwd=self.repo,
            input=json.dumps(event),
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()

    def check_pr(self, command="gh pr create --fill"):
        verdict = self.run_hook(
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": command},
            },
            "check-security-review.sh",
        )
        return (
            json.loads(verdict)["hookSpecificOutput"]["permissionDecision"]
            if verdict
            else "allow"
        )

    def completed(self, age=5, target=None):
        instant = int(time.time()) - age
        date = datetime.fromtimestamp(instant, timezone.utc).isoformat()
        digest = hashlib.sha256(
            f"local-workspace\0{target or self.repo}".encode()
        ).hexdigest()
        scan = {
            "id": "test-scan",
            "mode": "branch_diff",
            "status": "completed",
            "sealedAt": date,
            "completedAt": date,
            "target": {"kind": "git_diff", "targetId": "target_sha256_" + digest},
        }
        return {
            "hook_event_name": "PostToolUse",
            "tool_name": READ_SCAN,
            "tool_input": {"scanId": scan["id"]},
            "tool_response": {
                "structuredContent": {
                    "scanId": scan["id"],
                    "manifest": {
                        "documentType": "codex-security.scan-manifest",
                        "scan": scan,
                    },
                }
            },
        }, instant

    def mark(self, event):
        self.run_hook(event, "mark-security-review.sh")

    def test_recent_completed_diff_allows_pr(self):
        event, completed_at = self.completed()
        self.mark(event)
        self.assertEqual(int(self.marker.read_text()), completed_at)
        self.assertEqual(self.check_pr(), "allow")

    def test_absent_or_expired_marker_denies_only_pr(self):
        self.assertEqual(self.check_pr(), "deny")
        self.marker.write_text(str(int(time.time()) - 1801))
        self.assertEqual(self.check_pr(), "deny")
        self.assertEqual(self.check_pr("git status"), "allow")

    def test_invalid_results_do_not_mark(self):
        for reason in (
            "error",
            "incomplete",
            "unsealed",
            "other checkout",
            "id mismatch",
            "wrong mode",
            "future",
            "malformed",
            "error text",
        ):
            with self.subTest(reason=reason):
                event, _ = self.completed(
                    age=-300 if reason == "future" else 5,
                    target=self.repo.parent
                    if reason == "other checkout"
                    else self.repo,
                )
                result = event["tool_response"]
                scan = result["structuredContent"]["manifest"]["scan"]
                if reason == "error":
                    result["isError"] = True
                elif reason == "incomplete":
                    scan["status"] = "running"
                elif reason == "unsealed":
                    del scan["sealedAt"]
                elif reason == "id mismatch":
                    event["tool_input"]["scanId"] = "another-scan"
                elif reason == "wrong mode":
                    scan["mode"] = "repository"
                elif reason == "malformed":
                    del result["structuredContent"]
                elif reason == "error text":
                    event["tool_response"] = {
                        "content": [{"type": "text", "text": "failed"}]
                    }
                self.mark(event)
                self.assertFalse(self.marker.exists())

    def test_rereading_an_old_report_preserves_completion_time(self):
        old, stamp = self.completed(age=3600)
        self.mark(old)
        self.mark(old)
        self.assertEqual(int(self.marker.read_text()), stamp)
        self.assertEqual(self.check_pr(), "deny")
        recent, new_stamp = self.completed()
        self.mark(recent)
        self.mark(old)
        self.assertEqual(int(self.marker.read_text()), new_stamp)

    def test_claude_skill_is_still_recorded(self):
        script = ".claude/hooks/mark-security-review.sh"
        for skill in ("other", "security-review"):
            subprocess.run(
                [
                    "git",
                    "-c",
                    f"alias.test-mark=!CLAUDE_PROJECT_DIR=. bash {script}",
                    "test-mark",
                ],
                cwd=self.repo,
                input=json.dumps({"tool_input": {"skill": skill}}),
                text=True,
                check=True,
            )
            self.assertEqual(self.marker.exists(), skill == "security-review")


if __name__ == "__main__":
    unittest.main()
