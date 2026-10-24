"""OpenAI Chat Completions — one request shape, adapted to what the model accepts.

Both OpenAI call paths (card suggestions in ``ai_service`` and TurboLens in
``turbolens_ai``), and their Azure Hosted OpenAI twins, post Chat Completions,
and that endpoint stopped accepting one fixed payload for every model: the
reasoning models refuse a custom ``temperature`` unless their reasoning effort
is ``none`` — which the GPT-6 family either lacks or does not default to — and
refuse ``max_tokens`` in favour of ``max_completion_tokens`` ([#1319]). The
same ``openai`` provider type also serves OpenAI-compatible servers (Gemini,
OpenRouter, LM Studio, vLLM), which may only know the legacy names.

So the payload is not chosen by model name — a rule keyed on ``gpt-5*`` is
exactly what a new family breaks — but corrected from the error itself: OpenAI
answers an unsupported parameter with a 400 whose ``error.param`` names it, and
``post_chat`` drops or renames that parameter and re-posts. A server that
accepts the first payload is never retried.

[#1319]: https://github.com/vincentmakes/turbo-ea/discussions/1319
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("turboea.ai.openai")

# The two names of the output cap. The modern one goes first; a server that
# rejects it gets the legacy one, and the other way round.
_RENAMES = {
    "max_completion_tokens": "max_tokens",
    "max_tokens": "max_completion_tokens",
}

# Parameters a request can do without. ``response_format`` is safe to drop
# because every caller already extracts JSON from free text.
_DROPPABLE = frozenset({"temperature", "top_p", "response_format"})

# The error codes that mean "this parameter, not your request, is the problem".
_ADAPTABLE_CODES = frozenset({"unsupported_parameter", "unsupported_value"})

# Enough to fix the output-cap name and drop a sampling parameter in one call.
MAX_ADAPTATIONS = 2


def build_chat_payload(
    model: str | None,
    messages: list[dict[str, str]],
    *,
    max_tokens: int | None = None,
    temperature: float | None = None,
    json_mode: bool = False,
) -> dict[str, Any]:
    """Build a Chat Completions payload in the current OpenAI shape. ``model``
    is ``None`` for Azure, whose deployment is named in the URL instead."""
    payload: dict[str, Any] = {"messages": messages}
    if model is not None:
        payload = {"model": model, **payload}
    if max_tokens is not None:
        payload["max_completion_tokens"] = max_tokens
    if temperature is not None:
        payload["temperature"] = temperature
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    return payload


def _json_or_none(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return None


def _error_object(body: Any) -> dict[str, Any]:
    error = body.get("error") if isinstance(body, dict) else None
    return error if isinstance(error, dict) else {}


def adapt_payload(
    payload: dict[str, Any],
    body: Any,
    tried: frozenset[str] = frozenset(),
) -> dict[str, Any] | None:
    """Return a copy of ``payload`` without what the 400 ``body`` objected to.

    ``None`` means the error is not one this can fix: no parameter named, a
    code other than unsupported parameter/value, a parameter the payload does
    not carry or one that is not optional, or a parameter already adapted in
    ``tried`` — which is what stops the two output-cap names swapping forever.
    """
    error = _error_object(body)
    param = error.get("param")
    if (
        not isinstance(param, str)
        or error.get("code") not in _ADAPTABLE_CODES
        or param not in payload
        or param in tried
    ):
        return None
    adapted = dict(payload)
    if param in _RENAMES:
        target = _RENAMES[param]
        if target in tried:
            return None
        adapted[target] = adapted.pop(param)
        return adapted
    if param in _DROPPABLE:
        del adapted[param]
        return adapted
    return None


async def post_chat(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float | None = None,
    params: dict[str, str] | None = None,
) -> httpx.Response:
    """POST ``payload``, re-posting without each parameter the server refuses.

    Returns the last response whatever its status; the caller decides what a
    failure means. At most ``MAX_ADAPTATIONS`` extra requests are made.
    """
    kwargs: dict[str, Any] = {"json": payload, "headers": headers}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if params is not None:
        kwargs["params"] = params
    resp = await client.post(url, **kwargs)
    tried: set[str] = set()
    while resp.status_code == 400 and len(tried) < MAX_ADAPTATIONS:
        body = _json_or_none(resp)
        adapted = adapt_payload(payload, body, frozenset(tried))
        if adapted is None:
            break
        param = _error_object(body)["param"]
        tried.add(param)
        logger.info(
            "Chat Completions refused %r for model %s; retrying", param, payload.get("model", "-")
        )
        payload = adapted
        kwargs["json"] = payload
        resp = await client.post(url, **kwargs)
    return resp


def error_detail(resp: httpx.Response) -> str:
    """The provider's own reason for a failed response, for logs and errors."""
    message = _error_object(_json_or_none(resp)).get("message")
    if isinstance(message, str) and message:
        return message[:300]
    return (resp.text or "")[:200]
