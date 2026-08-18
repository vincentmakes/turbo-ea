"""teax CLI mirror of the SDK 1.2 grants validation.

teax deliberately duplicates the backend's manifest constants so it stays
stdlib-vendorable; these tests pin the two copies together and exercise the
new grants lint."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from app.services.extensions.bundle import VALID_GRANTS as BACKEND_VALID_GRANTS

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
        assert warnings == []

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
        assert warnings == []

    def test_non_list_grants_is_a_problem(self, teax, tmp_path):
        src = write_source(tmp_path, {**BASE_MANIFEST, "grants": "core.todos.write"})
        _, _, problems, _ = teax._lint_source(src)
        assert any("list of strings" in p for p in problems)
