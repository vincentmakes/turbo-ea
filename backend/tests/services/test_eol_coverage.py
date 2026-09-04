"""EOL coverage predicates and status classification.

`card_flags` owns what "this card has no end-of-life information" means, and
`eol_service` owns what "end of life" / "approaching" mean. Three surfaces read
them — the inventory filter and column, the Data Quality tile, the EOL report —
so a disagreement here is a user clicking a count of 37 and landing on a list
of something else.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.services.card_flags import (
    EOL_TYPES,
    has_eol_coverage,
    has_eol_link,
    has_manual_eol,
)
from app.services.eol_service import (
    APPROACHING_DAYS,
    eol_status,
    find_cycle,
    manual_eol_status,
)


def _iso(days_from_now: int) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=days_from_now)).isoformat()


class TestCoveragePredicates:
    def test_link_needs_both_halves(self):
        assert has_eol_link({"eol_product": "nginx", "eol_cycle": "1.25"}) is True
        # Half a link resolves to nothing upstream, so it is not coverage.
        assert has_eol_link({"eol_product": "nginx"}) is False
        assert has_eol_link({"eol_cycle": "1.25"}) is False
        assert has_eol_link({}) is False
        assert has_eol_link(None) is False

    def test_empty_strings_are_not_a_link(self):
        assert has_eol_link({"eol_product": "", "eol_cycle": ""}) is False

    def test_manual_date_is_coverage_in_its_own_right(self):
        assert has_manual_eol({"endOfLife": "2027-01-01"}) is True
        assert has_manual_eol({"active": "2020-01-01"}) is False
        assert has_manual_eol({}) is False
        assert has_manual_eol(None) is False

    def test_coverage_is_either_source(self):
        assert has_eol_coverage({"eol_product": "nginx", "eol_cycle": "1.25"}, None) is True
        assert has_eol_coverage(None, {"endOfLife": "2027-01-01"}) is True
        assert has_eol_coverage({}, {"active": "2020-01-01"}) is False

    def test_eligible_types(self):
        assert set(EOL_TYPES) == {"Application", "ITComponent"}


class TestApiStatus:
    def test_past_date_is_eol(self):
        assert eol_status(_iso(-1), None) == "eol"

    def test_true_is_eol_without_a_date(self):
        assert eol_status(True, None) == "eol"

    def test_within_the_window_is_approaching(self):
        assert eol_status(_iso(APPROACHING_DAYS - 5), None) == "approaching"

    def test_beyond_the_window_is_supported(self):
        assert eol_status(_iso(APPROACHING_DAYS + 60), None) == "supported"

    def test_ended_active_support_is_approaching(self):
        """Security-only maintenance is a warning even with the EOL date far off."""
        assert eol_status(_iso(400), _iso(-10)) == "approaching"

    def test_absent_upstream_data_is_unknown(self):
        assert eol_status(None, None) == "unknown"

    def test_unparseable_date_does_not_raise(self):
        assert eol_status("not-a-date", None) == "supported"


class TestManualStatus:
    def test_past_end_of_life(self):
        assert manual_eol_status({"endOfLife": _iso(-1)}) == "eol"

    def test_approaching_end_of_life(self):
        assert manual_eol_status({"endOfLife": _iso(30)}) == "approaching"

    def test_phase_out_started(self):
        assert manual_eol_status({"phaseOut": _iso(-3)}) == "approaching"

    def test_no_lifecycle_is_unknown(self):
        assert manual_eol_status(None) == "unknown"
        assert manual_eol_status({}) == "unknown"


class TestFindCycle:
    def test_matches_on_string_form(self):
        """Upstream cycles are sometimes numbers, the card always stores text."""
        cycles = [{"cycle": 1.25, "eol": "2027-01-01"}, {"cycle": "1.24"}]
        assert find_cycle(cycles, "1.25")["eol"] == "2027-01-01"

    def test_missing_cycle_returns_none(self):
        assert find_cycle([{"cycle": "1.24"}], "9.9") is None


@pytest.mark.parametrize(
    ("eol_value", "expected"),
    [(date.today().isoformat(), "eol"), (None, "unknown")],
)
def test_today_counts_as_reached(eol_value, expected):
    """A cycle whose EOL date is today is out of support, not "one day left"."""
    assert eol_status(eol_value, None) == expected
