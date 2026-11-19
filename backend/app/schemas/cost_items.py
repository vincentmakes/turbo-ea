from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

KEY_PATTERN = r"^[A-Za-z][A-Za-z0-9_]{0,63}$"
INT32_MAX = 2147483647  # a ``sort_order`` column's max; ``max + 1`` must not overflow it


class CostItemTypeCreate(BaseModel):
    key: str = Field(..., pattern=KEY_PATTERN)
    label: str = Field(..., min_length=1, max_length=100)
    translations: dict[str, str] | None = None


class CostItemTypeUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=100)
    translations: dict[str, str] | None = None
    archived: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=INT32_MAX)


class CostItemTypeOut(BaseModel):
    id: str
    key: str
    label: str
    sort_order: int
    archived: bool
    translations: dict[str, str] = {}


class CostLineOut(BaseModel):
    key: str
    amount: float
    renewal_date: date | None = None
    archived: bool = False


class YearCostsOut(BaseModel):
    fiscal_year: int
    is_current: bool
    is_forecast: bool
    confirmed: bool
    fallback_from: int | None = None
    items: list[CostLineOut]
    tco: float


class YearCostsDetailOut(YearCostsOut):
    can_edit: bool


class CardCostsOut(BaseModel):
    can_edit: bool
    years: list[YearCostsOut]
    catalogue: list[CostItemTypeOut]


class CostItemWrite(BaseModel):
    # le: a finite 1e308 on two cards sums to inf and breaks every cost report.
    amount: float = Field(..., ge=0, le=1e15, allow_inf_nan=False)
    renewal_date: date | None = Field(None, ge=date(1900, 1, 1), le=date(2200, 12, 31))
