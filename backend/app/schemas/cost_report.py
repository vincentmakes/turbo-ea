import uuid

from pydantic import BaseModel


class CostScopeItem(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    parent_id: uuid.UUID | None
    alias: str | None


class CostScopeResponse(BaseModel):
    items: list[CostScopeItem]
    total: int
