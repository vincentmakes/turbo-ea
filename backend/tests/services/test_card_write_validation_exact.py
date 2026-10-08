"""``card_write_service``'s validators and hierarchy guards, pinned to exact values.

The REST tests prove a bad write is refused; these pin *what* is refused and
*what the caller is told* — every 422/400 detail verbatim, every skip rule of
the attribute checks, and the level arithmetic of the hierarchy guards —
because the nightly mutation run showed those were the values no test
compared.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.services import card_write_service as svc
from app.services.card_write_service import WriteActor
from tests.conftest import (
    create_budget_line,
    create_card,
    create_card_type,
    create_cost_line,
    create_user,
)

SCHEMA = [
    {
        "section": "Main",
        "fields": [
            {"key": "website", "label": "Website", "type": "url"},
            {"key": "docs", "label": "Docs", "type": "url"},
            {"key": "progress", "label": "Progress", "type": "percentage"},
            {"key": "uptime", "label": "Uptime", "type": "percentage"},
            {"key": "notes", "label": "Notes", "type": "text"},
        ],
    },
    {"section": "Empty"},
]


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application", label="Application", fields_schema=SCHEMA)
    await create_card_type(db, key="Bare", label="Bare")
    return {}


def detail_of(exc: pytest.ExceptionInfo) -> tuple[int, object]:
    return exc.value.status_code, exc.value.detail


# ── constants and the actor ─────────────────────────────────────────────────


def test_the_constants():
    assert svc._PPM_MANAGED_FIELDS == {"costBudget", "costActual"}
    assert svc._ALLOWED_URL_SCHEMES == ("http://", "https://", "mailto:")
    assert svc.MACRO_CAPABILITY_LEVEL_KEY == "Macro"


async def test_an_actor_from_a_user_carries_its_id_and_name(db):
    user = await create_user(db, email="w@test.com", display_name="Wendy")
    assert WriteActor.from_user(user) == WriteActor(user_id=user.id, display_name="Wendy")
    assert WriteActor.from_user(user).ext_key is None


def test_an_extension_stamp_is_a_copy_and_a_user_gets_the_payload_back():
    data = {"id": "1"}
    stamped = svc._stamp_ext(WriteActor(None, "Bot", ext_key="sync"), data)
    assert stamped == {"id": "1", "ext": "sync"}
    assert data == {"id": "1"}
    assert svc._stamp_ext(WriteActor(uuid.uuid4(), "Wendy"), data) is data


# ── PPM-managed fields ──────────────────────────────────────────────────────


async def test_only_an_initiative_has_ppm_managed_fields(db):
    await create_card_type(db, key="Initiative", label="Initiative")
    app = await create_card(db, name="App")
    await create_budget_line(db, initiative_id=app.id, amount=10)
    assert await svc._get_ppm_exclusions(db, app) == set()


@pytest.mark.parametrize(
    "budget,cost,expected",
    [
        (False, False, set()),
        (True, False, {"costBudget"}),
        (False, True, {"costActual"}),
        (True, True, {"costBudget", "costActual"}),
    ],
)
async def test_each_kind_of_ppm_line_claims_its_own_field(db, budget, cost, expected):
    await create_card_type(db, key="Initiative", label="Initiative")
    ini = await create_card(db, card_type="Initiative", name="Programme")
    if budget:
        await create_budget_line(db, initiative_id=ini.id, amount=10)
    if cost:
        await create_cost_line(db, initiative_id=ini.id)
    assert await svc._get_ppm_exclusions(db, ini) == expected


async def test_recalculate_and_rescore_runs_the_calculations_first(db, monkeypatch):
    await create_card_type(db, key="Initiative", label="Initiative")
    ini = await create_card(db, card_type="Initiative", name="Programme")
    await create_budget_line(db, initiative_id=ini.id, amount=10)
    order = []

    async def calc(db_, card, exclude_fields=None):
        order.append(("calc", card.id, exclude_fields))

    async def score(db_, card):
        order.append(("score", card.id))
        return 42.0

    monkeypatch.setattr(svc, "run_calculations_for_card", calc)
    monkeypatch.setattr(svc, "calc_data_quality", score)
    await svc.recalculate_and_rescore(db, ini)
    assert order == [("calc", ini.id, {"costBudget"}), ("score", ini.id)]
    assert ini.data_quality == 42.0


# ── references ──────────────────────────────────────────────────────────────


async def test_a_reference_is_assigned_only_in_auto_mode(db):
    auto = await create_card_type(db, key="Auto", label="Auto")
    auto.reference_config = {"mode": "auto", "prefix": "AU-", "start": 7, "padding": 3}
    off = await create_card_type(db, key="Off", label="Off")
    off.reference_config = {"mode": "off", "prefix": "OF-"}
    await db.flush()
    a = await create_card(db, card_type="Auto", name="A")
    o = await create_card(db, card_type="Off", name="O")
    await svc._assign_reference_on_create(db, a, auto)
    await svc._assign_reference_on_create(db, o, off)
    assert a.reference == "AU-007"
    assert o.reference is None


async def test_no_card_type_assigns_no_reference(db):
    await create_card_type(db)
    card = await create_card(db, name="A")
    await svc._assign_reference_on_create(db, card, None)
    assert card.reference is None


# ── URL fields ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value",
    [
        "http://example.com",
        "https://example.com",
        "mailto:team@example.com",
        "  https://padded.example.com",
        "",
        None,
    ],
)
async def test_an_allowed_or_empty_url_passes(db, env, value):
    await svc._validate_url_attributes(db, "Application", {"website": value})


@pytest.mark.parametrize("value", ["javascript:alert(1)", "ftp://x", "example.com", "HTTP://X"])
async def test_a_url_with_another_scheme_is_refused(db, env, value):
    with pytest.raises(HTTPException) as exc:
        await svc._validate_url_attributes(db, "Application", {"docs": value})
    assert detail_of(exc) == (422, "Field 'docs' must use http://, https://, or mailto: scheme")


async def test_a_url_that_is_not_a_string_is_refused(db, env):
    with pytest.raises(HTTPException) as exc:
        await svc._validate_url_attributes(db, "Application", {"website": 42})
    assert detail_of(exc) == (422, "Field 'website' must be a string URL")


async def test_only_url_typed_fields_are_checked(db, env):
    await svc._validate_url_attributes(db, "Application", {"notes": "javascript:alert(1)"})


async def test_a_type_without_a_schema_checks_no_url(db, env):
    await svc._validate_url_attributes(db, "Bare", {"website": "javascript:alert(1)"})
    await svc._validate_url_attributes(db, "Nonexistent", {"website": "javascript:alert(1)"})


async def test_no_attributes_skip_the_url_check_without_a_query(db, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("queried")

    monkeypatch.setattr(db, "execute", boom)
    await svc._validate_url_attributes(db, "Application", {})


# ── percentage fields ───────────────────────────────────────────────────────


@pytest.mark.parametrize("value", [0, 100, 50.5, 0.0, None, ""])
async def test_a_percentage_in_range_or_empty_passes(db, env, value):
    await svc._validate_percentage_attributes(db, "Application", {"progress": value})


@pytest.mark.parametrize("value", [-1, 100.01, 101, True, False, "50", [50]])
async def test_a_percentage_out_of_range_or_not_a_number_is_refused(db, env, value):
    with pytest.raises(HTTPException) as exc:
        await svc._validate_percentage_attributes(db, "Application", {"uptime": value})
    assert detail_of(exc) == (422, "Field 'uptime' must be a number between 0 and 100")


async def test_an_empty_percentage_does_not_end_the_scan(db):
    # The keys are scanned in set order, so bury the bad one among many empty
    # ones: an early exit on an empty field would let it through.
    fields = [{"key": f"p{i}", "type": "percentage"} for i in range(30)]
    await create_card_type(db, key="Many", label="Many", fields_schema=[{"fields": fields}])
    attrs = {f"p{i}": None for i in range(30)} | {"p17": 150}
    with pytest.raises(HTTPException) as exc:
        await svc._validate_percentage_attributes(db, "Many", attrs)
    assert exc.value.detail == "Field 'p17' must be a number between 0 and 100"


async def test_only_percentage_typed_fields_are_range_checked(db, env):
    await svc._validate_percentage_attributes(db, "Application", {"notes": 500})
    await svc._validate_percentage_attributes(db, "Bare", {"progress": 500})
    await svc._validate_percentage_attributes(db, "Nonexistent", {"progress": 500})


async def test_no_attributes_skip_the_percentage_check_without_a_query(db, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("queried")

    monkeypatch.setattr(db, "execute", boom)
    await svc._validate_percentage_attributes(db, "Application", {})


# ── required fields are never cleared ───────────────────────────────────────


@pytest.mark.parametrize(
    "value,empty",
    [(None, True), ("", True), ([], True), (0, False), (False, False), ({}, False), (" ", False)],
)
def test_what_counts_as_an_empty_attribute(value, empty):
    assert svc._is_empty_attr(value) is empty


REQUIRED_SCHEMA = [
    {
        "section": "A",
        "fields": [
            {"key": "owner", "label": "Owner", "type": "text", "required": True},
            {"key": "tier", "type": "text", "required": True},
            {"key": "flag", "label": "Flag", "type": "boolean", "required": True},
            {"key": "calc", "label": "Calc", "type": "number", "required": True, "readonly": True},
            {"key": "free", "label": "Free", "type": "text"},
            {"label": "No key", "type": "text", "required": True},
        ],
    },
    {"section": "B"},
]


def test_clearing_required_fields_is_refused_with_every_one_named():
    old = {"owner": "Ann", "tier": "gold", "flag": True, "calc": 3, "free": "x"}
    new = {"owner": "", "tier": None, "flag": None, "calc": None, "free": ""}
    with pytest.raises(HTTPException) as exc:
        svc._check_required_not_cleared("Application", REQUIRED_SCHEMA, new, old)
    assert detail_of(exc) == (
        422,
        {
            "code": "required_field_empty",
            "message": "Required field(s) cannot be emptied: Owner, tier.",
            "field_keys": ["owner", "tier"],
            "card_type": "Application",
        },
    )


def test_a_key_missing_from_the_new_attributes_counts_as_cleared():
    with pytest.raises(HTTPException) as exc:
        svc._check_required_not_cleared("Application", REQUIRED_SCHEMA, {}, {"owner": ["a"]})
    assert exc.value.detail["field_keys"] == ["owner"]


@pytest.mark.parametrize(
    "old,new",
    [
        ({}, {}),  # never filled
        ({"owner": ""}, {"owner": ""}),  # already empty
        ({"owner": "Ann"}, {"owner": "Bob"}),  # changed, still filled
        ({"flag": True}, {}),  # booleans are exempt
        ({"calc": 1}, {}),  # readonly (calculated) fields are exempt
        ({"free": "x"}, {}),  # not required
    ],
)
def test_what_is_not_a_clearing(old, new):
    svc._check_required_not_cleared("Application", REQUIRED_SCHEMA, new, old)


def test_no_schema_means_no_required_fields():
    svc._check_required_not_cleared("Application", None, {}, {"owner": "Ann"})
    svc._check_required_not_cleared("Application", [], {}, {"owner": "Ann"})


async def test_the_required_check_reads_the_stored_schema(db):
    await create_card_type(db, key="Req", label="Req", fields_schema=REQUIRED_SCHEMA)
    with pytest.raises(HTTPException) as exc:
        await svc._validate_required_attributes(db, "Req", {}, {"tier": "gold"})
    assert exc.value.detail["field_keys"] == ["tier"]
    assert exc.value.detail["card_type"] == "Req"


# ── select options ──────────────────────────────────────────────────────────


SELECT_SCHEMA = [
    {
        "section": "A",
        "fields": [
            {
                "key": "criticality",
                "label": "Criticality",
                "type": "single_select",
                "options": [{"key": "high"}, {"key": "low"}, {"label": "keyless"}],
            },
            {
                "key": "regions",
                "type": "multiple_select",
                "options": [{"key": "eu"}, {"key": "us"}],
            },
            {
                "key": "zero",
                "label": "Zero",
                "type": "single_select",
                "options": [{"key": 0}, {"key": 1}],
            },
            {
                "key": "computed",
                "label": "Computed",
                "type": "single_select",
                "readonly": True,
                "options": [{"key": "a"}],
            },
            {"key": "openended", "label": "Open", "type": "single_select", "options": []},
            {"key": "text", "label": "Text", "type": "text", "options": [{"key": "a"}]},
            {"key": "custom", "type": "ext.vendor.picker", "options": [{"key": "a"}]},
            {"label": "No key", "type": "single_select", "options": [{"key": "a"}]},
        ],
    },
    {"section": "B"},
]


def check_select(new, old=None):
    svc._check_select_options("Application", SELECT_SCHEMA, new, old or {})


def test_a_single_select_outside_its_options_is_refused():
    with pytest.raises(HTTPException) as exc:
        check_select({"criticality": "mid"})
    assert detail_of(exc) == (
        422,
        {
            "code": "invalid_option_value",
            "message": (
                "Invalid value for select field(s): 'Criticality' got 'mid'; "
                "valid options: high, low."
            ),
            "field_keys": ["criticality"],
            "card_type": "Application",
        },
    )


def test_a_multiple_select_that_is_not_a_list_is_refused_with_its_type():
    with pytest.raises(HTTPException) as exc:
        check_select({"regions": "eu,us"})
    assert exc.value.detail["message"] == (
        "Invalid value for select field(s): 'regions' expects a list of option keys, got str."
    )
    assert exc.value.detail["field_keys"] == ["regions"]


def test_a_multiple_select_names_only_its_bad_entries():
    with pytest.raises(HTTPException) as exc:
        check_select({"regions": ["eu", "xx", 3]})
    assert exc.value.detail["message"] == (
        "Invalid value for select field(s): 'regions' got 'xx', 3; valid options: eu, us."
    )


def test_every_bad_field_is_reported_in_schema_order():
    with pytest.raises(HTTPException) as exc:
        check_select({"zero": 0, "regions": "eu", "criticality": "mid"})
    assert exc.value.detail["field_keys"] == ["criticality", "regions", "zero"]
    assert exc.value.detail["message"] == (
        "Invalid value for select field(s): 'Criticality' got 'mid'; valid options: high, low; "
        "'regions' expects a list of option keys, got str; "
        "'Zero' got 0; valid options: 0, 1."
    )


@pytest.mark.parametrize(
    "new,old",
    [
        ({"criticality": "high"}, {}),
        ({"regions": ["us", "eu"]}, {}),
        ({"zero": "0"}, {}),  # option keys compare as strings, a falsy key included
        ({"criticality": None}, {}),  # clearing is not invalid
        ({"criticality": ""}, {}),
        ({"regions": []}, {}),
        ({"criticality": "legacy"}, {"criticality": "legacy"}),  # unchanged legacy value
        ({"computed": "zzz"}, {}),  # readonly: the calculation engine writes it
        ({"openended": "zzz"}, {}),  # no options declared
        ({"text": "zzz"}, {}),  # not a select
        ({"custom": "zzz"}, {}),  # an extension type
        ({"unknown": "zzz"}, {}),  # not in the schema
        ({}, {"criticality": "legacy"}),  # not being written
    ],
)
def test_what_the_option_check_lets_through(new, old):
    check_select(new, old)


def test_no_skip_rule_ends_the_option_scan():
    schema = [
        {
            "fields": [
                {"key": "text", "type": "text", "options": [{"key": "a"}]},
                {"key": "absent", "type": "single_select", "options": [{"key": "a"}]},
                {"key": "blank", "type": "single_select", "options": [{"key": "a"}]},
                {"key": "legacy", "type": "single_select", "options": [{"key": "a"}]},
                {
                    "key": "calc",
                    "type": "single_select",
                    "readonly": True,
                    "options": [{"key": "a"}],
                },
                {"key": "open", "type": "single_select", "options": []},
                {"key": "last", "type": "single_select", "options": [{"key": "a"}]},
            ]
        }
    ]
    new = {"text": "zzz", "blank": "", "legacy": "old", "calc": "zzz", "open": "zzz", "last": "b"}
    with pytest.raises(HTTPException) as exc:
        svc._check_select_options("Application", schema, new, {"legacy": "old"})
    assert exc.value.detail["field_keys"] == ["last"]


def test_no_schema_means_no_options():
    svc._check_select_options("Application", None, {"criticality": "x"}, {})


async def test_the_option_check_reads_the_stored_schema(db):
    await create_card_type(db, key="Sel", label="Sel", fields_schema=SELECT_SCHEMA)
    with pytest.raises(HTTPException) as exc:
        await svc._validate_select_attributes(db, "Sel", {"criticality": "mid"}, {})
    assert exc.value.detail["card_type"] == "Sel"


async def test_no_attributes_skip_the_option_check_without_a_query(db, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("queried")

    monkeypatch.setattr(db, "execute", boom)
    await svc._validate_select_attributes(db, "Sel", {}, {"criticality": "x"})


# ── hierarchy link labels ───────────────────────────────────────────────────


LABELS = [{"key": "commercial", "label": "Commercial"}, {"key": "sales"}, {"label": "keyless"}]


def test_a_label_on_a_card_without_a_parent_is_refused():
    with pytest.raises(HTTPException) as exc:
        svc._check_hierarchy_label("Organization", LABELS, "commercial", None, has_parent=False)
    assert detail_of(exc) == (
        422,
        {
            "code": "hierarchy_label_without_parent",
            "message": (
                "A hierarchy link label describes the link to a parent card, "
                "so it cannot be set on a card that has no parent."
            ),
            "card_type": "Organization",
        },
    )


def test_an_undeclared_label_is_refused_with_the_valid_ones():
    with pytest.raises(HTTPException) as exc:
        svc._check_hierarchy_label("Organization", LABELS, "legal", None, has_parent=True)
    assert detail_of(exc) == (
        422,
        {
            "code": "invalid_hierarchy_label",
            "message": (
                "Card type 'Organization' does not define hierarchy link label 'legal'; "
                "valid labels: commercial, sales."
            ),
            "valid_labels": ["commercial", "sales"],
            "card_type": "Organization",
        },
    )


@pytest.mark.parametrize("vocabulary", [None, [], [{"label": "keyless"}]])
def test_a_type_with_no_labels_says_so(vocabulary):
    with pytest.raises(HTTPException) as exc:
        svc._check_hierarchy_label("Organization", vocabulary, "legal", None, has_parent=True)
    assert exc.value.detail["message"] == (
        "Card type 'Organization' does not define hierarchy link label 'legal'."
    )
    assert exc.value.detail["valid_labels"] == []


@pytest.mark.parametrize(
    "new,old,has_parent",
    [
        ("sales", None, True),
        (None, "sales", False),  # clearing
        ("", "sales", False),
        ("gone", "gone", False),  # unchanged, even a stale one with no parent
    ],
)
def test_what_the_label_check_lets_through(new, old, has_parent):
    svc._check_hierarchy_label("Organization", LABELS, new, old, has_parent)


async def test_the_label_check_reads_the_stored_vocabulary(db):
    await create_card_type(db, key="Organization", label="Org", hierarchy_labels=LABELS)
    await svc._validate_hierarchy_label(db, "Organization", "sales", None, has_parent=True)
    with pytest.raises(HTTPException) as exc:
        await svc._validate_hierarchy_label(db, "Organization", "legal", None, has_parent=True)
    assert exc.value.detail == {
        "code": "invalid_hierarchy_label",
        "message": (
            "Card type 'Organization' does not define hierarchy link label 'legal'; "
            "valid labels: commercial, sales."
        ),
        "valid_labels": ["commercial", "sales"],
        "card_type": "Organization",
    }


@pytest.mark.parametrize("new,old", [(None, "x"), ("", None), ("same", "same")])
async def test_an_unchanged_or_cleared_label_skips_the_query(db, monkeypatch, new, old):
    async def boom(*a, **k):
        raise AssertionError("queried")

    monkeypatch.setattr(db, "execute", boom)
    await svc._validate_hierarchy_label(db, "Organization", new, old, has_parent=False)


# ── strict attributes ───────────────────────────────────────────────────────


async def test_strict_mode_refuses_undeclared_keys_with_both_lists_sorted(db, env):
    with pytest.raises(HTTPException) as exc:
        await svc._validate_strict_attributes(
            db, "Application", {"zeta": 1, "website": "https://x", "alpha": 2}
        )
    assert detail_of(exc) == (
        422,
        {
            "error": "unknown_attribute_keys",
            "message": (
                "Card type 'Application' does not define attribute(s): alpha, zeta. "
                "Set strict_attributes=False to store side-channel JSONB metadata anyway."
            ),
            "unknown_keys": ["alpha", "zeta"],
            "valid_keys": ["docs", "notes", "progress", "uptime", "website"],
            "card_type": "Application",
        },
    )


async def test_strict_mode_ignores_a_keyless_field(db):
    await create_card_type(
        db,
        key="Odd",
        label="Odd",
        fields_schema=[{"section": "A", "fields": [{"label": "x"}, {"key": "", "label": "y"}]}],
    )
    with pytest.raises(HTTPException) as exc:
        await svc._validate_strict_attributes(db, "Odd", {"y": 1})
    assert exc.value.detail["valid_keys"] == []


async def test_strict_mode_accepts_declared_keys(db, env):
    await svc._validate_strict_attributes(db, "Application", {"website": "https://x"})
    await svc._validate_strict_attributes(db, "Bare", {"anything": 1})
    await svc._validate_strict_attributes(db, "Nonexistent", {"anything": 1})


async def test_no_attributes_skip_the_strict_check_without_a_query(db, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("queried")

    monkeypatch.setattr(db, "execute", boom)
    await svc._validate_strict_attributes(db, "Application", {})


# ── hierarchy guards ────────────────────────────────────────────────────────


async def chain(db, type_key, names, *, root_attrs=None):
    """Build a parent chain; returns the cards root first."""
    cards = []
    parent = None
    for i, name in enumerate(names):
        attrs = root_attrs if (i == 0 and root_attrs is not None) else {}
        card = await create_card(
            db,
            card_type=type_key,
            name=name,
            parent_id=parent.id if parent else None,
            attributes=attrs,
        )
        cards.append(card)
        parent = card
    return cards


@pytest.fixture
async def caps(db):
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_card_type(db, key="Application", label="Application", has_hierarchy=True)
    await create_card_type(db, key="Provider", label="Provider")
    return {}


async def test_the_deepest_active_branch_sets_the_subtree_depth(db, caps):
    root, mid, leaf = await chain(db, "Application", ["R", "M", "L"])
    await create_card(db, name="Side", parent_id=root.id)
    await create_card(db, name="Archived", parent_id=leaf.id, status="ARCHIVED")
    assert await svc._max_descendant_depth(db, root.id) == 2
    assert await svc._max_descendant_depth(db, mid.id) == 1
    assert await svc._max_descendant_depth(db, leaf.id) == 0


async def test_walking_up_counts_every_ancestor(db, caps):
    a, b, c = await chain(db, "Application", ["A", "B", "C"])
    assert await svc._walk_ancestor_chain(db, c.id, exclude=set()) == (3, False)
    assert await svc._walk_ancestor_chain(db, b.id, exclude=set()) == (2, False)
    assert await svc._walk_ancestor_chain(db, None, exclude=set()) == (0, False)


async def test_walking_up_reports_a_macro_root(db, caps):
    macro, l1 = await chain(
        db, "BusinessCapability", ["M", "L1"], root_attrs={"capabilityLevel": "Macro"}
    )
    plain, child = await chain(
        db, "BusinessCapability", ["P", "P1"], root_attrs={"capabilityLevel": "L1"}
    )
    assert await svc._walk_ancestor_chain(db, l1.id, exclude=set()) == (2, True)
    assert await svc._walk_ancestor_chain(db, macro.id, exclude=set()) == (1, True)
    assert await svc._walk_ancestor_chain(db, child.id, exclude=set()) == (2, False)


async def test_walking_up_stops_at_an_excluded_card(db, caps):
    macro, l1, l2 = await chain(
        db, "BusinessCapability", ["M", "L1", "L2"], root_attrs={"capabilityLevel": "Macro"}
    )
    # The excluded card is never read, so the macro root above it is not reached.
    assert await svc._walk_ancestor_chain(db, l2.id, exclude={l1.id}) == (1, False)
    assert await svc._walk_ancestor_chain(db, l2.id, exclude={l2.id}) == (0, False)


async def test_walking_up_a_loop_or_into_a_missing_card_ends(db, caps):
    a = await create_card(db, name="A")
    b = await create_card(db, name="B", parent_id=a.id)
    a.parent_id = b.id
    await db.flush()
    assert await svc._walk_ancestor_chain(db, a.id, exclude=set()) == (2, False)
    assert await svc._walk_ancestor_chain(db, uuid.uuid4(), exclude=set()) == (1, False)


async def test_a_card_cannot_become_its_own_parent(db, caps):
    a = await create_card(db, name="A")
    with pytest.raises(HTTPException) as exc:
        await svc._check_parent_not_descendant(db, {a.id}, a.id)
    assert detail_of(exc) == (400, "Cannot set a card as its own parent")


async def test_a_card_cannot_move_under_its_own_descendant(db, caps):
    a, b, c, d = await chain(db, "Application", ["A", "B", "C", "D"])
    other = await create_card(db, name="Other")
    for moving in ({a.id}, {other.id, b.id}):
        with pytest.raises(HTTPException) as exc:
            await svc._check_parent_not_descendant(db, moving, d.id)
        assert detail_of(exc) == (
            400,
            "Cannot set parent: the chosen parent is a descendant of a card "
            "being moved, which would create a hierarchy cycle",
        )


async def test_moves_that_cannot_cycle_pass(db, caps):
    a, b, c = await chain(db, "Application", ["A", "B", "C"])
    other = await create_card(db, name="Other")
    await svc._check_parent_not_descendant(db, {c.id}, a.id)  # moving up
    await svc._check_parent_not_descendant(db, {other.id}, c.id)  # unrelated
    await svc._check_parent_not_descendant(db, {a.id}, None)  # to the root
    await svc._check_parent_not_descendant(db, {a.id}, uuid.uuid4())  # unknown parent


async def test_a_loop_above_the_new_parent_ends_the_cycle_check(db, caps):
    a = await create_card(db, name="A")
    b = await create_card(db, name="B", parent_id=a.id)
    a.parent_id = b.id
    other = await create_card(db, name="Other")
    await db.flush()
    await svc._check_parent_not_descendant(db, {other.id}, a.id)


async def test_the_depth_limit_is_five_levels(db, caps):
    *_, l5 = await chain(db, "BusinessCapability", ["1", "2", "3", "4", "5"])
    l4 = _[3]
    moving = await create_card(db, card_type="BusinessCapability", name="X")
    await create_card(db, card_type="BusinessCapability", name="X1", parent_id=moving.id)
    with pytest.raises(HTTPException) as exc:
        await svc._check_hierarchy_depth(db, moving, l5.id)
    assert detail_of(exc) == (
        400,
        "Cannot set parent: hierarchy would exceed maximum depth of 5 levels "
        "(this item would be L6, deepest descendant would be L7)",
    )
    with pytest.raises(HTTPException) as exc:
        await svc._check_hierarchy_depth(db, moving, l4.id)
    assert exc.value.detail.endswith("(this item would be L5, deepest descendant would be L6)")
    leaf = await create_card(db, card_type="BusinessCapability", name="Leaf")
    await svc._check_hierarchy_depth(db, leaf, l4.id)  # exactly L5


async def test_a_macro_root_allows_a_sixth_level(db, caps):
    levels = await chain(
        db,
        "BusinessCapability",
        ["M", "1", "2", "3", "4"],
        root_attrs={"capabilityLevel": "Macro"},
    )
    leaf = await create_card(db, card_type="BusinessCapability", name="Leaf")
    await svc._check_hierarchy_depth(db, leaf, levels[-1].id)
    await create_card(db, card_type="BusinessCapability", name="Below", parent_id=leaf.id)
    with pytest.raises(HTTPException) as exc:
        await svc._check_hierarchy_depth(db, leaf, levels[-1].id)
    assert detail_of(exc) == (
        400,
        "Cannot set parent: hierarchy would exceed maximum depth of 6 levels "
        "(this item would be L6, deepest descendant would be L7)",
    )


async def test_the_depth_limit_binds_only_capabilities_under_a_parent(db, caps):
    *_, deep = await chain(db, "Application", ["1", "2", "3", "4", "5", "6"])
    app = await create_card(db, name="App")
    await svc._check_hierarchy_depth(db, app, deep.id)
    cap = await create_card(db, card_type="BusinessCapability", name="Cap")
    await svc._check_hierarchy_depth(db, cap, None)


# ── hierarchy level sync ────────────────────────────────────────────────────


async def test_levels_follow_the_tree_and_cascade_to_active_children(db, caps):
    root, mid, leaf = await chain(db, "Application", ["R", "M", "L"])
    gone = await create_card(db, name="Gone", parent_id=leaf.id, status="ARCHIVED")
    previous: dict = {}
    changed = await svc._sync_hierarchy_levels(db, root, previous=previous)
    assert [c.id for c in changed] == [root.id, mid.id, leaf.id]
    assert [c.attributes["hierarchyLevel"] for c in (root, mid, leaf)] == [1, 2, 3]
    assert gone.attributes == {}
    assert previous == {root.id: {}, mid.id: {}, leaf.id: {}}
    assert "capabilityLevel" not in leaf.attributes


async def test_a_card_already_at_its_level_is_not_reported(db, caps):
    root = await create_card(db, name="R", attributes={"hierarchyLevel": 1, "x": 1})
    child = await create_card(db, name="C", parent_id=root.id, attributes={"hierarchyLevel": 9})
    previous: dict = {}
    changed = await svc._sync_hierarchy_levels(db, root, previous=previous)
    assert changed == [child]
    assert previous == {child.id: {"hierarchyLevel": 9}}
    assert root.attributes == {"hierarchyLevel": 1, "x": 1}
    assert await svc._sync_hierarchy_levels(db, root) == []


async def test_capability_levels_are_capped_at_five(db, caps):
    cards = await chain(db, "BusinessCapability", ["1", "2", "3", "4", "5", "6"])
    await svc._sync_hierarchy_levels(db, cards[0])
    assert [c.attributes["capabilityLevel"] for c in cards] == ["L1", "L2", "L3", "L4", "L5", "L5"]
    assert [c.attributes["hierarchyLevel"] for c in cards] == [1, 2, 3, 4, 5, 6]


async def test_under_a_macro_the_levels_shift_and_the_macro_stays_pinned(db, caps):
    macro, l1, l2 = await chain(
        db, "BusinessCapability", ["M", "A", "B"], root_attrs={"capabilityLevel": "Macro"}
    )
    changed = await svc._sync_hierarchy_levels(db, macro)
    assert macro.attributes == {"capabilityLevel": "Macro", "hierarchyLevel": 1}
    assert l1.attributes == {"capabilityLevel": "L1", "hierarchyLevel": 2}
    assert l2.attributes == {"capabilityLevel": "L2", "hierarchyLevel": 3}
    assert changed == [macro, l1, l2]


async def test_a_capability_already_at_its_level_is_not_reported(db, caps):
    root = await create_card(
        db,
        card_type="BusinessCapability",
        name="R",
        attributes={"hierarchyLevel": 1, "capabilityLevel": "L1"},
    )
    child = await create_card(
        db,
        card_type="BusinessCapability",
        name="C",
        parent_id=root.id,
        attributes={"hierarchyLevel": 2, "capabilityLevel": "L4"},
    )
    previous: dict = {}
    assert await svc._sync_hierarchy_levels(db, root, previous=previous) == [child]
    assert child.attributes == {"hierarchyLevel": 2, "capabilityLevel": "L2"}
    assert previous == {child.id: {"hierarchyLevel": 2, "capabilityLevel": "L4"}}
    assert await svc._sync_hierarchy_levels(db, root) == []


async def test_a_capability_type_without_hierarchy_still_gets_its_level(db):
    await create_card_type(db, key="BusinessCapability", label="Business Capability")
    root, child = await chain(db, "BusinessCapability", ["R", "C"])
    await svc._sync_hierarchy_levels(db, root)
    assert root.attributes == {"capabilityLevel": "L1"}
    assert child.attributes == {"capabilityLevel": "L2"}


async def test_a_flat_type_is_left_alone_and_does_not_cascade(db, caps):
    flat = await create_card(db, card_type="Provider", name="Vendor")
    below = await create_card(db, card_type="Application", name="Below", parent_id=flat.id)
    assert await svc._sync_hierarchy_levels(db, flat) == []
    assert flat.attributes == {}
    assert below.attributes == {}


async def test_the_cascade_events_record_each_moved_descendant(db, caps, monkeypatch):
    published = []

    async def fake(event_type, data, db=None, card_id=None, user_id=None, batch_id=None):
        published.append((event_type, data, db, card_id, user_id))

    monkeypatch.setattr(svc.event_bus, "publish", fake)
    primary = await create_card(db, name="P", attributes={"hierarchyLevel": 2})
    moved = await create_card(db, name="M", attributes={"hierarchyLevel": 3, "k": 1})
    same = await create_card(db, name="S", attributes={"hierarchyLevel": 4})
    unknown = await create_card(db, name="U", attributes={"hierarchyLevel": 5})
    actor = uuid.uuid4()
    previous = {
        primary.id: {"hierarchyLevel": 1},
        moved.id: {"hierarchyLevel": 2, "k": 1},
        same.id: {"hierarchyLevel": 4},
    }
    await svc.emit_hierarchy_cascade_events(
        db, [primary, moved, same, unknown], previous, primary.id, actor
    )
    assert published == [
        (
            "card.updated",
            {
                "id": str(moved.id),
                "source": "hierarchy_cascade",
                "changes": {
                    "attributes": {
                        "old": {"hierarchyLevel": 2, "k": 1},
                        "new": {"hierarchyLevel": 3, "k": 1},
                    }
                },
            },
            db,
            moved.id,
            actor,
        )
    ]


async def test_descendants_are_recalculated_but_not_the_primary(db, caps, monkeypatch):
    await create_card_type(db, key="Initiative", label="Initiative")
    primary = await create_card(db, name="P")
    child = await create_card(db, name="C")
    ini = await create_card(db, card_type="Initiative", name="I")
    await create_cost_line(db, initiative_id=ini.id)
    calls = []

    async def calc(db_, card, exclude_fields=None):
        calls.append((card.id, exclude_fields))

    monkeypatch.setattr(svc, "run_calculations_for_card", calc)
    await svc._recalc_changed_descendants(db, [primary, child, ini], primary.id)
    assert calls == [(child.id, set()), (ini.id, {"costActual"})]
