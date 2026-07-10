"""Unit tests for content-pack loading/validation (no DB)."""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.models.survey import Survey
from app.services.extensions.content_pack import (
    CONTENT_ALLOWED_SHEETS,
    ContentPackError,
    apply_content,
    build_content_bundle,
    load_content,
)
from tests.conftest import create_card_type, create_role, create_user


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

    def test_surveys_is_an_allowed_sheet_but_responses_are_not(self):
        assert "Surveys" in CONTENT_ALLOWED_SHEETS
        assert "SurveyResponses" not in CONTENT_ALLOWED_SHEETS

    def test_build_bundle_clamps_survey_status_to_draft(self):
        # Even an "active" survey with send/close stamps is forced to draft.
        sheets = {
            "Surveys": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "S",
                    "status": "active",
                    "sent_at": "2026-01-01T00:00:00Z",
                    "closed_at": "2026-02-01T00:00:00Z",
                }
            ]
        }
        build_content_bundle(sheets)
        row = sheets["Surveys"][0]
        assert row["status"] == "draft"
        assert row["sent_at"] is None and row["closed_at"] is None


class TestApplyPackSurvey:
    """A pack-shipped survey lands as a reviewable draft with fields intact."""

    async def test_pack_survey_lands_as_draft_with_fields_preselected(self, db):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        survey_id = uuid.uuid4()
        fields = [
            {
                "key": "esgRating",
                "section": "ESG Metrics",
                "label": "ESG Rating",
                "type": "ext.esg-pack.rating",
                "action": "maintain",
            },
            {
                "key": "esgAudited",
                "section": "ESG Metrics",
                "label": "Audited",
                "type": "boolean",
                "action": "confirm",
            },
        ]
        sheets = {
            "Surveys": [
                {
                    "id": str(survey_id),
                    "name": "Maintain your ESG metrics",
                    "description": "Quarterly ESG review",
                    "message": "Please review.",
                    "status": "active",  # must be clamped to draft
                    "target_type_key": "Application",
                    "target_filters": {},
                    "target_roles": ["responsible"],
                    "fields": fields,
                    "sent_at": "2026-01-01T00:00:00Z",
                }
            ]
        }
        result = await apply_content(db, sheets, admin)
        assert result.total_failed == 0

        survey = (await db.execute(select(Survey).where(Survey.id == survey_id))).scalar_one()
        assert survey.status == "draft"  # never install-time active
        assert survey.sent_at is None
        # Fields ship pre-selected so the builder opens with them checked.
        assert [f["key"] for f in survey.fields] == ["esgRating", "esgAudited"]
        assert survey.target_type_key == "Application"

        # Idempotent: re-applying the same pack changes nothing.
        result2 = await apply_content(db, sheets, admin)
        assert result2.total_failed == 0
        again = (await db.execute(select(Survey).where(Survey.id == survey_id))).scalars().all()
        assert len(again) == 1
