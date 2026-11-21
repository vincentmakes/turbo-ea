"""Exercise the static-review receipt and both hosts' PR hooks in a local Git fixture."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOOKS = Path(".claude/hooks")
RECEIVER = HOOKS / "security-review.cjs"
GATE = "check-security-review.cjs"
SKILLS = ("trailofbits-differential-review-static", "getsentry-security-review-static")
HOSTS = (
    (".claude/settings.json", "Bash", "command"),
    (".claude/settings.json", "PowerShell", "command"),
    (".codex/hooks.json", "Bash", "cmd"),
)


class ShellCommandTokens(unittest.TestCase):
    def assert_tokens(self, event, examples):
        program = """
        const fs = require('node:fs');
        const { commands } = require('./.claude/hooks/shell-commands.cjs');
        const [event, examples] = JSON.parse(fs.readFileSync(0, 'utf8'));
        console.log(JSON.stringify(examples.map(text => commands(text, event))));
        """
        parsed = subprocess.run(
            ["node", "-e", program],
            cwd=ROOT,
            check=True,
            capture_output=True,
            encoding="utf-8",
            input=json.dumps([event, list(examples)]),
        )
        for (command, expected), actual in zip(
            examples.items(), json.loads(parsed.stdout), strict=True
        ):
            with self.subTest(command=command):
                self.assertEqual(actual, expected)

    def test_bash_continuations_and_escapes(self):
        self.assert_tokens(
            {"tool_name": "Bash", "tool_input": {"command": ""}},
            {
                "pr\\\nobe one\\ two": [["probe", "one two"]],
                "probe 'one\\\ntwo'": [["probe", "one\\\ntwo"]],
                'probe "one\\\ntwo"': [["probe", "onetwo"]],
                r"probe one\;two blue\|green red\(yellow\)": [
                    ["probe", "one;two", "blue|green", "red(yellow)"]
                ],
                r'probe "C:\Work Files\sample"': [["probe", r"C:\Work Files\sample"]],
                "probe one\\\\\nsample": [["probe", "one\\"], ["sample"]],
            },
        )

    def test_powershell_continuations_and_escapes(self):
        self.assert_tokens(
            {"tool_name": "PowerShell"},
            {
                "probe `\r\n one` two": [["probe", "one two"]],
                "probe \\\nsample": [["probe", "\\"], ["sample"]],
                "probe 'one`\ntwo'": [["probe", "one`\ntwo"]],
                'probe "one`\r\ntwo"': [["probe", "one\r\ntwo"]],
                r"probe C:\Work\sample": [["probe", r"C:\Work\sample"]],
                "probe 'it''s' one`;two": [["probe", "it's", "one;two"]],
                "probe one`tand`nmore": [["probe", "one\tand\nmore"]],
            },
        )

    def test_codex_selects_explicit_shell_or_platform_default(self):
        sample = "probe \\\nsample"
        bash = [["probe", "sample"]]
        powershell = [["probe", "\\"], ["sample"]]
        for shell, expected in (
            ("/bin/bash", bash),
            (r"C:\Tools\pwsh.exe", powershell),
            (None, powershell if os.name == "nt" else bash),
        ):
            self.assert_tokens(
                {"tool_name": "Bash", "tool_input": {"cmd": sample, "shell": shell}},
                {sample: expected},
            )

    def test_modern_powershell_unicode_escape(self):
        sample = 'probe "caf`u{e9}"'
        for shell, expected in (("pwsh.exe", "café"), ("powershell.exe", "cafu{e9}")):
            self.assert_tokens(
                {"tool_input": {"shell": shell}}, {sample: [["probe", expected]]}
            )


class SecurityReviewHooks(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="security review ")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name).resolve() / "checkout"
        self.repo.mkdir()
        self.env = {
            **{
                key: value
                for key, value in os.environ.items()
                if not key.startswith("GIT_") and key != "GH_REPO"
            },
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "CLAUDE_PROJECT_DIR": str(self.repo),
        }
        self.git("init", "-q", "-b", "review-fixture")
        self.git("config", "user.name", "Review fixture")
        self.git("config", "user.email", "review@example.invalid")
        self.git("remote", "add", "origin", "https://github.com/fixture/review.git")
        (self.repo / HOOKS).mkdir(parents=True)
        for script in (ROOT / HOOKS).glob("*.cjs"):
            shutil.copyfile(script, self.repo / HOOKS / script.name)
        (self.repo / ".gitignore").write_text(
            ".claude/.security-review-marker\ncache/\n"
        )
        self.tracked = self.repo / "tracked.txt"
        self.tracked.write_bytes(b"base\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
        self.tracked.write_bytes(b"branch change\n")
        self.git("commit", "-qam", "branch change")
        self.marker = self.repo / ".claude/.security-review-marker"

    def run_local(self, args, *, data=None, cwd=None, check=True):
        return subprocess.run(
            args,
            cwd=cwd or self.repo,
            env=self.env,
            input=data,
            capture_output=True,
            text=True,
            check=check,
        )

    def git(self, *args):
        return self.run_local(["git", *args]).stdout.strip()

    def cli(self, action, data=None, *, cwd=None):
        return self.run_local(
            ["node", str(self.repo / RECEIVER), action], data=data, cwd=cwd, check=False
        )

    def snapshot(self):
        result = self.cli("snapshot")
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def report(self):
        scope = self.snapshot()
        return {
            "scopeId": scope["scopeId"],
            "commit": scope["commit"],
            "completedAt": scope["observedAt"],
            "passes": [
                {"skill": skill, "status": "completed", "findings": [], "gaps": []}
                for skill in SKILLS
            ],
        }

    def record(self, report):
        return self.cli("record", json.dumps(report))

    def assert_recorded(self, report):
        result = self.record(report)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.cli("check")
        self.assertEqual(result.returncode, 0, result.stderr)

    def verdict(self, host, tool, field, command, *, workdir=None):
        config = json.loads((ROOT / host).read_text("utf-8"))
        hooks = [
            hook
            for group in config["hooks"]["PreToolUse"]
            if re.fullmatch(group["matcher"], tool)
            for hook in group["hooks"]
            if GATE in hook["command"]
        ]
        self.assertEqual(len(hooks), 1, (host, tool))
        self.assertNotIn(
            "if", hooks[0], "Each shell form should reach the command parser"
        )
        tool_input = {field: command}
        if workdir:
            tool_input["workdir"] = str(workdir)
        event = {
            "hook_event_name": "PreToolUse",
            "tool_name": tool,
            "cwd": str(self.repo),
            "tool_input": tool_input,
        }
        # The Claude command uses POSIX project-directory expansion. Git supplies
        # the same shell on Windows. Codex uses its native command processor.
        if host.startswith(".claude"):
            args = [
                "git",
                "-c",
                "alias.fixture-hook=!" + hooks[0]["command"],
                "fixture-hook",
            ]
            result = self.run_local(args, data=json.dumps(event))
        else:
            result = subprocess.run(
                hooks[0]["command"],
                shell=True,
                cwd=self.repo,
                env=self.env,
                input=json.dumps(event),
                capture_output=True,
                text=True,
                check=True,
            )
        return (
            json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"]
            if result.stdout.strip()
            else "allow"
        )

    def test_rerecording_an_old_report_cannot_renew_its_review(self):
        report = self.report()
        now = int(time.time() * 1000)
        for completion in (now - 1_801_000, now + 120_000, None):
            with self.subTest(completion=completion):
                self.assertNotEqual(
                    self.record(dict(report, completedAt=completion)).returncode, 0
                )
                self.assertFalse(self.marker.exists())

    def test_both_hosts_require_both_passes_only_for_a_pr(self):
        submissions = ("gh pr create --fill", "gh pr new --fill")
        for host in HOSTS:
            with self.subTest(host=host):
                for command in submissions:
                    self.assertEqual(self.verdict(*host, command), "deny", command)
                self.assertEqual(self.verdict(*host, "gh pr view"), "allow")
                self.assertEqual(self.verdict(*host, "gh pr new --help"), "allow")
                self.assertEqual(self.verdict(*host, "gh pr status"), "allow")
                self.assertEqual(
                    self.verdict(*host, "echo 'run gh pr create when ready'"), "allow"
                )
        report = self.report()
        report["passes"].reverse()
        report["passes"][0]["findings"] = ["Medium: inspect a changed permission check"]
        self.assert_recorded(report)
        self.assertEqual(
            json.loads(self.marker.read_text("utf-8"))["passes"], report["passes"]
        )
        for host in HOSTS:
            with self.subTest(host=host):
                for command in submissions:
                    self.assertEqual(self.verdict(*host, command), "allow", command)
        self.tracked.write_bytes(b"changed since review\n")
        self.assertEqual(self.verdict(*HOSTS[-1], "gh pr create --fill"), "deny")

    def test_grouped_commands_and_literal_messages_on_each_host(self):
        for host in HOSTS:
            with self.subTest(host=host):
                self.assertEqual(self.verdict(*host, "(gh pr create --fill)"), "deny")
                self.assertEqual(self.verdict(*host, "echo '(gh pr create)'"), "allow")
                self.assertEqual(self.verdict(*host, "(gh pr view)"), "allow")
        self.assert_recorded(self.report())
        for host in HOSTS:
            with self.subTest(host=host):
                self.assertEqual(self.verdict(*host, "(gh pr create --fill)"), "allow")
                self.assertEqual(self.verdict(*host, 'echo "$(gh pr create)"'), "deny")
        self.assertEqual(self.verdict(*HOSTS[0], 'echo "`gh pr create`"'), "deny")
        self.assertEqual(self.verdict(*HOSTS[0], "echo '`gh pr create`'"), "allow")
        self.assertEqual(self.verdict(*HOSTS[1], 'echo "`$(gh pr create)"'), "allow")

    def test_pr_target_must_match_the_reviewed_checkout(self):
        self.assert_recorded(self.report())
        host = HOSTS[-1]
        self.assertEqual(
            self.verdict(
                *host,
                "gh pr create --repo fixture/review --base main --head review-fixture",
            ),
            "allow",
        )
        self.assertEqual(
            self.verdict(
                *host,
                'gh pr --repo fixture/review create --head fixture:review-fixture --title "--base other"',
            ),
            "allow",
        )
        for command in (
            "gh -R another/repo pr create --fill",
            "gh pr create --repo another/repo --fill",
            "gh pr create --base another-base --fill",
            "gh pr create --head another-head --fill",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.verdict(*host, command), "deny")
        self.git("config", "branch.review-fixture.gh-merge-base", "another-base")
        self.assertEqual(self.verdict(*host, "gh pr create --fill"), "deny")
        self.assertEqual(self.verdict(*host, "gh pr create --base main"), "allow")
        self.git("config", "--unset", "branch.review-fixture.gh-merge-base")
        self.git("remote", "add", "upstream", "https://github.com/upstream/review.git")
        self.assertEqual(self.verdict(*host, "gh pr create --fill"), "deny")
        self.assertEqual(self.verdict(*host, "gh pr create -R fixture/review"), "allow")
        self.git("config", "remote.upstream.gh-resolved", "base")
        self.assertEqual(self.verdict(*host, "gh pr create --fill"), "deny")
        self.git("config", "--unset", "remote.upstream.gh-resolved")
        self.git("config", "remote.origin.gh-resolved", "base")
        self.assertEqual(self.verdict(*host, "gh pr create --fill"), "allow")

    def test_old_scan_and_skill_events_have_no_marker_writer(self):
        for config_path in {host for host, _, _ in HOSTS}:
            hosts = json.loads((ROOT / config_path).read_text("utf-8"))
            for group in hosts["hooks"].get("PostToolUse", []):
                for hook in group["hooks"]:
                    self.assertNotIn("mark-security-review.sh", hook.get("command", ""))

    def test_invalid_or_historical_reports_cannot_create_a_receipt(self):
        report = self.report()
        first, second = report["passes"]
        invalid = [
            {**report, "passes": [first]},
            {**report, "passes": [first, first]},
            {**report, "passes": [first, {**second, "status": "incomplete"}]},
            {**report, "passes": [first, {**second, "findings": "none"}]},
            {**report, "passes": [first, {**second, "skill": "security-review"}]},
            {**report, "scopeId": None},
            {**report, "commit": self.git("rev-parse", "HEAD^")},
        ]
        for bad in invalid:
            with self.subTest(bad=bad):
                self.assertNotEqual(self.record(bad).returncode, 0)
                self.assertFalse(self.marker.exists())
        self.assertNotEqual(self.cli("record", "{").returncode, 0)
        self.assertNotEqual(self.cli("check").returncode, 0)

    def test_scope_covers_index_even_when_worktree_matches_reviewed_bytes(self):
        old = self.report()
        self.assert_recorded(old)
        original = self.tracked.read_bytes()
        self.tracked.write_bytes(b"staged only\n")
        self.git("add", self.tracked.name)
        self.tracked.write_bytes(original)
        self.assertNotEqual(self.cli("check").returncode, 0)
        self.assertNotEqual(self.record(old).returncode, 0)

    def test_untracked_content_rename_deletion_and_ignored_files(self):
        tracked = self.report()
        self.assert_recorded(tracked)
        cache = self.repo / "cache"
        cache.mkdir()
        (cache / "ignored").write_text("temporary output")
        self.assertEqual(self.cli("check").returncode, 0)
        new = self.repo / "untracked with spaces.bin"
        new.write_bytes(bytes([0, 254]))
        self.assertNotEqual(self.cli("check").returncode, 0)
        untracked = self.report()
        self.assert_recorded(untracked)
        new.write_bytes(bytes([0, 255]))
        self.assertNotEqual(self.cli("check").returncode, 0)
        new.write_bytes(bytes([0, 254]))
        renamed = new.rename(self.repo / "renamed.bin")
        self.assertNotEqual(self.record(untracked).returncode, 0)
        renamed.unlink()
        self.assertNotEqual(self.record(untracked).returncode, 0)

    def test_receipt_is_bound_to_checkout_head_and_base(self):
        report = self.report()
        self.assert_recorded(report)
        copy = self.repo.parent / "another checkout"
        shutil.copytree(self.repo, copy)
        self.assertNotEqual(self.cli("check", cwd=copy).returncode, 0)
        self.assertEqual(
            self.verdict(*HOSTS[-1], "gh pr create --fill", workdir=copy), "deny"
        )
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.assertNotEqual(self.cli("check").returncode, 0)
        self.assert_recorded(self.report())
        self.git("commit", "--allow-empty", "-qm", "new head")
        self.assertNotEqual(self.cli("check").returncode, 0)

    def test_partial_expired_future_and_legacy_receipts_fail_closed(self):
        self.assert_recorded(self.report())
        receipt = json.loads(self.marker.read_text("utf-8"))
        now = int(time.time() * 1000)
        for bad in (
            dict(receipt, passes=receipt["passes"][:1]),
            dict(receipt, recordedAt=now - 1_801_000),
            dict(receipt, completedAt=now - 1_801_000),
            dict(receipt, recordedAt=now + 120_000),
            now // 1000,
            None,
        ):
            with self.subTest(bad=bad):
                self.marker.write_text(json.dumps(bad))
                self.assertNotEqual(self.cli("check").returncode, 0)
        self.assertEqual(self.verdict(*HOSTS[-1], "gh pr create --fill"), "deny")


class SecurityReviewerProfile(unittest.TestCase):
    def test_claude_reviewer_can_only_read_and_search(self):
        role = (ROOT / ".claude/agents/security-reviewer.md").read_text(encoding="utf-8")
        frontmatter = role.split("---", 2)[1]
        tools = re.findall(r"^tools: (.+)$", frontmatter, re.MULTILINE)
        self.assertEqual(len(tools), 1)
        self.assertEqual({tool.strip() for tool in tools[0].split(",")}, {"Read", "Grep", "Glob"})

    def test_codex_reviewer_uses_read_only_shared_role(self):
        with (ROOT / ".codex/agents/security-reviewer.toml").open("rb") as profile_file:
            profile = tomllib.load(profile_file)
        self.assertEqual(profile["sandbox_mode"], "read-only")
        self.assertIn(".claude/agents/security-reviewer.md", profile["developer_instructions"])


if __name__ == "__main__":
    unittest.main()
