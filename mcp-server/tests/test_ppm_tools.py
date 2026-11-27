"""The PPM tools (discussion 1457): four reads and six writes over the PPM
REST routes, each called with the user's token.

The backend here is a recorder: it answers the module switch, the PPM reads
and the batch open / close, records every call in order, and answers each
PPM write from ``writes`` (a value, or an exception).
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from turbo_ea_mcp import server

_PUBLIC = "https://ea.example.com"
INI = "00000000-0000-4000-8000-0000000000f1"
OTHER = "00000000-0000-4000-8000-0000000000f2"
W1 = "00000000-0000-4000-8000-00000000a001"
W2 = "00000000-0000-4000-8000-00000000a002"
MS = "00000000-0000-4000-8000-00000000a0ff"
T1 = "00000000-0000-4000-8000-00000000b001"
T2 = "00000000-0000-4000-8000-00000000b002"
D1 = "00000000-0000-4000-8000-00000000d001"
R1 = "00000000-0000-4000-8000-00000000e001"
P1 = "00000000-0000-4000-8000-00000000c001"
USER = "00000000-0000-4000-8000-000000000999"
NEW = "00000000-0000-4000-8000-00000000aaaa"

BASE = f"/ppm/initiatives/{INI}"
ENABLED = "/settings/ppm-enabled"
OPEN = "/mutation-batches?row_count={}"
CLOSE = "/mutation-batches/B-1/commit"

_WBS = [
    {
        "id": W1,
        "initiative_id": INI,
        "parent_id": None,
        "title": "Design",
        "description": None,
        "start_date": "2026-01-01",
        "end_date": "2026-02-01",
        "sort_order": 0,
        "is_milestone": False,
        "completion": 50.0,
        "assignee_id": None,
        "assignee_name": None,
        "progress": 50.0,
        "task_count": 2,
        "created_at": "x",
        "updated_at": "x",
    },
    {"id": W2, "title": "Build", "parent_id": W1, "is_milestone": False},
    {"id": MS, "title": "Go-live", "is_milestone": True, "start_date": "2026-06-01"},
]
_TASKS = [
    {
        "id": T1,
        "initiative_id": INI,
        "title": "Draw",
        "description": "d",
        "status": "done",
        "priority": "high",
        "assignee_id": None,
        "assignee_name": None,
        "start_date": None,
        "due_date": "2026-01-10",
        "sort_order": 0,
        "tags": [],
        "wbs_id": W1,
        "comment_count": 1,
        "created_at": "x",
        "updated_at": "x",
    },
    {"id": T2, "title": "Code", "status": "todo", "wbs_id": W2},
]
_DEPS = [
    {
        "id": D1,
        "initiative_id": INI,
        "pred_kind": "wbs",
        "pred_id": W1,
        "succ_kind": "task",
        "succ_id": T2,
        "kind": "FS",
        "created_at": "x",
    }
]
_REPORTS = [
    {"id": P1, "report_date": "2026-01-01", "schedule_health": "onTrack", "initiative_id": INI},
    {"id": "p2", "report_date": "2026-03-01", "schedule_health": "atRisk"},
    {"id": "p3", "report_date": "2026-02-01", "schedule_health": "offTrack"},
]
_RISKS = [
    {"id": R1, "title": "Vendor", "probability": 2, "impact": 2, "risk_score": 4},
    {"id": "r2", "title": "Budget", "probability": 5, "impact": 5, "risk_score": 25},
]


def _http_error(status: int, detail: object = None, method: str = "POST", path: str = "/x"):
    req = httpx.Request(method, "http://backend" + path)
    resp = httpx.Response(
        status, json={"detail": detail} if detail is not None else None, request=req
    )
    return httpx.HTTPStatusError(f"{status}", request=req, response=resp)


def _reads(**extra) -> dict:
    return {
        ENABLED: {"enabled": True},
        f"{BASE}/wbs": _WBS,
        f"{BASE}/tasks": _TASKS,
        f"{BASE}/dependencies": _DEPS,
        f"{BASE}/completion": {"completion": 42.5, "wbs_count": 3},
        f"{BASE}/reports": _REPORTS,
        f"{BASE}/risks": _RISKS,
        f"/ppm/tasks/{T1}/comments": [
            {"id": "c2", "user_display_name": "B", "content": "later", "created_at": "2026-02"},
            {
                "id": "c1",
                "user_display_name": "A",
                "content": "first",
                "created_at": "2026-01",
                "task_id": T1,
            },
        ],
        **extra,
    }


class _Backend:
    def __init__(self, reads: dict | None = None, writes: dict | None = None):
        self.reads = _reads() if reads is None else reads
        self.writes = writes or {}
        self.calls: list[tuple[str, str, object]] = []
        self.tokens: list[object] = []
        self.created = 0

    async def get(self, path, params=None):
        self.calls.append(("get", path, params))
        answer = self.reads[path]
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def _write(self, method, path, body):
        self.calls.append((method, path, body))
        if path == CLOSE:
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (body or {}).get("dry_run")}
        answer = self.writes.get((method, path))
        if isinstance(answer, list):
            answer = answer.pop(0)
        if isinstance(answer, Exception):
            raise answer
        if answer is not None:
            return answer
        if method == "delete":
            return {}
        if method == "post":
            self.created += 1
            return {
                "id": f"00000000-0000-4000-8000-{self.created:012d}",
                **(body or {}),
                "initiative_id": INI,
            }
        return {"id": path.rsplit("/", 1)[1], **(body or {})}

    async def post(self, path, json=None):
        return await self._write("post", path, json)

    async def patch(self, path, json=None):
        return await self._write("patch", path, json)

    async def delete(self, path):
        return await self._write("delete", path, None)

    def ppm_writes(self):
        return [(m, p, b) for m, p, b in self.calls if m != "get" and not p.startswith("/mutation")]

    def batch_calls(self):
        return [(m, p, b) for m, p, b in self.calls if p.startswith("/mutation")]

    def _as(self, answer):
        """``answer`` called as a method: ``autospec`` hands in the client,
        whose token is recorded beside the call."""

        async def method(client, *args, **kwargs):
            self.tokens.append(client._token)
            return await answer(*args, **kwargs)

        return method

    async def run(self, coro_fn):
        with (
            patch.object(
                server.TurboEAClient, "get", autospec=True, side_effect=self._as(self.get)
            ),
            patch.object(
                server.TurboEAClient, "post", autospec=True, side_effect=self._as(self.post)
            ),
            patch.object(
                server.TurboEAClient, "patch", autospec=True, side_effect=self._as(self.patch)
            ),
            patch.object(
                server.TurboEAClient, "delete", autospec=True, side_effect=self._as(self.delete)
            ),
        ):
            return json.loads(await coro_fn())


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")


@pytest.fixture(autouse=True)
def public_url(monkeypatch):
    monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", _PUBLIC + "/")


def _link(tab: str, initiative: str = INI) -> str:
    return f"{_PUBLIC}/ppm/{initiative}?tab={tab}"


_PREVIEW_NOTE = (
    "Preview built by the MCP server: the PPM routes have no dry run, so the "
    "initiative's current rows were read and nothing was changed. The backend "
    "still checks every row on commit. Call again with dry_run=False to save."
)
_NO_ROLLBACK = (
    "Ask the user to check the result in the web app. rollback_batch cannot "
    "undo a PPM write: call the tool again with the old values, or delete a "
    "row in the web app."
)

# Every tool, called with arguments it accepts.
_CALLS = {
    "get_ppm_plan": lambda: server.get_ppm_plan(initiative_id=INI),
    "list_ppm_status_reports": lambda: server.list_ppm_status_reports(initiative_id=INI),
    "list_ppm_risks": lambda: server.list_ppm_risks(initiative_id=INI),
    "get_ppm_task_comments": lambda: server.get_ppm_task_comments(task_id=T1),
    "save_ppm_work_packages": lambda: server.save_ppm_work_packages(
        initiative_id=INI, items=[{"title": "x"}]
    ),
    "save_ppm_tasks": lambda: server.save_ppm_tasks(initiative_id=INI, items=[{"title": "x"}]),
    "save_ppm_status_reports": lambda: server.save_ppm_status_reports(
        initiative_id=INI, items=[{"report_date": "2026-01-01"}]
    ),
    "save_ppm_risks": lambda: server.save_ppm_risks(initiative_id=INI, items=[{"title": "x"}]),
    "add_ppm_task_comment": lambda: server.add_ppm_task_comment(task_id=T1, content="hi"),
    "set_ppm_dependencies": lambda: server.set_ppm_dependencies(
        initiative_id=INI,
        add=[{"pred_kind": "task", "pred_id": T1, "succ_kind": "task", "succ_id": T2}],
    ),
}
_READS = ["get_ppm_plan", "list_ppm_status_reports", "list_ppm_risks", "get_ppm_task_comments"]
_WRITES = [name for name in _CALLS if name not in _READS]


# ── Shared behaviour ────────────────────────────────────────────────────────


class TestShared:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", list(_CALLS))
    async def test_not_authenticated(self, monkeypatch, tool):
        monkeypatch.setattr(server, "_stdio_token", None)
        backend = _Backend()
        with patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=backend.get)):
            assert await _CALLS[tool]() == "Error: Not authenticated. Please reconnect."
        assert backend.calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", list(_CALLS))
    async def test_the_module_switched_off_refuses_everything(self, fake_token, tool):
        backend = _Backend(reads={ENABLED: {"enabled": False}})
        data = await backend.run(_CALLS[tool])
        assert data["error"] == "ppm_disabled"
        assert backend.calls == [("get", ENABLED, None)]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", _WRITES)
    async def test_writes_disabled(self, fake_token, monkeypatch, tool):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _Backend()
        data = await backend.run(_CALLS[tool])
        assert data["error"] == "writes_disabled"
        assert backend.calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "tool, call",
        [
            ("get_ppm_plan", lambda: server.get_ppm_plan(initiative_id="../cards")),
            ("list_ppm_risks", lambda: server.list_ppm_risks(initiative_id="x")),
            (
                "list_ppm_status_reports",
                lambda: server.list_ppm_status_reports(initiative_id="x"),
            ),
            (
                "save_ppm_work_packages",
                lambda: server.save_ppm_work_packages(initiative_id="", items=[{"title": "t"}]),
            ),
            (
                "get_ppm_task_comments",
                lambda: server.get_ppm_task_comments(task_id=f"{T1}/../../cards"),
            ),
            (
                "save_ppm_tasks",
                lambda: server.save_ppm_tasks(initiative_id="I-1", items=[{"title": "t"}]),
            ),
            (
                "add_ppm_task_comment",
                lambda: server.add_ppm_task_comment(task_id="t", content="c"),
            ),
            (
                "set_ppm_dependencies",
                lambda: server.set_ppm_dependencies(initiative_id="i", remove=[D1]),
            ),
        ],
    )
    async def test_an_id_that_is_not_a_uuid_reaches_no_path(self, fake_token, tool, call):
        backend = _Backend()
        data = await backend.run(call)
        assert data["error"] == "invalid_id"
        assert backend.calls == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", list(_CALLS))
    @pytest.mark.parametrize("status", [403, 404])
    async def test_a_refused_read_is_a_structured_answer(self, fake_token, tool, status):
        reads = {
            path: (_http_error(status, "Initiative not found") if path != ENABLED else answer)
            for path, answer in _reads().items()
        }
        backend = _Backend(reads=reads)
        data = await backend.run(_CALLS[tool])
        assert data["error"] == "ppm_unavailable"
        assert data["status_code"] == status
        assert data["detail"] == "Initiative not found"
        assert backend.batch_calls() == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", list(_CALLS))
    @pytest.mark.parametrize("status", [403, 404])
    async def test_a_refused_read_names_what_was_asked_for(self, fake_token, tool, status):
        """The whole refusal: the comment tools name the task, every other
        tool the initiative."""
        reads = {
            path: (_http_error(status, "Initiative not found") if path != ENABLED else answer)
            for path, answer in _reads().items()
        }
        backend = _Backend(reads=reads)
        data = await backend.run(_CALLS[tool])
        context = {"task_id": T1} if "comment" in tool else {"initiative_id": INI}
        assert data == {
            "error": "ppm_unavailable",
            "status_code": status,
            "detail": "Initiative not found",
            **context,
        }

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool", list(_CALLS))
    async def test_a_server_error_is_raised(self, fake_token, tool):
        reads = {path: _http_error(500) for path in _reads()}
        reads[ENABLED] = {"enabled": True}
        backend = _Backend(reads=reads)
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_CALLS[tool])

    @pytest.mark.parametrize("tool", _READS)
    def test_reads_are_read_only(self, tool):
        assert server.mcp._tool_manager._tools[tool].annotations == server._READ_ANNOT

    @pytest.mark.parametrize("tool", [t for t in _WRITES if t != "set_ppm_dependencies"])
    def test_writes_are_additive(self, tool):
        assert server.mcp._tool_manager._tools[tool].annotations == server._WRITE_ADDITIVE_ANNOT

    def test_set_ppm_dependencies_is_destructive(self):
        tool = server.mcp._tool_manager._tools["set_ppm_dependencies"]
        assert tool.annotations == server._WRITE_DESTRUCTIVE_ANNOT

    @pytest.mark.parametrize("tool", _WRITES)
    def test_every_write_docstring_states_the_rules(self, tool):
        doc = " ".join(server.mcp._tool_manager._tools[tool].description.split())
        assert "Dry-run by default" in doc
        assert "not verified by the backend" in doc
        assert "``ppm.manage``" in doc
        assert "``rollback_batch`` cannot undo it" in doc

    def test_the_instructions_carry_the_ppm_paragraph(self):
        text = " ".join(server.mcp.instructions.split())
        assert (
            "Read it with get_ppm_plan before changing it, and pass the ids it returns. "
            "Save work packages (save_ppm_work_packages) before the tasks that sit in them "
            "(save_ppm_tasks); milestones are work packages with is_milestone."
        ) in text
        assert (
            "Work packages, tasks, reports and risks are deleted in the web app only; "
            "a dependency link can be removed with set_ppm_dependencies."
        ) in text


# ── Reads ───────────────────────────────────────────────────────────────────


class TestReads:
    @pytest.mark.asyncio
    async def test_get_ppm_plan(self, fake_token):
        backend = _Backend()
        data = await backend.run(_CALLS["get_ppm_plan"])
        assert [(m, p) for m, p, _ in backend.calls] == [
            ("get", ENABLED),
            ("get", f"{BASE}/wbs"),
            ("get", f"{BASE}/tasks"),
            ("get", f"{BASE}/dependencies"),
            ("get", f"{BASE}/completion"),
        ]
        assert data["initiative_id"] == INI
        assert data["completion"] == 42.5
        assert data["counts"] == {"work_packages": 2, "milestones": 1, "tasks": 2, "tasks_done": 1}
        assert data["work_packages"][0] == {
            key: _WBS[0][key] for key in server._ppm.WORK_PACKAGE_KEYS
        }
        assert "initiative_id" not in data["tasks"][0]
        assert "created_at" not in data["tasks"][0]
        assert data["tasks"][1]["wbs_id"] == W2
        assert data["dependencies"] == [
            {
                "id": D1,
                "pred_kind": "wbs",
                "pred_id": W1,
                "succ_kind": "task",
                "succ_id": T2,
                "kind": "FS",
                "pred_title": "Design",
                "succ_title": "Code",
            }
        ]
        assert data["gantt_url"] == _link("gantt")
        assert data["tasks_url"] == _link("tasks")

    @pytest.mark.asyncio
    async def test_get_ppm_plan_canonicalises_the_id(self, fake_token):
        backend = _Backend()
        data = await backend.run(lambda: server.get_ppm_plan(initiative_id=INI.upper()))
        assert data["initiative_id"] == INI
        assert backend.calls[1][1] == f"{BASE}/wbs"

    @pytest.mark.asyncio
    async def test_get_ppm_plan_tolerates_an_odd_completion(self, fake_token):
        backend = _Backend(reads=_reads(**{f"{BASE}/completion": []}))
        data = await backend.run(_CALLS["get_ppm_plan"])
        assert data["completion"] is None

    @pytest.mark.asyncio
    async def test_list_ppm_status_reports_newest_first(self, fake_token):
        backend = _Backend()
        data = await backend.run(lambda: server.list_ppm_status_reports(initiative_id=INI, limit=2))
        assert [(m, p) for m, p, _ in backend.calls] == [
            ("get", ENABLED),
            ("get", f"{BASE}/reports"),
        ]
        assert data["total"] == 3
        assert data["returned"] == 2
        assert [r["id"] for r in data["reports"]] == ["p2", "p3"]
        assert "initiative_id" not in data["reports"][0]
        assert data["url"] == _link("reports")

    @pytest.mark.asyncio
    @pytest.mark.parametrize("limit, returned", [(0, 1), (500, 3), (10, 3)])
    async def test_list_ppm_status_reports_clamps_the_limit(self, fake_token, limit, returned):
        backend = _Backend()
        data = await backend.run(
            lambda: server.list_ppm_status_reports(initiative_id=INI, limit=limit)
        )
        assert data["returned"] == returned

    @pytest.mark.asyncio
    async def test_list_ppm_risks_highest_score_first(self, fake_token):
        backend = _Backend()
        data = await backend.run(_CALLS["list_ppm_risks"])
        assert [(m, p) for m, p, _ in backend.calls] == [("get", ENABLED), ("get", f"{BASE}/risks")]
        assert data == {
            "initiative_id": INI,
            "total": 2,
            "risks": [
                {key: _RISKS[1].get(key) for key in server._ppm.RISK_KEYS},
                {key: _RISKS[0].get(key) for key in server._ppm.RISK_KEYS},
            ],
            "url": _link("risks"),
        }

    @pytest.mark.asyncio
    async def test_get_ppm_task_comments_oldest_first(self, fake_token):
        backend = _Backend()
        data = await backend.run(_CALLS["get_ppm_task_comments"])
        assert [(m, p) for m, p, _ in backend.calls] == [
            ("get", ENABLED),
            ("get", f"/ppm/tasks/{T1}/comments"),
        ]
        assert data["task_id"] == T1
        assert data["total"] == 2
        assert [c["id"] for c in data["comments"]] == ["c1", "c2"]
        assert "task_id" not in data["comments"][0]


# ── Save tools ──────────────────────────────────────────────────────────────


def _wbs(items, dry_run=True, **kw):
    return lambda: server.save_ppm_work_packages(
        initiative_id=INI, items=items, dry_run=dry_run, **kw
    )


def _tasks(items, dry_run=True, **kw):
    return lambda: server.save_ppm_tasks(initiative_id=INI, items=items, dry_run=dry_run, **kw)


class TestSaveRows:
    @pytest.mark.asyncio
    async def test_a_preview_reads_first_writes_nothing_and_shows_old_to_new(self, fake_token):
        backend = _Backend()
        items = [
            {"title": "Test", "wbs_id": W2, "priority": "low"},
            {"id": T1, "title": "Draw v2", "status": "done", "description": None},
            {"id": T2, "status": "todo"},
        ]
        data = await backend.run(_tasks(items))
        assert backend.calls[:3] == [
            ("get", ENABLED, None),
            ("get", f"{BASE}/tasks", None),
            ("get", f"{BASE}/wbs", None),
        ]
        assert backend.ppm_writes() == []
        assert backend.batch_calls() == [
            ("post", OPEN.format(3), {"tool_name": "save_ppm_tasks", "dry_run": True}),
            ("post", CLOSE, {"summary": {"rows": 3, "status": "previewed"}}),
        ]
        assert data == {
            "dry_run": True,
            "initiative_id": INI,
            "would_save": [
                {
                    "index": 0,
                    "action": "create",
                    "fields": {"title": "Test", "wbs_id": W2, "priority": "low"},
                },
                {
                    "index": 1,
                    "id": T1,
                    "title": "Draw",
                    "action": "update",
                    "changes": {
                        "title": {"old": "Draw", "new": "Draw v2"},
                        "description": {"old": "d", "new": None},
                    },
                },
                {"index": 2, "id": T2, "title": "Code", "action": "unchanged"},
            ],
            "counts": {"create": 1, "update": 1, "unchanged": 1},
            "note": _PREVIEW_NOTE,
            "verified": False,
            "url": _link("tasks"),
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_commit_sends_creates_and_changed_keys_in_order(self, fake_token):
        backend = _Backend()
        items = [
            {"title": "Test", "wbs_id": W2},
            {"id": T1, "title": "Draw v2", "status": "done", "wbs_id": ""},
            {"id": T2, "status": "todo"},
        ]
        data = await backend.run(_tasks(items, dry_run=False))
        assert backend.ppm_writes() == [
            ("post", f"{BASE}/tasks", {"title": "Test", "wbs_id": W2}),
            ("patch", f"/ppm/tasks/{T1}", {"title": "Draw v2", "wbs_id": None}),
        ]
        assert backend.batch_calls()[0] == (
            "post",
            OPEN.format(3),
            {"tool_name": "save_ppm_tasks", "dry_run": False},
        )
        assert backend.batch_calls()[-1] == (
            "post",
            CLOSE,
            {"summary": {"rows": 3, "create": 1, "update": 1, "unchanged": 1}},
        )
        assert backend.calls[-1][1] == CLOSE
        assert data["dry_run"] is False
        assert data["batch_id"] == "B-1"
        assert data["unchanged"] == [2]
        assert data["url"] == _link("tasks")
        assert data["next_action"] == _NO_ROLLBACK
        assert [(s["index"], s["action"], s["title"]) for s in data["saved"]] == [
            (0, "create", "Test"),
            (1, "update", "Draw v2"),
        ]
        assert "initiative_id" not in data["saved"][0]

    @pytest.mark.asyncio
    async def test_validation_errors_make_no_call(self, fake_token):
        backend = _Backend()
        data = await backend.run(
            _tasks([{"title": "a", "status": "doing"}, {"title": "b", "budget": 3}])
        )
        assert data["error"] == "invalid_items"
        assert [(e["error"], e["index"]) for e in data["errors"]] == [
            ("invalid_value", 0),
            ("unknown_field", 1),
        ]
        assert data["message"] == "Nothing was saved. Fix the items listed and call again."
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_an_id_of_another_initiative_refuses_the_call(self, fake_token):
        backend = _Backend()
        stranger = "00000000-0000-4000-8000-00000000b0ff"
        data = await backend.run(_tasks([{"title": "a"}, {"id": stranger, "title": "b"}], False))
        assert data["error"] == "unknown_id"
        assert data["errors"][0]["id"] == stranger
        assert data["errors"][0]["index"] == 1
        assert backend.batch_calls() == []
        assert backend.ppm_writes() == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "wbs_id, error",
        [(MS, "invalid_value"), ("00000000-0000-4000-8000-00000000a0aa", "unknown_ref")],
    )
    async def test_a_task_in_a_milestone_or_a_foreign_package(self, fake_token, wbs_id, error):
        backend = _Backend()
        data = await backend.run(_tasks([{"title": "a", "wbs_id": wbs_id}]))
        assert data["error"] == "invalid_items"
        assert data["errors"][0]["error"] == error
        assert backend.batch_calls() == []

    @pytest.mark.asyncio
    async def test_the_cap(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_PPM_ROWS_PER_CALL", 2)
        backend = _Backend()
        data = await backend.run(_tasks([{"title": "a"}] * 3))
        assert data["error"] == "batch_too_large"
        assert (data["cap"], data["received"]) == (2, 3)
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_at_the_cap_is_allowed(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_PPM_ROWS_PER_CALL", 2)
        backend = _Backend()
        data = await backend.run(_tasks([{"title": "a"}] * 2))
        assert data["dry_run"] is True

    @pytest.mark.asyncio
    async def test_a_commit_above_the_threshold_needs_the_token(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)
        backend = _Backend()
        data = await backend.run(_tasks([{"title": "a"}] * 2, dry_run=False))
        assert data["error"] == "confirm_token_required"
        assert data["tool"] == "save_ppm_tasks"
        assert backend.calls == []
        data = await backend.run(_tasks([{"title": "a"}] * 2, dry_run=False, confirm_token="TOK"))
        assert backend.batch_calls()[0][2] == {
            "tool_name": "save_ppm_tasks",
            "dry_run": False,
            "confirm_token": "TOK",
        }
        assert len(backend.ppm_writes()) == 2

    @pytest.mark.asyncio
    async def test_a_mid_run_refusal_reports_applied_and_not_applied(self, fake_token):
        backend = _Backend(
            writes={("patch", f"/ppm/tasks/{T1}"): _http_error(400, "Bad work package")}
        )
        items = [{"title": "a"}, {"id": T1, "title": "b"}, {"title": "c"}]
        data = await backend.run(_tasks(items, dry_run=False))
        assert [(m, p) for m, p, _ in backend.ppm_writes()] == [
            ("post", f"{BASE}/tasks"),
            ("patch", f"/ppm/tasks/{T1}"),
        ]
        assert data["error"] == "save_refused"
        assert data["status_code"] == 400
        assert data["detail"] == "Bad work package"
        assert data["initiative_id"] == INI
        assert data["index"] == 1
        assert [s["title"] for s in data["applied"]] == ["a"]
        assert data["not_applied"] == [1, 2]
        assert data["batch_id"] == "B-1"
        assert backend.batch_calls()[-1] == (
            "post",
            CLOSE,
            {
                "summary": {
                    "status": "refused",
                    "rows": 3,
                    "applied": 1,
                    "error": "save_refused",
                }
            },
        )

    @pytest.mark.asyncio
    async def test_a_refused_pre_read_names_the_canonical_initiative(self, fake_token):
        backend = _Backend(reads=_reads(**{f"{BASE}/risks": _http_error(404, "Not found")}))
        data = await backend.run(
            lambda: server.save_ppm_risks(initiative_id=INI.upper(), items=[{"title": "x"}])
        )
        assert data == {
            "error": "ppm_unavailable",
            "status_code": 404,
            "detail": "Not found",
            "initiative_id": INI,
        }
        assert backend.batch_calls() == []

    @pytest.mark.asyncio
    async def test_every_call_of_a_commit_carries_the_callers_token(self, fake_token):
        """The pre-reads, the batch open and close and every write are made
        as the caller."""
        backend = _Backend()
        await backend.run(_tasks([{"title": "a"}, {"id": T1, "title": "b"}], dry_run=False))
        assert [p for _, p, _ in backend.calls] == [
            ENABLED,
            f"{BASE}/tasks",
            f"{BASE}/wbs",
            OPEN.format(2),
            f"{BASE}/tasks",
            f"/ppm/tasks/{T1}",
            CLOSE,
        ]
        assert backend.tokens == ["test-token"] * 7

    @pytest.mark.asyncio
    async def test_an_unknown_id_and_a_work_package_error_are_both_reported(self, fake_token):
        backend = _Backend()
        stranger = "00000000-0000-4000-8000-00000000a0aa"
        items = [{"id": stranger, "title": "x"}, {"id": W2, "parent_id": MS}]
        data = await backend.run(_wbs(items, dry_run=False))
        assert data == {
            "error": "unknown_id",
            "errors": [
                {
                    "error": "unknown_id",
                    "index": 0,
                    "id": stranger,
                    "message": (
                        "This id is not a work package of this initiative; get_ppm_plan "
                        "and the list tools give the ids."
                    ),
                },
                {
                    "error": "invalid_value",
                    "index": 1,
                    "field": "parent_id",
                    "value": MS,
                    "message": "parent_id is a milestone; a milestone holds no work packages.",
                },
            ],
            "message": "Nothing was saved. Fix the items listed and call again.",
        }
        assert backend.batch_calls() == []

    @pytest.mark.asyncio
    async def test_moving_a_stored_milestone_later_is_accepted(self, fake_token):
        """The stored-date check applies the milestone rule to work packages:
        the moved milestone ends on its new start, so it is not inverted."""
        milestone = {
            "id": MS,
            "title": "Go-live",
            "is_milestone": True,
            "start_date": "2026-06-01",
            "end_date": "2026-06-01",
        }
        backend = _Backend(reads=_reads(**{f"{BASE}/wbs": [*_WBS[:2], milestone]}))
        data = await backend.run(_wbs([{"id": MS, "start_date": "2026-07-01"}]))
        assert data["would_save"] == [
            {
                "index": 0,
                "id": MS,
                "title": "Go-live",
                "action": "update",
                "changes": {
                    "start_date": {"old": "2026-06-01", "new": "2026-07-01"},
                    "end_date": {"old": "2026-06-01", "new": "2026-07-01"},
                },
            }
        ]

    @pytest.mark.asyncio
    async def test_the_whole_answer_of_a_mid_run_refusal(self, fake_token):
        backend = _Backend(
            writes={("patch", f"/ppm/tasks/{T1}"): _http_error(409, "Changed meanwhile")}
        )
        items = [{"title": "a"}, {"id": T1, "title": "b"}]
        data = await backend.run(_tasks(items, dry_run=False))
        applied = {key: None for key in server._ppm.TASK_KEYS}
        applied.update({"id": "00000000-0000-4000-8000-000000000001", "title": "a"})
        assert data == {
            "error": "save_refused",
            "status_code": 409,
            "detail": "Changed meanwhile",
            "initiative_id": INI,
            "index": 1,
            "applied": [{"index": 0, "action": "create", **applied}],
            "not_applied": [1],
            "url": _link("tasks"),
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_the_whole_answer_of_a_commit(self, fake_token):
        backend = _Backend()
        items = [{"id": T1, "title": "Draw v2"}, {"id": T2, "status": "todo"}]
        data = await backend.run(_tasks(items, dry_run=False))
        saved = {key: None for key in server._ppm.TASK_KEYS}
        saved.update({"id": T1, "title": "Draw v2"})
        assert data == {
            "dry_run": False,
            "initiative_id": INI,
            "saved": [{"index": 0, "action": "update", **saved}],
            "unchanged": [1],
            "url": _link("tasks"),
            "next_action": _NO_ROLLBACK,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_server_error_mid_run_is_raised(self, fake_token):
        backend = _Backend(writes={("post", f"{BASE}/tasks"): _http_error(500)})
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_tasks([{"title": "a"}], dry_run=False))
        assert backend.batch_calls()[-1][2]["summary"]["status"] == "errored"


class TestWorkPackages:
    @pytest.mark.asyncio
    async def test_refs_build_a_hierarchy_in_one_call(self, fake_token):
        backend = _Backend(
            writes={
                ("post", f"{BASE}/wbs"): [
                    {"id": NEW, "title": "Phase"},
                    {"id": "x", "title": "Step"},
                ]
            }
        )
        items = [
            {"title": "Phase", "ref": "phase"},
            {"title": "Step", "parent_ref": "phase"},
            {"id": W2, "parent_ref": "phase"},
        ]
        data = await backend.run(_wbs(items, dry_run=False))
        assert backend.ppm_writes() == [
            ("post", f"{BASE}/wbs", {"title": "Phase"}),
            ("post", f"{BASE}/wbs", {"title": "Step", "parent_id": NEW}),
            ("patch", f"/ppm/wbs/{W2}", {"parent_id": NEW}),
        ]
        assert [s["action"] for s in data["saved"]] == ["create", "create", "update"]

    @pytest.mark.asyncio
    async def test_the_preview_shows_the_ref(self, fake_token):
        backend = _Backend()
        data = await backend.run(
            _wbs([{"title": "Phase", "ref": "p"}, {"id": W2, "parent_ref": "p"}])
        )
        assert data["would_save"] == [
            {"index": 0, "action": "create", "fields": {"title": "Phase"}, "ref": "p"},
            {
                "index": 1,
                "id": W2,
                "title": "Build",
                "action": "update",
                "changes": {"parent_id": {"old": W1, "new": {"ref": "p"}}},
                "parent_ref": "p",
            },
        ]
        assert data["url"] == _link("gantt")

    @pytest.mark.asyncio
    async def test_a_parent_ref_naming_a_later_item_is_refused(self, fake_token):
        backend = _Backend()
        data = await backend.run(
            _wbs([{"title": "Step", "parent_ref": "p"}, {"title": "Phase", "ref": "p"}])
        )
        assert data["error"] == "invalid_items"
        assert data["errors"][0]["error"] == "unknown_ref"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_a_milestone_ends_on_its_start(self, fake_token):
        backend = _Backend()
        items = [
            {"title": "Launch", "is_milestone": True, "start_date": "2026-09-01"},
            {"id": MS, "start_date": "2026-07-01"},
        ]
        await backend.run(_wbs(items, dry_run=False))
        assert backend.ppm_writes() == [
            (
                "post",
                f"{BASE}/wbs",
                {
                    "title": "Launch",
                    "is_milestone": True,
                    "start_date": "2026-09-01",
                    "end_date": "2026-09-01",
                },
            ),
            (
                "patch",
                f"/ppm/wbs/{MS}",
                {"start_date": "2026-07-01", "end_date": "2026-07-01"},
            ),
        ]

    @pytest.mark.asyncio
    async def test_a_parent_of_another_initiative(self, fake_token):
        backend = _Backend()
        data = await backend.run(_wbs([{"title": "x", "parent_id": OTHER}]))
        assert data["error"] == "invalid_items"
        assert data["errors"][0]["field"] == "parent_id"
        assert backend.batch_calls() == []


def _refused(data: dict, errors: list[dict]) -> None:
    assert data == {
        "error": "invalid_items",
        "errors": errors,
        "message": "Nothing was saved. Fix the items listed and call again.",
    }


class TestChecksAgainstTheStoredRows:
    """What only the stored rows can tell: refused before the batch opens,
    with nothing written."""

    @pytest.mark.asyncio
    async def test_a_due_date_before_the_stored_start_is_refused(self, fake_token):
        tasks = [{**_TASKS[0], "start_date": "2026-06-01", "due_date": "2026-06-10"}, _TASKS[1]]
        backend = _Backend(reads=_reads(**{f"{BASE}/tasks": tasks}))
        data = await backend.run(_tasks([{"id": T1, "due_date": "2026-05-01"}], dry_run=False))
        _refused(
            data,
            [
                {
                    "error": "invalid_row",
                    "index": 0,
                    "message": "start_date (2026-06-01) is after due_date (2026-05-01).",
                }
            ],
        )
        assert backend.batch_calls() == []
        assert backend.ppm_writes() == []

    @pytest.mark.asyncio
    async def test_a_work_package_end_before_its_stored_start_is_refused(self, fake_token):
        backend = _Backend()
        data = await backend.run(_wbs([{"id": W1, "end_date": "2025-12-31"}], dry_run=False))
        _refused(
            data,
            [
                {
                    "error": "invalid_row",
                    "index": 0,
                    "message": "start_date (2026-01-01) is after end_date (2025-12-31).",
                }
            ],
        )
        assert backend.batch_calls() == []
        assert backend.ppm_writes() == []

    @pytest.mark.asyncio
    async def test_a_work_package_moved_into_a_milestone_is_refused(self, fake_token):
        backend = _Backend()
        items = [{"id": W2, "parent_id": MS}, {"id": W1, "is_milestone": True}]
        data = await backend.run(_wbs(items, dry_run=False))
        _refused(
            data,
            [
                {
                    "error": "invalid_value",
                    "index": 0,
                    "field": "parent_id",
                    "value": MS,
                    "message": "parent_id is a milestone; a milestone holds no work packages.",
                },
                {
                    "error": "invalid_value",
                    "index": 1,
                    "field": "is_milestone",
                    "message": (
                        "This work package holds tasks or work packages; a milestone holds none."
                    ),
                },
            ],
        )
        assert backend.batch_calls() == []
        assert backend.ppm_writes() == []

    @pytest.mark.asyncio
    async def test_a_new_package_under_a_new_milestone_is_refused(self, fake_token):
        backend = _Backend()
        items = [
            {"title": "Gate", "is_milestone": True, "ref": "gate"},
            {"title": "Inside", "parent_ref": "gate"},
        ]
        data = await backend.run(_wbs(items, dry_run=False))
        assert data["error"] == "invalid_items"
        assert [(e["index"], e["field"]) for e in data["errors"]] == [(1, "parent_ref")]
        assert backend.batch_calls() == []
        assert backend.ppm_writes() == []

    @pytest.mark.asyncio
    async def test_a_calculated_completion_is_refused(self, fake_token):
        backend = _Backend()
        data = await backend.run(_wbs([{"id": W1, "completion": 90}], dry_run=False))
        _refused(
            data,
            [
                {
                    "error": "invalid_value",
                    "index": 0,
                    "field": "completion",
                    "message": (
                        "completion is calculated for a work package that has tasks or "
                        "sub-packages."
                    ),
                }
            ],
        )
        assert backend.batch_calls() == []
        assert backend.ppm_writes() == []

    @pytest.mark.asyncio
    async def test_a_leaf_package_keeps_a_typed_completion(self, fake_token):
        backend = _Backend()
        await backend.run(_wbs([{"id": W2, "completion": 30}], dry_run=False))
        assert backend.ppm_writes() == [("patch", f"/ppm/wbs/{W2}", {"completion": 30})]

    @pytest.mark.asyncio
    async def test_a_task_re_sending_its_milestone_package_is_accepted(self, fake_token):
        tasks = [_TASKS[0], {**_TASKS[1], "wbs_id": MS}]
        backend = _Backend(reads=_reads(**{f"{BASE}/tasks": tasks}))
        data = await backend.run(
            _tasks([{"id": T2, "wbs_id": MS, "title": "Code 2"}], dry_run=False)
        )
        assert backend.ppm_writes() == [("patch", f"/ppm/tasks/{T2}", {"title": "Code 2"})]
        assert data["dry_run"] is False
        assert [(s["index"], s["action"]) for s in data["saved"]] == [(0, "update")]


class TestReportsAndRisks:
    @pytest.mark.asyncio
    async def test_reports(self, fake_token):
        backend = _Backend()
        items = [
            {"report_date": "2026-11-27", "schedule_health": "atRisk", "summary": "Late"},
            {"id": P1, "schedule_health": "offTrack"},
        ]
        data = await backend.run(
            lambda: server.save_ppm_status_reports(initiative_id=INI, items=items, dry_run=False)
        )
        assert backend.calls[1] == ("get", f"{BASE}/reports", None)
        assert backend.ppm_writes() == [
            (
                "post",
                f"{BASE}/reports",
                {"report_date": "2026-11-27", "schedule_health": "atRisk", "summary": "Late"},
            ),
            ("patch", f"/ppm/reports/{P1}", {"schedule_health": "offTrack"}),
        ]
        assert data["url"] == _link("reports")

    @pytest.mark.asyncio
    async def test_a_report_needs_its_date(self, fake_token):
        backend = _Backend()
        data = await backend.run(
            lambda: server.save_ppm_status_reports(initiative_id=INI, items=[{"summary": "s"}])
        )
        assert data["errors"][0]["missing"] == ["report_date"]
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_risks(self, fake_token):
        backend = _Backend()
        items = [{"title": "Supplier", "probability": 4, "impact": 5}, {"id": R1, "impact": 3}]
        data = await backend.run(
            lambda: server.save_ppm_risks(initiative_id=INI, items=items, dry_run=False)
        )
        assert backend.calls[1] == ("get", f"{BASE}/risks", None)
        assert backend.ppm_writes() == [
            ("post", f"{BASE}/risks", {"title": "Supplier", "probability": 4, "impact": 5}),
            ("patch", f"/ppm/risks/{R1}", {"impact": 3}),
        ]
        assert data["url"] == _link("risks")

    @pytest.mark.asyncio
    @pytest.mark.parametrize("value", [0, 6, "high"])
    async def test_a_risk_score_out_of_range(self, fake_token, value):
        backend = _Backend()
        data = await backend.run(
            lambda: server.save_ppm_risks(
                initiative_id=INI, items=[{"title": "x", "probability": value}]
            )
        )
        assert data["errors"][0]["field"] == "probability"
        assert backend.calls == []


# ── Task comment ────────────────────────────────────────────────────────────


class TestAddComment:
    @pytest.mark.asyncio
    async def test_preview(self, fake_token):
        backend = _Backend()
        data = await backend.run(lambda: server.add_ppm_task_comment(task_id=T1, content="Done?"))
        assert backend.ppm_writes() == []
        assert backend.batch_calls() == [
            ("post", OPEN.format(1), {"tool_name": "add_ppm_task_comment", "dry_run": True}),
            ("post", CLOSE, {"summary": {"rows": 1, "status": "previewed"}}),
        ]
        assert data == {
            "dry_run": True,
            "task_id": T1,
            "would_post": {"content": "Done?"},
            "existing_comments": 2,
            "note": _PREVIEW_NOTE,
            "verified": False,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_commit(self, fake_token):
        backend = _Backend(
            writes={
                ("post", f"/ppm/tasks/{T1}/comments"): {
                    "id": "c9",
                    "task_id": T1,
                    "user_id": USER,
                    "user_display_name": "Me",
                    "content": "Done?",
                    "created_at": "t",
                    "updated_at": "t",
                }
            }
        )
        data = await backend.run(
            lambda: server.add_ppm_task_comment(task_id=T1, content="Done?", dry_run=False)
        )
        assert backend.ppm_writes() == [("post", f"/ppm/tasks/{T1}/comments", {"content": "Done?"})]
        assert data == {
            "dry_run": False,
            "task_id": T1,
            "comment": {
                "id": "c9",
                "user_id": USER,
                "user_display_name": "Me",
                "content": "Done?",
                "created_at": "t",
                "updated_at": "t",
            },
            "batch_id": "B-1",
        }
        assert backend.batch_calls()[-1][2] == {"summary": {"rows": 1, "posted": 1}}

    @pytest.mark.asyncio
    @pytest.mark.parametrize("content", ["", "   ", "x" * 10001])
    async def test_a_bad_comment_makes_no_call(self, fake_token, content):
        backend = _Backend()
        data = await backend.run(lambda: server.add_ppm_task_comment(task_id=T1, content=content))
        assert data["error"] == "invalid_value"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_a_refused_commit(self, fake_token):
        backend = _Backend(
            writes={("post", f"/ppm/tasks/{T1}/comments"): _http_error(403, "Not allowed")}
        )
        data = await backend.run(
            lambda: server.add_ppm_task_comment(task_id=T1, content="x", dry_run=False)
        )
        assert data == {
            "error": "comment_refused",
            "status_code": 403,
            "detail": "Not allowed",
            "task_id": T1,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_server_error_on_commit_is_raised(self, fake_token):
        backend = _Backend(writes={("post", f"/ppm/tasks/{T1}/comments"): _http_error(502)})
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(
                lambda: server.add_ppm_task_comment(task_id=T1, content="x", dry_run=False)
            )


# ── Dependencies ────────────────────────────────────────────────────────────


def _deps(add=None, remove=None, dry_run=True, **kw):
    return lambda: server.set_ppm_dependencies(
        initiative_id=INI, add=add, remove=remove, dry_run=dry_run, **kw
    )


_NEW_LINK = {"pred_kind": "task", "pred_id": T1, "succ_kind": "wbs", "succ_id": W2}
_OLD_LINK = {"pred_kind": "wbs", "pred_id": W1, "succ_kind": "task", "succ_id": T2}


class TestDependencies:
    @pytest.mark.asyncio
    async def test_preview(self, fake_token):
        backend = _Backend()
        data = await backend.run(_deps(add=[_NEW_LINK, _OLD_LINK], remove=[D1.upper()]))
        assert [(m, p) for m, p, _ in backend.calls[:4]] == [
            ("get", ENABLED),
            ("get", f"{BASE}/dependencies"),
            ("get", f"{BASE}/tasks"),
            ("get", f"{BASE}/wbs"),
        ]
        assert backend.ppm_writes() == []
        assert backend.batch_calls()[0] == (
            "post",
            OPEN.format(3),
            {"tool_name": "set_ppm_dependencies", "dry_run": True},
        )
        assert data == {
            "dry_run": True,
            "initiative_id": INI,
            "would_remove": [{"index": 0, "action": "remove", "id": D1, **_OLD_LINK, "kind": "FS"}],
            "would_add": [
                {"index": 0, "action": "add", **_NEW_LINK},
                {"index": 1, "action": "add", **_OLD_LINK},
            ],
            "note": _PREVIEW_NOTE,
            "verified": False,
            "url": _link("gantt"),
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_commit_removes_then_adds_and_skips_existing(self, fake_token):
        backend = _Backend()
        data = await backend.run(_deps(add=[_NEW_LINK, _OLD_LINK], dry_run=False))
        assert backend.ppm_writes() == [
            ("post", f"{BASE}/dependencies", {**_NEW_LINK, "kind": "FS"}),
        ]
        assert data["exists"] == [1]
        assert data["next_action"] == _NO_ROLLBACK
        backend = _Backend()
        data = await backend.run(_deps(add=[_OLD_LINK], remove=[D1], dry_run=False))
        assert backend.ppm_writes() == [
            ("delete", f"/ppm/dependencies/{D1}", None),
            ("post", f"{BASE}/dependencies", {**_OLD_LINK, "kind": "FS"}),
        ]
        assert data["applied"][0] == {"list": "remove", "index": 0, "id": D1}
        assert data["applied"][1]["list"] == "add"
        assert data["exists"] == []
        assert backend.batch_calls()[-1][2] == {"summary": {"rows": 2, "applied": 2}}

    @pytest.mark.asyncio
    async def test_validation_errors_make_no_call(self, fake_token):
        backend = _Backend()
        self_link = {"pred_kind": "task", "pred_id": T1, "succ_kind": "task", "succ_id": T1}
        data = await backend.run(_deps(add=[self_link, {**_NEW_LINK, "kind": "SS"}]))
        assert data["error"] == "invalid_items"
        assert [e["error"] for e in data["errors"]] == ["invalid_row", "unknown_field"]
        assert backend.calls == []
        data = await backend.run(_deps())
        assert data["errors"][0]["message"] == "Give at least one add or remove."

    @pytest.mark.asyncio
    async def test_unknown_ends_and_removes(self, fake_token):
        backend = _Backend()
        data = await backend.run(
            _deps(add=[{**_NEW_LINK, "succ_id": OTHER}], remove=[OTHER], dry_run=False)
        )
        assert data["error"] == "unknown_id"
        assert [(e["list"], e["index"]) for e in data["errors"]] == [("remove", 0), ("add", 0)]
        assert backend.batch_calls() == []

    @pytest.mark.asyncio
    async def test_a_wrong_kind_is_unknown(self, fake_token):
        backend = _Backend()
        data = await backend.run(_deps(add=[{**_NEW_LINK, "pred_kind": "wbs"}]))
        assert data["errors"][0]["ends"] == ["pred"]

    @pytest.mark.asyncio
    async def test_the_cap_counts_adds_and_removes(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_PPM_ROWS_PER_CALL", 1)
        backend = _Backend()
        data = await backend.run(_deps(add=[_NEW_LINK], remove=[D1]))
        assert data["error"] == "batch_too_large"
        assert data["received"] == 2
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_a_commit_above_the_threshold_needs_the_token(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)
        backend = _Backend()
        data = await backend.run(_deps(add=[_NEW_LINK], remove=[D1], dry_run=False))
        assert data["error"] == "confirm_token_required"
        assert backend.calls == []

    @pytest.mark.asyncio
    async def test_a_cycle_refused_mid_run(self, fake_token):
        backend = _Backend(
            writes={
                ("post", f"{BASE}/dependencies"): _http_error(
                    422, "This dependency would create a cycle"
                )
            }
        )
        data = await backend.run(_deps(add=[_NEW_LINK], remove=[D1], dry_run=False))
        assert data["error"] == "dependency_refused"
        assert data["status_code"] == 422
        assert data["detail"] == "This dependency would create a cycle"
        assert data["list"] == "add"
        assert data["applied"] == [{"list": "remove", "index": 0, "id": D1}]
        assert data["not_applied"] == [{"list": "add", "index": 0}]
        assert data["batch_id"] == "B-1"
        assert backend.batch_calls()[-1][2]["summary"] == {
            "status": "refused",
            "rows": 2,
            "applied": 1,
            "error": "dependency_refused",
        }

    @pytest.mark.asyncio
    async def test_a_server_error_mid_run_is_raised(self, fake_token):
        backend = _Backend(writes={("delete", f"/ppm/dependencies/{D1}"): _http_error(500)})
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_deps(remove=[D1], dry_run=False))
