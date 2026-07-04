"""Unit tests for the embedding service (no database required)."""

from unittest.mock import AsyncMock

import pytest

from app.services import embedding_service as es
from app.services.embedding_service import (
    EMBEDDING_DIM,
    EmbeddingConfig,
    EmbeddingError,
    build_embedding_document,
    content_hash,
    embed_texts,
)


def _cfg(provider_type="ollama", **kw):
    return EmbeddingConfig(
        provider_type=provider_type,
        provider_url=kw.get("provider_url", "http://ollama:11434"),
        api_key=kw.get("api_key", ""),
        model=kw.get("model", "nomic-embed-text"),
        dimension=kw.get("dimension", EMBEDDING_DIM),
    )


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _patch_client(monkeypatch, payload):
    client = AsyncMock()
    client.post = AsyncMock(return_value=_FakeResp(payload))
    monkeypatch.setattr(es, "_get_client", AsyncMock(return_value=client))
    return client


# ── document builder + hash ────────────────────────────────────────────────


def test_build_document_excludes_cost_fields():
    doc = build_embedding_document(
        type_label="Application",
        subtype="Business Application",
        name="NexaPay Gateway",
        description="Handles customer payments.",
        attributes={"vendor": "Acme", "costTotalAnnual": 50000, "empty": ""},
        cost_field_keys=frozenset({"costTotalAnnual"}),
    )
    assert "Application" in doc and "Business Application" in doc
    assert "NexaPay Gateway" in doc
    assert "vendor: Acme" in doc
    assert "50000" not in doc  # cost field excluded
    assert "empty" not in doc  # blank value skipped


def test_content_hash_depends_on_doc_and_model():
    a = content_hash("doc one", "model-a")
    assert a == content_hash("doc one", "model-a")  # stable
    assert a != content_hash("doc two", "model-a")  # doc change
    assert a != content_hash("doc one", "model-b")  # model change


# ── provider dispatch ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_embed_ollama(monkeypatch):
    vec = [0.1] * EMBEDDING_DIM
    client = _patch_client(monkeypatch, {"embeddings": [vec, vec]})
    out = await embed_texts(["a", "b"], _cfg())
    assert out == [vec, vec]
    assert client.post.call_args.args[0].endswith("/api/embed")


@pytest.mark.asyncio
async def test_embed_openai_orders_by_index(monkeypatch):
    v0 = [0.0] * EMBEDDING_DIM
    v1 = [1.0] * EMBEDDING_DIM
    # Return out of order to prove we sort by index.
    _patch_client(
        monkeypatch,
        {"data": [{"index": 1, "embedding": v1}, {"index": 0, "embedding": v0}]},
    )
    out = await embed_texts(["x", "y"], _cfg(provider_type="openai", api_key="k"))
    assert out == [v0, v1]


@pytest.mark.asyncio
async def test_embed_anthropic_unsupported(monkeypatch):
    _patch_client(monkeypatch, {})
    with pytest.raises(EmbeddingError, match="Anthropic"):
        await embed_texts(["x"], _cfg(provider_type="anthropic"))


@pytest.mark.asyncio
async def test_embed_dimension_mismatch_raises(monkeypatch):
    _patch_client(monkeypatch, {"embeddings": [[0.1, 0.2, 0.3]]})  # wrong dim
    with pytest.raises(EmbeddingError, match="dimension"):
        await embed_texts(["x"], _cfg())


@pytest.mark.asyncio
async def test_embed_empty_input_short_circuits():
    assert await embed_texts([], _cfg()) == []
