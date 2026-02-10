from fastapi import APIRouter

from app.api.v1 import auth, events, fact_sheets, hierarchy, relations, tags, technology

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(fact_sheets.router, prefix="/fact-sheets", tags=["fact-sheets"])
api_router.include_router(hierarchy.router, prefix="/hierarchy", tags=["hierarchy"])
api_router.include_router(relations.router, prefix="/relations", tags=["relations"])
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(tags.router, prefix="/tags", tags=["tags"])
api_router.include_router(technology.router, prefix="/technology", tags=["technology"])
