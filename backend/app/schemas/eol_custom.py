"""Request / response shapes for custom EOL products.

A cycle travels in the same shape as an endoflife.date cycle (``cycle``,
``releaseDate``, ``eol``, ``support``, ``latest``, ``latestReleaseDate``) so
the card picker, the cycle details and the status classifier read a custom
product exactly as they read an upstream one. Snake-case names are accepted on
input too (``populate_by_name``).
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

#: The slug a card's link stores after ``custom:``. Lower-case so two people
#: typing "Acme ERP" and "acme erp" cannot mint two products.
PRODUCT_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_CYCLES_PER_PRODUCT = 200

#: endoflife.date requires ``eol`` on every release; ``support`` is optional.
#: A cycle without it can only ever read "unknown", so it is refused here.
EOL_REQUIRED_MESSAGE = (
    "end of life is required: a date, false when none is announced, "
    "or true when it has already ended"
)

#: endoflife.date's product categories — the twin of ``EOL_DATE_CATEGORIES``
#: in ``frontend/src/lib/eolContribution.ts``; change both together.
EOL_DATE_CATEGORIES = (
    "app",
    "database",
    "device",
    "framework",
    "lang",
    "os",
    "server-app",
    "service",
    "standard",
)


def parse_iso_date(value: str) -> date | None:
    """``value`` as a date when it is a real ``YYYY-MM-DD`` day, else None."""
    if not _DATE_RE.match(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def check_date(value: Any) -> str | None:
    """A nullable ISO date. Blank reads as "not set"."""
    if value is None or value == "":
        return None
    if not isinstance(value, str) or parse_iso_date(value) is None:
        raise ValueError("must be a date in YYYY-MM-DD form")
    return value


def check_milestone(value: Any) -> str | bool | None:
    """An EOL / end-of-support value: a date, ``true`` (already ended),
    ``false`` (no end announced) or null — what endoflife.date stores."""
    if isinstance(value, bool):
        return value
    return check_date(value)


def _clean_text(value: Any, max_len: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if len(text) > max_len:
        raise ValueError(f"must be at most {max_len} characters")
    return text or None


def check_link(value: Any) -> str | None:
    """An http(s) URL. Rendered as a link, so no other scheme is accepted."""
    text = _clean_text(value, 500)
    if text is None:
        return None
    if not re.match(r"^https?://[^\s]+$", text, re.IGNORECASE):
        raise ValueError("must be an http:// or https:// URL")
    return text


def check_category(value: Any) -> str | None:
    """One of endoflife.date's categories, for the proposal file. Blank clears."""
    text = _clean_text(value, 20)
    if text is None:
        return None
    if text not in EOL_DATE_CATEGORIES:
        raise ValueError("must be one of " + ", ".join(EOL_DATE_CATEGORIES))
    return text


class _CycleFields(BaseModel):
    model_config = {"populate_by_name": True}

    release_date: str | None = Field(None, alias="releaseDate")
    support: str | bool | None = None
    eol: str | bool | None = None
    latest: str | None = None
    latest_release_date: str | None = Field(None, alias="latestReleaseDate")

    @field_validator("release_date", "latest_release_date", mode="before")
    @classmethod
    def _check_dates(cls, v: Any) -> str | None:
        return check_date(v)

    @field_validator("support", "eol", mode="before")
    @classmethod
    def _check_milestones(cls, v: Any) -> str | bool | None:
        return check_milestone(v)

    @field_validator("latest", mode="before")
    @classmethod
    def _check_latest(cls, v: Any) -> str | None:
        return _clean_text(v, 100)


def _check_order(release: str | None, end: Any, label: str) -> None:
    """A cycle cannot end before it was released."""
    if not isinstance(release, str) or not isinstance(end, str):
        return
    if end < release:  # both validated ISO dates, so string order is date order
        raise ValueError(f"{label} must not be before the release date")


class EolCustomCycleCreate(_CycleFields):
    cycle: str
    sort_order: int | None = None
    #: Required, as on endoflife.date: a date, ``false`` (none announced) or
    #: ``true`` (already ended). ``support`` may stay unknown.
    eol: str | bool = Field(..., description="A date, false (none announced) or true (ended)")

    @field_validator("cycle", mode="before")
    @classmethod
    def _check_cycle(cls, v: Any) -> str:
        text = _clean_text(v, 100)
        if not text:
            raise ValueError("cycle name is required")
        return text

    # Runs beside the inherited milestone check: an explicit null or blank
    # ``eol`` gets the clear message instead of pydantic's type error.
    @field_validator("eol", mode="before")
    @classmethod
    def _require_eol(cls, v: Any) -> Any:
        if v is None or v == "":
            raise ValueError(EOL_REQUIRED_MESSAGE)
        return v

    @model_validator(mode="after")
    def _check_dates_order(self) -> EolCustomCycleCreate:
        _check_order(self.release_date, self.eol, "eol")
        _check_order(self.release_date, self.support, "support")
        return self


class EolCustomCycleUpdate(_CycleFields):
    """Partial update; a field left out of the body is left alone."""

    cycle: str | None = None
    sort_order: int | None = None

    @field_validator("cycle", mode="before")
    @classmethod
    def _check_cycle(cls, v: Any) -> str | None:
        if v is None:
            return None
        text = _clean_text(v, 100)
        if not text:
            raise ValueError("cycle name must not be empty")
        return text

    @model_validator(mode="after")
    def _eol_cannot_be_cleared(self) -> EolCustomCycleUpdate:
        """A field left out is left alone; ``eol`` set to null is refused."""
        if "eol" in self.model_fields_set and self.eol is None:
            raise ValueError(EOL_REQUIRED_MESSAGE)
        return self


