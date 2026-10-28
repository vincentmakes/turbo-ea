"""Request bodies of ``/dashboards``.

The validators only call the plain rule functions in
``services/dashboard_service.py`` (decorated validators are invisible to
mutmut, the rules are not).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.dashboard_service import (
    MAX_WIDGETS,
    duplicate_widget_id,
    layout_problem,
    widget_config_problem,
)

_ICON_PATTERN = r"^[a-z0-9_]+$"
_ROLE_KEY = Field(min_length=1, max_length=50)


class WidgetLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: int = Field(ge=0, le=11)
    y: int = Field(ge=0, le=10_000)
    w: int = Field(ge=1, le=12)
    h: int = Field(ge=1, le=100)
    minW: int | None = Field(None, ge=1, le=12)  # noqa: N815 — react-grid-layout's name
    minH: int | None = Field(None, ge=1, le=100)  # noqa: N815 — react-grid-layout's name

    @model_validator(mode="after")
    def _fits_the_grid(self) -> WidgetLayout:
        problem = layout_problem(self.x, self.w)
        if problem:
            raise ValueError(problem)
        return self


class DashboardWidgetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    type: str = Field(min_length=1, max_length=40)
    title: str | None = Field(None, max_length=120)
    config: dict[str, Any] = Field(default_factory=dict)
    layout: WidgetLayout

    @model_validator(mode="after")
    def _config_fits_the_type(self) -> DashboardWidgetIn:
        problem = widget_config_problem(self.type, self.config)
        if problem:
            raise ValueError(problem)
        return self


def _check_widgets(widgets: list[DashboardWidgetIn] | None) -> list[DashboardWidgetIn] | None:
    if widgets is not None:
        dup = duplicate_widget_id(w.id for w in widgets)
        if dup is not None:
            raise ValueError(f"duplicate widget id {dup!r}")
    return widgets


class DashboardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    icon: str | None = Field(None, max_length=80, pattern=_ICON_PATTERN)
    allowed_roles: list[str] = Field(default_factory=list, max_length=50)
    widgets: list[DashboardWidgetIn] = Field(default_factory=list, max_length=MAX_WIDGETS)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("name must not be blank")
        return value.strip()

    @field_validator("allowed_roles")
    @classmethod
    def _role_keys(cls, value: list[str]) -> list[str]:
        if any(not k or len(k) > 50 for k in value):
            raise ValueError("invalid role key")
        return value

    _widgets = field_validator("widgets")(_check_widgets)


class DashboardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    icon: str | None = Field(None, max_length=80, pattern=_ICON_PATTERN)
    is_hidden: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=10_000)
    allowed_roles: list[str] | None = Field(None, max_length=50)
    widgets: list[DashboardWidgetIn] | None = Field(None, max_length=MAX_WIDGETS)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("name must not be blank")
        return value.strip() if value is not None else None

    @field_validator("allowed_roles")
    @classmethod
    def _role_keys(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and any(not k or len(k) > 50 for k in value):
            raise ValueError("invalid role key")
        return value

    _widgets = field_validator("widgets")(_check_widgets)


class DashboardDuplicate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, max_length=200)
