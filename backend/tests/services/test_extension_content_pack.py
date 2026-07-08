"""Unit tests for content-pack loading/validation (no DB)."""

from __future__ import annotations

import json

import pytest

from app.services.extensions.content_pack import (
    CONTENT_ALLOWED_SHEETS,
    ContentPackError,
    build_content_bundle,
    load_content,
)


def write_content(tmp_path, name: str, payload) -> None:
    (tmp_path / "content").mkdir(exist_ok=True)
    (tmp_path / "content" / name).write_text(json.dumps(payload), encoding="utf-8")


class TestLoadContent:
    def test_merges_files_by_sheet(self, tmp_path):
        write_content(
            tmp_path,
            "types.json",
            {"CardTypes": [{"key": "EsgMetric", "label": "ESG Metric"}]},
        )
        write_content(
            tmp_path,
            "more.json",
            {
                "CardTypes": [{"key": "EsgTarget", "label": "ESG Target"}],
                "TagGroups": [{"name": "ESG Scope", "mode": "single"}],
            },
        )
        manifest = {"content": ["content/types.json", "content/more.json"]}
        sheets = load_content(tmp_path, manifest)
        assert [r["key"] for r in sheets["CardTypes"]] == ["EsgMetric", "EsgTarget"]
        assert len(sheets["TagGroups"]) == 1

    def test_unknown_sheet_rejected(self, tmp_path):
        write_content(tmp_path, "bad.json", {"Users": [{"email": "evil@example.com"}]})
        with pytest.raises(ContentPackError, match="unsupported sheet 'Users'"):
            load_content(tmp_path, {"content": ["content/bad.json"]})

    def test_settings_sheet_rejected(self, tmp_path):
        """A content pack must never be able to smuggle settings/roles in."""
        assert "Settings" not in CONTENT_ALLOWED_SHEETS
        assert "Users" not in CONTENT_ALLOWED_SHEETS
        assert "Roles" not in CONTENT_ALLOWED_SHEETS

    def test_non_object_file_rejected(self, tmp_path):
        write_content(tmp_path, "bad.json", ["not", "an", "object"])
        with pytest.raises(ContentPackError, match="object of sheet"):
            load_content(tmp_path, {"content": ["content/bad.json"]})

    def test_non_list_rows_rejected(self, tmp_path):
        write_content(tmp_path, "bad.json", {"CardTypes": {"key": "X"}})
        with pytest.raises(ContentPackError, match="list of row objects"):
            load_content(tmp_path, {"content": ["content/bad.json"]})

    def test_missing_file_rejected(self, tmp_path):
        with pytest.raises(ContentPackError, match="missing"):
            load_content(tmp_path, {"content": ["content/nope.json"]})

    def test_invalid_json_rejected(self, tmp_path):
        (tmp_path / "content").mkdir()
        (tmp_path / "content" / "bad.json").write_text("{not json", encoding="utf-8")
        with pytest.raises(ContentPackError, match="not valid JSON"):
            load_content(tmp_path, {"content": ["content/bad.json"]})

    def test_bundle_carries_format_version(self):
        bundle = build_content_bundle({"CardTypes": []})
        assert bundle.format_version == "1"
        assert bundle.rows("CardTypes") == []
