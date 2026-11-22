"""Release checks must protect the artifacts and versions operators actually use."""

import os
import re
import shlex
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"


def _run_release_step(
    tmp_path, workflow_name, step_name, ref, *, ref_type="tag", event_name="push"
):
    workflow = (WORKFLOWS / workflow_name).read_text(encoding="utf-8")
    step = workflow.split(f"      - name: {step_name}", 1)[1].split("      - name:", 1)[0]
    script = textwrap.dedent(step.split("run: |\n", 1)[1])
    script = script.replace("${{ github.event_name }}", event_name)
    (tmp_path / "VERSION").write_text("2.208.0\n", encoding="utf-8")
    (tmp_path / "CHANGELOG.md").write_text(
        "# Changelog\n\n## [2.208.0] - 2026-11-21\n\n"
        "### Fixed\n\n- Candidate change.\n\n"
        "## [2.207.0] - 2026-11-20\n\n- Earlier change.\n",
        encoding="utf-8",
    )
    env = {
        **os.environ,
        "GITHUB_REF_NAME": ref,
        "GITHUB_REF_TYPE": ref_type,
        "GITHUB_EVENT_NAME": event_name,
        "GITHUB_OUTPUT": "output",
    }
    result = subprocess.run(
        [_bash(), "-e", "-o", "pipefail", "-c", script],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
    )
    output = tmp_path / "output"
    return result, output.read_text(encoding="utf-8") if output.exists() else ""


@pytest.mark.parametrize(
    "ref,ref_type,event_name,version",
    [
        ("v2.208.0", "tag", "push", "2.208.0"),
        ("v2.208.0-rc.1", "tag", "push", "2.208.0-rc.1"),
        ("v2.208.0-rc.1", "tag", "workflow_dispatch", "2.208.0-rc.1"),
        ("main", "branch", "workflow_dispatch", "2.208.0"),
    ],
)
def test_helm_publish_resolves_chart_and_app_version(tmp_path, ref, ref_type, event_name, version):
    result, output = _run_release_step(
        tmp_path,
        "helm-publish.yml",
        "Resolve version",
        ref,
        ref_type=ref_type,
        event_name=event_name,
    )
    assert result.returncode == 0, result.stderr
    assert f"version={version}" in output.splitlines()
    workflow = (WORKFLOWS / "helm-publish.yml").read_text(encoding="utf-8")
    package = workflow.split("      - name: Package", 1)[1].split("      - name:", 1)[0]
    assert '--version "${{ steps.version.outputs.version }}"' in package
    assert '--app-version "${{ steps.version.outputs.version }}"' in package


@pytest.mark.parametrize(
    "tag",
    ["v2.208.1", "v2.208.1-rc.1", "v2.208.0-rc.", "v2.208.0-rc.01", "v2.208.0-invalid"],
)
def test_helm_publish_rejects_unmatched_or_malformed_tag(tmp_path, tag):
    result, _ = _run_release_step(tmp_path, "helm-publish.yml", "Resolve version", tag)
    assert result.returncode != 0


@pytest.mark.parametrize("tag", ["v2.208.0", "v2.208.0-rc.1"])
def test_github_release_uses_base_changelog_for_candidate(tmp_path, tag):
    result, output = _run_release_step(
        tmp_path, "github-release.yml", "Build release notes from changelog", tag
    )
    assert result.returncode == 0, result.stderr
    assert f"name=Turbo EA {tag.removeprefix('v')}" in output.splitlines()
    assert "- Candidate change." in output
    assert "- Earlier change." not in output


@pytest.mark.parametrize("tag", ["v2.207.0", "v2.208.0-rc.", "v2.208.0-rc.01", "v2.208.0-invalid"])
def test_github_release_rejects_unmatched_or_malformed_tag(tmp_path, tag):
    result, output = _run_release_step(
        tmp_path, "github-release.yml", "Build release notes from changelog", tag
    )
    assert result.returncode != 0
    assert output == ""


def _bash():
    git = Path(shutil.which("git"))
    windows_bash = git.parent.parent / "bin" / "bash.exe"
    return str(windows_bash) if windows_bash.exists() else "bash"


def _docs_only_result(tmp_path, changed_files):
    workflow = (WORKFLOWS / "version-check.yml").read_text(encoding="utf-8")
    step = workflow.split("id: docs_only", 1)[1].split("      - name:", 1)[0]
    script = textwrap.dedent(step.split("run: |\n", 1)[1])
    stub_git = """
git() {
  [[ "$#" == 3 && "$1" == diff && "$2" == --name-only && "$3" == base...HEAD ]] || return 1
  printf '%s\\n' "$CHANGED_FILES"
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


def test_version_check_rejects_wrong_diff_arguments(tmp_path, monkeypatch):
    workflow = (WORKFLOWS / "version-check.yml").read_text(encoding="utf-8")
    changed = workflow.replace(
        'git diff --name-only "${BASE_SHA}...HEAD"', "git diff --name-only HEAD"
    )
    assert changed != workflow
    (tmp_path / "version-check.yml").write_text(changed, encoding="utf-8")
    monkeypatch.setattr(sys.modules[__name__], "WORKFLOWS", tmp_path)
    with pytest.raises(subprocess.CalledProcessError):
        _docs_only_result(tmp_path, ["VERSION"])


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
