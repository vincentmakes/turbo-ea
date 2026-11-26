"""A scripted community language library for the catalogue tests.

``FakeLibrary`` answers the app's downloads through ``httpx.MockTransport``
(installed on ``language_catalogue._client``), records every URL asked for,
and can check that no database session is open while a download runs.
"""

from __future__ import annotations

import hashlib
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.services import language_catalogue as lc
from app.services import language_pack as lp

INDEX_URL = "https://raw.githubusercontent.com/vincentmakes/turbo-ea-translations/main/index.json"
COMMIT = "c0ffee" + "0" * 34
SAVE_HASH = lp.source_hash("Save")


def pack_url_for(code: str = "nl", commit: str = COMMIT) -> str:
    return (
        "https://raw.githubusercontent.com/vincentmakes/turbo-ea-translations/"
        f"{commit}/packs/{code}/pack.json"
    )


def make_pack(
    code: str = "nl",
    strings: dict[str, Any] | None = None,
    hashes: dict[str, Any] | None = None,
    **header: Any,
) -> dict[str, Any]:
    """A ``share`` export, as the library holds it."""
    pack: dict[str, Any] = {
        "format": lp.PACK_FORMAT,
        "format_version": lp.PACK_FORMAT_VERSION,
        "app_version": "2.214.0",
        "locale": {"code": code, "name": "Nederlands", "english_name": "Dutch", "rtl": False},
        "mode": "share",
        "instructions": "Translate every value. <b>never shown</b> https://example.org",
        "strings": {"common": {"actions.save": "Opslaan"}} if strings is None else strings,
        "source_hashes": {"common": {"actions.save": SAVE_HASH}} if hashes is None else hashes,
    }
    pack.update(header)
    return pack


def pack_bytes(pack: dict[str, Any]) -> bytes:
    return json.dumps(pack, ensure_ascii=False).encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_entry(code: str = "nl", data: bytes = b"{}", **kw: Any) -> dict[str, Any]:
    """An ``index.json`` entry as ``scripts/build_index.py`` writes it."""
    entry: dict[str, Any] = {
        "code": code,
        "name": "Nederlands",
        "english_name": "Dutch",
        "rtl": False,
        "app_version": "2.214.0",
        "path": f"packs/{code}/pack.json",
        "sha256": sha(data),
        "size": max(len(data), 1),
        "updated": "2026-11-20T10:00:00Z",
        "commit": COMMIT,
        "strings": 1,
        "ui_strings": 1,
        "metamodel_strings": 0,
        "english_strings": 7681,
        "translated": 1,
        "current": 1,
        "identical_to_english": 0,
        "coverage": 0.0,
        "compared_with": "v2.214.0",
    }
    entry.update(kw)
    return entry


def make_index(*entries: dict[str, Any], **kw: Any) -> dict[str, Any]:
    index: dict[str, Any] = {
        "format": lc.INDEX_FORMAT,
        "format_version": lc.INDEX_FORMAT_VERSION,
        "repository": "vincentmakes/turbo-ea-translations",
        "pack_url": "https://evil.example/{ref}/{path}",
        "languages": list(entries),
    }
    index.update(kw)
    return index


@dataclass
class FakeLibrary:
    """``url → (status, body, headers)``; anything else is a 404."""

    routes: dict[str, tuple[int, bytes, dict[str, str]]] = field(default_factory=dict)
    requested: list[str] = field(default_factory=list)
    #: Sessions open at the moment of each request (see ``count_sessions``).
    open_at_request: list[int] = field(default_factory=list)
    open_sessions: int = 0
    error: Exception | None = None

    def serve(self, url: str, body: bytes | dict, status: int = 200, **headers: str) -> None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.routes[url] = (status, data, headers)

    def publish(self, *packs: dict[str, Any], index_url: str = INDEX_URL) -> dict[str, bytes]:
        """Serve the packs and an index listing them; returns each pack's bytes."""
        out: dict[str, bytes] = {}
        entries = []
        for pack in packs:
            code = pack["locale"]["code"]
            data = pack_bytes(pack)
            out[code] = data
            self.serve(pack_url_for(code), data)
            entries.append(make_entry(code, data))
        self.serve(index_url, make_index(*entries))
        return out

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requested.append(url)
        self.open_at_request.append(self.open_sessions)
        if self.error is not None:
            raise self.error
        status, body, headers = self.routes.get(url, (404, b"", {}))
        return httpx.Response(status, content=body, headers=headers)

    def install(self, monkeypatch) -> FakeLibrary:
        transport = httpx.MockTransport(self.handler)
        monkeypatch.setattr(
            lc,
            "_client",
            lambda: httpx.AsyncClient(transport=transport, follow_redirects=False),
        )
        return self

    def count_sessions(self, monkeypatch, db) -> None:
        """Hand ``db`` to every ``async_session()`` the service opens, counting
        how many are open, so a download can be checked to run with none."""

        @asynccontextmanager
        async def factory():
            self.open_sessions += 1
            try:
                yield db
            finally:
                self.open_sessions -= 1

        monkeypatch.setattr("app.database.async_session", factory)
