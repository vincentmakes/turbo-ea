"""Every image compose can pull is built, signed, scanned and reconciled.

The ``ollama`` image spent two years outside ``docker-publish.yml``'s matrix as a
"thin patch over ``ollama/ollama:latest``, republished by hand" — which made it
the one image that was never cosign-signed, never Trivy-gated, never rescanned
by the daily job, and never tagged with the release version ``docker-compose.yml``
asks for (``ollama:${TURBO_EA_TAG}`` did not exist). Nothing noticed, because
the three matrices were hand-maintained lists that nothing compared.

These tests read the workflows and the compose file as text (the pattern of
``test_publish_workflow_signing``) and pin: the three matrices are one set, that
set is exactly the images ``docker-compose.yml`` references on GHCR, and the
Dockerfile pins every ``FROM`` to a tag rather than ``:latest``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[3]
_WORKFLOWS = _ROOT / ".github" / "workflows"
_MATRIX_WORKFLOWS = (
    "docker-publish.yml",
    "security-scan-published.yml",
    "trivy-reconcile.yml",
)
_MATRIX_RE = re.compile(r"^\s*image:\s*\[([^\]]+)\]\s*$", re.MULTILINE)
_COMPOSE_IMAGE_RE = re.compile(r"ghcr\.io/vincentmakes/turbo-ea/([a-z-]+):\$\{TURBO_EA_TAG")
_FROM_RE = re.compile(r"^FROM\s+(\S+)\s+AS\s+(\S+)\s*$", re.MULTILINE)


def _matrix_of(name: str) -> set[str]:
    text = (_WORKFLOWS / name).read_text(encoding="utf-8")
    matches = _MATRIX_RE.findall(text)
    assert len(matches) == 1, f"{name}: expected one `image: [...]` matrix, found {len(matches)}"
    return {item.strip() for item in matches[0].split(",")}


def _compose_images() -> set[str]:
    text = (_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    return set(_COMPOSE_IMAGE_RE.findall(text))


class TestImageMatrices:
    @pytest.mark.parametrize("name", _MATRIX_WORKFLOWS)
    def test_matrix_covers_every_image_compose_pulls(self, name: str):
        assert _matrix_of(name) == _compose_images(), (
            f"{name} builds/scans a different set of images than docker-compose.yml pulls; "
            "an image outside the matrix is unsigned, unscanned and has no release tag"
        )

    def test_the_three_matrices_are_one_set(self):
        matrices = {name: _matrix_of(name) for name in _MATRIX_WORKFLOWS}
        assert len({frozenset(m) for m in matrices.values()}) == 1, matrices

    def test_ollama_is_no_longer_the_exception(self):
        assert "ollama" in _compose_images()
        assert "ollama" in _matrix_of("docker-publish.yml")


class TestDockerfileBasesArePinned:
    def test_no_stage_builds_from_a_latest_tag(self):
        text = (_ROOT / "Dockerfile").read_text(encoding="utf-8")
        stages = _FROM_RE.findall(text)
        assert stages, "no `FROM ... AS ...` stages found"
        floating = [
            (base, stage) for base, stage in stages if base.endswith(":latest") or ":" not in base
        ]
        assert not floating, (
            f"{floating}: a moving tag is invisible to Dependabot's docker entry and cannot be "
            "reproduced from a signature; pin a release tag"
        )
