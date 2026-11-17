from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, parse_uuid
from app.database import get_db
from app.models.card import Card
from app.models.user import User
from app.schemas.cost_items import KEY_PATTERN
from app.schemas.licenses import (
    CardLicensesOut,
    ImportIssueOut,
    ImportResultOut,
    LicenseCellWrite,
    YearLicensesDetailOut,
    YearLicensesOut,
)
from app.services import card_licenses, license_import
from app.services.attachment_upload import read_validated_upload
from app.services.card_licenses import LICENSE_TYPES, LicenseError, YearLicenses
from app.services.card_read_scope import require_card_readable
from app.services.fiscal_year import (
    FISCAL_YEAR_LOOKAHEAD,
    MAX_FISCAL_YEAR,
    MIN_FISCAL_YEAR,
    current_fiscal_year,
    get_fiscal_year_start,
)
from app.services.permission_service import PermissionService

router = APIRouter(tags=["card-licenses"])

_KEY = Path(pattern=KEY_PATTERN)
_METRIC = Path(pattern=KEY_PATTERN)  # the catalogue decides which metric keys exist
_FY = Path(ge=MIN_FISCAL_YEAR, le=MAX_FISCAL_YEAR)
_STATUS = {"archived_type": 409, "archived_metric": 409}


async def _load_card(db: AsyncSession, card_uuid: uuid.UUID) -> Card:
    return (await db.execute(select(Card).where(Card.id == card_uuid))).scalar_one()


async def _load_for_edit(db: AsyncSession, user: User, card_id: str) -> Card:
    """Writes: ``licenses.edit`` or a card-editing stakeholder role on this card."""
    card_uuid = parse_uuid(card_id)
    card_type = await require_card_readable(db, user, card_uuid, mode="module")
    if card_type not in LICENSE_TYPES:
        raise HTTPException(404, "Card not found")
    if not await PermissionService.can_edit_licenses(db, user, card_uuid):
        raise HTTPException(403, "Not enough permissions")
    return await _load_card(db, card_uuid)


async def _load_for_read(db: AsyncSession, user: User, card_id: str) -> Card:
    card_uuid = parse_uuid(card_id)
    card_type = await require_card_readable(db, user, card_uuid, mode="module")
    if card_type not in LICENSE_TYPES:
        raise HTTPException(404, "Card not found")
    if not await PermissionService.can_view_licenses(db, user, card_uuid):
        raise HTTPException(403, "Not enough permissions")
    return await _load_card(db, card_uuid)


def _out(yl: YearLicenses) -> YearLicensesOut:
    return YearLicensesOut.model_validate(yl, from_attributes=True)


async def _write(
    db: AsyncSession,
    user: User,
    card_id: str,
    fiscal_year: int,
    op: Callable[[uuid.UUID], Awaitable[object]],
) -> YearLicensesOut:
    card = await _load_for_edit(db, user, card_id)
    try:
        new = await card_licenses.apply_write(db, card, user.id, fiscal_year, lambda: op(card.id))
    except LicenseError as e:
        raise HTTPException(_STATUS.get(e.code, 422), e.code) from e
    await db.commit()
    return _out(new)


@router.get("/cards/{card_id}/licenses", response_model=CardLicensesOut)
async def get_card_licenses(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await _load_for_read(db, user, card_id)
    years = await card_licenses.get_window(db, card, await get_fiscal_year_start(db))
    return CardLicensesOut(
        can_edit=await PermissionService.can_edit_licenses(db, user, card.id),
        years=[_out(y) for y in years],
    )


@router.get("/cards/{card_id}/licenses/{fiscal_year}", response_model=YearLicensesDetailOut)
async def get_card_licenses_year(
    card_id: str,
    fiscal_year: int = _FY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await _load_for_read(db, user, card_id)
    yl = await card_licenses.get_year(db, card, fiscal_year, await get_fiscal_year_start(db))
    return YearLicensesDetailOut(
        **_out(yl).model_dump(),
        can_edit=await PermissionService.can_edit_licenses(db, user, card.id),
    )


@router.put(
    "/cards/{card_id}/licenses/{fiscal_year}/items/{metric}/{key}",
    response_model=YearLicensesOut,
)
async def put_card_license_cell(
    card_id: str,
    body: LicenseCellWrite,
    fiscal_year: int = _FY,
    metric: str = _METRIC,
    key: str = _KEY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _write(
        db,
        user,
        card_id,
        fiscal_year,
        lambda cid: card_licenses.merge_cell(
            db, cid, fiscal_year, metric, key, licensed=body.licensed, actual=body.actual
        ),
    )


@router.delete("/cards/{card_id}/licenses/{fiscal_year}/items/{metric}/{key}", status_code=204)
async def delete_card_license_cell(
    card_id: str,
    fiscal_year: int = _FY,
    metric: str = _METRIC,
    key: str = _KEY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _write(
        db,
        user,
        card_id,
        fiscal_year,
        lambda cid: card_licenses.delete_cell(db, cid, fiscal_year, metric, key),
    )
    return Response(status_code=204)


@router.post("/cards/{card_id}/licenses/{fiscal_year}/confirm", response_model=YearLicensesOut)
async def confirm_card_license_year(
    card_id: str,
    fiscal_year: int = _FY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _write(
        db,
        user,
        card_id,
        fiscal_year,
        lambda cid: card_licenses.confirm_year(db, cid, fiscal_year),
    )


@router.post(
    "/cards/{card_id}/licenses/{fiscal_year}/items/{metric}/{key}/copy-to-forecast",
    response_model=YearLicensesOut,
)
async def copy_card_license_to_forecast(
    card_id: str,
    fiscal_year: int = _FY,
    metric: str = _METRIC,
    key: str = _KEY,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # The edit happens on the Forecast year, so that is the year the event diffs.
    forecast = current_fiscal_year(await get_fiscal_year_start(db)) + FISCAL_YEAR_LOOKAHEAD
    return await _write(
        db,
        user,
        card_id,
        forecast,
        lambda cid: card_licenses.copy_to_forecast(db, cid, fiscal_year, metric, key),
    )


@router.post("/licenses/import", response_model=ImportResultOut)
async def import_licenses(
    file: UploadFile,
    dry_run: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Excel import of license counts. ``dry_run`` (the default) reports and writes nothing;
    Apply re-sends the file and the server revalidates it. Needs the global ``licenses.edit``."""
    await PermissionService.require_permission(db, user, "licenses.edit")
    _, data = await read_validated_upload(file)
    await db.commit()  # the connection goes back to the pool before the parse
    try:
        rows = await run_in_threadpool(license_import.parse_workbook, data)
    except license_import.ImportFileError as e:
        raise HTTPException(400, str(e)) from e
    plan = await license_import.plan_import(db, user, rows)
    applied = 0
    if not dry_run:
        try:
            applied = await license_import.apply_import(db, user.id, plan)
        except LicenseError as e:  # the catalogue changed between the plan and the write
            await db.rollback()
            raise HTTPException(409, e.code) from e
        await db.commit()
    return ImportResultOut(
        matched=plan.matched,
        applied=applied,
        skipped=[ImportIssueOut(**vars(i)) for i in plan.skipped],
    )
