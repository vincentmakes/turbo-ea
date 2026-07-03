"""Generic, introspection-driven export/import engine for module entities.

The bespoke core sections handle metamodel/config/settings/cards/relations with
hand-written logic. This generic engine covers ~30 card-context and module tables
(stakeholders, comments, attachments, diagrams, BPM, PPM, GRC risks, ADR/SoAW,
surveys, …) — the generic entity sections. Rather than writing a bespoke applier
per table, it drives them all from a small :class:`EntitySection` descriptor plus
SQLAlchemy column introspection.

Key design decision — **preserve source UUIDs**. Every module row keeps its
original primary key on import, so every *intra-module* foreign key (a task's
``wbs_id``, an occurrence's ``task_id``, a comment's self ``parent_id``, …)
resolves verbatim with no remapping. Only three things need translation:

* **card FKs** — a column pointing at ``cards.id``. Exported as ``{col}__ref`` +
  ``{col}__type`` (full ``parent_path / name``); resolved via ``CardResolver`` on
  import. Cards do *not* preserve UUIDs (they're matched/created by the bespoke
  cards section).
* **user FKs** — a column pointing at ``users.id``. Exported as ``{col}__email``;
  resolved via the email→id map on import.
* **binary/large assets** — ``LargeBinary``, or a Text/JSONB column holding
  diagram/BPMN XML. Offloaded to ``assets/<sheet>/<pk>__<col>`` in the zip.

Idempotency: a row whose preserved PK already exists on the target is skipped.
"""

from __future__ import annotations

import json
import uuid as uuid_mod
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.card_resolver import CardResolver
from app.services.workspace_io import schema
from app.services.workspace_io.bundle import WorkspaceBundle

_TIMESTAMP_COLUMNS = frozenset({"created_at", "updated_at"})


@dataclass(frozen=True)
class EntitySection:
    """Declarative descriptor for one module table.

    ``columns`` are auto-derived (all model columns minus the managed/derived
    ones), so adding a column to a model needs no change here.
    """

    sheet: str
    model: Any  # a SQLAlchemy declarative model class
    card_fk_columns: tuple[str, ...] = ()
    user_fk_columns: tuple[str, ...] = ()
    # (column, kind: bytes|text|json, file extension for the asset)
    asset_columns: tuple[tuple[str, str, str], ...] = ()
    # Offload one *sub-key* of a JSONB column to its own asset file while keeping
    # the rest of the dict inline — e.g. ("data", "xml", "drawio") writes a real
    # .drawio file from ``data["xml"]`` and stores the remaining keys as JSON.
    json_asset_columns: tuple[tuple[str, str, str], ...] = ()  # (column, subkey, ext)
    # When set, asset files for this section are named from this column's value
    # (the original filename, e.g. "report.pdf") instead of "<pk>__<col>.<ext>".
    filename_column: str | None = None
    self_parent_column: str | None = None
    exclude_columns: tuple[str, ...] = ()
    # Optional SQLAlchemy whereclause limiting which rows are exported (e.g.
    # only analysis runs referenced by a compliance finding). Import is
    # unaffected — whatever rows are in the bundle are applied.
    export_where: Any = None

    def value_columns(self) -> list[str]:
        managed = (
            set(self.card_fk_columns)
            | set(self.user_fk_columns)
            | {a[0] for a in self.asset_columns}
            | {a[0] for a in self.json_asset_columns}
            | set(self.exclude_columns)
            | _TIMESTAMP_COLUMNS
        )
        return [c.name for c in self.model.__table__.columns if c.name not in managed]

    def pk_columns(self) -> list[str]:
        return [c.name for c in self.model.__table__.primary_key.columns]

    def header(self) -> list[str]:
        cols = list(self.value_columns())
        for c in self.card_fk_columns:
            cols += [f"{c}__ref", f"{c}__type"]
        for c in self.user_fk_columns:
            cols.append(f"{c}__email")
        for c, _kind, _ext in self.asset_columns:
            cols.append(f"{c}__asset")
        for c, subkey, _ext in self.json_asset_columns:
            cols += [f"{c}__meta", f"{c}__{subkey}__asset"]
        return cols


# ---------------------------------------------------------------------------
# Column kind introspection + scalar coercion
# ---------------------------------------------------------------------------


def _kind(model: Any, col: str) -> str:
    t = model.__table__.columns[col].type
    if isinstance(t, JSONB):
        return "json"
    if isinstance(t, PG_UUID):
        return "uuid"
    if isinstance(t, sa.DateTime):
        return "datetime"
    if isinstance(t, sa.Date):
        return "date"
    return "scalar"


