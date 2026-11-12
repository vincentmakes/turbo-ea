"""The step-link tools: ``get_process_flow_elements`` and
``link_process_flow_elements``.

A draft's steps carry card links keyed by their BPMN element id. The read
tool lists them; the write tool sets them, one backend PUT per step inside one
mutation batch, after refusing any entry it cannot send as asked.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.test_write_tools import (
    _DRAFT_URL,
    _DRAFTS_TAB,
    _FLOW,
    _PUBLIC,
    COMMIT_CLOSE,
    _flow_http_error,
    _FlowBackend,
)
from turbo_ea_mcp import server

_PROCESS = "00000000-0000-4000-8000-0000000000b1"
_DRAFT = "00000000-0000-4000-8000-0000000000d1"
_VERSION = f"{_FLOW}/versions/{_DRAFT}"
_ELEMENTS = f"{_VERSION}/draft-elements"
_APP_OLD = "00000000-0000-4000-8000-00000000a001"
_APP = "00000000-0000-4000-8000-00000000a002"
_DATA = "00000000-0000-4000-8000-00000000d001"
_ITC = "00000000-0000-4000-8000-00000000c001"
_CALLED = "00000000-0000-4000-8000-00000000b002"
_ORG_OLD = "00000000-0000-4000-8000-00000000e001"
_ORG = "00000000-0000-4000-8000-00000000e002"

_OPEN_1 = "/mutation-batches?row_count=1"
_OPEN_2 = "/mutation-batches?row_count=2"
_OPEN_3 = "/mutation-batches?row_count=3"

#: Two steps as the backend's draft-element route returns them.
_TASK = {
    "bpmn_element_id": "Activity_1",
    "element_type": "task",
    "name": "Check order",
    "documentation": "Look at it",
    "lane_name": "Sales",
    "is_automated": False,
    "sequence_order": 1,
    "event_definition_type": None,
    "definition_name": None,
    "application_id": _APP_OLD,
    "application_name": "CRM",
    "data_object_id": None,
    "data_object_name": None,
    "it_component_id": None,
    "it_component_name": None,
    "called_element": None,
    "business_process_id": None,
    "business_process_name": None,
    "organizations": [{"id": _ORG_OLD, "name": "Sales"}],
    "custom_fields": {"x": 1},
}
_GATEWAY = {"bpmn_element_id": "Gateway.2", "element_type": "exclusiveGateway", "name": "OK?"}
_ODD = {"bpmn_element_id": "Lane 3/x", "name": "Odd id", "organizations": None}

_NOT_LINKABLE = (
    "Step links can be set only on a draft or pending revision. A published "
    "flow's links are edited in its Elements table in the web UI; to change "
    "them here, start a new draft with import_bpmn, which carries them over."
)
_COMMIT_NEXT_ACTION = (
    "The links are saved on this revision and reach the published "
    "steps when it is approved. Ask the user to check them in the "
    "editor. rollback_batch cannot undo them: to change one, call "
    "link_process_flow_elements again; an empty value clears it."
)
_PREVIEW_NOTE = (
    "Preview built by the MCP server: the route has no dry "
    "run, so the version and its steps were read and nothing "
    "was changed. Call again with dry_run=False to save."
)
_ALLOWED = (
    "allowed: bpmn_element_id, application_id, data_object_id, it_component_id, "
    "business_process_id, organization_ids"
)
_NO_LINK = (
    "names no link to set: give at least one of application_id, data_object_id, "
    "it_component_id, business_process_id, organization_ids"
)
_BAD_ELEMENT_ID = "bpmn_element_id must be a step's id (get_process_flow_elements)"


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")


@pytest.fixture
def public_url(monkeypatch):
    monkeypatch.setattr(server, "TURBO_EA_PUBLIC_URL", _PUBLIC + "/")


class _LinkBackend(_FlowBackend):
    """``_FlowBackend`` that also answers the draft-element PUT: ``writes``
    holds an answer (or an exception) per path, ``{"status": "updated"}``
    otherwise."""

    async def put(self, path, json=None):
        self.calls.append(("put", path, json))
        answer = self.writes.get(path, {"status": "updated"})
        if isinstance(answer, Exception):
            raise answer
        return answer

    async def run(self, coro_fn):
        g, p, pa = self.patched()
        pu = patch.object(server.TurboEAClient, "put", AsyncMock(side_effect=self.put))
        with g, p, pa, pu:
            return json.loads(await coro_fn())


def _backend(status="draft", elements=None, **kwargs) -> _LinkBackend:
    version = {"id": _DRAFT, "revision": 5, "status": status}
    reads = {_VERSION: version, _ELEMENTS: [_TASK, _GATEWAY] if elements is None else elements}
    return _LinkBackend(reads={**reads, **kwargs.pop("reads", {})}, **kwargs)


def _link(links, dry_run=True, **kwargs):
    return lambda: server.link_process_flow_elements(
        business_process_id=_PROCESS, version_id=_DRAFT, links=links, dry_run=dry_run, **kwargs
    )


def _put(element_segment: str) -> str:
    return f"{_ELEMENTS}/{element_segment}"


# ── get_process_flow_elements ──────────────────────────────────────────────


def _read():
    return lambda: server.get_process_flow_elements(business_process_id=_PROCESS, version_id=_DRAFT)


def _summary(element: dict) -> dict:
    return {key: element.get(key) for key in server._FLOW_ELEMENT_KEYS}


class TestGetProcessFlowElements:
    @pytest.mark.asyncio
    async def test_a_draft_lists_its_steps_and_their_links(self, fake_token, public_url):
        backend = _backend()
        data = await backend.run(_read())
        assert backend.paths() == [("get", _VERSION), ("get", _ELEMENTS)]
        assert data == {
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "revision": 5,
            "status": "draft",
            "links_editable": True,
            "elements": [
                {
                    "bpmn_element_id": "Activity_1",
                    "element_type": "task",
                    "name": "Check order",
                    "lane_name": "Sales",
                    "sequence_order": 1,
                    "application_id": _APP_OLD,
                    "application_name": "CRM",
                    "data_object_id": None,
                    "data_object_name": None,
                    "it_component_id": None,
                    "it_component_name": None,
                    "business_process_id": None,
                    "business_process_name": None,
                    "organizations": [{"id": _ORG_OLD, "name": "Sales"}],
                },
                _summary(_GATEWAY),
            ],
            "drafts_tab_url": _DRAFTS_TAB,
            "draft_url": _DRAFT_URL.format(_DRAFT),
        }

    @pytest.mark.asyncio
    async def test_a_pending_version_is_editable_without_an_editor_link(
        self, fake_token, public_url
    ):
        data = await _backend(status="pending").run(_read())
        assert data["links_editable"] is True
        assert "draft_url" not in data
        assert "note" not in data
        assert data["drafts_tab_url"] == _DRAFTS_TAB

    @pytest.mark.asyncio
    async def test_a_published_version_says_where_its_links_are_edited(
        self, fake_token, public_url
    ):
        data = await _backend(status="published").run(_read())
        assert data["links_editable"] is False
        assert data["note"] == _NOT_LINKABLE
        assert "draft_url" not in data

    @pytest.mark.asyncio
    async def test_answers_that_are_not_what_was_asked_read_as_empty(self, fake_token, public_url):
        backend = _LinkBackend(reads={_VERSION: None, _ELEMENTS: {"not": "a list"}})
        data = await backend.run(_read())
        assert data == {
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "revision": None,
            "status": None,
            "links_editable": False,
            "elements": [],
            "drafts_tab_url": _DRAFTS_TAB,
            "note": _NOT_LINKABLE,
        }

    @pytest.mark.asyncio
    async def test_only_objects_are_listed(self, fake_token, public_url):
        data = await _backend(elements=["Activity_1", None, _GATEWAY]).run(_read())
        assert data["elements"] == [_summary(_GATEWAY)]

    @pytest.mark.asyncio
    async def test_a_hidden_version_is_refused_before_its_steps_are_read(
        self, fake_token, public_url
    ):
        backend = _backend(reads={_VERSION: _flow_http_error(404, "Version not found", "GET")})
        data = await backend.run(_read())
        assert backend.paths() == [("get", _VERSION)]
        assert data == {
            "error": "version_unavailable",
            "status_code": 404,
            "detail": "Version not found",
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    async def test_steps_the_reader_may_not_see_are_a_structured_refusal(
        self, fake_token, public_url
    ):
        backend = _backend(
            reads={_ELEMENTS: _flow_http_error(403, "Insufficient permissions", "GET")}
        )
        data = await backend.run(_read())
        assert data == {
            "error": "elements_unavailable",
            "status_code": 403,
            "detail": "Insufficient permissions",
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    async def test_a_server_error_on_the_steps_is_raised(self, fake_token):
        backend = _backend(reads={_ELEMENTS: _flow_http_error(500, "boom", "GET")})
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_read())

    def test_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        backend = _backend()
        out = asyncio.run(backend.run(lambda: _json_text(_read())))
        assert out == "Error: Not authenticated. Please reconnect."
        assert backend.calls == []

    def test_is_a_read_tool(self):
        tool = server.mcp._tool_manager._tools["get_process_flow_elements"]
        assert tool.annotations == server._READ_ANNOT


async def _json_text(factory):
    """Wrap a tool's plain-text answer so ``_LinkBackend.run`` can parse it."""
    return json.dumps(await factory())


