import uuid

from pydantic import BaseModel, ConfigDict


class CostScopeItem(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    parent_id: uuid.UUID | None
    alias: str | None


class CostScopeResponse(BaseModel):
    items: list[CostScopeItem]
    total: int


class CostReportNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    logo_updated_at: str | None = None


class CostTreemapResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    items: list[CostReportNode]


class CostSankeyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    nodes: list[CostReportNode]
