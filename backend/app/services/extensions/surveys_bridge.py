"""The SDK surveys bridge — extensions' sanctioned path to data-maintenance
surveys, SDK 1.14.

Design invariants (mirroring ``risks_bridge`` and ``adr_bridge``):

* **Grant-gated per call.** ``preview`` / ``get`` need ``core.surveys.read``
  (or ``core.surveys.write``, which implies it); ``send`` needs
  ``core.surveys.write``. Access revokes the moment the extension is
  disabled, removed, pending restart, or its licence stops being usable.
* **Send only.** An extension creates a survey and sends it in one step;
  closing it and applying the answers stay human acts in Admin → Surveys,
  the same posture as ADR signing and risk status transitions. There is no
  ``update``, ``close`` or ``delete`` here.
* **Explicit cards, never a filter.** The bridge takes the card ids the
  extension already matched (up to 500, all existing, ACTIVE and of the
  target type — a malformed or unknown id is refused, not skipped) and
  stores them as the survey's ``card_ids`` filter, so the survey page shows
  exactly the set the extension chose.
* **Fields come from the metamodel.** ``[{key, action}]`` is expanded by
  ``survey_service.expand_fields`` into the same rows the survey builder
  writes, so labels and options are never hand-written by a program.
* **Provenance without a synthetic author.** ``created_by`` stays NULL; the
  write runs in a committed ``MutationBatch(tool_name="ext:{key}",
  origin="ext")`` (or joins the open ``ctx.batch`` scope), and the
  ``survey.sent`` events fanned out to every matched card carry ``ext: {key}``
  so the extension's own handler filters them by default and a rollback of
  the batch closes the survey. Honours ``EXTENSION_WRITES_ENABLED``.
* **No session across delivery.** The notifications go through
  ``deliver_notification_batch`` AFTER the batch has committed and its session
  closed — each emailed one opens an SMTP connection.
* **One writer.** The rows come from ``survey_service.activate_survey`` — the
  same function ``POST /surveys/{id}/send`` calls — so the response rows, the
  per-user notification and the card events are identical whichever path
  sent the survey.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.card import Card
from app.models.survey import Survey, SurveyResponse
from app.services import (
    mutation_batch_service,
    notification_service,
    stakeholder_service,
    survey_service,
)
from app.services.event_bus import request_batch_id, request_origin
from app.services.extensions import data_service
from app.services.extensions.registry import extension_registry
from app.services.extensions.sdk import (
    ExtensionDataError,
    ExtensionPermissionError,
    ExtSurvey,
    ExtSurveyPreview,
    SurveysBridge,
)

READ_GRANTS = frozenset({"core.surveys.read", "core.surveys.write"})
WRITE_GRANT = "core.surveys.write"

MAX_NAME_LENGTH = 500  # surveys.name column
MAX_CARDS_PER_SURVEY = 500  # matches MAX_CARD_IDS_PER_QUERY on the data bridge
NOTIFICATION_TYPE = "survey_request"

_T = TypeVar("_T")


def _parse_uuid(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as e:
        raise ExtensionDataError(f"Invalid {what}: {value!r}") from e


async def _to_ext_survey(db: AsyncSession, survey: Survey) -> ExtSurvey:
    total = (
        await db.execute(
            select(func.count(SurveyResponse.id)).where(SurveyResponse.survey_id == survey.id)
        )
    ).scalar() or 0
    completed = (
        await db.execute(
            select(func.count(SurveyResponse.id)).where(
                SurveyResponse.survey_id == survey.id, SurveyResponse.status == "completed"
            )
        )
    ).scalar() or 0
    card_ids = (survey.target_filters or {}).get("card_ids") or []
    return ExtSurvey(
        id=str(survey.id),
        name=survey.name,
        status=survey.status,
        target_type=survey.target_type_key,
        card_count=len(card_ids),
        response_count=int(total),
        completed_count=int(completed),
        sent_at=survey.sent_at.isoformat() if survey.sent_at else None,
        closed_at=survey.closed_at.isoformat() if survey.closed_at else None,
    )


class ExtensionSurveys(SurveysBridge):
    """Per-extension bridge instance attached to ``ExtensionContext.surveys``."""

    def __init__(self, key: str):
        self._key = key

    # -- gating ------------------------------------------------------------

    def _require(self, *, write: bool) -> None:
        grants = set(extension_registry.grants_for(self._key))
        allowed = WRITE_GRANT in grants if write else bool(READ_GRANTS & grants)
        if not allowed:
            needed = WRITE_GRANT if write else "core.surveys.read"
            raise ExtensionPermissionError(
                f"Extension {self._key} requires the {needed} grant "
                "(and an enabled, licensed install) for this call"
            )

    def _require_writes_enabled(self) -> None:
        if not settings.EXTENSION_WRITES_ENABLED:
            raise ExtensionPermissionError(
                "Extension writes are disabled on this instance (EXTENSION_WRITES_ENABLED=false)"
            )

    # -- validation --------------------------------------------------------

    @staticmethod
    def _parse_card_ids(card_ids: Sequence[str]) -> list[uuid.UUID]:
        parsed: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for raw in card_ids:
            cid = _parse_uuid(raw, "card id")
            if cid not in seen:
                seen.add(cid)
                parsed.append(cid)
        if not parsed:
            raise ExtensionDataError("A survey needs at least one card")
        if len(parsed) > MAX_CARDS_PER_SURVEY:
            raise ExtensionDataError(
                f"At most {MAX_CARDS_PER_SURVEY} cards per survey (got {len(parsed)})"
            )
        return parsed

    @staticmethod
    def _clean_roles(roles: Sequence[str]) -> list[str]:
        clean = [str(r).strip() for r in roles if str(r).strip()]
        if not clean:
            raise ExtensionDataError("A survey needs at least one stakeholder role")
        return list(dict.fromkeys(clean))

    async def _check_cards(
        self, db: AsyncSession, target_type: str, card_ids: list[uuid.UUID]
    ) -> None:
        rows = await db.execute(
            select(Card.id, Card.type, Card.status).where(Card.id.in_(card_ids))
        )
        found = {row[0]: (row[1], row[2]) for row in rows}
        missing = [str(cid) for cid in card_ids if cid not in found]
        if missing:
            raise ExtensionDataError(f"Cards not found: {', '.join(missing)}")
        archived = [str(cid) for cid, (_, status) in found.items() if status == "ARCHIVED"]
        if archived:
            raise ExtensionDataError(f"Cannot survey archived card(s): {', '.join(archived)}")
        wrong = [str(cid) for cid, (ctype, _) in found.items() if ctype != target_type]
        if wrong:
            raise ExtensionDataError(f"Card(s) are not of type {target_type}: {', '.join(wrong)}")

    async def _check_roles(self, db: AsyncSession, target_type: str, roles: list[str]) -> None:
        defined = {r["key"] for r in await stakeholder_service.roles_for_type(db, target_type)}
        unknown = [r for r in roles if r not in defined]
        if unknown:
            raise ExtensionDataError(f"Role(s) not defined on {target_type}: {', '.join(unknown)}")

    # -- reads -------------------------------------------------------------

    async def get(self, survey_id: str) -> ExtSurvey | None:
        self._require(write=False)
        try:
            sid = uuid.UUID(survey_id)
        except (TypeError, ValueError):
            return None
        async with async_session() as db:
            survey = (await db.execute(select(Survey).where(Survey.id == sid))).scalar_one_or_none()
            if survey is None:
                return None
            return await _to_ext_survey(db, survey)

    async def preview(
        self, *, target_type: str, card_ids: Sequence[str], roles: Sequence[str]
    ) -> ExtSurveyPreview:
        """Who a survey over ``card_ids`` would reach — without writing
        anything. The same resolver the send uses, on an unsaved survey."""
        self._require(write=False)
        parsed = self._parse_card_ids(card_ids)
        clean_roles = self._clean_roles(roles)
        async with async_session() as db:
            await self._check_cards(db, target_type, parsed)
            await self._check_roles(db, target_type, clean_roles)
            draft = Survey(
                name="preview",
                target_type_key=target_type,
                target_filters={"card_ids": [str(c) for c in parsed]},
                target_roles=clean_roles,
                fields=[],
            )
            targets, matched = await survey_service.resolve_targets(db, draft)
        return ExtSurveyPreview(
            cards_matched=len(matched),
            cards_with_targets=len(targets),
            users=len({u["user_id"] for t in targets for u in t["users"]}),
            requests=sum(len(t["users"]) for t in targets),
            targets=tuple(
                {"card_id": t["card_id"], "user_ids": tuple(u["user_id"] for u in t["users"])}
                for t in targets
            ),
        )

    # -- writes ------------------------------------------------------------

    async def _write(
        self,
        op: Callable[[AsyncSession], Awaitable[_T]],
        *,
        summary: Callable[[_T], dict[str, Any]] | None = None,
    ) -> _T:
        self._require(write=True)
        self._require_writes_enabled()
        if data_service.active_batch_id() is not None:
            # Inside ``ctx.batch(...)``: join it — the scope already set the
            # origin and batch contextvars, so the send lands in the same
            # audit row as the card writes around it.
            data_service.count_write_in_active_batch()
            async with async_session() as db:
                try:
                    result = await op(db)
                except HTTPException as e:
                    raise ExtensionDataError(str(e.detail)) from e
                await db.commit()
                return result
        origin_token = request_origin.set("ext")
        batch_token = None
        try:
            async with async_session() as db:
                batch = await mutation_batch_service.create_batch(
                    db,
                    tool_name=f"ext:{self._key}"[:100],
                    actor=None,
                    origin="ext",
                    dry_run=False,
                )
                batch_token = request_batch_id.set(batch.id)
                try:
                    result = await op(db)
                except HTTPException as e:  # defensive: service helpers are HTTP-flavoured
                    raise ExtensionDataError(str(e.detail)) from e
                await mutation_batch_service.commit_batch(
                    db, batch, summary=summary(result) if summary else None
                )
                await db.commit()
                return result
        finally:
            if batch_token is not None:
                request_batch_id.reset(batch_token)
            request_origin.reset(origin_token)

    async def send(
        self,
        *,
        name: str,
        target_type: str,
        card_ids: Sequence[str],
        roles: Sequence[str],
        fields: Sequence[dict[str, Any]],
        message: str = "",
        description: str = "",
    ) -> ExtSurvey:
        clean_name = str(name or "").strip()
        if not clean_name:
            raise ExtensionDataError("A survey needs a name")
        if len(clean_name) > MAX_NAME_LENGTH:
            raise ExtensionDataError(f"Survey name exceeds {MAX_NAME_LENGTH} characters")
        # Validate what needs no session BEFORE opening one.
        parsed = self._parse_card_ids(card_ids)
        clean_roles = self._clean_roles(roles)
        if not fields:
            raise ExtensionDataError("A survey needs at least one field")

        async def op(db: AsyncSession) -> tuple[ExtSurvey, list[dict]]:
            await self._check_cards(db, target_type, parsed)
            await self._check_roles(db, target_type, clean_roles)
            try:
                expanded = await survey_service.expand_fields(db, target_type, list(fields))
            except ValueError as e:
                raise ExtensionDataError(str(e)) from e
            survey = Survey(
                name=clean_name,
                description=str(description or ""),
                message=str(message or ""),
                status="draft",
                target_type_key=target_type,
                target_filters={"card_ids": [str(c) for c in parsed]},
                target_roles=clean_roles,
                fields=expanded,
                created_by=None,
            )
            # Resolve BEFORE the row exists: a refusal writes nothing.
            targets, _matched = await survey_service.resolve_targets(db, survey)
            if not targets:
                raise ExtensionDataError(
                    "No stakeholder holds one of the roles "
                    f"({', '.join(clean_roles)}) on the matched cards"
                )
            db.add(survey)
            await db.flush()
            activation = await survey_service.activate_survey(
                db, survey, targets, actor_id=None, event_extra={"ext": self._key}
            )
            return await _to_ext_survey(db, survey), activation.recipients

        out, recipients = await self._write(
            op,
            summary=lambda pair: {
                "survey_id": pair[0].id,
                "name": pair[0].name,
                "cards": pair[0].card_count,
                "users": len(pair[1]),
            },
        )
        # Delivery AFTER the commit and with the session closed: each emailed
        # notification opens its own SMTP connection.
        await notification_service.deliver_notification_batch(
            recipients, notif_type=NOTIFICATION_TYPE, actor_id=None
        )
        return out
