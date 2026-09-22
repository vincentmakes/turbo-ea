"""The publish workflows sign in the format the docs promise, and prove it.

Issue #1136: cosign 2.4.1 reported "no signatures found" on every image since
1.37.0. The images were signed — cosign-installer v4 (#631) had moved the
publish jobs to cosign 3, which stores the signature as a Sigstore bundle that
cosign < 2.6 cannot see — but nothing in CI knew, and the docs named no client
floor. Two things now pin the promise: each publish verifies its own signature
with the *oldest* client the docs support, and these tests keep that client,
the docs, and the two workflows saying the same number.

The workflows are scanned as text (the pattern of ``test_alembic_timestamp_defaults``):
PyYAML is not a backend dependency, and the assertions are about order and
literal flags, which regexes express directly.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[3]
_WORKFLOWS = _ROOT / ".github" / "workflows"
_SUPPLY_CHAIN_DOC = _ROOT / "docs" / "admin" / "supply-chain.md"
_PUBLISH_WORKFLOWS = ("docker-publish.yml", "helm-publish.yml")

_FLOOR_INSTALL_RE = re.compile(r"cosign-release:\s*v(\d+\.\d+)\.\d+")
_DOC_FLOOR_RE = re.compile(r"cosign\s*(?:≥|>=)\s*(\d+\.\d+)")
_OIDC_ISSUER = "https://token.actions.githubusercontent.com"


def _workflow(name: str) -> str:
    return (_WORKFLOWS / name).read_text(encoding="utf-8")


def _floor_of(text: str) -> str:
    versions = {m.group(1) for m in _FLOOR_INSTALL_RE.finditer(text)}
    assert len(versions) == 1, f"expected exactly one pinned floor client, found {versions}"
    return versions.pop()


@pytest.mark.parametrize("name", _PUBLISH_WORKFLOWS)
class TestPublishWorkflowSigning:
    def test_registry_login_precedes_signing(self, name: str):
        text = _workflow(name)
        login = text.index("docker/login-action")
        sign = text.index("cosign sign --yes")
        assert login < sign, "cosign reads Docker's credential store; log in before signing (#1113)"

    def test_signature_is_the_bundle_format_the_docs_describe(self, name: str):
        text = _workflow(name)
        assert text.count("cosign sign --yes") == 1
        assert "--new-bundle-format=false" not in text, (
            "the docs promise a Sigstore bundle; a legacy signature would make them wrong"
        )

    def test_floor_client_is_installed_after_signing_into_its_own_dir(self, name: str):
        text = _workflow(name)
        sign = text.index("cosign sign --yes")
        floor = _FLOOR_INSTALL_RE.search(text)
        assert floor is not None, "no pinned cosign-release for the verification gate"
        assert floor.start() > sign, (
            "the installer prepends install-dir to PATH; installing the floor client "
            "before signing would shadow the signing binary"
        )
        assert re.search(r"install-dir:\s*\$\{\{\s*runner\.temp\s*\}\}/cosign-floor", text)

    def test_signature_is_verified_with_the_floor_client(self, name: str):
        text = _workflow(name)
        verify = text.index('"${RUNNER_TEMP}/cosign-floor/cosign" verify')
        assert verify > text.index("cosign sign --yes")
        step = text[verify:]
        assert '--certificate-identity "${IDENTITY}"' in step
        assert f"--certificate-oidc-issuer {_OIDC_ISSUER}" in step
        workflow_path = f".github/workflows/{name}@${{{{ github.ref }}}}"
        assert workflow_path in text, "the gate pins the certificate to this workflow's identity"


class TestFloorIsOneNumberEverywhere:
    def test_workflows_agree_on_the_floor(self):
        floors = {_floor_of(_workflow(name)) for name in _PUBLISH_WORKFLOWS}
        assert len(floors) == 1, floors

    def test_docs_state_the_same_floor(self):
        workflow_floor = _floor_of(_workflow("docker-publish.yml"))
        doc_floors = set(_DOC_FLOOR_RE.findall(_SUPPLY_CHAIN_DOC.read_text(encoding="utf-8")))
        assert doc_floors == {workflow_floor}, (
            f"docs/admin/supply-chain.md promises cosign ≥ {doc_floors or '?'} but the publish "
            f"gate verifies with {workflow_floor}; move the two together"
        )


class TestChartSignOnlyDispatch:
    def test_helm_workflow_can_sign_an_already_published_version(self):
        text = _workflow("helm-publish.yml")
        assert "sign_only_version" in text
        assert "ref=${CHART_REF}:${SIGN_ONLY_VERSION}" in text
        assert "TARGET: ${{ steps.target.outputs.ref }}" in text
        assert 'cosign sign --yes "${TARGET}"' in text

    def test_package_and_push_are_skipped_on_a_sign_only_run(self):
        text = _workflow("helm-publish.yml")
        for step in ("Resolve version", "Lint", "Package", "Push", "Upload packaged chart"):
            block = text[text.index(f"- name: {step}\n") + 1 :]
            next_step = block.find("- name: ")
            block = block if next_step == -1 else block[:next_step]
            assert "if: ${{ !inputs.sign_only_version }}" in block, step
