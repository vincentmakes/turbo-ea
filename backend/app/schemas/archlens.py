"""Pydantic schemas for ArchLens integration."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, HttpUrl


class ArchLensConnectionCreate(BaseModel):
    name: str
    instance_url: HttpUrl
    credentials: dict | None = None
    is_active: bool = True


class ArchLensConnectionUpdate(BaseModel):
    name: str | None = None
    instance_url: HttpUrl | None = None
    credentials: dict | None = None
    is_active: bool | None = None


class ArchLensConnectionOut(BaseModel):
    id: str
    name: str
    instance_url: str
    is_active: bool
    last_tested_at: datetime | None = None
    test_status: str | None = None
    last_synced_at: datetime | None = None
    sync_status: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ArchLensSyncRequest(BaseModel):
    turbo_ea_url: str | None = None
    email: str | None = None
    password: str | None = None


class ArchLensAnalyseRequest(BaseModel):
    pass


class ArchLensArchitectRequest(BaseModel):
    model_config = {"populate_by_name": True}

    phase: int
    requirement: str | None = None
    phase1_qa: dict | list | None = Field(None, alias="phase1QA")
    all_qa: dict | list | None = Field(None, alias="allQA")


class ArchLensAnalysisRunOut(BaseModel):
    id: str
    connection_id: str
    analysis_type: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None

    model_config = {"from_attributes": True}
