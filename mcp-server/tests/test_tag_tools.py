"""The tag write tools: ``set_card_tags`` (add / remove / replace through
``POST /cards/tags/bulk``, previewed by the backend) and ``create_tag_groups``
(groups and tags deduplicated by name against ``GET /tag-groups`` before the
batch opens), plus their plain validation and planning helpers."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from turbo_ea_mcp import server


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _parse(s: str):
    return json.loads(s)


def _http_error(status: int, detail: object) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://backend/api/v1/x")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError(f"{status} error", request=request, response=response)


class _Backend:
    """Answers the batch open / close; ``answers`` maps a write path to a
    response or an exception (a callable gets the body). Records every call."""

    def __init__(self, answers=None, groups=None):
        self.answers = answers or {}
        self.groups = groups if groups is not None else []
        self.posts: list[tuple[str, dict | None]] = []
        self.gets: list[str] = []

    async def post(self, path, json=None):
        self.posts.append((path, json))
        if path.endswith("/commit"):
            return {"id": "B-1", "committed_at": "now"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run")}
        answer = self.answers.get(path, {"id": f"new:{path}"})
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(json)
        return answer

    async def get(self, path, params=None):
        self.gets.append(path)
        assert path == "/tag-groups"
        return self.groups

    def writes(self):
        return [(p, b) for p, b in self.posts if not p.startswith("/mutation-batches")]

    def closed_summary(self):
        return self.posts[-1][1]["summary"]

    def patched(self):
        return (
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=self.post)),
            patch.object(server.TurboEAClient, "get", AsyncMock(side_effect=self.get)),
        )


async def _run(backend: _Backend, coro_factory):
    p1, p2 = backend.patched()
    with p1, p2:
        return _parse(await coro_factory())


# ── _validate_tag_ops ───────────────────────────────────────────────────────


OP_NOT_A_DICT = "Each operation must be a dict."
OP_UNKNOWN = "An operation takes card_id, tag_ids and mode only."
NO_CARD = "Every operation needs a card_id."
OP_MODE = 'mode must be "add", "remove" or "replace".'
TAG_IDS_SHAPE = "tag_ids must be a list of tag id strings (from list_tag_groups)."
TAG_IDS_EMPTY = "add and remove need at least one tag id; replace with [] clears."


class TestValidateTagOps:
    def test_valid_ops_are_normalised(self):
        ops, err = server._validate_tag_ops(
            [
                {"card_id": " c1 ", "tag_ids": ["t1", "t2"], "mode": "add"},
                {"card_id": "c2", "tag_ids": [], "mode": "replace"},
                {"card_id": "c3", "tag_ids": ["t1"], "mode": "remove"},
            ]
        )
        assert err is None
        assert ops == [
            {"card_id": "c1", "tag_ids": ["t1", "t2"], "mode": "add"},
            {"card_id": "c2", "tag_ids": [], "mode": "replace"},
            {"card_id": "c3", "tag_ids": ["t1"], "mode": "remove"},
        ]

    @pytest.mark.parametrize(
        ("op", "expected"),
        [
            ("c1", {"error": "invalid_operation", "message": OP_NOT_A_DICT}),
            (
                {"card_id": "c1", "tag_ids": ["t"], "mode": "add", "x": 1},
                {"error": "unknown_fields", "unknown": ["x"], "message": OP_UNKNOWN},
            ),
            ({"tag_ids": ["t"], "mode": "add"}, {"error": "missing_card_id", "message": NO_CARD}),
            (
                {"card_id": "  ", "tag_ids": ["t"], "mode": "add"},
                {"error": "missing_card_id", "message": NO_CARD},
            ),
            (
                {"card_id": 5, "tag_ids": ["t"], "mode": "add"},
                {"error": "missing_card_id", "message": NO_CARD},
            ),
            (
                {"card_id": "c1", "tag_ids": ["t"]},
                {"error": "invalid_mode", "mode": None, "message": OP_MODE},
            ),
            (
                {"card_id": "c1", "tag_ids": ["t"], "mode": "toggle"},
                {"error": "invalid_mode", "mode": "toggle", "message": OP_MODE},
            ),
            (
                {"card_id": "c1", "tag_ids": "t", "mode": "add"},
                {"error": "invalid_tag_ids", "message": TAG_IDS_SHAPE},
            ),
            (
                {"card_id": "c1", "mode": "add"},
                {"error": "invalid_tag_ids", "message": TAG_IDS_SHAPE},
            ),
            (
                {"card_id": "c1", "tag_ids": ["t", ""], "mode": "add"},
                {"error": "invalid_tag_ids", "message": TAG_IDS_SHAPE},
            ),
            (
                {"card_id": "c1", "tag_ids": ["t", 3], "mode": "add"},
                {"error": "invalid_tag_ids", "message": TAG_IDS_SHAPE},
            ),
            (
                {"card_id": "c1", "tag_ids": [], "mode": "add"},
                {"error": "invalid_tag_ids", "message": TAG_IDS_EMPTY},
            ),
            (
                {"card_id": "c1", "tag_ids": [], "mode": "remove"},
                {"error": "invalid_tag_ids", "message": TAG_IDS_EMPTY},
            ),
        ],
    )
    def test_a_bad_op_is_named_by_its_index(self, op, expected):
        ops, err = server._validate_tag_ops(
            [{"card_id": "c0", "tag_ids": ["t"], "mode": "add"}, op]
        )
        assert ops == []
        assert err == {**expected, "index": 1}

    def test_the_unknown_keys_and_the_bad_mode_are_echoed(self):
        _, err = server._validate_tag_ops(
            [{"card_id": "c1", "tag_ids": ["t"], "mode": "add", "z": 1, "a": 2}]
        )
        assert err["unknown"] == ["a", "z"]
        _, err = server._validate_tag_ops([{"card_id": "c1", "tag_ids": ["t"], "mode": "set"}])
        assert err["mode"] == "set"


# ── _validate_tag_group_specs / _plan_tag_groups ────────────────────────────


TAG_UNKNOWN = "A tag takes name, color and description only."
TAG_NAME = "A tag name is 1-200 characters."
TAG_COLOR = "color is a string of at most 20 characters."
EXISTING_UNKNOWN = (
    "An entry with group_id adds tags to that group and takes group_id and tags only."
)
EXISTING_NO_TAGS = "An entry with group_id needs at least one tag."
NEW_UNKNOWN = (
    "A new group takes name, description, mode, mandatory, restrict_to_types and tags only."
)
GROUP_NAME = "A group name is 1-200 characters."
RESTRICT = "restrict_to_types is a list of card type keys, or null for every type."


class TestValidateTagGroupSpecs:
    def test_a_new_group_takes_defaults(self):
        specs, err = server._validate_tag_group_specs(
            [{"name": " Hosting ", "tags": [{"name": " Cloud ", "color": "#111"}]}]
        )
        assert err is None
        assert specs == [
            {
                "kind": "new",
                "name": "Hosting",
                "description": None,
                "mode": "multi",
                "mandatory": False,
                "restrict_to_types": None,
                "tags": [{"name": "Cloud", "color": "#111", "description": None}],
            }
        ]
        assert server._tag_group_rows(specs) == 2

    def test_a_full_new_group_and_an_existing_group_entry(self):
        specs, err = server._validate_tag_group_specs(
            [
                {
                    "name": "Tier",
                    "description": "Service tier",
                    "mode": "single",
                    "mandatory": True,
                    "restrict_to_types": ["Application"],
                },
                {"group_id": " g1 ", "tags": [{"name": "A"}, {"name": "B", "description": "d"}]},
            ]
        )
        assert err is None
        assert specs[0]["mode"] == "single" and specs[0]["mandatory"] is True
        assert specs[0]["restrict_to_types"] == ["Application"]
        assert specs[0]["description"] == "Service tier" and specs[0]["tags"] == []
        assert specs[1] == {
            "kind": "existing",
            "group_id": "g1",
            "tags": [
                {"name": "A", "color": None, "description": None},
                {"name": "B", "color": None, "description": "d"},
            ],
        }
        # One new group (no tags) + two tags for the existing one.
        assert server._tag_group_rows(specs) == 3

    @pytest.mark.parametrize(
        ("entry", "expected"),
        [
            ("Hosting", {"error": "invalid_group", "message": "Each entry must be a dict."}),
            (
                {"name": "G", "tags": "x"},
                {"error": "invalid_tags", "message": "tags must be a list of dicts."},
            ),
            (
                {"name": "G", "tags": ["x"]},
                {"error": "invalid_tags", "message": "Each tag must be a dict."},
            ),
            (
                {"name": "G", "tags": [{"name": "T", "size": 1, "id": "x"}]},
                {"error": "unknown_fields", "unknown": ["id", "size"], "message": TAG_UNKNOWN},
            ),
            (
                {"name": "G", "tags": [{"name": ""}]},
                {"error": "invalid_tag_name", "message": TAG_NAME},
            ),
            (
                {"name": "G", "tags": [{"name": "x" * 201}]},
                {"error": "invalid_tag_name", "message": TAG_NAME},
            ),
            (
                {"name": "G", "tags": [{"name": "T", "color": "#" * 21}]},
                {"error": "invalid_color", "message": TAG_COLOR},
            ),
            (
                {"name": "G", "tags": [{"name": "T", "color": 3}]},
                {"error": "invalid_color", "message": TAG_COLOR},
            ),
            (
                {"name": "G", "tags": [{"name": "T", "description": 3}]},
                {"error": "invalid_description", "message": "description is a string."},
            ),
            (
                {"name": "G", "tags": [{"name": "T"}, {"name": " t "}]},
                {
                    "error": "duplicate_tag",
                    "name": "t",
                    "message": "A tag is named twice in one group.",
                },
            ),
            (
                {"group_id": "g1", "name": "G", "tags": [{"name": "T"}]},
                {"error": "unknown_fields", "unknown": ["name"], "message": EXISTING_UNKNOWN},
            ),
            (
                {"group_id": "", "tags": [{"name": "T"}]},
                {"error": "invalid_group_id", "message": "group_id is a string."},
            ),
            (
                {"group_id": 7, "tags": [{"name": "T"}]},
                {"error": "invalid_group_id", "message": "group_id is a string."},
            ),
            ({"group_id": "g1"}, {"error": "invalid_tags", "message": EXISTING_NO_TAGS}),
            (
                {"group_id": "g1", "tags": []},
                {"error": "invalid_tags", "message": EXISTING_NO_TAGS},
            ),
            (
                {"name": "G", "colour": "x", "id": 1},
                {"error": "unknown_fields", "unknown": ["colour", "id"], "message": NEW_UNKNOWN},
            ),
            ({"name": " "}, {"error": "invalid_group_name", "message": GROUP_NAME}),
            ({"name": 3}, {"error": "invalid_group_name", "message": GROUP_NAME}),
            ({"name": "x" * 201}, {"error": "invalid_group_name", "message": GROUP_NAME}),
            (
                {"name": "G", "mode": "several"},
                {
                    "error": "invalid_mode",
                    "mode": "several",
                    "message": 'mode must be "single" or "multi".',
                },
            ),
            (
                {"name": "G", "mandatory": "yes"},
                {"error": "invalid_mandatory", "message": "mandatory is a boolean."},
            ),
            (
                {"name": "G", "restrict_to_types": "Application"},
                {"error": "invalid_restrict_to_types", "message": RESTRICT},
            ),
            (
                {"name": "G", "restrict_to_types": ["Application", ""]},
                {"error": "invalid_restrict_to_types", "message": RESTRICT},
            ),
            (
                {"name": "G", "description": 4},
                {"error": "invalid_description", "message": "description is a string."},
            ),
            (
                {"name": " first "},
                {"error": "duplicate_group", "name": "first", "message": "A group is named twice."},
            ),
        ],
    )
    def test_a_bad_entry_is_named_by_its_index(self, entry, expected):
        specs, err = server._validate_tag_group_specs([{"name": "First"}, entry])
        assert specs == []
        assert err == {**expected, "index": 1}

    def test_names_at_the_limit_pass(self):
        specs, err = server._validate_tag_group_specs(
            [{"name": "x" * 200, "tags": [{"name": "y" * 200, "color": "#" * 20}]}]
        )
        assert err is None and len(specs) == 1


EXISTING = [
    {
        "id": "g1",
        "name": "Hosting",
        "tags": [{"id": "t1", "name": "Cloud"}, {"id": "t2", "name": "On-Prem"}],
    },
    {"id": "g2", "name": "hosting", "tags": []},
    {"id": "g3", "name": "Empty"},
]


class TestPlanTagGroups:
    def _specs(self, entries):
        specs, err = server._validate_tag_group_specs(entries)
        assert err is None
        return specs

    def test_an_existing_name_is_reused_and_matching_tags_too(self):
        plan, err = server._plan_tag_groups(
            self._specs([{"name": "HOSTING", "tags": [{"name": "cloud"}, {"name": "Edge"}]}]),
            EXISTING,
        )
        assert err is None
        public = server._public_plan(plan)
        assert public == [
            {
                "group_id": "g1",
                "name": "Hosting",
                "status": "exists",
                "tags": [
                    {"name": "Cloud", "id": "t1", "status": "exists"},
                    {"name": "Edge", "color": None, "description": None, "status": "create"},
                ],
            }
        ]
        assert server._plan_counts(plan) == (0, 1)

    def test_a_new_name_is_created(self):
        plan, err = server._plan_tag_groups(
            self._specs([{"name": "Tier", "tags": [{"name": "Gold"}]}]), EXISTING
        )
        assert err is None
        assert server._public_plan(plan) == [
            {
                "group_id": None,
                "name": "Tier",
                "status": "create",
                "tags": [{"name": "Gold", "color": None, "description": None, "status": "create"}],
            }
        ]
        assert server._plan_counts(plan) == (1, 1)

    def test_a_tag_named_twice_in_one_spec_is_planned_once(self):
        # The shape check refuses this; the planner holds the line on its own.
        spec = {
            "kind": "new",
            "name": "Tier",
            "description": None,
            "mode": "multi",
            "mandatory": False,
            "restrict_to_types": None,
            "tags": [
                {"name": "Gold", "color": None, "description": None},
                {"name": "GOLD", "color": None, "description": None},
            ],
        }
        plan, err = server._plan_tag_groups([spec], [])
        assert err is None
        assert [(t["name"], t["status"]) for t in plan[0]["tags"]] == [
            ("Gold", "create"),
            ("GOLD", "duplicate"),
        ]

    def test_tags_for_a_group_by_id(self):
        plan, err = server._plan_tag_groups(
            self._specs([{"group_id": "g3", "tags": [{"name": "A"}]}]), EXISTING
        )
        assert err is None
        assert plan[0]["group_id"] == "g3" and plan[0]["name"] == "Empty"
        assert plan[0]["status"] == "exists"
        assert plan[0]["tags"][0]["status"] == "create"

    def test_an_unknown_group_id_refuses_the_call(self):
        plan, err = server._plan_tag_groups(
            self._specs([{"name": "Tier"}, {"group_id": "nope", "tags": [{"name": "A"}]}]),
            EXISTING,
        )
        assert plan == []
        assert err == {
            "error": "unknown_group",
            "index": 1,
            "group_id": "nope",
            "message": "No tag group has this id; call list_tag_groups.",
        }

    def test_junk_in_the_listing_is_ignored(self):
        plan, err = server._plan_tag_groups(
            self._specs([{"name": "Tier", "tags": [{"name": "A"}]}]),
            ["junk", {"id": "g9", "name": None}, {"id": "g8", "name": "Tier", "tags": ["x"]}],
        )
        assert err is None
        assert plan[0]["group_id"] == "g8" and plan[0]["status"] == "exists"
        assert plan[0]["tags"][0]["status"] == "create"

    def test_two_entries_for_one_group_id_are_merged(self):
        plan, err = server._plan_tag_groups(
            self._specs(
                [
                    {"group_id": "g1", "tags": [{"name": "Edge"}, {"name": "cloud"}]},
                    {"group_id": "g1", "tags": [{"name": "EDGE"}, {"name": "Fog"}]},
                ]
            ),
            EXISTING,
        )
        assert err is None
        assert server._public_plan(plan) == [
            {
                "group_id": "g1",
                "name": "Hosting",
                "status": "exists",
                "tags": [
                    {"name": "Edge", "color": None, "description": None, "status": "create"},
                    {"name": "Cloud", "id": "t1", "status": "exists"},
                    {"name": "EDGE", "status": "duplicate"},
                    {"name": "Fog", "color": None, "description": None, "status": "create"},
                ],
                "merged_entries": [0, 1],
            }
        ]
        assert server._plan_counts(plan) == (0, 2)

    def test_a_name_and_the_id_of_the_group_it_names_are_merged(self):
        plan, err = server._plan_tag_groups(
            self._specs(
                [
                    {"name": "HOSTING", "tags": [{"name": "Edge"}]},
                    {"group_id": "g3", "tags": [{"name": "Edge"}]},
                    {"group_id": "g1", "tags": [{"name": "edge"}, {"name": "On-prem"}]},
                ]
            ),
            EXISTING,
        )
        assert err is None
        public = server._public_plan(plan)
        assert [(p["group_id"], p.get("merged_entries")) for p in public] == [
            ("g1", [0, 2]),
            ("g3", None),
        ]
        assert [(t["name"], t["status"]) for t in public[0]["tags"]] == [
            ("Edge", "create"),
            ("edge", "duplicate"),
            ("On-Prem", "exists"),
        ]
        # The other group's tag of the same name is its own.
        assert public[1]["tags"][0]["status"] == "create"
        assert server._plan_counts(plan) == (0, 2)

    def test_two_new_groups_of_one_name_never_reach_the_plan(self):
        specs, err = server._validate_tag_group_specs([{"name": "Tier"}, {"name": "TIER"}])
        assert specs == []
        assert err["error"] == "duplicate_group" and err["index"] == 1

    def test_counts_take_created_rows_too(self):
        plan = [
            {"status": "created", "tags": [{"status": "created"}, {"status": "exists"}]},
            {"status": "refused", "tags": [{"status": "skipped"}]},
            {"status": "exists", "tags": [{"status": "refused"}, {"status": "create"}]},
        ]
        assert server._plan_counts(plan) == (1, 2)


# ── create_tag_groups ───────────────────────────────────────────────────────


class TestCreateTagGroups:
    @pytest.mark.asyncio
    async def test_preview_asks_the_backend_and_stores_nothing(self, fake_token):
        backend = _Backend(groups=EXISTING)
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[
                    {"name": "Tier", "mode": "single", "tags": [{"name": "Gold"}]},
                    {"name": "hosting", "tags": [{"name": "Cloud"}, {"name": "Edge"}]},
                ]
            ),
        )
        assert backend.gets == ["/tag-groups"]
        # The dedupe read runs before the batch opens.
        assert backend.posts[0] == (
            "/mutation-batches?row_count=5",
            {"tool_name": "create_tag_groups", "dry_run": True},
        )
        assert backend.writes() == [
            (
                "/tag-groups",
                {
                    "name": "Tier",
                    "description": None,
                    "mode": "single",
                    "mandatory": False,
                    "restrict_to_types": None,
                    "dry_run": True,
                },
            ),
            (
                "/tag-groups/g1/tags",
                {"name": "Edge", "color": None, "description": None, "dry_run": True},
            ),
        ]
        assert data["dry_run"] is True and data["batch_id"] == "B-1"
        assert data["would_create"] == {"groups": 1, "tags": 2}
        tier, hosting = data["groups"]
        assert (tier["status"], tier["group_id"]) == ("create", None)
        assert tier["tags"][0]["status"] == "create"
        assert hosting["status"] == "exists" and hosting["group_id"] == "g1"
        assert [t["status"] for t in hosting["tags"]] == ["exists", "create"]
        assert "spec" not in tier
        assert backend.closed_summary() == {"rows": 5, "would_create": {"groups": 1, "tags": 2}}

    @pytest.mark.asyncio
    async def test_commit_creates_the_group_then_its_tags(self, fake_token):
        backend = _Backend(
            answers={
                "/tag-groups": {"id": "g-new", "name": "Tier"},
                "/tag-groups/g-new/tags": {"id": "t-new", "name": "Gold"},
            }
        )
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[{"name": "Tier", "tags": [{"name": "Gold"}]}], dry_run=False
            ),
        )
        assert [p for p, _ in backend.writes()] == ["/tag-groups", "/tag-groups/g-new/tags"]
        assert all(body["dry_run"] is False for _, body in backend.writes())
        assert data["dry_run"] is False and data["batch_id"] == "B-1"
        assert data["created"] == {"groups": 1, "tags": 1}
        [group] = data["groups"]
        assert (group["status"], group["group_id"]) == ("created", "g-new")
        assert group["tags"] == [
            {"name": "Gold", "color": None, "description": None, "status": "created", "id": "t-new"}
        ]
        assert backend.closed_summary() == {"rows": 2, "created": {"groups": 1, "tags": 1}}

    @pytest.mark.asyncio
    async def test_a_refused_group_skips_its_tags_and_the_rest_still_runs(self, fake_token):
        backend = _Backend(
            answers={
                "/tag-groups": _http_error(422, "Unknown card type(s) in restrict_to_types: X"),
                "/tag-groups/g1/tags": _http_error(403, "Insufficient permissions"),
                "/tag-groups/g3/tags": {"id": "t9"},
            },
            groups=EXISTING,
        )
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[
                    {"name": "Bad", "restrict_to_types": ["X"], "tags": [{"name": "A"}]},
                    {"group_id": "g1", "tags": [{"name": "Edge"}]},
                    {"group_id": "g3", "tags": [{"name": "Fine"}]},
                ],
                dry_run=False,
            ),
        )
        bad, refused_tag, fine = data["groups"]
        assert bad["status"] == "refused" and bad["http_status"] == 422
        assert bad["detail"] == "Unknown card type(s) in restrict_to_types: X"
        assert bad["tags"][0]["status"] == "skipped"
        assert refused_tag["tags"][0]["status"] == "refused"
        assert refused_tag["tags"][0]["http_status"] == 403
        assert fine["tags"][0]["status"] == "created" and fine["tags"][0]["id"] == "t9"
        assert data["created"] == {"groups": 0, "tags": 1}
        assert [p for p, _ in backend.writes()] == [
            "/tag-groups",
            "/tag-groups/g1/tags",
            "/tag-groups/g3/tags",
        ]

    @pytest.mark.asyncio
    async def test_a_refused_tag_does_not_stop_the_next_tag_of_its_group(self, fake_token):
        def answer(body):
            if body["name"] == "Bad":
                raise _http_error(409, "Tag already exists")
            return {"id": f"id-{body['name']}"}

        backend = _Backend(answers={"/tag-groups/g3/tags": answer}, groups=EXISTING)
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[{"group_id": "g3", "tags": [{"name": "Bad"}, {"name": "Good"}]}],
                dry_run=False,
            ),
        )
        assert [b["name"] for _, b in backend.writes()] == ["Bad", "Good"]
        [group] = data["groups"]
        assert group["tags"] == [
            {
                "name": "Bad",
                "color": None,
                "description": None,
                "status": "refused",
                "http_status": 409,
                "detail": "Tag already exists",
            },
            {
                "name": "Good",
                "color": None,
                "description": None,
                "status": "created",
                "id": "id-Good",
            },
        ]
        assert data["created"] == {"groups": 0, "tags": 1}

    @pytest.mark.asyncio
    async def test_a_tag_carries_its_color_and_description(self, fake_token):
        backend = _Backend(answers={"/tag-groups/g3/tags": {"id": "t1"}}, groups=EXISTING)
        await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[
                    {
                        "group_id": "g3",
                        "tags": [{"name": "Gold", "color": "#ffd700", "description": "Top tier"}],
                    }
                ],
                dry_run=False,
            ),
        )
        assert backend.writes() == [
            (
                "/tag-groups/g3/tags",
                {"name": "Gold", "color": "#ffd700", "description": "Top tier", "dry_run": False},
            )
        ]

    @pytest.mark.asyncio
    async def test_an_answer_that_is_not_an_object_leaves_no_id(self, fake_token):
        # The group answer carries no id, so its tags cannot be sent.
        backend = _Backend(
            answers={"/tag-groups": None, "/tag-groups/g3/tags": ["odd"]}, groups=EXISTING
        )
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[
                    {"name": "Tier", "tags": [{"name": "Gold"}]},
                    {"group_id": "g3", "tags": [{"name": "A"}]},
                ],
                dry_run=False,
            ),
        )
        assert [p for p, _ in backend.writes()] == ["/tag-groups", "/tag-groups/g3/tags"]
        tier, empty = data["groups"]
        assert (tier["status"], tier["group_id"]) == ("created", None)
        assert tier["tags"][0]["status"] == "create"
        assert empty["tags"] == [
            {"name": "A", "color": None, "description": None, "status": "created", "id": None}
        ]

    @pytest.mark.asyncio
    async def test_merged_entries_create_a_tag_once(self, fake_token):
        backend = _Backend(answers={"/tag-groups/g1/tags": {"id": "t-edge"}}, groups=EXISTING)
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[
                    {"name": "Hosting", "tags": [{"name": "Edge"}]},
                    {"group_id": "g1", "tags": [{"name": "edge"}]},
                ],
                dry_run=False,
            ),
        )
        assert [p for p, _ in backend.writes()] == ["/tag-groups/g1/tags"]
        assert data["created"] == {"groups": 0, "tags": 1}
        [group] = data["groups"]
        assert group["merged_entries"] == [0, 1]
        assert [(t["name"], t["status"]) for t in group["tags"]] == [
            ("Edge", "created"),
            ("edge", "duplicate"),
        ]

    @pytest.mark.asyncio
    async def test_a_group_id_is_sent_as_one_path_segment(self, fake_token):
        backend = _Backend(groups=[{"id": "a/b", "name": "Odd", "tags": []}])
        await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[{"group_id": "a/b", "tags": [{"name": "T"}]}], dry_run=False
            ),
        )
        assert [p for p, _ in backend.writes()] == ["/tag-groups/a%2Fb/tags"]

    @pytest.mark.asyncio
    async def test_everything_existing_writes_nothing(self, fake_token):
        backend = _Backend(groups=EXISTING)
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[{"name": "Hosting", "tags": [{"name": "Cloud"}]}], dry_run=False
            ),
        )
        assert backend.writes() == []
        assert data["created"] == {"groups": 0, "tags": 0}
        assert data["groups"][0]["status"] == "exists"

    @pytest.mark.asyncio
    async def test_an_unknown_group_id_refuses_before_the_batch(self, fake_token):
        backend = _Backend(groups=EXISTING)
        data = await _run(
            backend,
            lambda: server.create_tag_groups(groups=[{"group_id": "zz", "tags": [{"name": "T"}]}]),
        )
        assert data["error"] == "unknown_group"
        assert backend.posts == []

    @pytest.mark.asyncio
    async def test_a_non_list_listing_counts_as_no_groups(self, fake_token):
        backend = _Backend(groups={"detail": "odd"})
        data = await _run(backend, lambda: server.create_tag_groups(groups=[{"name": "Tier"}]))
        assert data["would_create"] == {"groups": 1, "tags": 0}

    @pytest.mark.asyncio
    async def test_a_bad_entry_refuses_before_any_call(self, fake_token):
        backend = _Backend()
        data = await _run(
            backend, lambda: server.create_tag_groups(groups=[{"name": "G", "mode": "x"}])
        )
        assert data["error"] == "invalid_mode"
        assert backend.posts == [] and backend.gets == []

    @pytest.mark.asyncio
    async def test_the_cap_counts_groups_and_tags(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_CARDS_PER_CALL", 2)
        backend = _Backend()
        data = await _run(
            backend,
            lambda: server.create_tag_groups(
                groups=[{"name": "G", "tags": [{"name": "A"}, {"name": "B"}]}]
            ),
        )
        assert data["error"] == "batch_too_large"
        assert (data["cap"], data["received"]) == (2, 3)
        assert backend.posts == [] and backend.gets == []
        # At the cap, it runs.
        data = await _run(
            backend,
            lambda: server.create_tag_groups(groups=[{"name": "G", "tags": [{"name": "A"}]}]),
        )
        assert data["dry_run"] is True

    @pytest.mark.asyncio
    async def test_kill_switch(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _Backend()
        data = await _run(backend, lambda: server.create_tag_groups(groups=[{"name": "G"}]))
        assert data["error"] == "writes_disabled"
        assert backend.posts == [] and backend.gets == []

    def test_requires_auth(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in asyncio.run(server.create_tag_groups(groups=[]))

    def test_is_additive(self):
        tool = server.mcp._tool_manager._tools["create_tag_groups"]
        assert tool.annotations == server._WRITE_ADDITIVE_ANNOT


# ── set_card_tags ───────────────────────────────────────────────────────────

BULK_ANSWER = {
    "results": [
        {
            "index": 0,
            "card_id": "c1",
            "status": "updated",
            "added": ["t1"],
            "removed": [],
            "tag_ids": ["t1"],
            "error": None,
        },
        {"index": 1, "card_id": "c2", "status": "not_found"},
    ],
    "updated": 1,
    "unchanged": 0,
    "failed": 1,
}


def _bulk(body):
    return {**BULK_ANSWER, "dry_run": body["dry_run"]}


OPS = [
    {"card_id": "c1", "tag_ids": ["t1"], "mode": "add"},
    {"card_id": "c2", "tag_ids": ["t1"], "mode": "replace"},
]


class TestSetCardTags:
    @pytest.mark.asyncio
    async def test_preview_is_a_backend_dry_run(self, fake_token):
        backend = _Backend(answers={"/cards/tags/bulk": _bulk})
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS))
        assert backend.posts[0] == (
            "/mutation-batches?row_count=2",
            {"tool_name": "set_card_tags", "dry_run": True},
        )
        assert backend.writes() == [("/cards/tags/bulk", {"operations": OPS, "dry_run": True})]
        assert data["dry_run"] is True and data["batch_id"] == "B-1"
        assert data["results"] == BULK_ANSWER["results"]
        assert (data["updated"], data["failed"]) == (1, 1)
        assert backend.closed_summary() == {"rows": 2, "would_update": 1, "failed": 1}

    @pytest.mark.asyncio
    async def test_commit_returns_the_batch_id(self, fake_token):
        backend = _Backend(answers={"/cards/tags/bulk": _bulk})
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS, dry_run=False))
        assert backend.writes() == [("/cards/tags/bulk", {"operations": OPS, "dry_run": False})]
        assert data["dry_run"] is False and data["batch_id"] == "B-1"
        assert "confirm_token" not in data
        assert backend.closed_summary() == {"rows": 2, "updated": 1, "failed": 1}

    @pytest.mark.asyncio
    async def test_preview_above_the_threshold_carries_the_token(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        backend = _Backend(answers={"/cards/tags/bulk": _bulk})

        async def post(path, json=None):
            if path.startswith("/mutation-batches?"):
                backend.posts.append((path, json))
                return {"id": "B-1", "dry_run": True, "confirm_token": "TOK"}
            return await backend.post(path, json)

        with patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)):
            data = _parse(await server.set_card_tags(operations=OPS))
        assert data["confirm_token"] == "TOK"

    @pytest.mark.asyncio
    async def test_a_refused_call_reports_the_backend_detail(self, fake_token):
        backend = _Backend(
            answers={
                "/cards/tags/bulk": _http_error(403, "Not enough permissions to tag card(s): c1")
            }
        )
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS, dry_run=False))
        assert data == {
            "error": "set_card_tags_refused",
            "http_status": 403,
            "detail": "Not enough permissions to tag card(s): c1",
            "batch_id": "B-1",
        }
        assert backend.closed_summary() == {"rows": 2, "status": "refused"}

    @pytest.mark.asyncio
    async def test_a_refused_preview_still_hands_back_the_batch(self, fake_token):
        backend = _Backend(answers={"/cards/tags/bulk": _http_error(422, [{"msg": "bad"}])})
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS))
        assert data["error"] == "set_card_tags_refused"
        assert data["http_status"] == 422 and data["detail"] == [{"msg": "bad"}]
        assert data["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_a_non_dict_answer_is_wrapped(self, fake_token):
        backend = _Backend(answers={"/cards/tags/bulk": ["odd"]})
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS, dry_run=False))
        assert data["result"] == ["odd"] and data["dry_run"] is False
        assert backend.closed_summary() == {"rows": 2, "updated": 0, "failed": 0}

    @pytest.mark.asyncio
    async def test_a_bad_op_refuses_before_any_call(self, fake_token):
        backend = _Backend()
        data = await _run(
            backend,
            lambda: server.set_card_tags(operations=[{"card_id": "c1", "tag_ids": ["t"]}]),
        )
        assert data["error"] == "invalid_mode"
        assert backend.posts == []

    @pytest.mark.asyncio
    async def test_the_cap(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_MAX_CARDS_PER_CALL", 1)
        backend = _Backend()
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS))
        assert data["error"] == "batch_too_large"
        assert (data["cap"], data["received"]) == (1, 2)
        assert backend.posts == []

    @pytest.mark.asyncio
    async def test_a_commit_above_the_threshold_needs_the_token(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_BATCH_CONFIRMATION_THRESHOLD", 1)
        monkeypatch.setattr(server, "MCP_REQUIRE_DRYRUN_FIRST", True)
        backend = _Backend()
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS, dry_run=False))
        assert data["error"] == "confirm_token_required" and data["tool"] == "set_card_tags"
        assert backend.posts == []

    @pytest.mark.asyncio
    async def test_kill_switch(self, fake_token, monkeypatch):
        monkeypatch.setattr(server, "MCP_WRITES_ENABLED", False)
        backend = _Backend()
        data = await _run(backend, lambda: server.set_card_tags(operations=OPS))
        assert data["error"] == "writes_disabled"
        assert backend.posts == []

    def test_requires_auth(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(server, "_stdio_token", None)
        assert "Not authenticated" in asyncio.run(server.set_card_tags(operations=OPS))

    def test_is_destructive(self):
        tool = server.mcp._tool_manager._tools["set_card_tags"]
        assert tool.annotations == server._WRITE_DESTRUCTIVE_ANNOT


class TestInstructions:
    def test_the_server_instructions_name_the_tag_tools(self):
        text = server.mcp.instructions
        for name in ("list_tag_groups", "set_card_tags", "create_tag_groups"):
            assert name in text