# ── link_process_flow_elements: input ──────────────────────────────────────


def _problem(index, problem):
    return {"index": index, "problem": problem}


_INVALID_LINKS = {
    "empty": ([], [_problem(None, "links must be a non-empty list of entries")]),
    "not a list": ("Activity_1", [_problem(None, "links must be a non-empty list of entries")]),
    "not an object": (
        ["Activity_1"],
        [_problem(0, "must be an object: bpmn_element_id and the links to set")],
    ),
    "unknown keys": (
        [
            {
                "bpmn_element_id": "Activity_1",
                "application_id": _APP,
                "name": "x",
                "custom_fields": 1,
            }
        ],
        [_problem(0, f"unknown key(s): custom_fields, name; {_ALLOWED}")],
    ),
    "no element id": ([{"application_id": _APP}], [_problem(0, _BAD_ELEMENT_ID)]),
    "an element id that is not a string": (
        [{"bpmn_element_id": 7, "application_id": _APP}],
        [_problem(0, _BAD_ELEMENT_ID)],
    ),
    "an empty element id": (
        [{"bpmn_element_id": "", "application_id": _APP}],
        [_problem(0, _BAD_ELEMENT_ID)],
    ),
    "no link": ([{"bpmn_element_id": "Activity_1"}], [_problem(0, _NO_LINK)]),
    "a card id that is not a UUID": (
        [{"bpmn_element_id": "Activity_1", "data_object_id": "Customer"}],
        [_problem(0, "data_object_id must be a card UUID, or empty to clear the link")],
    ),
    "a list as a card id": (
        [{"bpmn_element_id": "Activity_1", "it_component_id": []}],
        [_problem(0, "it_component_id must be a card UUID, or empty to clear the link")],
    ),
    "organizations that are not a list": (
        [{"bpmn_element_id": "Activity_1", "organization_ids": _ORG}],
        [_problem(0, "organization_ids must be a list of card UUIDs; [] clears them")],
    ),
    # Not iterated: a number cannot be, and a mapping keyed by card ids would
    # otherwise pass as its keys.
    "organizations as a number": (
        [{"bpmn_element_id": "Activity_1", "organization_ids": 7}],
        [_problem(0, "organization_ids must be a list of card UUIDs; [] clears them")],
    ),
    "organizations as a mapping keyed by card ids": (
        [{"bpmn_element_id": "Activity_1", "organization_ids": {_ORG: "Sales"}}],
        [_problem(0, "organization_ids must be a list of card UUIDs; [] clears them")],
    ),
    "an organization that is not a UUID": (
        [{"bpmn_element_id": "Activity_1", "organization_ids": [_ORG, "Sales"]}],
        [_problem(0, "organization_ids must be a list of card UUIDs; [] clears them")],
    ),
    "a step given twice": (
        [
            {"bpmn_element_id": "Activity_1", "application_id": _APP},
            {"bpmn_element_id": "Gateway.2", "application_id": _APP},
            {"bpmn_element_id": "Activity_1", "data_object_id": _DATA},
        ],
        [
            _problem(
                2,
                "step Activity_1 is already set by entry 0; give each step once, "
                "with all its links",
            )
        ],
    ),
    "a step given twice after another": (
        [
            {"bpmn_element_id": "Activity_1", "application_id": _APP},
            {"bpmn_element_id": "Gateway.2", "application_id": _APP},
            {"bpmn_element_id": "Gateway.2", "data_object_id": _DATA},
        ],
        [
            _problem(
                2,
                "step Gateway.2 is already set by entry 1; give each step once, with all its links",
            )
        ],
    ),
    "every problem of every entry": (
        [
            {"bpmn_element_id": "Activity_1", "application_id": _APP},
            {"oops": 1},
            {"bpmn_element_id": "Gateway.2", "business_process_id": "P"},
        ],
        [
            _problem(1, f"unknown key(s): oops; {_ALLOWED}"),
            _problem(1, _BAD_ELEMENT_ID),
            _problem(1, _NO_LINK),
            _problem(2, "business_process_id must be a card UUID, or empty to clear the link"),
        ],
    ),
}


