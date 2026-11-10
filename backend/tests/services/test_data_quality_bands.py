"""The data-quality band of a score: one table, exact edges."""

from __future__ import annotations

import pytest

from app.services.data_quality_bands import DQ_BAND_BOUNDS, band_of


@pytest.mark.parametrize(
    ("score", "band"),
    [
        (0, "minimal"),
        (39.9, "minimal"),
        (40, "partial"),
        (79.9, "partial"),
        (80, "complete"),
        (100, "complete"),
    ],
)
def test_band_of_edges(score: float, band: str) -> None:
    assert band_of(score) == band


def test_band_keys_are_the_table_keys() -> None:
    assert set(DQ_BAND_BOUNDS) == {"complete", "partial", "minimal"}
    assert {band_of(s) for s in (0, 50, 90)} == set(DQ_BAND_BOUNDS)


def test_a_score_no_band_holds_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(DQ_BAND_BOUNDS, "minimal", (0.0, 40.0))
    with pytest.raises(ValueError, match="no data-quality band"):
        band_of(-1)
