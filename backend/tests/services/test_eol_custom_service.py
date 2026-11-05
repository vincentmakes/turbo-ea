"""Pure pieces of the custom EOL product feature: the link vocabulary, the
cycle shape, the switch plan, the schema validators and the resolver's
custom branch. No database needed."""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.eol_custom_cycle import EolCustomCycle
from app.schemas.eol_custom import (
    EolCustomCycleCreate,
    EolCustomCycleUpdate,
    EolCustomProductCreate,
    EolCustomProductUpdate,
    check_category,
    check_date,
    check_link,
    check_milestone,
    parse_iso_date,
)
from app.services import eol_custom_service as svc
from app.services import eol_service

TODAY = date.today()
PAST = (TODAY - timedelta(days=30)).isoformat()
FUTURE = (TODAY + timedelta(days=1000)).isoformat()


class TestLinkVocabulary:
    def test_prefix_round_trip(self):
        assert svc.product_ref("acme") == "custom:acme"
        assert svc.key_of("custom:acme") == "acme"

    @pytest.mark.parametrize(
        ("value", "expected"),
        [("custom:acme", True), ("custom:", True), ("python", False), (None, False), (3, False)],
    )
    def test_is_custom_product(self, value, expected):
        assert svc.is_custom_product(value) is expected


def _cycle(name, release=None, sort_order=0, **kw):
    return EolCustomCycle(
        product_key="acme", cycle=name, release_date=release, sort_order=sort_order, **kw
    )


class TestCycleShape:
    def test_cycle_to_dict_matches_endoflife_date(self):
        c = _cycle("1", "2020-01-01", eol=True, support="2022-01-01", latest="1.9")
        c.latest_release_date = "2021-05-05"
        assert svc.cycle_to_dict(c) == {
            "cycle": "1",
            "releaseDate": "2020-01-01",
            "eol": True,
            "support": "2022-01-01",
            "latest": "1.9",
            "latestReleaseDate": "2021-05-05",
        }

    def test_sorted_newest_first_then_undated_then_sort_order(self):
        cycles = [
            _cycle("old", "2019-01-01"),
            _cycle("undated"),
            _cycle("new", "2024-01-01"),
            _cycle("pinned-last", "2030-01-01", sort_order=1),
        ]
        assert [c.cycle for c in svc.sorted_cycles(cycles)] == [
            "new",
            "old",
            "undated",
            "pinned-last",
        ]


class TestPlanSwitch:
    UP = [{"cycle": "2024"}, {"cycle": 2020}]

    def test_moves_only_mapped_cycles(self):
        moves = svc.plan_switch(["1", "2", "3"], self.UP, {"1": "2020", "2": None, "3": "2024"})
        assert moves == {"1": "2020", "3": "2024"}

    def test_unknown_custom_cycle(self):
        with pytest.raises(HTTPException) as exc:
            svc.plan_switch(["1"], self.UP, {"9": "2020", "8": None})
        assert exc.value.status_code == 422
        assert "8, 9" in exc.value.detail

    def test_unknown_upstream_cycle(self):
        with pytest.raises(HTTPException) as exc:
            svc.plan_switch(["1", "2"], self.UP, {"1": "1999", "2": "1998"})
        assert exc.value.status_code == 422
        assert "1998, 1999" in exc.value.detail

    def test_empty_map_moves_nothing(self):
        assert svc.plan_switch(["1"], self.UP, {}) == {}