class TestLinkInputIsCheckedFirst:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    @pytest.mark.parametrize("case", list(_INVALID_LINKS))
    async def test_a_bad_entry_is_refused_with_no_backend_call(self, fake_token, case, dry_run):
        links, problems = _INVALID_LINKS[case]
        backend = _backend()
        data = await backend.run(_link(links, dry_run=dry_run))
        assert backend.calls == []
        assert data == {
            "error": "invalid_links",
            "problems": problems,
            "message": "Nothing was saved. Fix the entries listed and call again.",
        }

    def test_an_entry_is_normalised_to_the_body_the_backend_takes(self):
        entry, problems = server._step_link_entry(
            {
                "bpmn_element_id": "Activity_1",
                "application_id": _APP.upper(),
                "data_object_id": "",
                "it_component_id": None,
                "organization_ids": ["{" + _ORG + "}"],
            }
        )
        assert problems == []
        assert entry == {
            "bpmn_element_id": "Activity_1",
            "body": {
                "application_id": _APP,
                "data_object_id": None,
                "it_component_id": None,
                "organization_ids": [_ORG],
            },
        }

    @pytest.mark.parametrize("empty", [None, "", []])
    def test_any_empty_organizations_value_is_a_clear(self, empty):
        entry, problems = server._step_link_entry(
            {"bpmn_element_id": "Activity_1", "organization_ids": empty}
        )
        assert problems == []
        assert entry["body"] == {"organization_ids": []}

    def test_a_link_left_out_is_left_out_of_the_body(self):
        entry, _ = server._step_link_entry(
            {"bpmn_element_id": "Activity_1", "business_process_id": _CALLED}
        )
        assert entry["body"] == {"business_process_id": _CALLED}

    @pytest.mark.parametrize("value", [None, 7, ["x"], {"id": _APP}, "nope", ""])
    def test_only_a_uuid_is_a_card_id(self, value):
        assert server._as_uuid(value) is None

    def test_a_uuid_comes_back_canonical(self):
        assert server._as_uuid(_APP.replace("-", "").upper()) == _APP

    @pytest.mark.parametrize(
        ("element_id", "segment"),
        [
            ("Activity_1", "Activity_1"),
            ("Gateway.2", "Gateway%2E2"),
            ("..", "%2E%2E"),
            ("a/b c?d#e", "a%2Fb%20c%3Fd%23e"),
            ("%2E", "%252E"),
        ],
    )
    def test_an_element_id_is_one_path_segment(self, element_id, segment):
        assert server._element_segment(element_id) == segment

    @pytest.mark.parametrize(
        ("element", "key", "current"),
        [
            (_TASK, "application_id", _APP_OLD),
            (_TASK, "organization_ids", [_ORG_OLD]),
            (_GATEWAY, "organization_ids", []),
            (_ODD, "organization_ids", []),
            (_GATEWAY, "data_object_id", None),
        ],
    )
    def test_the_current_link_reads_in_the_shape_the_tool_takes(self, element, key, current):
        assert server._current_link(element, key) == current


