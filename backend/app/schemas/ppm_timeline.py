"""Settings for the Initiative actual-date mapping."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PmlTimelineMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actual_start_key: str | None = None
    actual_end_key: str | None = None


class PmlTimelineUpdate(PmlTimelineMapping):
    create_defaults: list[Literal["start", "end"]] = Field(default_factory=list, max_length=2)
