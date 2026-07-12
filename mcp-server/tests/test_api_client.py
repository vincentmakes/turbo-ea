"""Unit tests for the API client's error-detail surfacing and DELETE verb.

FastAPI 4xx responses carry a ``detail`` payload naming the failing field;
the bare ``httpx.HTTPStatusError`` message hides it, which made payload
bugs like #802 undiagnosable from the MCP side.
"""

from __future__ import annotations

import httpx
import pytest

from turbo_ea_mcp.api_client import TurboEAClient, _raise_for_status_with_detail


def _response(status: int, *, json_body=None, text: str = "") -> httpx.Response:
    request = httpx.Request("POST", "http://backend:8000/api/v1/soaw")
    if json_body is not None:
        return httpx.Response(status, json=json_body, request=request)
    return httpx.Response(status, text=text, request=request)


class TestRaiseForStatusWithDetail:
    def test_success_is_a_no_op(self):
        _raise_for_status_with_detail(_response(200, json_body={"ok": True}))

    def test_422_detail_named_in_message(self):
        resp = _response(
            422,
            json_body={
                "detail": [
                    {
                        "loc": ["body", "name"],
                        "msg": "Field required",
                        "type": "missing",
                    }
                ]
            },
        )
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            _raise_for_status_with_detail(resp)
        msg = str(exc_info.value)
        # Original status text preserved (call sites string-match on it) …
        assert "422" in msg
        # … and the FastAPI detail is appended so the failing field is named.
        assert "Backend detail:" in msg
        assert "name" in msg
        assert "Field required" in msg

    def test_403_status_text_preserved_for_sniffers(self):
        # transition_card_lifecycle / sign_adr pattern-match "403" in
        # str(exc) for the graceful-degradation deep-link path.
        resp = _response(403, json_body={"detail": "Not enough permissions"})
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            _raise_for_status_with_detail(resp)
        msg = str(exc_info.value)
        assert "403" in msg
        assert "Not enough permissions" in msg

    def test_non_json_body_falls_back_to_text(self):
        resp = _response(502, text="Bad Gateway")
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            _raise_for_status_with_detail(resp)
        assert "Bad Gateway" in str(exc_info.value)

    def test_exception_carries_request_and_response(self):
        resp = _response(422, json_body={"detail": "x"})
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            _raise_for_status_with_detail(resp)
        assert exc_info.value.response.status_code == 422
        assert exc_info.value.request is not None


class TestDelete:
    @pytest.mark.asyncio
    async def test_delete_returns_empty_dict_on_204(self, monkeypatch):
        captured: dict = {}

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def delete(self, url, headers=None):
                captured["url"] = url
                captured["headers"] = headers
                return httpx.Response(204, request=httpx.Request("DELETE", url))

        monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
        client = TurboEAClient("tok", batch_id="B-1")
        out = await client.delete("/stakeholders/st-1")
        assert out == {}
        assert captured["url"].endswith("/api/v1/stakeholders/st-1")
        assert captured["headers"]["Authorization"] == "Bearer tok"
        assert captured["headers"]["X-Turbo-EA-Batch"] == "B-1"

    @pytest.mark.asyncio
    async def test_delete_surfaces_error_detail(self, monkeypatch):
        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def delete(self, url, headers=None):
                return httpx.Response(
                    404,
                    json={"detail": "Stakeholder not found"},
                    request=httpx.Request("DELETE", url),
                )

        monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
        client = TurboEAClient("tok")
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await client.delete("/stakeholders/nope")
        assert "Stakeholder not found" in str(exc_info.value)
