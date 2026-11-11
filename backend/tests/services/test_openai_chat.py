"""Tests for the adaptive OpenAI Chat Completions poster (openai_chat.py).

No database: the HTTP client is a fake that answers a scripted list of
responses and records every payload it was sent (#1319). The refusals of the
OpenAI-compatible servers are the bodies those servers really send (#1372).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import openai_chat
from app.services.openai_chat import (
    MAX_ADAPTATIONS,
    adapt_payload,
    build_chat_payload,
    error_code,
    error_detail,
    post_chat,
    post_chat_traced,
    refused_param,
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


# The body LM Studio answers JSON mode with, as captured in #1372: ``error``
# is a bare string, with neither ``param`` nor ``code``.
LM_STUDIO = {"error": "'response_format.type' must be 'json_schema' or 'text'"}

# A FastAPI server that forbids a field it does not know: a 422, and the
# parameter is an element of ``loc``.
FASTAPI = {
    "detail": [
        {
            "type": "extra_forbidden",
            "loc": ["body", "response_format"],
            "msg": "Extra inputs are not permitted",
        }
    ]
}

# A provider with its own validation envelope; the rule's code holds the name
# inside a longer identifier, which is not a mention of it.
ERRORS_ARRAY = {
    "code": "validation_failed",
    "description": "Validation failed",
    "errors": [
        {
            "code": "validation_rule_response_format_types_blacklist",
            "description": "This value is no longer supported.",
            "context": {"attribute": "response_format.type"},
        }
    ],
}


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


class TestRefusedParam:
    """Which parameter a refusal names, in the envelope of each kind of server."""

    BASE = TestAdaptPayload.BASE

    @pytest.mark.parametrize(
        ("body", "param"),
        [
            (LM_STUDIO, "response_format"),
            (FASTAPI, "response_format"),
            (ERRORS_ARRAY, "response_format"),
            # An error object that fills no ``param``, with a numeric code.
            (
                {"error": {"message": "temperature is not supported here", "code": 400}},
                "temperature",
            ),
            # No ``error`` key at all, and a null ``param``.
            ({"object": "error", "message": "top_p: unknown", "param": None, "code": 400}, "top_p"),
            (
                {"error": {"message": "Unknown field: max_completion_tokens"}},
                "max_completion_tokens",
            ),
            ("temperature is not supported", "temperature"),
            (["no", ["deeper", {"why": "bad temperature"}]], "temperature"),
        ],
    )
    def test_a_refusal_in_any_envelope_names_its_parameter(self, body, param):
        assert refused_param(self.BASE, body) == param

    @pytest.mark.parametrize("code", ["unsupported_parameter", "unsupported_value"])
    def test_a_nested_field_is_its_parameter(self, code):
        body = _refusal("response_format.type", code).json.return_value
        assert refused_param(self.BASE, body) == "response_format"
        assert adapt_payload(self.BASE, body) == {
            k: v for k, v in self.BASE.items() if k != "response_format"
        }

    def test_a_nested_field_of_a_required_parameter_is_not_fixable(self):
        body = _refusal("messages.0.content", "unsupported_value").json.return_value
        assert refused_param(self.BASE, body) is None

    @pytest.mark.parametrize(
        "body",
        [
            # ``error.param`` is the verdict; a parameter the message happens
            # to mention is not.
            {"error": {"message": "response_format needs json", "param": "messages", "code": None}},
            {
                "error": {
                    "message": "temperature is unsupported",
                    "param": "messages",
                    "code": "unsupported_value",
                }
            },
            {"error": {"message": "temperature", "param": 7, "code": "unsupported_value"}},
            # Longer identifiers that merely contain a name.
            {"error": "max_completion_tokens_per_minute exceeded"},
            {"error": "the xtemperature is wrong"},
            {"error": "set_temperature failed"},
            {"error": "temperature2 is wrong"},
            # Keys are not mentions: a server echoing the request names them all.
            {"error": "bad request", "input": {"temperature": 0.1, "top_p": 0.5}},
            {"error": "context length exceeded"},
            {"error": "seed is not supported"},
        ],
    )
    def test_errors_that_name_no_optional_parameter(self, body):
        assert refused_param(self.BASE, body) is None

    def test_the_first_parameter_in_the_fixed_order_wins(self):
        body = {"error": "top_p, temperature and response_format are not supported"}
        assert refused_param(self.BASE, body) == "response_format"
        tried = frozenset({"response_format"})
        assert refused_param(self.BASE, body, tried) == "temperature"
        assert refused_param(self.BASE, body, tried | {"temperature"}) == "top_p"
        assert refused_param(self.BASE, body, tried | {"temperature", "top_p"}) is None

    def test_a_named_parameter_the_payload_lacks_is_not_fixable(self):
        payload = {"model": "m", "messages": MSGS, "temperature": 0.1}
        assert refused_param(payload, LM_STUDIO) is None

    def test_the_output_cap_does_not_swap_back_on_text_either(self):
        payload = {"model": "m", "messages": MSGS, "max_tokens": 7}
        body = {"error": "max_tokens is not supported"}
        assert refused_param(payload, body) == "max_tokens"
        assert refused_param(payload, body, frozenset({"max_completion_tokens"})) is None

    @pytest.mark.parametrize("body", [None, 7, 0.5, True, [None, 3], {"error": None}])
    def test_a_body_that_holds_no_text_names_nothing(self, body):
        assert refused_param(self.BASE, body) is None

    def test_adapting_from_text_drops_or_renames(self):
        assert adapt_payload(self.BASE, LM_STUDIO) == {
            k: v for k, v in self.BASE.items() if k != "response_format"
        }
        renamed = adapt_payload(self.BASE, {"error": "max_completion_tokens: unknown field"})
        assert renamed is not None
        assert renamed["max_tokens"] == 9 and "max_completion_tokens" not in renamed
        assert self.BASE["max_completion_tokens"] == 9, "the input payload is never mutated"


class TestPostChat:
    async def test_json_mode_refused_by_a_bare_string_is_retried_without_it(self):
        """The #1372 regression: LM Studio (behind a Bionic gateway) refuses
        ``json_object`` in an envelope OpenAI never uses."""
        client = _client(_resp(400, LM_STUDIO), _resp(200, {}))
        payload = build_chat_payload("google/gemma-4-e4b", MSGS, temperature=0.1, json_mode=True)
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp.status_code == 200
        first, second = _sent(client)
        assert first["response_format"] == {"type": "json_object"}
        assert second == {"model": "google/gemma-4-e4b", "messages": MSGS, "temperature": 0.1}

    async def test_a_422_refusal_is_retried(self):
        client = _client(_resp(422, FASTAPI), _resp(200, {}))
        payload = build_chat_payload("m", MSGS, json_mode=True)
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp.status_code == 200
        assert _sent(client)[-1] == {"model": "m", "messages": MSGS}

    async def test_a_refusal_that_is_not_json_is_read_as_text(self):
        refused = _resp(400, ValueError("not json"), text="Unsupported field: temperature")
        client = _client(refused, _resp(200, {}))
        payload = build_chat_payload("m", MSGS, temperature=0.1)
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp.status_code == 200
        assert _sent(client)[-1] == {"model": "m", "messages": MSGS}

    async def test_the_text_of_a_json_refusal_is_not_searched(self):
        refused = _resp(400, {"error": "nope"}, text="temperature")
        client = _client(refused)
        payload = build_chat_payload("m", MSGS, temperature=0.1)
        resp = await post_chat(client, "u", headers={}, payload=payload)
        assert resp is refused
        assert client.post.await_count == 1

    async def test_the_dropped_parameters_are_reported_in_order(self):
        client = _client(
            _refusal("max_completion_tokens"),
            _refusal("temperature", "unsupported_value"),
            _resp(400, LM_STUDIO),
            _resp(200, {}),
        )
        payload = build_chat_payload("m", MSGS, max_tokens=5, temperature=0.1, json_mode=True)
        resp, dropped = await post_chat_traced(client, "u", headers={}, payload=payload)
        assert resp.status_code == 200
        # The renamed cap was still sent, so it is not among them.
        assert dropped == ("temperature", "response_format")
        assert _sent(client)[-1] == {"model": "m", "messages": MSGS, "max_tokens": 5}

    async def test_nothing_is_reported_dropped_for_an_accepted_payload(self):
        accepted = _resp(200, {})
        client = _client(accepted)
        payload = build_chat_payload("m", MSGS, temperature=0.1, json_mode=True)
        resp, dropped = await post_chat_traced(
            client, "u", headers={"h": "v"}, payload=payload, timeout=9.0, params={"p": "q"}
        )
        assert resp is accepted
        assert dropped == ()
        assert client.post.call_args.kwargs == {
            "json": payload,
            "headers": {"h": "v"},
            "timeout": 9.0,
            "params": {"p": "q"},
        }

    async def test_a_drop_is_reported_even_when_the_retry_fails(self):
        failed = _resp(500, {})
        client = _client(_resp(400, LM_STUDIO), failed)
        payload = build_chat_payload("m", MSGS, json_mode=True)
        resp, dropped = await post_chat_traced(client, "u", headers={}, payload=payload)
        assert resp is failed
        assert dropped == ("response_format",)

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

    async def test_a_successful_answer_that_mentions_a_parameter_is_not_a_refusal(self):
        """Only a refusal status is searched: a model may well write the word."""
        answered = _resp(200, {"choices": [{"message": {"content": "the temperature is fine"}}]})
        client = _client(answered)
        payload = build_chat_payload("m", MSGS, temperature=0.1)
        resp, dropped = await post_chat_traced(client, "u", headers={}, payload=payload)
        assert resp is answered
        assert dropped == ()
        assert client.post.await_count == 1

    async def test_the_cap_ends_the_retries_and_what_was_dropped_is_still_reported(self):
        assert MAX_ADAPTATIONS == 3
        client = _client(
            _refusal("max_completion_tokens"),
            _refusal("temperature"),
            _refusal("top_p"),
            _refusal("response_format"),
        )
        payload = {
            "model": "m",
            "messages": MSGS,
            "max_completion_tokens": 5,
            "temperature": 0.1,
            "top_p": 0.5,
            "response_format": {"type": "json_object"},
        }
        resp, dropped = await post_chat_traced(client, "u", headers={}, payload=payload)
        assert resp.status_code == 400
        assert client.post.await_count == 4
        assert dropped == ("temperature", "top_p")
        assert _sent(client)[-1] == {
            "model": "m",
            "messages": MSGS,
            "max_tokens": 5,
            "response_format": {"type": "json_object"},
        }

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


class TestErrorCode:
    def test_the_code_of_an_error_object(self):
        assert error_code(_refusal("temperature", "unsupported_value")) == "unsupported_value"
        assert error_code(_resp(404, {"error": {"code": "DeploymentNotFound"}})) == (
            "DeploymentNotFound"
        )

    @pytest.mark.parametrize(
        "body",
        [
            ValueError("not json"),
            None,
            {},
            {"error": "bare string"},
            {"error": {"message": "no code"}},
            {"error": {"code": 404}},
            {"error": {"code": None}},
            {"code": "top-level"},
        ],
    )
    def test_no_code_when_the_provider_sent_none_as_text(self, body):
        assert error_code(_resp(404, body)) is None


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

    def test_a_bare_string_error_is_the_reason(self):
        assert error_detail(_resp(400, LM_STUDIO, text="raw")) == LM_STUDIO["error"]
        assert error_detail(_resp(400, {"error": "e" * 500})) == "e" * 300

    @pytest.mark.parametrize("body", [{"error": ""}, {"error": 5}, ["error"], "error"])
    def test_an_error_that_is_no_reason_falls_back_to_the_text(self, body):
        assert error_detail(_resp(400, body, text="raw")) == "raw"

    def test_no_text_is_an_empty_string(self):
        resp = _resp(403, ValueError("x"), text="")
        assert error_detail(resp) == ""
