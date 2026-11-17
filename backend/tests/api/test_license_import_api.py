"""POST /licenses/import: gate, dry run vs apply, and the upload checks."""

from __future__ import annotations

import io
import zipfile

import openpyxl
import pytest
from sqlalchemy import select, update

from app.models.card_license import CardLicense
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.services.fiscal_year import current_fiscal_year
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_license_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

CUR = current_fiscal_year(1)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def book(rows) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Component", "Metric", "License type", "Year", "Licensed", "Actual"])
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


GOOD = [["ERP", "users", "admin", CUR, 10, 4], ["Ghost", "users", "admin", CUR, 1, 1]]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", permissions={"*": True})
    await create_role(
        db, key="member", label="M", permissions={"inventory.view": True, "licenses.view": True}
    )
    await create_role(
        db, key="editor", label="E", permissions={"inventory.view": True, "licenses.edit": True}
    )
    await create_card_type(db, key="Application", label="Application")
    await create_license_type(db, "admin", "Admin")
    await create_stakeholder_role_def(
        db, key="responsible", label="R", permissions={"card.view": True, "card.edit": True}
    )
    card = await create_card(
        db, card_type="Application", name="ERP", attributes={"licensingModel": ["users"]}
    )
    users = {
        "admin": await create_user(db, email="a@lic-imp-api.com", role="admin"),
        "member": await create_user(db, email="m@lic-imp-api.com", role="member"),
        "editor": await create_user(db, email="e@lic-imp-api.com", role="editor"),
    }
    return {**users, "card": card}


async def _post(client, env, content, user="admin", name="f.xlsx", dry_run=True):
    return await client.post(
        "/api/v1/licenses/import",
        params={"dry_run": str(dry_run).lower()},
        files={"file": (name, content, XLSX)},
        headers=auth_headers(env[user]),
    )


async def _rows(db):
    return (await db.execute(select(CardLicense))).scalars().all()


async def test_requires_licenses_edit(client, db, env):
    assert (await _post(client, env, book(GOOD), "member")).status_code == 403
    assert (await _post(client, env, book(GOOD), "editor")).status_code == 200


async def test_stakeholder_editor_still_403(client, db, env):
    db.add(Stakeholder(card_id=env["card"].id, user_id=env["member"].id, role="responsible"))
    await db.flush()
    assert (await _post(client, env, book(GOOD), "member")).status_code == 403
    assert (await _post(client, env, book(GOOD), "member", dry_run=False)).status_code == 403
    assert await _rows(db) == []


async def test_dry_run_writes_nothing(client, db, env):
    body = (await _post(client, env, book(GOOD))).json()
    assert body["matched"] == 1 and body["applied"] == 0
    assert [(s["row"], s["reason"]) for s in body["skipped"]] == [(3, "card_not_found")]
    assert "flagged" not in body
    assert await _rows(db) == []


async def test_apply_writes_and_returns_counts(client, db, env):
    body = (await _post(client, env, book(GOOD), dry_run=False)).json()
    assert body["matched"] == 1 and body["applied"] == 1
    [row] = await _rows(db)
    assert row.items == {"users": {"admin": {"licensed": 10, "actual": 4}}}


async def test_apply_is_the_default_off(client, db, env):
    resp = await client.post(
        "/api/v1/licenses/import",
        files={"file": ("f.xlsx", book(GOOD), XLSX)},
        headers=auth_headers(env["admin"]),
    )
    assert resp.status_code == 200 and resp.json()["applied"] == 0 and await _rows(db) == []


async def test_wrong_extension_and_wrong_headers_refused(client, db, env):
    assert (await _post(client, env, book(GOOD), name="f.csv")).status_code == 400
    bad = openpyxl.Workbook()
    bad.active.append(["a", "b"])
    buf = io.BytesIO()
    bad.save(buf)
    assert (await _post(client, env, buf.getvalue())).status_code == 400


async def test_renamed_executable_refused_400(client, db, env):
    assert (await _post(client, env, b"MZ\x90\x00" + b"\0" * 100)).status_code == 400


async def test_over_20mb_refused_400(client, db, env):
    resp = await _post(client, env, b"PK\x03\x04" + b"\0" * (21 * 1024 * 1024))
    assert resp.status_code == 400


async def test_zip_bomb_refused_400(client, db, env):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/worksheets/sheet1.xml", b"\0" * (60 * 1024 * 1024))
    resp = await _post(client, env, buf.getvalue())
    assert resp.status_code == 400 and "limit" in resp.json()["detail"]


async def test_hidden_card_reads_as_not_found(client, db, env):
    await db.execute(
        update(CardType)
        .where(CardType.key == "Application")
        .values(role_permissions={"editor": {"inventory.view": False}})
    )
    await db.flush()
    body = (await _post(client, env, book(GOOD), "editor", dry_run=False)).json()
    assert body["matched"] == 0 and body["applied"] == 0
    assert {s["reason"] for s in body["skipped"]} == {"card_not_found"}
    assert await _rows(db) == []
