"""API tests for GET /cards/semantic-search.

Covers the lexical fallback (no provider), the vector-ranked path with a
monkeypatched embedding provider, and — most importantly — that the same RBAC
scope as GET /cards holds: hidden types and non-ACTIVE cards never surface, even
when their embedding is the closest match.
"""

from unittest.mock import AsyncMock

import pytest

from app.models.card_embedding import EMBEDDING_DIM, CardEmbedding
from app.services.embedding_service import EmbeddingConfig
from tests.conftest import auth_headers, create_card, create_card_type


def _vec(*head):
    """A 768-dim vector with `head` in the leading slots, zeros after."""
    v = list(head) + [0.0] * (EMBEDDING_DIM - len(head))
    return v[:EMBEDDING_DIM]


def _cfg():
    return EmbeddingConfig(
        provider_type="ollama",
        provider_url="http://x",
        api_key="",
        model="nomic-embed-text",
        dimension=EMBEDDING_DIM,
    )


def _enable_embeddings(monkeypatch, query_vec):
    """Patch the endpoint's embedding hooks so the vector path runs."""
    import app.api.v1.cards as cards_mod

    monkeypatch.setattr(cards_mod, "load_embedding_config", AsyncMock(return_value=_cfg()))
    monkeypatch.setattr(cards_mod, "embed_texts", AsyncMock(return_value=[query_vec]))


@pytest.mark.asyncio
async def test_lexical_fallback_when_no_provider(client, db, admin_user):
    await create_card(db, card_type="Application", name="Payment Gateway", user_id=admin_user.id)
    await create_card(db, card_type="Application", name="HR Portal", user_id=admin_user.id)

    resp = await client.get(
        "/api/v1/cards/semantic-search?query=Payment", headers=auth_headers(admin_user)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["embedding_available"] is False
    names = [i["card"]["name"] for i in body["items"]]
    assert "Payment Gateway" in names
    assert "HR Portal" not in names


@pytest.mark.asyncio
async def test_vector_ranking_orders_by_similarity(client, db, admin_user, monkeypatch):
    # query points along axis 0; nearest is the identical vector.
    a = await create_card(db, card_type="Application", name="Alpha", user_id=admin_user.id)
    b = await create_card(db, card_type="Application", name="Bravo", user_id=admin_user.id)
    c = await create_card(db, card_type="Application", name="Charlie", user_id=admin_user.id)
    db.add(
        CardEmbedding(
            card_id=a.id, embedding=_vec(1.0), model="m", dim=EMBEDDING_DIM, content_hash="a"
        )
    )
    db.add(
        CardEmbedding(
            card_id=b.id, embedding=_vec(0.0, 1.0), model="m", dim=EMBEDDING_DIM, content_hash="b"
        )
    )
    db.add(
        CardEmbedding(
            card_id=c.id, embedding=_vec(0.7, 0.7), model="m", dim=EMBEDDING_DIM, content_hash="c"
        )
    )
    await db.flush()

    _enable_embeddings(monkeypatch, _vec(1.0))
    resp = await client.get(
        "/api/v1/cards/semantic-search?query=anything&mode=semantic",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["embedding_available"] is True
    names = [i["card"]["name"] for i in body["items"]]
    # Alpha (identical) closest, then Charlie (45°), then Bravo (orthogonal).
    assert names == ["Alpha", "Charlie", "Bravo"]
    assert body["items"][0]["match"] == "semantic"


@pytest.mark.asyncio
async def test_hidden_type_excluded_from_vector_results(client, db, admin_user, monkeypatch):
    await create_card_type(db, key="SecretType", label="Secret", is_hidden=True)
    visible = await create_card(db, card_type="Application", name="Visible", user_id=admin_user.id)
    secret = await create_card(db, card_type="SecretType", name="TopSecret", user_id=admin_user.id)
    # secret is the CLOSEST match — it must still be excluded by the hidden filter.
    db.add(
        CardEmbedding(
            card_id=secret.id, embedding=_vec(1.0), model="m", dim=EMBEDDING_DIM, content_hash="s"
        )
    )
    db.add(
        CardEmbedding(
            card_id=visible.id,
            embedding=_vec(0.5, 0.5),
            model="m",
            dim=EMBEDDING_DIM,
            content_hash="v",
        )
    )
    await db.flush()

    _enable_embeddings(monkeypatch, _vec(1.0))
    resp = await client.get(
        "/api/v1/cards/semantic-search?query=x&mode=semantic", headers=auth_headers(admin_user)
    )
    names = [i["card"]["name"] for i in resp.json()["items"]]
    assert "TopSecret" not in names
    assert "Visible" in names


@pytest.mark.asyncio
async def test_archived_card_excluded_by_default(client, db, admin_user, monkeypatch):
    active = await create_card(db, card_type="Application", name="LiveApp", user_id=admin_user.id)
    archived = await create_card(
        db, card_type="Application", name="DeadApp", user_id=admin_user.id, status="ARCHIVED"
    )
    db.add(
        CardEmbedding(
            card_id=archived.id, embedding=_vec(1.0), model="m", dim=EMBEDDING_DIM, content_hash="d"
        )
    )
    db.add(
        CardEmbedding(
            card_id=active.id,
            embedding=_vec(0.5, 0.5),
            model="m",
            dim=EMBEDDING_DIM,
            content_hash="l",
        )
    )
    await db.flush()

    _enable_embeddings(monkeypatch, _vec(1.0))
    resp = await client.get(
        "/api/v1/cards/semantic-search?query=x&mode=semantic", headers=auth_headers(admin_user)
    )
    names = [i["card"]["name"] for i in resp.json()["items"]]
    assert "DeadApp" not in names
    assert "LiveApp" in names
