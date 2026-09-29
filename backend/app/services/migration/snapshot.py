"""Shared typed payloads for the platform-migration importer.

Source-agnostic dataclasses that every parser (LeanIX xlsx today,
Ardoq / HOPEX / BiZZdesign / Avolution tomorrow) lands data into.
The staging service (:mod:`app.services.migration.staging`) and the
apply pipeline (:mod:`app.services.migration.apply`) both consume the
same shape — adding a source is "write a parser that emits a
:class:`MigrationSnapshot`", not "rewrite the pipeline".

History: this module used to live at
``app.services.leanix_snapshot_parser`` with ``FactSheet`` /
``LeanixSnapshot`` names. The shape was already parser-neutral; the
rename to ``SourceEntity`` / ``MigrationSnapshot`` and the
``source_id`` column on every row is cosmetic but removes the LeanIX
trade-dress so other sources (Ardoq "Components", HOPEX "Objects",
BiZZdesign "Elements") sit on the same terminology.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class SourceEntity:
    """One row out of the source platform's primary entity table.

    LeanIX calls these *fact sheets*, Ardoq calls them *components*,
    HOPEX calls them *objects*, BiZZdesign calls them *elements*. They
    all share the same shape: a typed identifier, a name, optional
    description / category / lifecycle / parent, plus a free-form
    ``custom_fields`` map for everything the metamodel doesn't cover.
    """

    source_id: str
    type: str  # source-native entity type, e.g. "Application"
    name: str
    display_name: str | None = None
    category: str | None = None  # source-native subtype equivalent
    description: str | None = None
    lifecycle: dict[str, str] = field(default_factory=dict)  # phase -> ISO date
    tags: list[str] = field(default_factory=list)  # tag ids
    parent_id: str | None = None  # resolved via the source's hierarchy edges
    custom_fields: dict[str, Any] = field(default_factory=dict)
    quality_seal: str | None = None
    completion: float | None = None
    status: str | None = None  # source-native status (ACTIVE / ARCHIVED)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Relation:
    source_id: str  # native id assigned by the source platform
    type: str  # source-native relation type, e.g. "relApplicationToITComponent"
    from_entity_id: str
    to_entity_id: str
    attributes: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Subscription:
    source_id: str
    entity_id: str  # parent entity id (a SourceEntity.source_id)
    user_email: str | None
    user_display_name: str | None
    role_name: str | None  # e.g. "Application Owner"
    role_type: str | None  # RESPONSIBLE | ACCOUNTABLE | OBSERVER (LeanIX shape)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Tag:
    source_id: str
    name: str
    group_name: str | None
    group_mode: str | None  # SINGLE | MULTIPLE
    color: str | None = None
    # Entity types the group is restricted to (native type names), when
    # the source models that. Only the exporter fills it today; parsers
    # may leave it ``None``.
    group_restrict_to_types: list[str] | None = None


@dataclass
class Document:
    source_id: str
    entity_id: str  # parent SourceEntity.source_id
    name: str
    url: str | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Comment:
    source_id: str
    entity_id: str  # parent SourceEntity.source_id
    author_email: str | None
    body: str
    created_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class UserRef:
    source_id: str
    email: str
    display_name: str | None = None


@dataclass
class MetamodelField:
    type_name: str  # source entity type the field is attached to
    key: str
    label: str
    # Source-native data type string (LeanIX uses STRING / SINGLE_SELECT /
    # FACT_SHEET_REFERENCE / …). Each source adapter has its own mapping
    # table that translates this into a Turbo EA ``fields_schema`` type.
    data_type: str
    options: list[dict[str, Any]] = field(default_factory=list)
    translations: dict[str, str] = field(default_factory=dict)
    is_custom: bool = True  # False if it's a known native source field


@dataclass
class MetamodelType:
    name: str
    is_custom: bool
    fields: list[MetamodelField] = field(default_factory=list)
    subtypes: list[str] = field(default_factory=list)


@dataclass
class MetamodelRelationType:
    name: str
    source_type: str  # native entity type name on the from-side
    target_type: str  # native entity type name on the to-side
    label: str | None = None
    attributes_schema: list[dict[str, Any]] = field(default_factory=list)
    is_custom: bool = True


@dataclass
class MigrationSnapshot:
    """Parser output — everything the staging service needs to land an import."""

    version: str
    entities: list[SourceEntity]
    relations: list[Relation]
    subscriptions: list[Subscription]
    tags: list[Tag]
    documents: list[Document]
    comments: list[Comment]
    users: list[UserRef]
    metamodel_types: list[MetamodelType]
    metamodel_relation_types: list[MetamodelRelationType]
    parse_errors: list[str] = field(default_factory=list)