# ── link_process_flow_elements: reads that refuse ──────────────────────────


class TestLinkRefusalsBeforeTheBatch:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_a_published_version_is_refused(self, fake_token, public_url, dry_run):
        backend = _backend(status="published")
        data = await backend.run(
            _link([{"bpmn_element_id": "Activity_1", "application_id": _APP}], dry_run)
        )
        assert backend.paths() == [("get", _VERSION)]
        assert data == {
            "error": "wrong_status",
            "status": "published",
            "expected_status": ["draft", "pending"],
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "revision": 5,
            "message": _NOT_LINKABLE,
            "drafts_tab_url": _DRAFTS_TAB,
        }

    @pytest.mark.asyncio
    async def test_a_version_that_is_not_an_object_is_refused(self, fake_token, public_url):
        backend = _LinkBackend(reads={_VERSION: None})
        data = await backend.run(_link([{"bpmn_element_id": "Activity_1", "application_id": _APP}]))
        assert data["error"] == "wrong_status"
        assert data["status"] is None
        assert backend.paths() == [("get", _VERSION)]

    @pytest.mark.asyncio
    async def test_a_hidden_version_is_refused(self, fake_token, public_url):
        backend = _backend(reads={_VERSION: _flow_http_error(404, "Version not found", "GET")})
        data = await backend.run(_link([{"bpmn_element_id": "Activity_1", "application_id": _APP}]))
        assert backend.paths() == [("get", _VERSION)]
        assert data["error"] == "version_unavailable"
        assert data["detail"] == "Version not found"

    @pytest.mark.asyncio
    async def test_unreadable_steps_are_refused(self, fake_token, public_url):
        backend = _backend(reads={_ELEMENTS: _flow_http_error(403, "Insufficient permissions")})
        data = await backend.run(_link([{"bpmn_element_id": "Activity_1", "application_id": _APP}]))
        assert backend.paths() == [("get", _VERSION), ("get", _ELEMENTS)]
        assert data["error"] == "elements_unavailable"
        assert data["status_code"] == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize("dry_run", [True, False])
    async def test_an_unknown_step_is_refused_before_any_write(self, fake_token, dry_run):
        backend = _backend()
        links = [
            {"bpmn_element_id": "Activity_9", "application_id": _APP},
            {"bpmn_element_id": "Activity_1", "application_id": _APP},
            {"bpmn_element_id": "../../cards", "application_id": _APP},
        ]
        data = await backend.run(_link(links, dry_run))
        assert backend.paths() == [("get", _VERSION), ("get", _ELEMENTS)]
        assert data == {
            "error": "unknown_elements",
            "bpmn_element_ids": ["Activity_9", "../../cards"],
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "message": (
                "Nothing was saved: these ids are not steps of the version's "
                "saved diagram. get_process_flow_elements lists the steps; a "
                "step added since must first be saved with import_bpmn "
                "(draft_version_id)."
            ),
        }

    @pytest.mark.asyncio
    async def test_steps_that_are_not_a_list_know_no_step(self, fake_token):
        backend = _backend(elements={"Activity_1": {}})
        data = await backend.run(_link([{"bpmn_element_id": "Activity_1", "application_id": _APP}]))
        assert data["error"] == "unknown_elements"
        assert data["bpmn_element_ids"] == ["Activity_1"]