def _nullable(model: Any, col: str) -> bool:
    return bool(model.__table__.columns[col].nullable)


def _to_cell(value: Any, kind: str) -> Any:
    if value is None:
        return None
    if kind == "uuid":
        return str(value)
    if kind in ("datetime", "date"):
        return value.isoformat() if hasattr(value, "isoformat") else str(value)
    if kind == "json":
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return value


def _from_cell(value: Any, kind: str) -> Any:
    if value is None or value == "":
        return None
    if kind == "uuid":
        return value if isinstance(value, uuid_mod.UUID) else uuid_mod.UUID(str(value))
    if kind == "datetime":
        return value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    if kind == "date":
        if isinstance(value, datetime):
            return value.date()
        return value if isinstance(value, date) else date.fromisoformat(str(value))
    if kind == "json":
        return json.loads(value) if isinstance(value, str) else value
    return value


def _encode_asset(content: Any, kind: str) -> bytes:
    if kind == "bytes":
        return bytes(content)
    if kind == "text":
        return str(content).encode("utf-8")
    if kind == "json":
        return json.dumps(content, ensure_ascii=False).encode("utf-8")
    raise ValueError(f"Unknown asset kind {kind!r}")


def _safe_filename(name: str) -> str:
    """Make a value usable as a zip path segment (keep the original extension)."""
    cleaned = "".join(c if c.isalnum() or c in "._- " else "_" for c in name).strip()
    return cleaned[:120] or "file"


def _decode_asset(raw: bytes | None, kind: str) -> Any:
    if raw is None:
        return None
    if kind == "bytes":
        return raw
    if kind == "text":
        return raw.decode("utf-8")
    if kind == "json":
        return json.loads(raw.decode("utf-8"))
    raise ValueError(f"Unknown asset kind {kind!r}")


def build_card_ref(card: Any, card_map: dict[Any, Any]) -> str:
    """Full ``parent_path / name`` reference for a card (root→name, escaped)."""
    segments: list[str] = []
    seen: set[Any] = set()
    current = card_map.get(card.parent_id) if card.parent_id else None
    while current is not None and current.id not in seen and len(segments) < schema.MAX_PATH_DEPTH:
        seen.add(current.id)
        segments.insert(0, current.name)
        current = card_map.get(current.parent_id) if current.parent_id else None
    return schema.build_ref_string(segments, card.name)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


async def export_entity_section(
    db: AsyncSession,
    section: EntitySection,
    card_map: dict[Any, Any],
    user_email: dict[Any, str],
    assets: dict[str, bytes],
) -> tuple[list[str], list[dict[str, Any]]]:
    """Return ``(header, rows)`` for a section and append any binary assets."""
    stmt = sa.select(section.model)
    if section.export_where is not None:
        stmt = stmt.where(section.export_where)
    objs: list[Any] = list((await db.execute(stmt)).scalars().all())
    value_cols = section.value_columns()
    pk0 = section.pk_columns()[0]
    rows: list[dict[str, Any]] = []
    for obj in objs:
        out: dict[str, Any] = {}
        for col in value_cols:
            out[col] = _to_cell(getattr(obj, col), _kind(section.model, col))
        for col in section.card_fk_columns:
            cid = getattr(obj, col)
            card = card_map.get(cid) if cid else None
            out[f"{col}__ref"] = build_card_ref(card, card_map) if card else None
            out[f"{col}__type"] = card.type if card else None
        for col in section.user_fk_columns:
            uid = getattr(obj, col)
            out[f"{col}__email"] = user_email.get(uid) if uid else None
        for col, kind, ext in section.asset_columns:
            content = getattr(obj, col)
            if content is None:
                out[f"{col}__asset"] = None
                continue
            pk = getattr(obj, pk0)
            fname = None
            if section.filename_column:
                fname = getattr(obj, section.filename_column, None)
            if fname:
                path = f"{section.sheet}/{pk}__{_safe_filename(str(fname))}"
            else:
                path = f"{section.sheet}/{pk}__{col}.{ext}"
            assets[path] = _encode_asset(content, kind)
            out[f"{col}__asset"] = path
        for col, subkey, ext in section.json_asset_columns:
            content = getattr(obj, col)
            data = content if isinstance(content, dict) else {}
            sub = data.get(subkey)
            meta = {k: v for k, v in data.items() if k != subkey}
            out[f"{col}__meta"] = json.dumps(meta, ensure_ascii=False) if meta else None
            if sub:
                pk = getattr(obj, pk0)
                fname = (
                    getattr(obj, section.filename_column, None) if section.filename_column else None
                )
                base = _safe_filename(str(fname)) if fname else f"{col}_{subkey}"
                path = f"{section.sheet}/{pk}__{base}.{ext}"
                assets[path] = _encode_asset(sub, "text")
                out[f"{col}__{subkey}__asset"] = path
            else:
                out[f"{col}__{subkey}__asset"] = None
        rows.append(out)
    return section.header(), rows


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def _topo_rows(rows: list[dict[str, Any]], section: EntitySection) -> list[dict[str, Any]]:
    """Order rows so a self-parent appears before its children (preserved PKs)."""
    if not section.self_parent_column:
        return rows
    pk0 = section.pk_columns()[0]
    parent_col = section.self_parent_column
    by_pk = {str(r.get(pk0)): r for r in rows}
    ordered: list[dict[str, Any]] = []
    placed: set[str] = set()

    def place(r: dict[str, Any]) -> None:
        key = str(r.get(pk0))
        if key in placed:
            return
        parent = r.get(parent_col)
        if parent and str(parent) in by_pk and str(parent) not in placed:
            place(by_pk[str(parent)])
        placed.add(key)
        ordered.append(r)

    for r in rows:
        place(r)
    return ordered


