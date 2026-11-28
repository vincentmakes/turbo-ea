"""Monetisation guard: free core has NO path that sets ``cards.lifecycle_maintained``.

The claim that locks lifecycle phases is the pen a licensed extension holds
(``core.cards.maintain_lifecycle``). Core ships the column, the lock and the
rendering inert; the only writers are the data bridge's ``maintain_lifecycle``
/ ``release_lifecycle`` and the uninstall clean-up. This file pins that:

* every REST body (create, bulk create, update, bulk update), a workspace
  import and a content pack carrying the key leave the column NULL;
* the workspace exporter never carries it (it is an instance-local claim);
* the bridge calls are refused without the grant or with a lapsed entitlement;
* a static scan fails when a new module under ``app/`` writes the column.
"""

from __future__ import annotations

import ast
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.services.extensions import data_service as bridge_mod
from app.services.extensions.data_service import ExtensionData
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import ExtensionPermissionError
from tests.app_source import iter_py
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

KEY = "acme-sync"
GRANTS = ["core.cards.write", "core.cards.maintain_lifecycle"]
MARKER = {"ext": KEY, "phases": ["active"]}


def load(*, grants: list[str] = GRANTS, expires_in_days: int | None = None) -> None:
    now = datetime.now(timezone.utc)
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Acme Sync",
                version="1.0.0",
                status="installed",
                enabled=True,
                manifest={"grants": grants},
            )
        ]
    )
    expires = None if expires_in_days is None else now + timedelta(days=expires_in_days)
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=now - timedelta(days=60),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=expires)],
        )
    )


@pytest.fixture(autouse=True)
def _registry(monkeypatch):
    extension_registry.clear()
    bridge_mod.reset_rate_limiter()
    monkeypatch.setattr(extension_registry, "refresh_from_db", AsyncMock())
    yield
    extension_registry.clear()
    bridge_mod.reset_rate_limiter()


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="Application", label="Application")
    await db.commit()
    return {"admin": admin}


async def _marker_of(db, name: str):
    card = (await db.execute(select(Card).where(Card.name == name))).scalar_one()
    await db.refresh(card)
    return card.lifecycle_maintained