# ── link_process_flow_elements: preview and commit ─────────────────────────

_LINKS = [
    {
        "bpmn_element_id": "Activity_1",
        "application_id": _APP.upper(),
        "data_object_id": _DATA,
        "organization_ids": None,
    },
    {
        "bpmn_element_id": "Gateway.2",
        "it_component_id": _ITC,
        "business_process_id": _CALLED,
    },
]

_PLAN = [
    {
        "bpmn_element_id": "Activity_1",
        "name": "Check order",
        "links": {
            "application_id": {"old": _APP_OLD, "new": _APP},
            "data_object_id": {"old": None, "new": _DATA},
            "organization_ids": {"old": [_ORG_OLD], "new": []},
        },
    },
    {
        "bpmn_element_id": "Gateway.2",
        "name": "OK?",
        "links": {
            "it_component_id": {"old": None, "new": _ITC},
            "business_process_id": {"old": None, "new": _CALLED},
        },
    },
]


class TestLinkPreview:
    @pytest.mark.asyncio
    async def test_the_preview_reports_each_links_old_and_new_value(self, fake_token, public_url):
        backend = _backend()
        data = await backend.run(_link(_LINKS))
        assert backend.paths() == [
            ("get", _VERSION),
            ("get", _ELEMENTS),
            ("post", _OPEN_2),
            ("post", "/mutation-batches/B-1/commit"),
        ]
        assert backend.body("post", _OPEN_2) == {
            "tool_name": "link_process_flow_elements",
            "dry_run": True,
        }
        assert backend.body("post", COMMIT_CLOSE) == {"summary": {"rows": 2, "status": "previewed"}}
        assert data == {
            "dry_run": True,
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "revision": 5,
            "status": "draft",
            "would_link": _PLAN,
            "note": _PREVIEW_NOTE,
            "verified": False,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_preview_above_the_threshold_is_issued_a_token(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        backend = _backend()

        async def post(path, json=None):
            backend.calls.append(("post", path, json))
            if path == _OPEN_2:
                return {"id": "B-1", "dry_run": True, "confirm_token": "TOK-1"}
            return {"id": "B-1"}

        with patch.object(server.TurboEAClient, "put", AsyncMock()) as put:
            g, _, pa = backend.patched()
            with g, pa, patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
                data = json.loads(await _link(_LINKS)())
        put.assert_not_called()
        assert data["confirm_token"] == "TOK-1"
        assert backend.calls[-1] == (
            "post",
            COMMIT_CLOSE,
            {"summary": {"rows": 2, "status": "previewed"}, "confirm_token": "TOK-1"},
        )


class TestLinkCommit:
    @pytest.mark.asyncio
    async def test_one_put_per_step_inside_one_batch(self, fake_token, public_url):
        backend = _backend(elements=[_TASK, _GATEWAY, _ODD])
        links = [*_LINKS, {"bpmn_element_id": "Lane 3/x", "organization_ids": [_ORG]}]
        data = await backend.run(_link(links, dry_run=False))
        assert backend.paths() == [
            ("get", _VERSION),
            ("get", _ELEMENTS),
            ("post", _OPEN_3),
            ("put", _put("Activity_1")),
            ("put", _put("Gateway%2E2")),
            ("put", _put("Lane%203%2Fx")),
            ("post", COMMIT_CLOSE),
        ]
        assert backend.body("post", _OPEN_3) == {
            "tool_name": "link_process_flow_elements",
            "dry_run": False,
        }
        assert backend.body("put", _put("Activity_1")) == {
            "application_id": _APP,
            "data_object_id": _DATA,
            "organization_ids": [],
        }
        assert backend.body("put", _put("Gateway%2E2")) == {
            "it_component_id": _ITC,
            "business_process_id": _CALLED,
        }
        assert backend.body("put", _put("Lane%203%2Fx")) == {"organization_ids": [_ORG]}
        assert backend.body("post", COMMIT_CLOSE) == {"summary": {"rows": 3, "applied": 3}}
        assert data == {
            "dry_run": False,
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "revision": 5,
            "linked": [
                *_PLAN,
                {
                    "bpmn_element_id": "Lane 3/x",
                    "name": "Odd id",
                    "links": {"organization_ids": {"old": [], "new": [_ORG]}},
                },
            ],
            "drafts_tab_url": _DRAFTS_TAB,
            "draft_url": _DRAFT_URL.format(_DRAFT),
            "next_action": _COMMIT_NEXT_ACTION,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_pending_version_is_linked_without_an_editor_link(self, fake_token, public_url):
        backend = _backend(status="pending")
        data = await backend.run(
            _link([{"bpmn_element_id": "Activity_1", "application_id": ""}], dry_run=False)
        )
        assert backend.body("put", _put("Activity_1")) == {"application_id": None}
        assert "draft_url" not in data
        assert data["drafts_tab_url"] == _DRAFTS_TAB
        assert data["batch_id"] == "B-1"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("refused_at", "applied", "not_applied"),
        [
            (0, [], ["Activity_1", "Gateway.2", "Lane 3/x"]),
            (1, ["Activity_1"], ["Gateway.2", "Lane 3/x"]),
            (2, ["Activity_1", "Gateway.2"], ["Lane 3/x"]),
        ],
    )
    async def test_a_refusal_stops_the_run_and_says_what_was_applied(
        self, fake_token, public_url, refused_at, applied, not_applied
    ):
        segments = ["Activity_1", "Gateway%2E2", "Lane%203%2Fx"]
        refused = _put(segments[refused_at])
        backend = _backend(
            elements=[_TASK, _GATEWAY, _ODD],
            writes={refused: _flow_http_error(404, "Card not found", "PUT", refused)},
        )
        links = [*_LINKS, {"bpmn_element_id": "Lane 3/x", "organization_ids": [_ORG]}]
        data = await backend.run(_link(links, dry_run=False))
        assert backend.paths("put") == [("put", _put(s)) for s in segments[: refused_at + 1]]
        assert backend.calls[-1][1] == COMMIT_CLOSE
        assert backend.body("post", COMMIT_CLOSE) == {
            "summary": {
                "status": "refused",
                "rows": 3,
                "applied": refused_at,
                "error": "link_refused",
            }
        }
        assert data == {
            "error": "link_refused",
            "status_code": 404,
            "detail": "Card not found",
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "drafts_tab_url": _DRAFTS_TAB,
            "bpmn_element_id": (applied + not_applied)[refused_at],
            "applied": applied,
            "not_applied": not_applied,
            "batch_id": "B-1",
        }

    @pytest.mark.asyncio
    async def test_a_card_of_the_wrong_type_comes_back_as_the_backends_400(
        self, fake_token, public_url
    ):
        """The backend checks each link's card type; the tool passes its
        refusal through with what was and was not applied."""
        detail = "it_component_id takes a card of type ITComponent, not Application"
        refused = _put("Gateway%2E2")
        backend = _backend(writes={refused: _flow_http_error(400, detail, "PUT", refused)})
        data = await backend.run(_link(_LINKS, dry_run=False))
        assert data == {
            "error": "link_refused",
            "status_code": 400,
            "detail": detail,
            "business_process_id": _PROCESS,
            "version_id": _DRAFT,
            "drafts_tab_url": _DRAFTS_TAB,
            "bpmn_element_id": "Gateway.2",
            "applied": ["Activity_1"],
            "not_applied": ["Gateway.2"],
            "batch_id": "B-1",
        }

    def test_the_docstring_says_how_a_wrong_card_type_answers(self):
        text = " ".join(
            server.mcp._tool_manager._tools["link_process_flow_elements"].description.split()
        )
        assert (
            "the backend refuses a card of another type with a 400 that names both types, "
            "and a card that does not exist, is archived or is hidden from the user as "
            "not found (404)."
        ) in text

    @pytest.mark.asyncio
    async def test_a_server_error_closes_the_batch_as_errored_and_is_raised(self, fake_token):
        refused = _put("Activity_1")
        backend = _backend(writes={refused: _flow_http_error(500, "boom", "PUT", refused)})
        with pytest.raises(httpx.HTTPStatusError):
            await backend.run(_link(_LINKS, dry_run=False))
        assert backend.paths("put") == [("put", refused)]
        assert backend.body("post", COMMIT_CLOSE)["summary"]["status"] == "errored"

    @pytest.mark.asyncio
    async def test_a_commit_above_the_threshold_needs_the_token(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)
        backend = _backend()
        data = await backend.run(_link(_LINKS, dry_run=False))
        assert backend.calls == []
        assert data["error"] == "confirm_token_required"
        assert data["tool"] == "link_process_flow_elements"
        assert data["received"] == 2

    @pytest.mark.asyncio
    async def test_the_token_is_presented_when_the_batch_opens(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        backend = _backend()
        data = await backend.run(_link(_LINKS, dry_run=False, confirm_token="TOK-1"))
        assert backend.body("post", _OPEN_2) == {
            "tool_name": "link_process_flow_elements",
            "dry_run": False,
            "confirm_token": "TOK-1",
        }
        assert "confirm_token" not in backend.body("post", COMMIT_CLOSE)
        assert data["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_a_commit_at_the_threshold_needs_no_token(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        backend = _backend()
        await backend.run(
            _link([{"bpmn_element_id": "Activity_1", "application_id": _APP}], dry_run=False)
        )
        assert backend.body("post", _OPEN_1) == {
            "tool_name": "link_process_flow_elements",
            "dry_run": False,
        }

    @pytest.mark.asyncio
    async def test_writes_disabled_refuses_with_no_backend_call(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _backend()
        data = await backend.run(_link(_LINKS, dry_run=False))
        assert data["error"] == "writes_disabled"
        assert backend.calls == []

    def test_requires_auth(self, monkeypatch):
        monkeypatch.setattr(server, "_stdio_token", None)
        backend = _backend()
        out = asyncio.run(backend.run(lambda: _json_text(_link(_LINKS, dry_run=False))))
        assert out == "Error: Not authenticated. Please reconnect."
        assert backend.calls == []

    def test_is_an_additive_write(self):
        tool = server.mcp._tool_manager._tools["link_process_flow_elements"]
        assert tool.annotations == server._WRITE_ADDITIVE_ANNOT


class TestTheAssistantIsToldWhereStepLinksGo:
    def test_the_server_instructions_name_both_tools_and_the_argument_rule(self):
        text = " ".join(server.mcp.instructions.split())
        assert (
            "To link a draft's steps to cards (applications, data objects, IT "
            "components, organizations, called processes), read the step ids with "
            "get_process_flow_elements and set the links with "
            "link_process_flow_elements; import_bpmn takes no links."
        ) in text
        assert (
            "Every tool refuses an argument it does not declare: pass only the "
            "parameters a tool lists."
        ) in text

    def test_import_bpmn_points_at_the_link_tool(self):
        text = " ".join(server.mcp._tool_manager._tools["import_bpmn"].description.split())
        assert (
            "This tool saves the diagram only: it takes no step links. To link the "
            "steps to cards, call ``get_process_flow_elements`` for their ids, then "
            "``link_process_flow_elements``. Replacing a draft's XML keeps the links "
            "of every step whose ``id`` the new XML still has"
        ) in text
