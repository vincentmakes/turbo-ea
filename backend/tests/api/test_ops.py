"""Integration tests for the control-plane ops API (/api/v1/ops)."""

from __future__ import annotations

import base64
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from app.config import settings
from app.core.ops_auth import canonical_string
from app.core.security import create_access_token
from app.models.notification import Notification
from app.models.user import User
from tests.conftest import create_role, create_user


def make_keypair():
    private = Ed25519PrivateKey.generate()
    public_b64 = base64.b64encode(
        private.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    ).decode()
    return private, public_b64


def ops_headers(private: Ed25519PrivateKey, method: str, path: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    nonce = str(uuid.uuid4())
    signature = base64.b64encode(
        private.sign(canonical_string(method, path, body, ts, nonce))
    ).decode()
    return {
        "X-Ops-Timestamp": ts,
        "X-Ops-Nonce": nonce,
        "X-Ops-Signature": signature,
        "Content-Type": "application/json",
    }


async def test_ops_routes_404_when_key_unset(client, monkeypatch):
    monkeypatch.setattr(settings, "OPS_PUBLIC_KEY", "")
    response = await client.get("/api/v1/ops/info")
    assert response.status_code == 404


async def test_ops_info_requires_valid_signature(client, monkeypatch):
    private, public_b64 = make_keypair()
    monkeypatch.setattr(settings, "OPS_PUBLIC_KEY", public_b64)

    # Unsigned → 401
    response = await client.get("/api/v1/ops/info")
    assert response.status_code == 401

    # Properly signed → 200 with version + counts
    headers = ops_headers(private, "GET", "/api/v1/ops/info", b"")
    response = await client.get("/api/v1/ops/info", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data and "user_count" in data

    # Replaying the exact same headers (same nonce) → 401
    response = await client.get("/api/v1/ops/info", headers=headers)
    assert response.status_code == 401


async def test_rescue_access_lifecycle(client, db, monkeypatch):
    private, public_b64 = make_keypair()
    monkeypatch.setattr(settings, "OPS_PUBLIC_KEY", public_b64)
    await create_role(db, key="admin")
    admin = await create_user(db, role="admin", email="owner@customer.example")

    request_id = uuid.uuid4().hex
    payload = {
        "request_id": request_id,
        "operator_email": "op@turboea.cloud",
        "operator_name": "Vincent",
        "reason": "Debug broken SSO configuration",
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
        "break_glass": False,
    }
    body = json.dumps(payload).encode()
    headers = ops_headers(private, "POST", "/api/v1/ops/rescue-access", body)
    response = await client.post("/api/v1/ops/rescue-access", content=body, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["setup_path"].startswith("/auth/set-password?token=")

    # A time-boxed admin account exists
    rescue = (await db.execute(select(User).where(User.email == data["admin_email"]))).scalar_one()
    assert rescue.role == "admin"
    assert rescue.access_expires_at is not None
    assert rescue.password_setup_token is not None

    # Every instance admin was notified (transparency requirement)
    notification = (
        (
            await db.execute(
                select(Notification).where(
                    Notification.user_id == admin.id,
                    Notification.type == "ops_rescue_access",
                )
            )
        )
        .scalars()
        .first()
    )
    assert notification is not None
    assert "Vincent" in notification.message

    # Revoke deactivates the account
    revoke_body = json.dumps({"request_id": request_id}).encode()
    headers = ops_headers(private, "DELETE", "/api/v1/ops/rescue-access", revoke_body)
    response = await client.request(
        "DELETE", "/api/v1/ops/rescue-access", content=revoke_body, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["revoked"] is True
    await db.refresh(rescue)
    assert rescue.is_active is False


async def test_expired_rescue_account_is_rejected(client, db):
    await create_role(db, key="admin")
    user = await create_user(db, role="admin")
    user.access_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db.flush()

    token = create_access_token(user.id, user.role)
    response = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_unexpired_rescue_account_is_accepted(client, db):
    await create_role(db, key="admin")
    user = await create_user(db, role="admin")
    user.access_expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    await db.flush()

    token = create_access_token(user.id, user.role)
    response = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


async def test_rescue_access_is_dual_written_to_the_audit_log(client, db, monkeypatch):
    """The ``ops.*`` events stay (docs/admin/ops-api.md promises them) and the
    Security log carries the same grant and revoke, with no actor (the caller
    is the control plane) and never the setup token."""
    from app.models.audit_log import AuditLogEntry
    from app.models.event import Event

    private, public_b64 = make_keypair()
    monkeypatch.setattr(settings, "OPS_PUBLIC_KEY", public_b64)
    await create_role(db, key="admin")
    await create_user(db, role="admin", email="owner@customer.example")
    request_id = uuid.uuid4().hex
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    body = json.dumps(
        {
            "request_id": request_id,
            "operator_email": "op@turboea.cloud",
            "operator_name": "Vincent",
            "reason": "Debug broken SSO configuration",
            "expires_at": expires_at,
            "break_glass": True,
        }
    ).encode()
    headers = ops_headers(private, "POST", "/api/v1/ops/rescue-access", body)
    granted_resp = await client.post("/api/v1/ops/rescue-access", content=body, headers=headers)
    assert granted_resp.status_code == 200
    data = granted_resp.json()
    token = data["setup_path"].split("token=", 1)[1]

    revoke_body = json.dumps({"request_id": request_id}).encode()
    headers = ops_headers(private, "DELETE", "/api/v1/ops/rescue-access", revoke_body)
    await client.request(
        "DELETE", "/api/v1/ops/rescue-access", content=revoke_body, headers=headers
    )

    await db.rollback()
    granted, revoked = (
        (
            await db.execute(
                select(AuditLogEntry)
                .where(AuditLogEntry.action.like("admin.ops.%"))
                .order_by(AuditLogEntry.created_at)
            )
        )
        .scalars()
        .all()
    )
    assert granted.action == "admin.ops.rescue_access.granted"
    assert granted.category == "admin" and granted.actor_user_id is None
    assert granted.subject_email == data["admin_email"]
    assert (granted.target_type, granted.target_id) == ("user", data["user_id"])
    assert granted.details == {
        "request_id": request_id,
        "operator_email": "op@turboea.cloud",
        "operator_name": "Vincent",
        "reason": "Debug broken SSO configuration",
        "break_glass": True,
        "expires_at": datetime.fromisoformat(expires_at).isoformat(),
    }
    assert token not in json.dumps(granted.details)
    assert revoked.action == "admin.ops.rescue_access.revoked"
    assert revoked.subject_email == data["admin_email"]
    assert revoked.details == {"request_id": request_id}

    # The event stream the ops docs promise is still written alongside.
    events = (
        (await db.execute(select(Event.event_type).where(Event.event_type.like("ops.%"))))
        .scalars()
        .all()
    )
    assert set(events) >= {"ops.rescue_access_granted", "ops.rescue_access_revoked"}
