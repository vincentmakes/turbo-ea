"""Data-quality bands: the one vocabulary of the data-quality report, the
inventory's quality facet and the card query's ``where.data_quality_band``.

Bands: ``complete`` from 80 up, ``partial`` from 40 up to, but excluding, 80
(scores are floats, so 79.9 is partial), ``minimal`` below 40.

An unscored card is never bandless: ``cards.data_quality`` is NOT NULL (the
model's ``Mapped[float]``); the ORM default is 0, so an unscored card holds 0
and no coalesce is needed. It lands in ``minimal``, as the frontend's
``bandOf`` does.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import and_, or_

from app.models.card import Card

# The data-quality report counts through `band_of`, so this table is its one
# source. The only lock-step partner left is DATA_QUALITY_BANDS in
# `frontend/src/lib/dataQualityBands.ts` — the panel opened from a bar segment
# has to list exactly the cards that segment counted.
#: ``{band: (inclusive low, exclusive high)}``; ``None`` is unbounded.
DQ_BAND_BOUNDS: dict[str, tuple[float | None, float | None]] = {
    "complete": (80.0, None),
    "partial": (40.0, 80.0),
    "minimal": (None, 40.0),
}


def band_of(score: float) -> str:
    """The ``DQ_BAND_BOUNDS`` key whose range holds ``score``."""
    for band, (low, high) in DQ_BAND_BOUNDS.items():
        if (low is None or score >= low) and (high is None or score < high):
            return band
    raise ValueError(f"no data-quality band holds {score!r}")


def dq_band_condition(bands: Iterable[str], *, card: Any = Card) -> Any:
    """A card (``Card`` or an alias) whose score falls in any of ``bands``.
    Every band must be a ``DQ_BAND_BOUNDS`` key."""
    # NOT NULL (the model's `Mapped[float]`); the ORM default is 0, so an
    # unscored card holds 0 and no coalesce is needed.
    score = card.data_quality
    options: list[Any] = []
    for band in bands:
        low, high = DQ_BAND_BOUNDS[band]
        bounds = []
        if low is not None:
            bounds.append(score >= low)
        if high is not None:
            bounds.append(score < high)
        options.append(and_(*bounds))
    return or_(*options)
