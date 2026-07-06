"""Request authentication for the control-plane ops API (/api/v1/ops).

The Turbo EA Cloud control plane signs every ops request with a per-instance
Ed25519 private key; this instance verifies with the matching public key from
the ``OPS_PUBLIC_KEY`` env var. The canonical string binds method, path+query,
body hash, timestamp, and a single-use nonce:

    METHOD \\n PATH_WITH_QUERY \\n sha256(body).hexdigest() \\n timestamp \\n nonce

Headers: ``X-Ops-Timestamp`` (unix seconds), ``X-Ops-Nonce`` (uuid4),
``X-Ops-Signature`` (base64 Ed25519 signature).

When no public key is configured (every self-hosted install), the ops API
answers 404 so the surface is indistinguishable from a non-existent route.
"""

from __future__ import annotations

import base64
import hashlib
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.ops_nonce import OpsRequestNonce

SIGNATURE_HEADER = "X-Ops-Signature"
TIMESTAMP_HEADER = "X-Ops-Timestamp"
NONCE_HEADER = "X-Ops-Nonce"
MAX_CLOCK_SKEW_SECONDS = 300


def canonical_string(
    method: str, path_with_query: str, body: bytes, timestamp: str, nonce: str
) -> bytes:
    body_hash = hashlib.sha256(body).hexdigest()
    return "\n".join([method.upper(), path_with_query, body_hash, timestamp, nonce]).encode()


def _verify_signature(
    public_key_b64: str,
    method: str,
    path_with_query: str,
    body: bytes,
    timestamp: str,
    nonce: str,
    signature_b64: str,
) -> bool:
    try:
        public = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        public.verify(
            base64.b64decode(signature_b64),
            canonical_string(method, path_with_query, body, timestamp, nonce),
        )
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


async def verify_ops_request(request: Request, db: AsyncSession = Depends(get_db)) -> None:
    """FastAPI dependency guarding every /ops route. 404 when the feature is off;
    401 on any signature / freshness / replay failure."""
    if not settings.OPS_PUBLIC_KEY:
        raise HTTPException(status_code=404, detail="Not Found")

    timestamp = request.headers.get(TIMESTAMP_HEADER, "")
    nonce = request.headers.get(NONCE_HEADER, "")
    signature = request.headers.get(SIGNATURE_HEADER, "")
    if not timestamp or not nonce or not signature or len(nonce) > 64:
        raise HTTPException(status_code=401, detail="Missing ops auth headers")

    try:
        ts = int(timestamp)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid timestamp") from None
    if abs(time.time() - ts) > MAX_CLOCK_SKEW_SECONDS:
        raise HTTPException(status_code=401, detail="Request expired")

    path_with_query = request.url.path
    if request.url.query:
        path_with_query = f"{path_with_query}?{request.url.query}"
    body = await request.body()

    if not _verify_signature(
        settings.OPS_PUBLIC_KEY, request.method, path_with_query, body, timestamp, nonce, signature
    ):
        raise HTTPException(status_code=401, detail="Invalid signature")

    # Replay protection: each nonce is accepted exactly once.
    existing = (
        await db.execute(select(OpsRequestNonce).where(OpsRequestNonce.nonce == nonce))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=401, detail="Replayed nonce")
    db.add(OpsRequestNonce(nonce=nonce))
    await db.flush()
