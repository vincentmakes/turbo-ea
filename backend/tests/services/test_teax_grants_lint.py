"""teax CLI mirror of the SDK 1.2 grants validation.

teax deliberately duplicates the backend's manifest constants so it stays
stdlib-vendorable; these tests pin the two copies together and exercise the
new grants lint."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from app.services.extensions.bundle import (
    DEFAULT_SECTION_PLACEMENT as BACKEND_DEFAULT_PLACEMENT,
)
from app.services.extensions.bundle import LOGO_EXTENSIONS as BACKEND_LOGO_EXTENSIONS
from app.services.extensions.bundle import MAX_LOGO_BYTES as BACKEND_MAX_LOGO_BYTES
from app.services.extensions.bundle import SECTION_ANCHORS as BACKEND_SECTION_ANCHORS
from app.services.extensions.bundle import VALID_GRANTS as BACKEND_VALID_GRANTS
from app.services.extensions.bundle import placement_error as backend_placement_error

TEAX_PATH = Path(__file__).resolve().parents[3] / "scripts" / "extension-tools" / "teax.py"


@pytest.fixture(scope="module")
def teax():
    spec = importlib.util.spec_from_file_location("teax_cli", TEAX_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_source(tmp_path: Path, manifest: dict) -> Path:
    (tmp_path / "extension.json").write_text(json.dumps(manifest), encoding="utf-8")
    content_dir = tmp_path / "content"
    content_dir.mkdir()
    (content_dir / "pack.json").write_text(json.dumps({"Cards": []}), encoding="utf-8")
    return tmp_path


BASE_MANIFEST = {
    "key": "sample-ext",
    "name": "Sample",
    "version": "1.0.0",
    "capabilities": ["content"],
    "core": {"min": "0.0.1"},
}


class TestTeaxGrantsLint:
    def test_valid_grants_mirror_backend(self, teax):
        # The two deliberately-duplicated constants must never drift.
        assert set(teax.VALID_GRANTS) == set(BACKEND_VALID_GRANTS)

    def test_placement_constants_and_verdicts_mirror_backend(self, teax):
        # teax lints what the backend will accept: if these drift, an extension
        # passes lint and then fails verify on the customer's instance.
        assert set(teax.SECTION_ANCHORS) == set(BACKEND_SECTION_ANCHORS)
        assert teax.DEFAULT_SECTION_PLACEMENT == BACKEND_DEFAULT_PLACEMENT
        for value in (
            "start",
            "end",
            "before:relations",
            "after:lifecycle",
            "before:custom:0",  # positional — deliberately not addressable
            "beside:relations",
            "before:",
            "before:nope",
            "",
            None,
            7,
        ):
            assert (teax.placement_error(value) is None) == (
                backend_placement_error(value) is None
            ), value

    def test_logo_constants_mirror_backend(self, teax):
        # Same reasoning: teax lints what the backend will accept, so the two
        # copies must agree or an extension passes lint and fails verify.
        assert set(teax.LOGO_EXTENSIONS) == set(BACKEND_LOGO_EXTENSIONS)
        assert teax.MAX_LOGO_BYTES == BACKEND_MAX_LOGO_BYTES

    def test_missing_logo_is_only_a_warning(self, teax, tmp_path):
        """A logo is recommended, never required — an extension that predates
        the field must still lint clean."""
        src = write_source(tmp_path, BASE_MANIFEST)
        _, _, problems, warnings = teax._lint_source(src)
        assert not problems
        assert any("no logo declared" in w for w in warnings)

    def test_declared_logo_that_is_missing_is_a_problem(self, teax, tmp_path):
        src = write_source(tmp_path, {**BASE_MANIFEST, "logo": "logo.png"})
        _, _, problems, _ = teax._lint_source(src)
        assert any("logo file listed but missing" in p for p in problems)

    def test_logo_with_a_non_image_suffix_is_a_problem(self, teax, tmp_path):
        src = write_source(tmp_path, {**BASE_MANIFEST, "logo": "content/pack.json"})
        _, _, problems, _ = teax._lint_source(src)
        assert any("logo must end in one of" in p for p in problems)

    def test_unsafe_logo_path_is_a_problem(self, teax, tmp_path):
        src = write_source(tmp_path, {**BASE_MANIFEST, "logo": "../evil.png"})
        _, _, problems, _ = teax._lint_source(src)
        assert any("unsafe logo path" in p for p in problems)

    def test_oversized_logo_is_a_problem(self, teax, tmp_path):
        src = write_source(tmp_path, {**BASE_MANIFEST, "logo": "logo.png"})
        (src / "logo.png").write_bytes(b"x" * (teax.MAX_LOGO_BYTES + 1))
        _, _, problems, _ = teax._lint_source(src)
        assert any("logo is larger than" in p for p in problems)

    def test_valid_logo_passes(self, teax, tmp_path):
        src = write_source(tmp_path, {**BASE_MANIFEST, "logo": "logo.png"})
        (src / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        _, _, problems, warnings = teax._lint_source(src)
        assert not problems
        assert not any("logo" in w for w in warnings)

    def test_unknown_grant_is_a_problem(self, teax, tmp_path):
        # core.cards.delete stays the canonical rejected grant: the bridge
        # deliberately exposes no hard delete, so no such grant may exist.
        src = write_source(tmp_path, {**BASE_MANIFEST, "grants": ["core.cards.delete"]})
        _, _, problems, _ = teax._lint_source(src)
        assert any("unknown grant" in p for p in problems)

    def test_known_grants_pass(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {**BASE_MANIFEST, "grants": ["core.todos.write", "core.events.todo"]},
        )
        _, _, problems, _ = teax._lint_source(src)
        assert problems == []

    def test_core_grant_with_old_sdk_warns(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {**BASE_MANIFEST, "grants": ["core.todos.write"], "sdk_version": "1.1"},
        )
        _, _, problems, warnings = teax._lint_source(src)
        assert problems == []
        assert any("SDK 1.2" in w for w in warnings)

    def test_users_grant_with_pre_1_3_sdk_warns(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {**BASE_MANIFEST, "grants": ["core.users.read"], "sdk_version": "1.2"},
        )
        _, _, problems, warnings = teax._lint_source(src)
        assert problems == []
        assert any("SDK 1.3" in w for w in warnings)

    def test_users_grant_with_1_3_sdk_is_clean(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {**BASE_MANIFEST, "grants": ["core.users.read"], "sdk_version": "1.3"},
        )
        _, _, problems, warnings = teax._lint_source(src)
        assert problems == []
        # The logo advisory fires on any manifest shipping no artwork; this
        # case is pinning that the *grants* draw no complaint.
        assert [w for w in warnings if "logo" not in w] == []

    def test_cards_grant_with_pre_1_5_sdk_warns(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {**BASE_MANIFEST, "grants": ["core.cards.read"], "sdk_version": "1.4"},
        )
        _, _, problems, warnings = teax._lint_source(src)
        assert problems == []
        assert any("SDK 1.5" in w for w in warnings)

    def test_cards_grants_with_1_5_sdk_are_clean(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {
                **BASE_MANIFEST,
                "grants": ["core.cards.read", "core.cards.write", "core.events.card"],
                "sdk_version": "1.5",
            },
        )
        _, _, problems, warnings = teax._lint_source(src)
        assert problems == []
        # The logo advisory fires on any manifest shipping no artwork; this
        # case is pinning that the *grants* draw no complaint.
        assert [w for w in warnings if "logo" not in w] == []

    def test_adr_grant_with_pre_1_8_sdk_warns(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {**BASE_MANIFEST, "grants": ["core.adr.write"], "sdk_version": "1.7"},
        )
        _, _, problems, warnings = teax._lint_source(src)
        assert problems == []
        assert any("SDK 1.8" in w for w in warnings)

    def test_adr_grants_with_1_8_sdk_are_clean(self, teax, tmp_path):
        src = write_source(
            tmp_path,
            {
                **BASE_MANIFEST,
                "grants": ["core.adr.read", "core.adr.write"],
                "sdk_version": "1.8",
            },
        )
        _, _, problems, warnings = teax._lint_source(src)
        assert problems == []
        # The logo advisory fires on any manifest shipping no artwork; this
        # case is pinning that the *grants* draw no complaint.
        assert [w for w in warnings if "logo" not in w] == []

    def test_non_list_grants_is_a_problem(self, teax, tmp_path):
        src = write_source(tmp_path, {**BASE_MANIFEST, "grants": "core.todos.write"})
        _, _, problems, _ = teax._lint_source(src)
        assert any("list of strings" in p for p in problems)
