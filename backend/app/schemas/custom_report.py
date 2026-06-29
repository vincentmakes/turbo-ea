"""Declarative spec for the freeform Custom Report engine.

A ``CustomReportSpec`` is a safe, fully-declarative description of a report that
the Custom Report engine (``app.services.custom_report_engine``) interprets over
the ``cards`` / ``relations`` tables using SQLAlchemy ORM only — never raw SQL.

The spec is authored either by a human or, more commonly, by an AI assistant via
the MCP server. Because it can come from an untrusted author, every leaf string
reference (attribute key, relation-type key, subtype, tag-group id) is validated
against the live metamodel by the engine before it ever reaches a query, and the
structural caps below (``conlist`` / ``conint`` / ``pattern``) form the first
line of defense. Keep the surface small and closed: closed enums for every
operator, no free-form expressions, no computed fields.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Same safe-key shape enforced by reports._SAFE_KEY_RE — alphanumeric + underscore,
# camelCase friendly, no dots/brackets so a key can never traverse a JSONB path.
SAFE_KEY_PATTERN = r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$"

# Structural caps (also defended again inside the engine).
MAX_FILTERS = 25
MAX_SUBTYPES = 50
MAX_DIMENSIONS = 2
MAX_MEASURES = 4
MAX_LIMIT = 500


class FilterOp(str, Enum):
    eq = "eq"
    ne = "ne"
    in_ = "in"
    not_in = "not_in"
    gt = "gt"
    gte = "gte"
    lt = "lt"
    lte = "lte"
    contains = "contains"
    is_set = "is_set"
    is_empty = "is_empty"


class FilterTarget(str, Enum):
    attribute = "attribute"  # Card.attributes[key]
    lifecycle = "lifecycle"  # current lifecycle phase (computed)
    subtype = "subtype"  # Card.subtype column
    tag = "tag"  # tag id or tag name
    name = "name"  # Card.name
    approval_status = "approval_status"  # Card.approval_status column


class Filter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: FilterTarget
    key: str | None = Field(default=None, pattern=SAFE_KEY_PATTERN)
    op: FilterOp
    value: str | float | bool | list[str | float] | None = None

    @model_validator(mode="after")
    def _check(self) -> "Filter":
        if self.target == FilterTarget.attribute and not self.key:
            raise ValueError("filter with target='attribute' requires 'key'")
        if self.op in (FilterOp.is_set, FilterOp.is_empty):
            return self
        if self.op in (FilterOp.in_, FilterOp.not_in):
            if not isinstance(self.value, list):
                raise ValueError(f"op '{self.op.value}' requires a list value")
        elif self.value is None:
            raise ValueError(f"op '{self.op.value}' requires a value")
        return self


class RelationTraversal(BaseModel):
    """Hop from the source working set to related cards (exactly one hop in v1)."""

    model_config = ConfigDict(extra="forbid")

    relation_type: str = Field(pattern=SAFE_KEY_PATTERN)
    direction: str = Field(default="any", pattern="^(out|in|any)$")
    # Required so the traversed working set has a single, validatable card type.
    target_type: str = Field(pattern=SAFE_KEY_PATTERN)


class DataSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    card_type: str = Field(pattern=SAFE_KEY_PATTERN)
    subtypes: list[str] | None = Field(default=None, max_length=MAX_SUBTYPES)
    filters: list[Filter] = Field(default_factory=list, max_length=MAX_FILTERS)
    traverse: RelationTraversal | None = None


class DimensionKind(str, Enum):
    attribute = "attribute"
    subtype = "subtype"
    lifecycle = "lifecycle"
    tag_group = "tag_group"
    relation = "relation"


class Dimension(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: DimensionKind
    # attribute key / relation_type key / tag_group id (uuid as string)
    key: str | None = None
    label: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _check(self) -> "Dimension":
        if self.kind in (DimensionKind.attribute, DimensionKind.relation) and not self.key:
            raise ValueError(f"dimension kind='{self.kind.value}' requires 'key'")
        # tag_group key is a uuid string (not a metamodel key), so only the
        # attribute / relation keys must match the safe-key pattern.
        if self.kind in (DimensionKind.attribute, DimensionKind.relation):
            import re

            if not re.match(SAFE_KEY_PATTERN, self.key or ""):
                raise ValueError(f"invalid key for dimension kind='{self.kind.value}'")
        return self


class Aggregation(str, Enum):
    count = "count"
    sum = "sum"
    avg = "avg"
    min = "min"
    max = "max"


class Measure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agg: Aggregation
    # Required for everything except count; must be a numeric/cost attribute key.
    field: str | None = Field(default=None, pattern=SAFE_KEY_PATTERN)
    label: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _check(self) -> "Measure":
        if self.agg != Aggregation.count and not self.field:
            raise ValueError(f"aggregation '{self.agg.value}' requires 'field'")
        return self


class VizKind(str, Enum):
    table = "table"
    bar = "bar"
    column = "column"
    pie = "pie"
    donut = "donut"
    scatter = "scatter"
    treemap = "treemap"
    line = "line"
    kpi = "kpi"


class Visualization(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: VizKind
    # Optional hints (labels of a dimension/measure) for axis/series binding.
    x: str | None = Field(default=None, max_length=120)
    y: str | None = Field(default=None, max_length=120)
    series: str | None = Field(default=None, max_length=120)


class Sort(BaseModel):
    model_config = ConfigDict(extra="forbid")

    by: str = Field(max_length=120)  # a dimension or measure label/key
    desc: bool = True


class CustomReportSpec(BaseModel):
    """A complete, safe description of a custom report."""

    model_config = ConfigDict(extra="forbid")

    version: int = 1
    title: str = Field(max_length=200)
    source: DataSource
    dimensions: list[Dimension] = Field(default_factory=list, max_length=MAX_DIMENSIONS)
    measures: list[Measure] = Field(min_length=1, max_length=MAX_MEASURES)
    visualization: Visualization
    sort: Sort | None = None
    limit: int = Field(default=100, ge=1, le=MAX_LIMIT)

    @model_validator(mode="after")
    def _check(self) -> "CustomReportSpec":
        if self.visualization.kind == VizKind.kpi and self.dimensions:
            raise ValueError("kpi visualization takes measures only (no dimensions)")
        return self