class TestValidators:
    @pytest.mark.parametrize(
        ("value", "ok"),
        [("2024-02-29", True), ("2023-02-29", False), ("2024-2-1", False), ("x", False)],
    )
    def test_parse_iso_date(self, value, ok):
        assert (parse_iso_date(value) is not None) is ok

    def test_check_date(self):
        assert check_date(None) is None
        assert check_date("") is None
        assert check_date("2024-01-01") == "2024-01-01"
        for bad in ("2024-13-01", 20240101, True):
            with pytest.raises(ValueError):
                check_date(bad)

    def test_check_milestone_accepts_booleans(self):
        assert check_milestone(True) is True
        assert check_milestone(False) is False
        assert check_milestone("2024-01-01") == "2024-01-01"
        with pytest.raises(ValueError):
            check_milestone("soon")

    def test_check_link(self):
        assert check_link(None) is None
        assert check_link("  ") is None
        assert check_link(" https://x.example/a ") == "https://x.example/a"
        assert check_link("HTTP://x.example") == "HTTP://x.example"
        for bad in ("javascript:alert(1)", "ftp://x", "https://a b", "x" * 501):
            with pytest.raises(ValueError):
                check_link(bad)

    def test_cycle_end_must_follow_release(self):
        ok = EolCustomCycleCreate(cycle="1", releaseDate="2020-01-01", eol="2020-01-01")
        assert ok.eol == "2020-01-01"
        with pytest.raises(ValidationError):
            EolCustomCycleCreate(cycle="1", releaseDate="2020-01-02", eol="2020-01-01")
        with pytest.raises(ValidationError):
            EolCustomCycleCreate(cycle="1", releaseDate="2020-01-02", support="2019-01-01")
        # A boolean end never conflicts with a release date.
        assert EolCustomCycleCreate(cycle="1", releaseDate="2020-01-02", eol=True).eol is True

    def test_cycle_name_is_trimmed(self):
        assert EolCustomCycleCreate(cycle="  1.10 ", eol=False).cycle == "1.10"

    def test_an_end_of_life_is_required_on_create(self):
        """endoflife.date requires `eol` on every release; `support` may stay unknown."""
        for value in (False, True, "2030-01-01"):
            assert EolCustomCycleCreate(cycle="1", eol=value).eol == value
        assert EolCustomCycleCreate(cycle="1", eol=False, support=None).support is None
        with pytest.raises(ValidationError):
            EolCustomCycleCreate(cycle="1")
        for blank in (None, ""):
            with pytest.raises(ValidationError, match="end of life is required"):
                EolCustomCycleCreate(cycle="1", eol=blank)

    def test_an_update_may_leave_the_end_of_life_alone_but_not_clear_it(self):
        assert EolCustomCycleUpdate(latest="2").eol is None
        assert EolCustomCycleUpdate(eol=True).eol is True
        for blank in (None, ""):
            with pytest.raises(ValidationError, match="end of life is required"):
                EolCustomCycleUpdate(eol=blank)

    def test_category_must_be_one_of_endoflife_dates(self):
        assert check_category(None) is None
        assert check_category("  ") is None
        assert check_category(" server-app ") == "server-app"
        with pytest.raises(ValueError, match="must be one of"):
            check_category("toaster")
        assert EolCustomProductUpdate(eol_category="os").eol_category == "os"
        with pytest.raises(ValidationError):
            EolCustomProductUpdate(eol_category="Apps")

    @pytest.mark.parametrize(
        ("key", "ok"),
        [
            ("acme-erp", True),
            ("a.b_c-1", True),
            ("x" * 100, True),
            ("x" * 101, False),
            ("-acme", False),
            ("Acme", False),
            ("custom:acme", False),
        ],
    )
    def test_product_key(self, key, ok):
        if ok:
            assert EolCustomProductCreate(key=key, title="T").key == key
        else:
            with pytest.raises(ValidationError):
                EolCustomProductCreate(key=key, title="T")

    def test_an_absent_key_is_generated_later(self):
        # No key, an empty one or blanks: the service derives it from the title.
        for given in (None, "", "  "):
            assert EolCustomProductCreate(key=given, title="T").key is None
        assert EolCustomProductCreate(title="T").key is None

    @pytest.mark.parametrize(
        ("title", "key"),
        [
            ("Acme ERP 2", "acme-erp-2"),
            ("  Éclair  Café ", "eclair-cafe"),
            ("SAP S/4HANA", "sap-s-4hana"),
            ("--Weird__name..", "weird__name"),
            ("🚀", ""),
            ("x" * 150, "x" * 100),
            ("a" * 99 + "-b", "a" * 99),
        ],
    )
    def test_product_key_from_title(self, title, key):
        from app.schemas.eol_custom import PRODUCT_KEY_RE, product_key_from_title

        out = product_key_from_title(title)
        assert out == key
        assert out == "" or PRODUCT_KEY_RE.match(out)

    def test_too_many_cycles(self):
        cycles = [{"cycle": str(i), "eol": False} for i in range(201)]
        with pytest.raises(ValidationError):
            EolCustomProductCreate(key="a", title="A", cycles=cycles)
        assert len(EolCustomProductCreate(key="a", title="A", cycles=cycles[:200]).cycles) == 200


