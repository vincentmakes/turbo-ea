"""``GET /extensions/agent-tools`` — the operations installed extensions offer to
AI assistants through the MCP server (SDK 1.18).

Listed only while the extension is enabled, licensed and declares the
``core.agent.tools`` grant, and then only the tools whose permission the caller
holds. Declarations core cannot vouch for (configuration, the extension's admin
permission, a route that does not exist, a bare-dict body without a schema, a
duplicate name, a file download) never reach the catalogue. Fake extension key,
real router, in-memory registry seam.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import APIRouter
from pydantic import BaseModel

from app.core import permissions as perm_registry
from app.services.extensions import agent_tools
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import AgentTool
from tests.conftest import auth_headers, create_role, create_user

KEY = "sample-ext"
URL = "/api/v1/extensions/agent-tools"
VIEW = f"ext.{KEY}.view"
MANAGE = f"ext.{KEY}.manage"
ADMIN = f"ext.{KEY}.admin"


class ScenarioIn(BaseModel):
    name: str
    description: str | None = None
    dry_run: bool = False


def build_router() -> APIRouter:
    router = APIRouter()

    @router.get("/scenarios")
    async def list_scenarios(limit: int = 50):
        return []

    @router.post("/scenarios")
    async def create_scenario(body: ScenarioIn):
        return {}

    @router.post("/assessments")
    async def create_assessment(body: dict):
        return {}

    @router.get("/settings")
    async def get_settings():
        return {}

    @router.get("/export.xlsx")
    async def export():
        return b""

    return router


def tool(**overrides) -> AgentTool:
    values = dict(
        name="list_scenarios",
        title="List scenarios",
        description="Lists the scenarios.",
        method="GET",
        path="/scenarios",
        permission=VIEW,
        kind="read",
    )
    values.update(overrides)
    return AgentTool(**values)


DECLARED = [
    tool(),
    tool(
        name="create_scenario",
        title="Create a scenario",
        description="Creates a draft scenario.",
        method="POST",
        permission=MANAGE,
        kind="write",
        supports_dry_run=True,
    ),
    # Every one of these is dropped at registration.
    tool(name="read_settings", path="/settings"),
    tool(name="admin_list", permission=ADMIN),
    tool(name="missing", path="/nowhere"),
    tool(
        name="create_assessment",
        method="POST",
        path="/assessments",
        permission=MANAGE,
        kind="write",
    ),
    tool(title="Duplicate"),
    tool(name="export", path="/export.xlsx"),
    tool(name="core_admin", permission="admin.metamodel"),
]


class SampleExtension:
    def get_agent_tools(self):
        return DECLARED


def install(
    *, enabled=True, status="installed", licensed=True, grants=(agent_tools.GRANT,)
) -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Extension",
                version="1.4.0",
                status=status,
                enabled=enabled,
                manifest={"grants": list(grants)},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=datetime.now(timezone.utc) - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)] if licensed else [],
        )
    )


@pytest.fixture(autouse=True)
def _registry(monkeypatch):
    extension_registry.clear()
    agent_tools.reset_tools()
    # The route reloads the registry from the database; keep the in-memory one.
    monkeypatch.setattr(extension_registry, "refresh_from_db", AsyncMock())
    monkeypatch.setattr(
        perm_registry,
        "ALL_APP_PERMISSION_KEYS",
        set(perm_registry.ALL_APP_PERMISSION_KEYS) | {VIEW, MANAGE, ADMIN},
    )
    agent_tools.register_extension_tools(
        KEY, {"grants": [agent_tools.GRANT]}, SampleExtension(), build_router()
    )
    yield
    extension_registry.clear()
    agent_tools.reset_tools()


@pytest.fixture
async def users(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={VIEW: True})
    await create_role(db, key="nobody", label="Nobody", permissions={"inventory.view": True})
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    nobody = await create_user(db, email="nobody@test.com", role="nobody")
    await db.commit()
    return {"admin": admin, "viewer": viewer, "nobody": nobody}


async def _get(client, user):
    resp = await client.get(URL, headers=auth_headers(user))
    assert resp.status_code == 200
    return resp.json()


class TestCatalogue:
    async def test_lists_only_the_valid_declarations(self, client, users):
        install()
        body = await _get(client, users["admin"])
        assert [(e["key"], e["name"], e["version"]) for e in body["extensions"]] == [
            (KEY, "Sample Extension", "1.4.0")
        ]
        tools = body["extensions"][0]["tools"]
        assert [t["name"] for t in tools] == ["list_scenarios", "create_scenario"]
        assert tools[0] == {
            "name": "list_scenarios",
            "title": "List scenarios",
            "description": "Lists the scenarios.",
            "kind": "read",
            "method": "GET",
            "path": "/scenarios",
            "path_params": [],
            "query_params": [],
            "input_schema": {
                "type": "object",
                "properties": {"limit": {"type": "integer"}},
            },
            "supports_dry_run": False,
        }

    async def test_the_schema_is_derived_from_the_pydantic_body(self, client, users):
        install()
        body = await _get(client, users["admin"])
        create = body["extensions"][0]["tools"][1]
        assert create["kind"] == "write"
        assert create["method"] == "POST"
        assert create["supports_dry_run"] is True
        assert create["input_schema"]["required"] == ["name"]
        assert set(create["input_schema"]["properties"]) == {"name", "description", "dry_run"}

    async def test_a_tool_is_hidden_without_its_permission(self, client, users):
        install()
        body = await _get(client, users["viewer"])
        assert [t["name"] for t in body["extensions"][0]["tools"]] == ["list_scenarios"]

    async def test_an_extension_with_no_visible_tool_is_omitted(self, client, users):
        install()
        assert await _get(client, users["nobody"]) == {"extensions": []}

    @pytest.mark.parametrize(
        "state",
        [
            {"licensed": False},
            {"enabled": False, "status": "disabled"},
            {"status": "failed"},
            {"status": "needs_restart"},
            {"grants": ("core.cards.read",)},
        ],
        ids=["unlicensed", "disabled", "failed", "needs_restart", "ungranted"],
    )
    async def test_hidden_unless_live(self, client, users, state):
        install(**state)
        assert await _get(client, users["admin"]) == {"extensions": []}

    async def test_not_installed(self, client, users):
        extension_registry.clear()
        assert await _get(client, users["admin"]) == {"extensions": []}

    async def test_requires_authentication(self, client):
        install()
        resp = await client.get(URL)
        assert resp.status_code == 401
