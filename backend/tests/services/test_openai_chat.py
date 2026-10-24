"""Tests for the adaptive OpenAI Chat Completions poster (openai_chat.py).

No database: the HTTP client is a fake that answers a scripted list of
responses and records every payload it was sent (#1319).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import openai_chat
from app.services.openai_chat import (
    MAX_ADAPTATIONS,
    adapt_payload,
    build_chat_payload,
    error_detail,
    post_chat,
)

MSGS = [{"role": "user", "content": "hi"}]


def _resp(status: int = 200, body=None, text: str = "") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.is_success = 200 <= status < 300
    resp.text = text
    if isinstance(body, Exception):
        resp.json.side_effect = body
    else:
        resp.json.return_value = body
    return resp


def _refusal(param, code="unsupported_parameter", message="nope") -> MagicMock:
    return _resp(
        400,
        {
            "error": {
                "message": message,
                "type": "invalid_request_error",
                "param": param,
                "code": code,
            }
        },
    )


def _client(*responses: MagicMock) -> AsyncMock:
    client = AsyncMock()
    client.post = AsyncMock(side_effect=list(responses))
    return client


def _sent(client: AsyncMock) -> list[dict]:
    return [call.kwargs["json"] for call in client.post.call_args_list]


class TestBuildChatPayload:
    def test_minimal_payload_is_model_and_messages(self):
        assert build_chat_payload("gpt-6.1-sol", MSGS) == {
            "model": "gpt-6.1-sol",
            "messages": MSGS,
        }

    def test_options_use_the_current_names(self):
        assert build_chat_payload("m", MSGS, max_tokens=50, temperature=0.1, json_mode=True) == {
            "model": "m",
            "messages": MSGS,
            "max_completion_tokens": 50,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }

    def test_no_model_for_azure(self):
        assert build_chat_payload(None, MSGS, max_tokens=4) == {
            "messages": MSGS,
            "max_completion_tokens": 4,
        }

    def test_zero_values_are_still_sent(self):
        payload = build_chat_payload("m", MSGS, max_tokens=0, temperature=0.0)
        assert payload["max_completion_tokens"] == 0
        assert payload["temperature"] == 0.0


class TestAdaptPayload:
    BASE = {
        "model": "m",
        "messages": MSGS,
        "max_completion_tokens": 9,
        "temperature": 0.1,
        "top_p": 0.5,
        "response_format": {"type": "json_object"},
    }

    @pytest.mark.parametrize("param", ["temperature", "top_p", "response_format"])
    @pytest.mark.parametrize("code", ["unsupported_parameter", "unsupported_value"])
    def test_optional_parameters_are_dropped(self, param, code):
        body = _refusal(param, code).json.return_value
        adapted = adapt_payload(self.BASE, body)
        expected = {k: v for k, v in self.BASE.items() if k != param}
        assert adapted == expected
        assert param in self.BASE, "the input payload is never mutated"

    def test_modern_cap_falls_back_to_the_legacy_name(self):
        body = _refusal("max_completion_tokens").json.return_value
        adapted = adapt_payload(self.BASE, body)
        assert adapted is not None
        assert "max_completion_tokens" not in adapted
        assert adapted["max_tokens"] == 9

    def test_legacy_cap_moves_to_the_modern_name(self):
        payload = {"model": "m", "messages": MSGS, "max_tokens": 7}
        body = _refusal("max_tokens").json.return_value
        assert adapt_payload(payload, body) == {
            "model": "m",
            "messages": MSGS,
            "max_completion_tokens": 7,
        }

    def test_a_rename_back_to_a_tried_name_is_refused(self):
        payload = {"model": "m", "messages": MSGS, "max_tokens": 7}
        body = _refusal("max_tokens").json.return_value
        assert adapt_payload(payload, body, frozenset({"max_completion_tokens"})) is None

    def test_a_tried_parameter_is_not_adapted_twice(self):
        body = _refusal("temperature").json.return_value
        assert adapt_payload(self.BASE, body, frozenset({"temperature"})) is None

    @pytest.mark.parametrize(
        "body",
        [
            None,
            "text",
            {},
            {"error": "flat string"},
            {"error": {"param": "temperature", "code": "invalid_type"}},
            {"error": {"param": "temperature"}},
            {"error": {"param": None, "code": "unsupported_parameter"}},
            {"error": {"param": ["temperature"], "code": "unsupported_parameter"}},
            {"error": {"param": "seed", "code": "unsupported_parameter"}},
            {"error": {"param": "model", "code": "unsupported_value"}},
            {"error": {"param": "messages", "code": "unsupported_value"}},
        ],
    )
    def test_errors_it_cannot_fix(self, body):
        assert adapt_payload(self.BASE, body) is None

    def test_a_parameter_the_payload_lacks_is_not_fixable(self):
        payload = {"model": "m", "messages": MSGS}
        assert adapt_payload(payload, _refusal("temperature").json.return_value) is None


class TestPostChat:
    async def test_an_accepted_payload_is_sent_once(self):
        client = _client(_resp(200, {"choices": []}))
        payload = build_chat_payload("m", MSGS, temperature=0.1)
        resp = await post_chat(client, "https://x/v1/chat/completions", headers={}, payload=payload)
        assert resp.status_code == 200
        assert client.post.await_count == 1
        args, kwargs = client.post.call_args
        assert args == ("https://x/v1/chat/completions",)
        assert kwargs == {"json": payload, "headers": {}}

    async def test_temperature_refusal_is_retried_without_it(self):
        """The #1319 regression: a GPT-6 reasoning model refuses temperature."""
        client = _client(_refusal("temperature", "unsupported_value"), _resp(200, {}))
        payload = build_chat_payload("gpt-6.1-sol", MSGS, temperature=0.1, json_mode=True)
        resp = await post_chat(client, "u", headers={"h": "v"}, payload=payload)
        assert resp.status_code == 200
        assert [c.args for c in client.post.call_args_list] == [("u",), ("u",)]
        first, second = _sent(client)
        assert first["temperature"] == 0.1
        assert "temperature" not in second
        assert second["response_format"] == {"type": "json_object"}
        assert client.post.call_args.kwargs["headers"] == {"h": "v"}

    async def test_two_fixes_in_a_row(self):
        client = _client(
            _refusal("max_completion_tokens"),
            _refusal("temperature"),
            _resp(200, {}),
        )
        payload = build_chat_payload("m", MSGS, max_tokens=5, temperature=0.1)
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp.status_code == 200
        assert _sent(client)[-1] == {"model": "m", "messages": MSGS, "max_tokens": 5}

    async def test_retries_stop_at_the_cap(self):
        assert MAX_ADAPTATIONS == 2
        client = _client(
            _refusal("temperature"),
            _refusal("top_p"),
            _refusal("response_format"),
        )
        payload = {
            "model": "m",
            "messages": MSGS,
            "temperature": 0.1,
            "top_p": 0.5,
            "response_format": {"type": "json_object"},
        }
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp.status_code == 400
        assert client.post.await_count == 3

    async def test_the_output_cap_never_swaps_back(self):
        client = _client(
            _refusal("max_completion_tokens"),
            _refusal("max_tokens"),
        )
        payload = build_chat_payload("m", MSGS, max_tokens=5)
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp.status_code == 400
        assert client.post.await_count == 2

    @pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
    async def test_other_failures_are_returned_untouched(self, status):
        refused = _refusal("temperature")
        refused.status_code = status
        client = _client(refused)
        payload = build_chat_payload("m", MSGS, temperature=0.1)
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp is refused
        assert client.post.await_count == 1

    async def test_an_unfixable_400_is_returned(self):
        bad = _resp(400, ValueError("not json"), text="<html>")
        client = _client(bad)
        resp = await post_chat(client, "u", headers={}, payload=build_chat_payload("m", MSGS))
        assert resp is bad
        assert client.post.await_count == 1

    async def test_timeout_is_forwarded_to_every_attempt(self):
        client = _client(_refusal("temperature"), _resp(200, {}))
        payload = build_chat_payload("m", MSGS, temperature=0.1)
        await post_chat(client, "u", headers={}, payload=payload, timeout=30.0)
        assert [c.kwargs["timeout"] for c in client.post.call_args_list] == [30.0, 30.0]

    async def test_params_are_forwarded_and_a_modelless_retry_logs(self, caplog):
        caplog.set_level("INFO", logger=openai_chat.logger.name)
        client = _client(_refusal("temperature"), _resp(200, {}))
        payload = build_chat_payload(None, MSGS, temperature=0.1)
        await post_chat(client, "u", headers={}, payload=payload, params={"api-version": "v"})
        assert [c.kwargs["params"] for c in client.post.call_args_list] == [
            {"api-version": "v"},
            {"api-version": "v"},
        ]
        assert "for model -" in caplog.text

    async def test_the_retry_is_logged_with_param_and_model(self, caplog):
        caplog.set_level("INFO", logger=openai_chat.logger.name)
        client = _client(_refusal("temperature"), _resp(200, {}))
        payload = build_chat_payload("gpt-6.1-sol", MSGS, temperature=0.1)
        await post_chat(client, "u", headers={}, payload=payload)
        assert (
            "Chat Completions refused 'temperature' for model gpt-6.1-sol; retrying" in caplog.text
        )


class TestErrorDetail:
    def test_prefers_the_provider_message(self):
        resp = _refusal("x", message="Project p has no access to model gpt-6.1-sol")
        assert error_detail(resp) == "Project p has no access to model gpt-6.1-sol"

    def test_a_long_message_is_cut(self):
        resp = _resp(403, {"error": {"message": "m" * 500}})
        assert error_detail(resp) == "m" * 300

    @pytest.mark.parametrize(
        "body",
        [ValueError("not json"), {}, {"error": {"message": ""}}, {"error": {"message": 3}}],
    )
    def test_falls_back_to_the_text(self, body):
        resp = _resp(403, body, text="t" * 300)
        assert error_detail(resp) == "t" * 200

    def test_no_text_is_an_empty_string(self):
        resp = _resp(403, ValueError("x"), text="")
        assert error_detail(resp) == ""
