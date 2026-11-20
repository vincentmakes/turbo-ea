"""Release checks must protect the artifacts and versions operators actually use."""

import os
import re
import shlex
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"


def _bash():
    git = Path(shutil.which("git"))
    windows_bash = git.parent.parent / "bin" / "bash.exe"
    return str(windows_bash) if windows_bash.exists() else "bash"


def _docs_only_result(tmp_path, changed_files):
    workflow = (WORKFLOWS / "version-check.yml").read_text(encoding="utf-8")
    step = workflow.split("id: docs_only", 1)[1].split("      - name:", 1)[0]
    script = textwrap.dedent(step.split("run: |\n", 1)[1])
    script = script.replace("${{ github.base_ref }}", "main")
    stub_git = """
git() {
  case "$1" in
    fetch) return 0 ;;
    rev-parse) printf '%s\\n' base ;;
    diff) printf '%s\\n' "$CHANGED_FILES" ;;
    *) return 1 ;;
  esac
}
"""
    env = {
        **os.environ,
        "BASE_SHA": "base",
        "CHANGED_FILES": "\n".join(changed_files),
        "GITHUB_OUTPUT": "output",
    }
    subprocess.run([_bash(), "-c", stub_git + script], cwd=tmp_path, env=env, check=True)
    assert "if: steps.docs_only.outputs.result != 'true'" in workflow
    return (tmp_path / "output").read_text().strip()


@pytest.mark.parametrize(
    "changed, expected",
    [
        (["VERSION"], "result=false"),
        (["VERSION", "CHANGELOG.md"], "result=false"),
        (["docs/guide/example.md"], "result=true"),
        (["backend/app/main.py"], "result=false"),
    ],
)
def test_version_check_runs_for_version_bump_even_in_docs_only_pr(tmp_path, changed, expected):
    assert _docs_only_result(tmp_path, changed) == expected


@pytest.mark.parametrize("tag, prerelease", [("v2.208.0-rc.1", True), ("v2.208.0", False)])
def test_github_release_classifies_candidate_from_tag(tag, prerelease):
    workflow = (WORKFLOWS / "github-release.yml").read_text(encoding="utf-8")
    expression = re.search(r"^\s+prerelease:\s*(.+)$", workflow, re.M).group(1)
    match = re.fullmatch(r"\$\{\{\s*contains\(github\.ref_name,\s*'([^']+)'\)\s*\}\}", expression)
    assert match, f"unsupported prerelease expression: {expression}"
    assert (match.group(1) in tag) is prerelease


@pytest.mark.parametrize("doc", ["admin/supply-chain.md", "reference/releases.md"])
def test_documented_backend_signature_targets_the_fork_and_its_publish_workflow(doc):
    text = (ROOT / "docs" / doc).read_text(encoding="utf-8")
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    backend_image = re.search(r"image:\s*(ghcr\.io/[^:\s]+/backend):", compose).group(1)
    commands = re.findall(r"cosign verify[^\n]*", text.replace("\\\n", " "))
    backend_commands = [command for command in commands if "/backend" in command]
    assert backend_commands, f"no backend signature verification in {doc}"
    for command in backend_commands:
        args = shlex.split(command)
        assert args[-1].startswith(backend_image + ":") or args[-1].startswith(backend_image + "@")
        identity = args[args.index("--certificate-identity-regexp") + 1]
        assert re.fullmatch(
            identity,
            "https://github.com/TommasoChi/turbo-ea/.github/workflows/"
            "docker-publish.yml@refs/tags/v2.208.0",
        )
        assert not re.fullmatch(
            identity,
            "https://github.com/vincentmakes/turbo-ea/.github/workflows/"
            "docker-publish.yml@refs/tags/v2.208.0",
        )
        assert not re.fullmatch(
            identity,
            "https://github.com/TommasoChi/turbo-ea/.github/workflows/other.yml@refs/tags/v2.208.0",
        )