def product_key_from_title(title: str) -> str:
    """The key a product gets from its title: "Acme ERP 2" -> "acme-erp-2".

    Accents are folded, anything outside the key alphabet becomes one hyphen
    and leading or trailing separators go, so the result always matches
    ``PRODUCT_KEY_RE`` — or is empty when the title holds nothing usable.
    """
    folded = "".join(
        ch for ch in unicodedata.normalize("NFKD", title) if not unicodedata.combining(ch)
    )
    key = re.sub(r"[^a-z0-9._-]+", "-", folded.lower())
    key = re.sub(r"-{2,}", "-", key)
    key = re.sub(r"^[^a-z0-9]+", "", key)
    key = re.sub(r"[-._]+$", "", key)[:100]
    return re.sub(r"[-._]+$", "", key)


class EolCustomProductCreate(BaseModel):
    #: Generated from the title when absent (see ``product_key_from_title``).
    key: str | None = None
    title: str
    description: str | None = None
    link: str | None = None
    #: What the endoflife.date proposal file needs beyond the cycles.
    eol_category: str | None = None
    release_policy_note: str | None = None
    cycles: list[EolCustomCycleCreate] = Field(default_factory=list)

    @field_validator("key", mode="before")
    @classmethod
    def _check_key(cls, v: Any) -> str | None:
        text = str(v or "").strip()
        if not text:
            return None
        if not PRODUCT_KEY_RE.match(text):
            raise ValueError(
                "must be 1-100 lower-case letters, digits, dots, hyphens or underscores"
            )
        return text

    @field_validator("title", mode="before")
    @classmethod
    def _check_title(cls, v: Any) -> str:
        text = _clean_text(v, 200)
        if not text:
            raise ValueError("title is required")
        return text

    @field_validator("description", mode="before")
    @classmethod
    def _check_description(cls, v: Any) -> str | None:
        return _clean_text(v, 5000)

    @field_validator("link", mode="before")
    @classmethod
    def _check_link(cls, v: Any) -> str | None:
        return check_link(v)

    @field_validator("eol_category", mode="before")
    @classmethod
    def _check_category(cls, v: Any) -> str | None:
        return check_category(v)

    @field_validator("release_policy_note", mode="before")
    @classmethod
    def _check_policy_note(cls, v: Any) -> str | None:
        return _clean_text(v, 5000)

    @model_validator(mode="after")
    def _check_cycles(self) -> EolCustomProductCreate:
        if len(self.cycles) > MAX_CYCLES_PER_PRODUCT:
            raise ValueError(f"at most {MAX_CYCLES_PER_PRODUCT} cycles per product")
        names = [c.cycle for c in self.cycles]
        if len(names) != len(set(names)):
            raise ValueError("cycle names must be unique")
        return self


class EolCustomProductUpdate(BaseModel):
    """Title, description, link and the proposal fields. The key is
    immutable: cards store it."""

    title: str | None = None
    description: str | None = None
    link: str | None = None
    eol_category: str | None = None
    release_policy_note: str | None = None

    @field_validator("title", mode="before")
    @classmethod
    def _check_title(cls, v: Any) -> str | None:
        if v is None:
            return None
        text = _clean_text(v, 200)
        if not text:
            raise ValueError("title must not be empty")
        return text

    @field_validator("description", mode="before")
    @classmethod
    def _check_description(cls, v: Any) -> str | None:
        return _clean_text(v, 5000)

    @field_validator("link", mode="before")
    @classmethod
    def _check_link(cls, v: Any) -> str | None:
        return check_link(v)

    @field_validator("eol_category", mode="before")
    @classmethod
    def _check_category(cls, v: Any) -> str | None:
        return check_category(v)

    @field_validator("release_policy_note", mode="before")
    @classmethod
    def _check_policy_note(cls, v: Any) -> str | None:
        return _clean_text(v, 5000)


class EolCustomCycleOut(BaseModel):
    model_config = {"populate_by_name": True}

    id: str
    cycle: str
    release_date: str | None = Field(None, serialization_alias="releaseDate")
    support: str | bool | None = None
    eol: str | bool | None = None
    latest: str | None = None
    latest_release_date: str | None = Field(None, serialization_alias="latestReleaseDate")
    sort_order: int = 0
    linked_cards: int = 0
    updated_at: str | None = None


class EolCustomProductOut(BaseModel):
    id: str
    key: str
    product: str = Field(description='The value a card stores: "custom:<key>"')
    title: str
    description: str | None = None
    link: str | None = None
    eol_category: str | None = None
    release_policy_note: str | None = None
    linked_cards: int = 0
    cycles: list[EolCustomCycleOut] = Field(default_factory=list)
    updated_at: str | None = None


class EolCustomSwitchRequest(BaseModel):
    """Move a custom product's card links onto an endoflife.date product."""

    target_product: str
    #: custom cycle name → upstream cycle name, or null to keep that cycle's
    #: cards on the custom product.
    cycle_map: dict[str, str | None] = Field(default_factory=dict)
    delete_when_unused: bool = False


class EolCustomSwitchResult(BaseModel):
    relinked: int
    kept: int
    deleted: bool


class EolUpstreamMatch(BaseModel):
    name: str
    score: float