class TestRestBodies:
    async def test_create(self, client, db, env):
        load()
        resp = await client.post(
            "/api/v1/cards",
            headers=auth_headers(env["admin"]),
            json={"type": "Application", "name": "Created", "lifecycle_maintained": MARKER},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["lifecycle_maintained"] is None
        assert await _marker_of(db, "Created") is None

    async def test_bulk_create(self, client, db, env):
        load()
        resp = await client.post(
            "/api/v1/cards/bulk-create",
            headers=auth_headers(env["admin"]),
            json={
                "cards": [
                    {
                        "row_index": 0,
                        "type": "Application",
                        "name": "Bulk made",
                        "lifecycle_maintained": MARKER,
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert await _marker_of(db, "Bulk made") is None

    async def test_update_and_bulk_update(self, client, db, env):
        load()
        card = await create_card(db, name="Edited")
        await db.commit()
        headers = auth_headers(env["admin"])
        resp = await client.patch(
            f"/api/v1/cards/{card.id}",
            headers=headers,
            json={"description": "x", "lifecycle_maintained": MARKER},
        )
        assert resp.status_code == 200, resp.text
        resp = await client.patch(
            "/api/v1/cards/bulk",
            headers=headers,
            json={"ids": [str(card.id)], "updates": {"alias": "y", "lifecycle_maintained": MARKER}},
        )
        assert resp.status_code == 200, resp.text
        assert await _marker_of(db, "Edited") is None


class TestWorkspaceTransfer:
    async def test_the_exporter_does_not_carry_the_claim(self, db, env):
        from app.services.workspace_io import build_bundle, parse_bundle, schema
        from app.services.workspace_io import exporter as exp

        assert "lifecycle_maintained" not in exp.CARD_COLUMNS
        await create_card(db, name="Claimed", lifecycle_maintained=dict(MARKER))
        bundle = parse_bundle(await build_bundle(db))
        rows = bundle.sheets[schema.SHEET_CARDS]
        row = next(r for r in rows if r["name"] == "Claimed")
        assert "lifecycle_maintained" not in row
        assert not any("lifecycle_maintained" in r for r in rows)

    async def test_a_content_pack_row_cannot_plant_the_claim(self, db, env):
        from app.services.extensions.content_pack import apply_content

        load()
        sheets = {
            "Cards": [
                {
                    "type": "Application",
                    "name": "Packed",
                    "parent_path": "",
                    "lifecycle": {"active": "2020-01-01"},
                    "lifecycle_maintained": MARKER,
                }
            ]
        }
        result = await apply_content(db, sheets, env["admin"])
        assert result.total_failed == 0, result.as_dict()
        card = (await db.execute(select(Card).where(Card.name == "Packed"))).scalar_one()
        assert card.lifecycle == {"active": "2020-01-01"}
        assert card.lifecycle_maintained is None


@pytest.fixture
def _bridge_session(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)


@pytest.mark.usefixtures("_bridge_session")
class TestBridgeGating:
    async def test_refused_without_the_grant(self, db, env):
        load(grants=["core.cards.write"])
        card = await create_card(db, name="No grant")
        with pytest.raises(ExtensionPermissionError, match="core.cards.maintain_lifecycle"):
            await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        await db.refresh(card)
        assert card.lifecycle_maintained is None

    async def test_refused_with_a_lapsed_entitlement(self, db, env):
        load(expires_in_days=-40)
        card = await create_card(db, name="Lapsed")
        with pytest.raises(ExtensionPermissionError):
            await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        with pytest.raises(ExtensionPermissionError):
            await ExtensionData(KEY).release_lifecycle(str(card.id))
        await db.refresh(card)
        assert card.lifecycle_maintained is None

    async def test_allowed_while_licensed_with_the_grant(self, db, env):
        load(expires_in_days=-5)  # grace still counts
        card = await create_card(db, name="Granted")
        out = await ExtensionData(KEY).maintain_lifecycle(str(card.id), {"active": "2020-01-01"})
        assert out.lifecycle_maintained == MARKER


# ---------------------------------------------------------------------------
# Static scan: who may WRITE the column
# ---------------------------------------------------------------------------

#: Modules under ``app/`` that may write ``lifecycle_maintained``, with why.
WRITERS_OK: dict[str, str] = {
    "services/extensions/data_service.py": (
        "the bridge's maintain_lifecycle / release_lifecycle build the update payload "
        "update_card applies with lifecycle_maintainer set"
    ),
    "services/extensions/lifecycle_gate.py": (
        "release_extension_claims clears an uninstalled extension's markers"
    ),
}

FIELD = "lifecycle_maintained"


def _writes(tree: ast.AST) -> list[int]:
    """Lines that write the column: an attribute or subscript assignment, a
    dict literal key, or a ``Card(...)`` keyword."""
    lines: list[int] = []
    for node in ast.walk(tree):
        targets: list[ast.AST] = []
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        for target in targets:
            if isinstance(target, ast.Attribute) and target.attr == FIELD:
                lines.append(node.lineno)
            if (
                isinstance(target, ast.Subscript)
                and isinstance(target.slice, ast.Constant)
                and target.slice.value == FIELD
            ):
                lines.append(node.lineno)
        if isinstance(node, ast.Dict):
            for key in node.keys:
                if isinstance(key, ast.Constant) and key.value == FIELD:
                    lines.append(node.lineno)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "Card"
            and any(kw.arg == FIELD for kw in node.keywords)
        ):
            lines.append(node.lineno)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "setattr"
            and len(node.args) >= 2
            and isinstance(node.args[1], ast.Constant)
            and node.args[1].value == FIELD
        ):
            lines.append(node.lineno)
    return sorted(lines)


@pytest.mark.source_scan
def test_only_allow_listed_modules_write_the_claim():
    offenders = {
        path: lines
        for path, source in iter_py().items()
        if path not in WRITERS_OK and (lines := _writes(ast.parse(source)))
    }
    assert offenders == {}, (
        "cards.lifecycle_maintained is the licensed extension's pen: only the data "
        f"bridge and the uninstall clean-up may write it. New writers: {offenders}"
    )


@pytest.mark.source_scan
def test_every_allow_listed_module_still_writes_it():
    # A stale entry would let a future write slip into that module unseen.
    sources = iter_py()
    for path in WRITERS_OK:
        assert _writes(ast.parse(sources[path])), path


def test_the_scan_sees_each_write_shape():
    source = (
        "card.lifecycle_maintained = None\n"
        "updates['lifecycle_maintained'] = m\n"
        "x = {'lifecycle_maintained': m}\n"
        "Card(name='n', lifecycle_maintained=m)\n"
        "setattr(card, 'lifecycle_maintained', m)\n"
        "y = card.lifecycle_maintained\n"
        "CardResponse(lifecycle_maintained=m)\n"
    )
    assert _writes(ast.parse(source)) == [1, 2, 3, 4, 5]
