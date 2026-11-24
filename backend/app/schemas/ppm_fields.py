"""Typed field definitions for PML financial rows."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PmlRowKind = Literal["budget", "cost_item", "invoice"]
PmlRowValues = dict[str, Any]
PmlFieldKind = Literal[
    "text", "number", "date", "boolean", "select", "card_reference", "calculated"
]


class PmlOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    active: bool = True


class PmlCalculation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result_type: Literal["text", "number", "date", "boolean"]
    inputs: dict[str, str] = Field(default_factory=dict, max_length=30)
    expression: str | None = Field(default=None, max_length=2000)
    rules: list[dict[str, Any]] | None = Field(default=None, max_length=100)
    fallback: Any = None


class PmlFieldDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$", max_length=100)
    label: str = Field(min_length=1, max_length=200)
    help: str | None = Field(default=None, max_length=1000)
    kind: PmlFieldKind
    active: bool = True
    required: bool = False
    default: Any = None
    options: list[PmlOption] = Field(default_factory=list, max_length=500)
    card_type: str | None = Field(default=None, max_length=100)
    relation_type: str | None = Field(default=None, max_length=100)
    calculation: PmlCalculation | None = None


class PmlProviderSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    budget_field_key: str
    allow_child_selection: bool = False


class PmlSectionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[PmlFieldDefinition] = Field(default_factory=list, max_length=100)
    visible_columns: list[str] = Field(default_factory=list, max_length=150)
    provider_source: PmlProviderSource | None = None
