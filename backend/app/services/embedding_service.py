"""Embedding service — turns card text into vectors for semantic search.

This is NOT a chat LLM and NOT an agent: it calls a provider's *embeddings*
endpoint (a small text→vector model) and returns raw float vectors. No prose is
generated. Used by the reconciliation worker (to embed cards) and the
``/cards/semantic-search`` endpoint (to embed the query).

Config is a dedicated ``ai.embedding`` block in app_settings, independent of the
chat ``ai`` block — Anthropic (a supported chat provider) has no embeddings API,
so coupling the two would break semantic search on Anthropic-chat instances.
Defaults to self-hosted Ollama ``nomic-embed-text`` so the feature works fully
offline.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value
from app.models.app_settings import AppSettings
from app.models.card_embedding import EMBEDDING_DIM

logger = logging.getLogger("turboea.embedding")

DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"
# Max texts per provider call — keeps request bodies and provider latency sane.
EMBED_BATCH_SIZE = 64

_client: httpx.AsyncClient | None = None


async def _get_client() -> httpx.AsyncClient:
    global _client  # noqa: N816
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client


class EmbeddingError(RuntimeError):
    """Raised when embedding generation fails or is unsupported."""


@dataclass(frozen=True)
class EmbeddingConfig:
    provider_type: str  # "ollama" | "openai" | "azure_openai"
    provider_url: str
    api_key: str  # already decrypted
    model: str
    dimension: int = EMBEDDING_DIM

    @property
    def configured(self) -> bool:
        return bool(self.provider_url and self.model)


async def load_embedding_config(db: AsyncSession) -> EmbeddingConfig | None:
    """Read the ``ai.embedding`` block from app_settings.

    Returns ``None`` when embeddings are disabled or not configured — callers
    treat that as "fall back to lexical search / skip the reconcile cycle".
    """
    result = await db.execute(select(AppSettings))
    row = result.scalar_one_or_none()
    if not row or not row.general_settings:
        return None
    emb = (row.general_settings.get("ai") or {}).get("embedding") or {}
    if not emb.get("enabled"):
        return None
    encrypted_key = emb.get("apiKey", "")
    cfg = EmbeddingConfig(
        provider_type=emb.get("providerType", "ollama"),
        provider_url=emb.get("providerUrl", ""),
        api_key=decrypt_value(encrypted_key) if encrypted_key else "",
        model=emb.get("model", DEFAULT_EMBEDDING_MODEL),
        dimension=int(emb.get("dimension", EMBEDDING_DIM) or EMBEDDING_DIM),
    )
    return cfg if cfg.configured else None


# ---------------------------------------------------------------------------
# Provider dispatch
# ---------------------------------------------------------------------------


async def embed_texts(texts: list[str], cfg: EmbeddingConfig) -> list[list[float]]:
    """Embed a list of texts, returning one vector per input (order preserved).

    Batches at ``EMBED_BATCH_SIZE``. Raises ``EmbeddingError`` on provider
    failure, unsupported provider, or dimension mismatch — callers decide
    whether to surface (settings test) or soft-fail (reconcile / search).
    """
    if not texts:
        return []
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        vectors = await _embed_batch(batch, cfg)
        for v in vectors:
            if len(v) != cfg.dimension:
                raise EmbeddingError(
                    f"Embedding model '{cfg.model}' returned dimension {len(v)}, "
                    f"expected {cfg.dimension}."
                )
        out.extend(vectors)
    return out


async def _embed_batch(batch: list[str], cfg: EmbeddingConfig) -> list[list[float]]:
    pt = cfg.provider_type
    if pt == "openai":
        return await _embed_openai(batch, cfg)
    if pt == "azure_openai":
        return await _embed_azure(batch, cfg)
    if pt == "anthropic":
        raise EmbeddingError(
            "Anthropic has no embeddings API. Configure a separate embedding "
            "provider (Ollama or an OpenAI-compatible endpoint)."
        )
    return await _embed_ollama(batch, cfg)


async def _embed_ollama(batch: list[str], cfg: EmbeddingConfig) -> list[list[float]]:
    client = await _get_client()
    url = f"{cfg.provider_url.rstrip('/')}/api/embed"
    try:
        resp = await client.post(url, json={"model": cfg.model, "input": batch})
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"Ollama embeddings call failed: {exc}") from exc
    data: dict[str, Any] = resp.json()
    embeddings = data.get("embeddings")
    if not isinstance(embeddings, list):
        raise EmbeddingError("Ollama embeddings response missing 'embeddings' array.")
    return embeddings


async def _embed_openai(batch: list[str], cfg: EmbeddingConfig) -> list[list[float]]:
    client = await _get_client()
    url = f"{cfg.provider_url.rstrip('/')}/v1/embeddings"
    headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"}
    # `dimensions` is honoured by text-embedding-3-*; models that natively emit
    # the requested size ignore it. Length is validated in embed_texts either way.
    payload = {"model": cfg.model, "input": batch, "dimensions": cfg.dimension}
    try:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"OpenAI-compatible embeddings call failed: {exc}") from exc
    return _parse_openai_shape(resp.json())


async def _embed_azure(batch: list[str], cfg: EmbeddingConfig) -> list[list[float]]:
    client = await _get_client()
    url = f"{cfg.provider_url.rstrip('/')}/openai/deployments/{cfg.model}/embeddings"
    headers = {"api-key": cfg.api_key, "Content-Type": "application/json"}
    payload = {"input": batch, "dimensions": cfg.dimension}
    try:
        resp = await client.post(
            url, json=payload, headers=headers, params={"api-version": "2024-02-01"}
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise EmbeddingError(f"Azure embeddings call failed: {exc}") from exc
    return _parse_openai_shape(resp.json())


def _parse_openai_shape(data: dict[str, Any]) -> list[list[float]]:
    """Both OpenAI and Azure return {"data": [{"index": i, "embedding": [...]}]}."""
    items = data.get("data")
    if not isinstance(items, list):
        raise EmbeddingError("Embeddings response missing 'data' array.")
    ordered = sorted(items, key=lambda d: d.get("index", 0))
    return [d["embedding"] for d in ordered]


# ---------------------------------------------------------------------------
# Embedding document + content hash
# ---------------------------------------------------------------------------


def build_embedding_document(
    *,
    type_label: str,
    subtype: str | None,
    name: str,
    description: str | None,
    attributes: dict | None,
    cost_field_keys: frozenset[str],
) -> str:
    """Compose the text embedded for a card.

    Includes the human type label + subtype (the semantic context substring
    search loses) and non-cost attributes. Cost-typed attributes are excluded so
    redacted values never enter the index.
    """
    header_bits = [type_label]
    if subtype:
        header_bits.append(subtype)
    header_bits.append(name)
    lines = [" · ".join(b for b in header_bits if b)]
    if description:
        lines.append(description.strip())
    if attributes:
        attr_bits = []
        for key, val in attributes.items():
            if key in cost_field_keys or val in (None, "", [], {}):
                continue
            attr_bits.append(f"{key}: {val}")
        if attr_bits:
            lines.append("\n".join(attr_bits))
    return "\n".join(lines).strip()


def content_hash(document: str, model: str) -> str:
    """Stable hash of (document, model) — drives re-embed decisions.

    Includes the model so switching embedding models re-embeds every card.
    """
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\x00")
    h.update(document.encode("utf-8"))
    return h.hexdigest()