async def apply_entity_section(
    db: AsyncSession,
    section: EntitySection,
    bundle: WorkspaceBundle,
    sr: Any,
    resolver: CardResolver,
    email_to_id: dict[str, Any],
    *,
    dry_run: bool,
) -> None:
    """Create rows for a section, preserving PKs and resolving card/user FKs."""
    rows = bundle.rows(section.sheet)
    if not rows:
        return
    model = section.model
    pk_cols = section.pk_columns()
    value_cols = section.value_columns()

    existing_pks: set[tuple] = set()
    existing_objs: list[Any] = list((await db.execute(sa.select(model))).scalars().all())
    for obj in existing_objs:
        existing_pks.add(tuple(getattr(obj, c) for c in pk_cols))

    for row in _topo_rows(rows, section):
        # Build the full row first — a PK column can itself be a card FK (the
        # association tables RiskCard / AdrCard), so the PK isn't knowable until
        # the card reference is resolved.
        kwargs: dict[str, Any] = {}
        for col in value_cols:
            kwargs[col] = _from_cell(row.get(col), _kind(model, col))

        unresolved: str | None = None
        for col in section.card_fk_columns:
            ref = row.get(f"{col}__ref")
            ctype = row.get(f"{col}__type")
            if ref and ctype:
                res = resolver.resolve(str(ctype), str(ref))
                if res.status == "resolved":
                    kwargs[col] = res.card_id
                elif _nullable(model, col):
                    kwargs[col] = None
                else:
                    unresolved = f"card {col} = {ref!r} ({ctype})"
                    break
            else:
                kwargs[col] = None
        if unresolved:
            sr.conflict += 1
            sr.errors.append(f"{section.sheet}: required {unresolved} not found — row skipped")
            continue

        # A required user that can't be matched by email must not slip through
        # as NULL — the flush-time IntegrityError would abort the whole import.
        missing_user: str | None = None
        for col in section.user_fk_columns:
            email = row.get(f"{col}__email")
            uid = email_to_id.get(str(email).lower()) if email else None
            if uid is None and not _nullable(model, col):
                missing_user = f"{col} = {email!r}"
                break
            kwargs[col] = uid
        if missing_user:
            sr.conflict += 1
            sr.errors.append(
                f"{section.sheet}: required user {missing_user} not found — row skipped"
            )
            continue

        for col, kind, _ext in section.asset_columns:
            path = row.get(f"{col}__asset")
            kwargs[col] = _decode_asset(bundle.assets.get(str(path)), kind) if path else None

        for col, subkey, _ext in section.json_asset_columns:
            meta_raw = row.get(f"{col}__meta")
            data = json.loads(meta_raw) if isinstance(meta_raw, str) and meta_raw else {}
            apath = row.get(f"{col}__{subkey}__asset")
            sub = _decode_asset(bundle.assets.get(str(apath)), "text") if apath else None
            if sub is not None:
                data[subkey] = sub
            kwargs[col] = data

        pk_vals = tuple(kwargs.get(c) for c in pk_cols)
        if any(v is None for v in pk_vals):
            sr.failed += 1
            continue
        if pk_vals in existing_pks:
            sr.skip("already_present")
            continue

        db.add(model(**kwargs))
        existing_pks.add(pk_vals)
        sr.created += 1
    await db.flush()
