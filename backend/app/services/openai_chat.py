"""OpenAI Chat Completions — one request shape, adapted to what the model accepts.

Both OpenAI call paths (card suggestions in ``ai_service`` and TurboLens in
``turbolens_ai``), and their Azure Hosted OpenAI twins, post Chat Completions,
and that endpoint stopped accepting one fixed payload for every model: the
reasoning models refuse a custom ``temperature`` unless their reasoning effort
is ``none`` — which the GPT-6 family either lacks or does not default to — and
refuse ``max_tokens`` in favour of ``max_completion_tokens`` ([#1319]). The
same ``openai`` provider type also serves OpenAI-compatible servers (Gemini,
OpenRouter, LM Studio, vLLM, and gateways in front of them), which may only
know the legacy names, or refuse JSON mode ([#1372]).

So the payload is not chosen by model name — a rule keyed on ``gpt-5*`` is
exactly what a new family breaks — nor by a setting an admin has to find, but
corrected from the error itself: ``post_chat`` drops or renames the optional
parameter a refusal names and re-posts. A server that accepts the first
payload is never retried.

A refusal names its parameter in one of two ways (``refused_param``). OpenAI
answers with a 400 whose ``error.param`` names it and whose ``error.code``
says the parameter is the problem. The compatible servers each have their own
envelope — LM Studio a bare string, FastAPI servers a 422 ``detail`` list,
others an ``errors`` array — and what they share is only that the parameter's
name appears somewhere in what they say.

[#1319]: https://github.com/vincentmakes/turbo-ea/discussions/1319
[#1372]: https://github.com/vincentmakes/turbo-ea/discussions/1372
"""

from __future__ import annotations

import logging
import re
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

# Every optional parameter, in the order a refusal that names none of them in
# ``error.param`` is searched for them.
_OPTIONAL = ("response_format", "temperature", "top_p", "max_completion_tokens", "max_tokens")

# A parameter name counts only as a whole word: ``max_tokens`` is not named by
# a message about ``max_tokens_per_minute``.
_NAMED = {
    name: re.compile(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])") for name in _OPTIONAL
}

# What a server answers a parameter it will not take with: 400 from OpenAI and
# most compatible servers, 422 from the ones that validate with FastAPI.
_REFUSAL_STATUSES = frozenset({400, 422})

# Enough to fix the output-cap name and drop both of the parameters a card
# suggestion asks for (``temperature`` and ``response_format``) in one call.
MAX_ADAPTATIONS = 3


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


def _refusal_text(body: Any) -> str:
    """Every string a refusal carries, whatever envelope it came in.

    Values only, never keys: a server that echoes the request back would
    otherwise name every parameter the payload has.
    """
    parts: list[str] = []
    stack = [body]
    while stack:
        value = stack.pop()
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return " ".join(parts)


def _adaptable(payload: dict[str, Any], param: str, tried: frozenset[str]) -> bool:
    """Whether ``payload`` carries ``param`` and can still do without it —
    or, for the output cap, still has its other name to try."""
    if param not in payload or param in tried:
        return False
    if param in _RENAMES:
        return _RENAMES[param] not in tried
    return param in _DROPPABLE


def refused_param(
    payload: dict[str, Any],
    body: Any,
    tried: frozenset[str] = frozenset(),
) -> str | None:
    """The optional parameter of ``payload`` a refusal objects to, if any.

    ``body`` is the parsed error response, or its raw text from a server that
    did not answer in JSON. ``None`` means the error is not one a retry can
    fix: no optional parameter named, one the payload does not carry, or one
    already adapted in ``tried`` — which is what stops the two output-cap
    names swapping forever.

    An error that fills OpenAI's ``error.param`` is judged on that alone, and
    only with a code that blames the parameter: its message may well mention
    another parameter in passing. Any other envelope has just its text, so
    the first optional parameter it names is the one.
    """
    error = _error_object(body)
    param = error.get("param")
    if param is not None:
        if not isinstance(param, str) or error.get("code") not in _ADAPTABLE_CODES:
            return None
        # OpenAI names a nested field by its path: ``response_format.type``.
        root = param.split(".")[0]
        return root if _adaptable(payload, root, tried) else None
    refusal = _refusal_text(body)
    for name in _OPTIONAL:
        if _adaptable(payload, name, tried) and _NAMED[name].search(refusal):
            return name
    return None


def _without(payload: dict[str, Any], param: str) -> dict[str, Any]:
    """A copy of ``payload`` with ``param`` renamed (the output cap) or dropped."""
    adapted = dict(payload)
    if param in _RENAMES:
        adapted[_RENAMES[param]] = adapted.pop(param)
    else:
        del adapted[param]
    return adapted


def adapt_payload(
    payload: dict[str, Any],
    body: Any,
    tried: frozenset[str] = frozenset(),
) -> dict[str, Any] | None:
    """Return a copy of ``payload`` without what the refusal ``body`` objected
    to, or ``None`` when ``refused_param`` finds nothing a retry can fix."""
    param = refused_param(payload, body, tried)
    return None if param is None else _without(payload, param)


async def post_chat_traced(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float | None = None,
    params: dict[str, str] | None = None,
) -> tuple[httpx.Response, tuple[str, ...]]:
    """POST ``payload``, re-posting without each parameter the server refuses.

    Returns the last response whatever its status — the caller decides what a
    failure means — and the parameters the request ended up going without. A
    renamed output cap is not among them: it was still sent. At most
    ``MAX_ADAPTATIONS`` extra requests are made.
    """
    kwargs: dict[str, Any] = {"json": payload, "headers": headers}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if params is not None:
        kwargs["params"] = params
    resp = await client.post(url, **kwargs)
    tried: list[str] = []
    while resp.status_code in _REFUSAL_STATUSES and len(tried) < MAX_ADAPTATIONS:
        body = _json_or_none(resp)
        param = refused_param(payload, resp.text if body is None else body, frozenset(tried))
        if param is None:
            break
        tried.append(param)
        logger.info(
            "Chat Completions refused %r for model %s; retrying", param, payload.get("model", "-")
        )
        payload = _without(payload, param)
        kwargs["json"] = payload
        resp = await client.post(url, **kwargs)
    return resp, tuple(p for p in tried if p in _DROPPABLE)


async def post_chat(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float | None = None,
    params: dict[str, str] | None = None,
) -> httpx.Response:
    """``post_chat_traced`` for a caller that only wants the response."""
    resp, _dropped = await post_chat_traced(
        client, url, headers=headers, payload=payload, timeout=timeout, params=params
    )
    return resp


def error_code(resp: httpx.Response) -> str | None:
    """The ``error.code`` of a failed response, when the provider sent one as text."""
    code = _error_object(_json_or_none(resp)).get("code")
    return code if isinstance(code, str) else None


def error_detail(resp: httpx.Response) -> str:
    """The provider's own reason for a failed response, for logs and errors.

    OpenAI's ``error.message``, or the ``error`` itself from a server that
    answers with a bare string (LM Studio); failing both, the raw text.
    """
    body = _json_or_none(resp)
    message = _error_object(body).get("message")
    if not isinstance(message, str) and isinstance(body, dict):
        message = body.get("error")
    if isinstance(message, str) and message:
        return message[:300]
    return (resp.text or "")[:200]
