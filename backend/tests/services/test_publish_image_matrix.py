"""Every image compose pulls from GHCR is built, signed, scanned and reconciled.

The ``ollama`` image spent two years outside ``docker-publish.yml``'s matrix as a
"thin patch over ``ollama/ollama:latest``, republished by hand" — never
cosign-signed, never Trivy-gated, never rescanned by the daily job, and never
tagged with the release version ``docker-compose.yml`` asked for. Nothing
noticed, because the three matrices were hand-maintained lists that nothing
compared. 2.154.0 put it in the matrix; 2.155.0 dropped the image altogether,
because the patch added nothing but a non-root user and in exchange the repo
was signing and scanning a Go binary it cannot rebuild (75 upstream-toolchain
alerts on day one). Compose now pins upstream's own tag.

These tests read the workflows and the compose file as text (the pattern of
``test_publish_workflow_signing``) and pin: the three matrices are one set, that
set is exactly the images ``docker-compose.yml`` references on GHCR, every
image compose pulls from elsewhere is pinned to a release tag, and the
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
_COMPOSE_ANY_IMAGE_RE = re.compile(r"^\s*image:\s*(\S+)\s*$", re.MULTILINE)
_FROM_RE = re.compile(r"^FROM\s+(\S+)\s+AS\s+(\S+)\s*$", re.MULTILINE)


def _matrix_of(name: str) -> set[str]:
    text = (_WORKFLOWS / name).read_text(encoding="utf-8")
    matches = _MATRIX_RE.findall(text)
    assert len(matches) == 1, f"{name}: expected one `image: [...]` matrix, found {len(matches)}"
    return {item.strip() for item in matches[0].split(",")}


def _compose_text() -> str:
    return (_ROOT / "docker-compose.yml").read_text(encoding="utf-8")


def _compose_images() -> set[str]:
    return set(_COMPOSE_IMAGE_RE.findall(_compose_text()))


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


class TestUpstreamComposeImagesArePinned:
    def test_every_non_ghcr_image_carries_a_release_tag(self):
        upstream = [
            ref
            for ref in _COMPOSE_ANY_IMAGE_RE.findall(_compose_text())
            if not ref.startswith("ghcr.io/vincentmakes/turbo-ea/")
        ]
        assert upstream, "expected at least the upstream ollama/ollama image in docker-compose.yml"
        floating = [ref for ref in upstream if ":" not in ref or ref.endswith(":latest")]
        assert not floating, (
            f"{floating}: an upstream image compose pulls must be pinned to a release tag — "
            "a moving tag is invisible to Dependabot's docker-compose entry"
        )


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

    def test_no_ollama_stage_is_built_here(self):
        text = (_ROOT / "Dockerfile").read_text(encoding="utf-8")
        assert "AS ollama" not in text, (
            "the ollama image is upstream's, pinned in docker-compose.yml; do not reintroduce "
            "a patched copy the repo would have to sign and scan"
        )


_NGINX_BASE_RE = re.compile(r"^nginx:[^\s]*-alpine$")
_UNUSED_NGINX_PACKAGES = (
    "nginx-module-image-filter",
    "nginx-module-xslt",
    "nginx-module-geoip",
    "nginx-module-njs",
    "nginx-module-acme",
    "curl",
)


def _stage_bodies(text: str) -> dict[str, tuple[str, str]]:
    """``{stage: (base, body)}`` with backslash continuations joined, so a
    ``RUN`` spread over several lines reads as one."""
    joined = re.sub(r"\\\n\s*", " ", text)
    parts = re.split(r"(?m)^(?=FROM\s)", joined)
    stages: dict[str, tuple[str, str]] = {}
    for part in parts:
        match = _FROM_RE.match(part)
        if match:
            stages[match.group(2)] = (match.group(1), part)
    return stages


class TestNginxStagesDropUnusedModules:
    """The official nginx image ships five optional module packages and curl.
    Nothing here loads a module or calls curl, and their dependency tree
    (libgd, tiff, libX11, fontconfig/libexpat, libxslt, geoip) is where the
    recurring libtiff, libexpat and libX11 findings on the frontend and edge
    images came from. A base bump or a copied stage must not bring them back."""

    def _nginx_stages(self) -> dict[str, str]:
        text = (_ROOT / "Dockerfile").read_text(encoding="utf-8")
        return {
            stage: body
            for stage, (base, body) in _stage_bodies(text).items()
            if _NGINX_BASE_RE.match(base)
        }

    def test_both_published_nginx_images_are_covered(self):
        assert {"frontend", "nginx"} <= set(self._nginx_stages())

    def test_every_nginx_stage_removes_the_unused_packages(self):
        for stage, body in self._nginx_stages().items():
            del_lines = [line for line in body.splitlines() if "apk del" in line]
            assert del_lines, f"stage {stage!r} has no `apk del` of nginx's unused modules"
            removed = set(" ".join(del_lines).split())
            missing = [pkg for pkg in _UNUSED_NGINX_PACKAGES if pkg not in removed]
            assert not missing, f"stage {stage!r} keeps {missing}"

    def test_the_removal_runs_before_the_upgrade(self):
        """Removing first means the upgrade never fetches fixes for packages
        about to go, and the layer never holds them."""
        for stage, body in self._nginx_stages().items():
            assert body.index("apk del") < body.index("apk upgrade"), stage