def _card(cid, product=None, cycle=None, lifecycle=None):
    attrs = {"eol_product": product, "eol_cycle": cycle} if product else {}
    return SimpleNamespace(id=cid, attributes=attrs, lifecycle=lifecycle or {})


class TestResolver:
    async def test_custom_links_resolve_from_the_given_cycles(self):
        custom = {
            "custom:acme": [
                {"cycle": "1", "eol": PAST, "support": PAST, "latest": "1.4"},
                {"cycle": "2", "eol": False, "support": FUTURE, "latest": None},
                {"cycle": "3", "eol": False, "support": False, "latest": None},
            ]
        }
        fetch = AsyncMock(return_value=[{"cycle": "3.12", "eol": FUTURE}])
        with patch.object(eol_service, "fetch_product_cycles", fetch):
            out = await eol_service.resolve_eol_statuses(
                [
                    _card("a", "custom:acme", "1"),
                    _card("b", "custom:acme", "2"),
                    _card("c", "custom:gone", "1"),
                    _card("d", "python", "3.12"),
                    _card("e", "custom:acme", "3"),
                ],
                custom,
            )
        # Only the upstream product went out.
        assert [call.args[1] for call in fetch.await_args_list] == ["python"]
        assert out["a"] == {
            "status": "eol",
            "source": "custom",
            "eol_product": "custom:acme",
            "eol_product_title": None,
            "eol_cycle": "1",
            "eol_date": PAST,
            "support_date": PAST,
            "latest": "1.4",
        }
        assert (out["b"]["status"], out["b"]["eol_date"], out["b"]["support_date"]) == (
            "supported",
            None,
            FUTURE,
        )
        assert (out["c"]["status"], out["c"]["source"]) == ("unknown", "custom")
        assert (out["d"]["status"], out["d"]["source"]) == ("supported", "api")
        # "Support already ended" with no end of life announced: security
        # fixes only, so a warning (the same as a past support date).
        assert (out["e"]["status"], out["e"]["eol_date"], out["e"]["support_date"]) == (
            "approaching",
            None,
            None,
        )

    async def test_the_custom_product_title_rides_on_the_status(self):
        custom = {"custom:acme": [{"cycle": "1", "eol": False, "title": "Acme ERP"}]}
        out = await eol_service.resolve_eol_statuses(
            [_card("a", "custom:acme", "1"), _card("b", "custom:acme", "9")], custom
        )
        assert out["a"]["eol_product_title"] == "Acme ERP"
        # Even on a cycle the product no longer has, the product is still named.
        assert (out["b"]["status"], out["b"]["eol_product_title"]) == ("unknown", "Acme ERP")

    async def test_without_custom_cycles_a_custom_link_is_unknown(self):
        out = await eol_service.resolve_eol_statuses([_card("a", "custom:acme", "1")])
        assert out["a"]["status"] == "unknown"
        assert out["a"]["source"] == "custom"

    async def test_fetch_never_sends_a_custom_product_upstream(self):
        fetch = AsyncMock(return_value=[])
        with patch.object(eol_service, "fetch_product_cycles", fetch):
            assert await eol_service.fetch_cycles_for_products({"custom:a", "custom:b"}) == {}
        fetch.assert_not_awaited()


class TestLoadCustomCycles:
    """Callers hand in raw ``attributes.eol_product`` values — ``None``, a
    non-string, an upstream slug — and only ``custom:`` links are looked up."""

    async def test_reads_only_existing_custom_products(self, db):
        from app.models.eol_custom_product import EolCustomProduct

        db.add(EolCustomProduct(key="acme", title="Acme"))
        await db.flush()
        db.add_all([_cycle("2", "2024-01-01"), _cycle("1", "2020-01-01", eol=True)])
        await db.flush()

        out = await svc.load_custom_cycles(
            db, [None, 3, {"x": 1}, "python", "custom:acme", "custom:gone", "custom:acme"]
        )
        assert list(out) == ["custom:acme"]
        assert [c["cycle"] for c in out["custom:acme"]] == ["2", "1"]
        assert out["custom:acme"][1]["eol"] is True
        # Every cycle names its product: the resolver copies it to the status.
        assert {c["title"] for c in out["custom:acme"]} == {"Acme"}

    async def test_nothing_custom_means_no_query(self, db):
        assert await svc.load_custom_cycles(db, [None, "python", 7]) == {}
