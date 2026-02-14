from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class DiagramSave(BaseModel):
    bpmn_xml: str
    svg_thumbnail: str | None = None


class ElementUpdate(BaseModel):
    """Update EA cross-references on an extracted BPMN element."""

    application_id: str | None = None
    data_object_id: str | None = None
    it_component_id: str | None = None
    custom_fields: dict | None = None


class ProcessAssessmentCreate(BaseModel):
    assessment_date: date
    overall_score: int  # 1-5
    efficiency: int
    effectiveness: int
    compliance: int
    automation: int
    notes: str | None = None
    action_items: list[dict] | None = None


class ProcessAssessmentUpdate(BaseModel):
    overall_score: int | None = None
    efficiency: int | None = None
    effectiveness: int | None = None
    compliance: int | None = None
    automation: int | None = None
    notes: str | None = None
    action_items: list[dict] | None = None
