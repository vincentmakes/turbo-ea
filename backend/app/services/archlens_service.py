"""ArchLens API client — communicates with an ArchLens instance over HTTP."""

from __future__ import annotations

import logging
from typing import Any, cast

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30.0
SYNC_TIMEOUT = 300.0


class ArchLensClient:
    """Async HTTP client for the ArchLens REST API."""

    def __init__(self, instance_url: str):
        self._base = instance_url.rstrip("/")

    def _client(self, timeout: float = DEFAULT_TIMEOUT) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self._base, timeout=timeout)

    @staticmethod
    def _check_response(r: httpx.Response, endpoint: str) -> None:
        """Raise with the upstream error message instead of a bare status code."""
        if r.is_success:
            return
        detail = ""
        try:
            detail = r.json().get("error", "")
        except Exception:
            detail = r.text[:300]
        raise httpx.HTTPStatusError(
            f"ArchLens {endpoint} failed ({r.status_code}): {detail}",
            request=r.request,
            response=r,
        )

    # ── Health / connectivity ───────────────────────────────────────────────
    async def test_connection(self) -> tuple[bool, str]:
        """Hit GET /api/health and return (ok, message)."""
        try:
            async with self._client() as c:
                r = await c.get("/api/health")
                if r.status_code == 200:
                    data = r.json()
                    version = data.get("version", "unknown")
                    return True, f"Connected — ArchLens v{version}"
                return False, f"Unexpected status {r.status_code}"
        except httpx.ConnectError:
            return False, "Connection refused — is ArchLens running?"
        except Exception as exc:
            return False, str(exc)

    # ── AI config passthrough ────────────────────────────────────────────────
    async def push_ai_config(self, provider: str, api_key: str) -> tuple[bool, str]:
        """Push AI provider + key to ArchLens via POST /api/settings."""
        try:
            async with self._client() as c:
                r = await c.post(
                    "/api/settings",
                    json={"ai_provider": provider, "ai_api_key": api_key},
                )
                if r.status_code == 200:
                    return True, "AI configuration pushed to ArchLens"
                return False, f"Unexpected status {r.status_code}"
        except Exception as exc:
            logger.warning("Failed to push AI config to ArchLens: %s", exc)
            return False, str(exc)

    # ── Sync ────────────────────────────────────────────────────────────────
    async def trigger_sync(
        self,
        turbo_url: str,
        email: str,
        password: str,
    ) -> dict[str, Any]:
        """Tell ArchLens to connect to Turbo EA and sync card data."""
        async with self._client(timeout=SYNC_TIMEOUT) as c:
            # Step 1: connect
            r = await c.post(
                "/api/connect",
                json={
                    "workspace": turbo_url,
                    "source_type": "turboea",
                    "email": email,
                    "password": password,
                },
            )
            if r.status_code != 200:
                detail = r.json().get("error", r.text)
                raise RuntimeError(f"ArchLens connect failed: {detail}")
            connect_data = r.json()
            host = connect_data.get("host", turbo_url)

            # Step 2: trigger sync via POST (credentials in body, not query string)
            sync_result: dict[str, Any] = {}
            async with c.stream(
                "POST",
                "/api/sync/stream",
                json={
                    "workspace": host,
                    "source_type": "turboea",
                    "email": email,
                    "password": password,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        import json

                        try:
                            data = json.loads(line[6:])
                            if data.get("event") == "done":
                                sync_result = data
                            elif data.get("event") == "error":
                                raise RuntimeError(data.get("msg", "Sync failed"))
                        except json.JSONDecodeError:
                            pass
            return sync_result

    # ── Overview ────────────────────────────────────────────────────────────
    async def get_overview(self, workspace: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.get("/api/data/overview", params={"workspace": workspace})
            self._check_response(r, r.request.url.path)
            return cast(dict[str, Any], r.json())

    # ── Vendor analysis ─────────────────────────────────────────────────────
    async def trigger_vendor_analysis(self, workspace: str) -> dict[str, Any]:
        async with self._client(timeout=SYNC_TIMEOUT) as c:
            r = await c.post("/api/vendors/analyse", json={"workspace": workspace})
            self._check_response(r, "vendors/analyse")
            return cast(dict[str, Any], r.json())

    async def get_vendors(self, workspace: str) -> list[dict[str, Any]]:
        async with self._client() as c:
            r = await c.get("/api/vendors", params={"workspace": workspace})
            self._check_response(r, r.request.url.path)
            return cast(list[dict[str, Any]], r.json())

    # ── Vendor resolution ───────────────────────────────────────────────────
    async def trigger_vendor_resolution(self, workspace: str) -> dict[str, Any]:
        """Trigger vendor identity resolution (streaming, wait for complete)."""
        async with self._client(timeout=SYNC_TIMEOUT) as c:
            result: dict[str, Any] = {}
            async with c.stream(
                "GET",
                "/api/resolution/stream",
                params={"workspace": workspace},
            ) as resp:
                import json

                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            if data.get("event") == "complete":
                                result = data
                            elif data.get("event") == "error":
                                raise RuntimeError(data.get("msg", "Resolution failed"))
                        except json.JSONDecodeError:
                            pass
            return result

    async def get_vendor_hierarchy(self, workspace: str) -> list[dict[str, Any]]:
        async with self._client() as c:
            r = await c.get("/api/resolution/hierarchy", params={"workspace": workspace})
            self._check_response(r, r.request.url.path)
            return cast(list[dict[str, Any]], r.json())

    # ── Duplicate detection ─────────────────────────────────────────────────
    async def trigger_duplicate_detection(self, workspace: str) -> dict[str, Any]:
        """Trigger duplicate detection (streaming, wait for complete)."""
        async with self._client(timeout=SYNC_TIMEOUT) as c:
            result: dict[str, Any] = {}
            async with c.stream(
                "GET",
                "/api/duplicates/stream",
                params={"workspace": workspace},
            ) as resp:
                import json

                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            if data.get("event") == "complete":
                                result = data
                            elif data.get("event") == "error":
                                raise RuntimeError(data.get("msg", "Detection failed"))
                        except json.JSONDecodeError:
                            pass
            return result

    async def get_duplicates(self, workspace: str) -> list[dict[str, Any]]:
        async with self._client() as c:
            r = await c.get("/api/duplicates", params={"workspace": workspace})
            self._check_response(r, r.request.url.path)
            return cast(list[dict[str, Any]], r.json())

    # ── Architecture AI ─────────────────────────────────────────────────────
    async def get_landscape(self, workspace: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.get("/api/architect/landscape", params={"workspace": workspace})
            self._check_response(r, r.request.url.path)
            return cast(dict[str, Any], r.json())

    async def architect_phase1(self, workspace: str, requirement: str) -> dict[str, Any]:
        async with self._client(timeout=120) as c:
            r = await c.post(
                "/api/architect/phase1",
                json={"workspace": workspace, "requirement": requirement},
            )
            self._check_response(r, "architect/phase1")
            return cast(dict[str, Any], r.json())

    async def architect_phase2(
        self,
        workspace: str,
        requirement: str,
        phase1_qa: dict[str, Any] | list[Any],
    ) -> dict[str, Any]:
        async with self._client(timeout=120) as c:
            r = await c.post(
                "/api/architect/phase2",
                json={
                    "workspace": workspace,
                    "requirement": requirement,
                    "phase1QA": phase1_qa,
                },
            )
            self._check_response(r, "architect/phase2")
            return cast(dict[str, Any], r.json())

    async def architect_phase3(
        self,
        workspace: str,
        requirement: str,
        all_qa: dict[str, Any] | list[Any],
    ) -> dict[str, Any]:
        async with self._client(timeout=180) as c:
            r = await c.post(
                "/api/architect/phase3",
                json={
                    "workspace": workspace,
                    "requirement": requirement,
                    "allQA": all_qa,
                },
            )
            self._check_response(r, "architect/phase3")
            return cast(dict[str, Any], r.json())
