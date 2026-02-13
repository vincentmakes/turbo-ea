from fastapi import APIRouter

from app.api.v1 import (
    auth,
    bookmarks,
    comments,
    diagrams,
    documents,
    events,
    fact_sheets,
    metamodel,
    milestones,
    notifications,
    relations,
    reports,
    settings,
    soaw,
    subscriptions,
    surveys,
    tags,
    todos,
    transformations,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(metamodel.router)
api_router.include_router(fact_sheets.router)
api_router.include_router(relations.router)
api_router.include_router(subscriptions.router)
api_router.include_router(comments.router)
api_router.include_router(todos.router)
api_router.include_router(tags.router)
api_router.include_router(documents.router)
api_router.include_router(bookmarks.router)
api_router.include_router(reports.router)
api_router.include_router(diagrams.router)
api_router.include_router(soaw.router)
api_router.include_router(events.router)
api_router.include_router(users.router)
api_router.include_router(notifications.router)
api_router.include_router(surveys.router)
api_router.include_router(settings.router)
api_router.include_router(transformations.router)
api_router.include_router(milestones.router)
