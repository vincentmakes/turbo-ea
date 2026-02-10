from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from base64 import urlsafe_b64decode, urlsafe_b64encode

import bcrypt

from app.config import settings


def _b64encode(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64decode(data: str) -> bytes:
    padding = 4 - len(data) % 4
    return urlsafe_b64decode(data + "=" * padding)


def create_access_token(user_id: uuid.UUID, role: str = "member") -> str:
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    now = int(time.time())
    payload_dict = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }
    payload = _b64encode(json.dumps(payload_dict).encode())
    sig_input = f"{header}.{payload}".encode()
    sig = _b64encode(hmac.new(settings.SECRET_KEY.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def decode_access_token(token: str) -> dict | None:
    try:
        header, payload, sig = token.split(".")
        sig_input = f"{header}.{payload}".encode()
        expected = hmac.new(settings.SECRET_KEY.encode(), sig_input, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64decode(sig), expected):
            return None
        data = json.loads(_b64decode(payload))
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())
