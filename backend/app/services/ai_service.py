"""AI service — web search + LLM description generation for cards.

Two-step pipeline:
  1. Web search (DuckDuckGo HTML scrape) for the card name
  2. LLM prompt with search snippets → card description (type-aware)

Supports multiple LLM providers:
  - Ollama (self-hosted, /api/chat)
  - OpenAI-compatible (OpenAI, Gemini, Azure, OpenRouter, LM Studio, vLLM)
  - Anthropic Claude (/v1/messages)
"""

from __future__ import annotations

import json
import logging
import re
from html import unescape
from typing import Any

import httpx

logger = logging.getLogger("turboea.ai")

# ---------------------------------------------------------------------------
# Module-level HTTP clients (reused across requests)
# ---------------------------------------------------------------------------

_search_client: httpx.AsyncClient | None = None
_llm_client: httpx.AsyncClient | None = None


async def _get_search_client() -> httpx.AsyncClient:
    global _search_client  # noqa: N816
    if _search_client is None or _search_client.is_closed:
        _search_client = httpx.AsyncClient(timeout=20.0)
    return _search_client


async def _get_llm_client() -> httpx.AsyncClient:
    global _llm_client  # noqa: N816
    if _llm_client is None or _llm_client.is_closed:
        _llm_client = httpx.AsyncClient(timeout=120.0)
    return _llm_client


# Keep backward-compatible alias used by tests
async def _get_client() -> httpx.AsyncClient:
    return await _get_search_client()


# ---------------------------------------------------------------------------
# Ollama introspection
# ---------------------------------------------------------------------------


async def fetch_running_models(provider_url: str) -> list[dict[str, Any]]:
    """Return the models currently loaded in Ollama via ``GET /api/ps``.

    Each entry has ``name`` (model tag) and ``size`` (VRAM bytes).
    Returns an empty list on any error so callers can degrade gracefully.
    """
    client = await _get_llm_client()
    try:
        resp = await client.get(
            f"{provider_url.rstrip('/')}/api/ps",
            timeout=5.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return [
            {"name": m.get("name", ""), "size": m.get("size", 0)} for m in data.get("models", [])
        ]
    except Exception as exc:
        logger.debug("Could not fetch running models: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Web search providers
# ---------------------------------------------------------------------------


async def _search_duckduckgo(query: str, limit: int = 8) -> list[dict[str, str]]:
    """Scrape DuckDuckGo HTML for search snippets (zero-dependency fallback)."""
    client = await _get_search_client()
    try:
        resp = await client.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers={"User-Agent": "TurboEA/1.0 (Enterprise Architecture Tool)"},
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("DuckDuckGo search failed: %s", exc)
        return []

    html = resp.text
    results: list[dict[str, str]] = []

    # Extract result blocks from DDG HTML response
    for match in re.finditer(
        r'<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>(.*?)</a>'
        r'.*?<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
        html,
        re.DOTALL,
    ):
        url = unescape(match.group(1))
        title = re.sub(r"<[^>]+>", "", unescape(match.group(2))).strip()
        snippet = re.sub(r"<[^>]+>", "", unescape(match.group(3))).strip()
        if url and title:
            results.append({"url": url, "title": title, "snippet": snippet})
        if len(results) >= limit:
            break

    return results


async def _search_searxng(base_url: str, query: str, limit: int = 8) -> list[dict[str, str]]:
    """Search via a SearXNG instance (JSON API)."""
    client = await _get_search_client()
    try:
        resp = await client.get(
            f"{base_url.rstrip('/')}/search",
            params={"q": query, "format": "json", "engines": "google,bing,duckduckgo"},
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("SearXNG search failed: %s", exc)
        return []

    results: list[dict[str, str]] = []
    for item in data.get("results", [])[:limit]:
        results.append(
            {
                "url": item.get("url", ""),
                "title": item.get("title", ""),
                "snippet": item.get("content", ""),
            }
        )
    return results


async def _search_google(api_key: str, cx: str, query: str, limit: int = 8) -> list[dict[str, str]]:
    """Search via Google Custom Search JSON API.

    Requires a Google API key and a Custom Search Engine ID (cx).
    The search_url field stores them as "KEY:CX" or the admin can put the
    API key in the field and the CX in the search_url after a colon.
    """
    client = await _get_search_client()
    try:
        resp = await client.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": api_key, "cx": cx, "q": query, "num": min(limit, 10)},
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("Google Custom Search failed: %s", exc)
        return []

    results: list[dict[str, str]] = []
    for item in data.get("items", [])[:limit]:
        results.append(
            {
                "url": item.get("link", ""),
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
            }
        )
    return results


async def web_search(
    query: str,
    provider: str = "duckduckgo",
    search_url: str = "",
    limit: int = 8,
) -> list[dict[str, str]]:
    """Run a web search using the configured provider."""
    if provider == "searxng" and search_url:
        return await _search_searxng(search_url, query, limit)
    if provider == "google" and search_url:
        # search_url format: "API_KEY:SEARCH_ENGINE_ID"
        parts = search_url.split(":", 1)
        if len(parts) == 2:
            return await _search_google(parts[0], parts[1], query, limit)
        logger.warning("Google search_url must be 'API_KEY:CX' format")
        return []
    return await _search_duckduckgo(query, limit)


# ---------------------------------------------------------------------------
# Type-aware search & prompt context
# ---------------------------------------------------------------------------

# Maps card type keys to search keywords and LLM context descriptions.
# Types not listed here fall back to the generic type label.
_TYPE_SEARCH_CONTEXT: dict[str, dict[str, str]] = {
    "Application": {
        "search_suffix": "software application",
        "llm_context": "a software application or digital product",
    },
    "ITComponent": {
        "search_suffix": "technology product",
        "llm_context": "an IT infrastructure component, software product, or cloud service",
    },
    "Interface": {
        "search_suffix": "API integration",
        "llm_context": "a software interface, API, or integration point",
    },
    "DataObject": {
        "search_suffix": "data model",
        "llm_context": "a data entity or information object",
    },
    "Organization": {
        "search_suffix": "company organization",
        "llm_context": "a company, business unit, or organizational entity",
    },
    "BusinessCapability": {
        "search_suffix": "business capability",
        "llm_context": "a business capability in an enterprise architecture context",
    },
    "BusinessContext": {
        "search_suffix": "business process",
        "llm_context": "a business context such as a value stream or customer journey",
    },
    "BusinessProcess": {
        "search_suffix": "business process",
        "llm_context": "a business process in an enterprise context",
    },
    "Provider": {
        "search_suffix": "technology vendor",
        "llm_context": "a technology vendor or service provider",
    },
    "Platform": {
        "search_suffix": "technology platform",
        "llm_context": "a technology or business platform",
    },
    "Initiative": {
        "search_suffix": "project initiative",
        "llm_context": "a strategic initiative, program, or project",
    },
    "Objective": {
        "search_suffix": "strategic objective",
        "llm_context": "a strategic objective or business goal",
    },
    "TechCategory": {
        "search_suffix": "technology category",
        "llm_context": "a technology category for classifying IT components",
    },
    "System": {
        "search_suffix": "IT system",
        "llm_context": "an IT system or technical platform",
    },
}


def _get_search_suffix(type_key: str, subtype: str | None) -> str:
    """Return a contextual search suffix based on card type."""
    ctx = _TYPE_SEARCH_CONTEXT.get(type_key)
    if ctx:
        return ctx["search_suffix"]
    # Fallback: use the type key as-is (e.g. custom types)
    return type_key.lower()


def _get_llm_item_description(type_key: str, type_label: str) -> str:
    """Return an LLM-friendly description of what this item is."""
    ctx = _TYPE_SEARCH_CONTEXT.get(type_key)
    if ctx:
        return ctx["llm_context"]
    return f"a {type_label.lower()} in an enterprise architecture context"


# ---------------------------------------------------------------------------
# LLM prompt builder (description-only)
# ---------------------------------------------------------------------------


def build_llm_prompt(
    name: str,
    type_key: str,
    type_label: str,
    subtype: str | None,
    search_results: list[dict[str, str]],
    context: str | None = None,
) -> list[dict[str, str]]:
    """Build the chat messages for a description-only LLM prompt."""
    item_desc = _get_llm_item_description(type_key, type_label)

    snippets_text = ""
    for i, sr in enumerate(search_results, 1):
        snippets_text += (
            f"[{i}] {sr.get('title', '')} ({sr.get('url', '')})\n    {sr.get('snippet', '')}\n\n"
        )

    has_search = bool(snippets_text.strip())

    if has_search:
        search_instruction = (
            "Use the web search results below as your primary source. "
            "Include the domain the information came from in "
            '"source".'
        )
    else:
        search_instruction = (
            "No web search results are available. Use your general knowledge about "
            "this item. Set confidence lower (0.4-0.6) when relying on general "
            'knowledge. Set "source" to "general knowledge".'
        )

    system_msg = (
        "You are a description writer for an enterprise architecture management tool. "
        f"Given information about {item_desc}, write a concise, factual description. "
        "Return ONLY valid JSON.\n\n"
        f"{search_instruction}\n\n"
        "Rules:\n"
        "- Write a 2-4 sentence description that explains what this item is, "
        "its purpose, and key characteristics.\n"
        "- Be factual and objective — do not speculate.\n"
        '- Include "confidence" (0.0-1.0) indicating how certain you are.\n'
        '- Include "source" with the domain where you found the info.\n\n'
        "Response format (JSON):\n"
        "{\n"
        '  "description": {\n'
        '    "value": "2-4 sentence description...",\n'
        '    "confidence": 0.8,\n'
        '    "source": "example.com"\n'
        "  }\n"
        "}"
    )

    user_msg = f'Item name: "{name}"\nType: {type_label}'
    if subtype:
        user_msg += f"\nSubtype: {subtype}"
    if context:
        user_msg += f"\nAdditional context: {context}"
    if has_search:
        user_msg += f"\n\nWeb search results:\n{snippets_text}"

    return [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_msg},
    ]


# ---------------------------------------------------------------------------
# LLM call — multi-provider dispatch
# ---------------------------------------------------------------------------


def _parse_llm_content(content: str) -> dict[str, Any]:
    """Parse JSON from LLM response content, with markdown code-block fallback."""
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", content)
        if json_match:
            return json.loads(json_match.group(1))
        logger.warning("LLM returned non-JSON content: %.200s", content)
        return {}


async def _call_ollama(
    provider_url: str,
    model: str,
    messages: list[dict[str, str]],
) -> dict[str, Any]:
    """Call an Ollama-compatible /api/chat endpoint."""
    client = await _get_llm_client()
    url = f"{provider_url.rstrip('/')}/api/chat"

    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1},
    }

    try:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Ollama API call failed: %s", exc)
        raise

    data = resp.json()
    content = data.get("message", {}).get("content", "{}")
    return _parse_llm_content(content)


async def _call_openai_compatible(
    provider_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
) -> dict[str, Any]:
    """Call an OpenAI-compatible /v1/chat/completions endpoint.

    Works with OpenAI, Google Gemini, Azure OpenAI, OpenRouter, LM Studio, vLLM.
    """
    client = await _get_llm_client()
    url = f"{provider_url.rstrip('/')}/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }

    try:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("OpenAI-compatible API call failed: %s", exc)
        raise

    data = resp.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")
    return _parse_llm_content(content)


async def _call_anthropic(
    provider_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
) -> dict[str, Any]:
    """Call the Anthropic /v1/messages endpoint.

    Anthropic requires system messages as a top-level parameter, not in the messages array.
    """
    client = await _get_llm_client()
    url = f"{provider_url.rstrip('/')}/v1/messages"

    # Separate system message from user/assistant messages
    system_text = ""
    chat_messages: list[dict[str, str]] = []
    for msg in messages:
        if msg["role"] == "system":
            system_text = msg["content"]
        else:
            chat_messages.append(msg)

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "max_tokens": 1024,
        "messages": chat_messages,
        "temperature": 0.1,
    }
    if system_text:
        payload["system"] = system_text

    try:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Anthropic API call failed: %s", exc)
        raise

    data = resp.json()
    content_blocks = data.get("content", [])
    text = content_blocks[0].get("text", "{}") if content_blocks else "{}"
    return _parse_llm_content(text)


async def call_llm(
    provider_url: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    provider_type: str = "ollama",
    api_key: str = "",
) -> dict[str, Any]:
    """Dispatch an LLM call to the configured provider.

    Supported provider_type values: "ollama", "openai", "anthropic".
    """
    if provider_type == "openai":
        return await _call_openai_compatible(provider_url, api_key, model, messages)
    if provider_type == "anthropic":
        return await _call_anthropic(provider_url, api_key, model, messages)
    return await _call_ollama(provider_url, model, messages)


# ---------------------------------------------------------------------------
# Provider connection test
# ---------------------------------------------------------------------------


async def check_provider_connection(
    provider_url: str,
    provider_type: str = "ollama",
    api_key: str = "",
    model: str = "",
) -> dict[str, Any]:
    """Test connectivity to an LLM provider. Returns available models and status."""
    client = await _get_llm_client()

    if provider_type == "openai":
        url = f"{provider_url.rstrip('/')}/v1/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        try:
            resp = await client.get(url, headers=headers, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            available = [m.get("id", "") for m in data.get("data", [])]
            model_found = any(model in m for m in available) if model else False
            return {"ok": True, "available_models": available[:20], "model_found": model_found}
        except httpx.HTTPError as exc:
            raise httpx.HTTPError(f"Cannot reach provider at {provider_url}: {exc}") from exc

    if provider_type == "anthropic":
        # Anthropic has no model-list endpoint; make a minimal test call
        url = f"{provider_url.rstrip('/')}/v1/messages"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": model or "claude-haiku-4-5-20251001",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "Hi"}],
        }
        try:
            resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
            resp.raise_for_status()
            return {"ok": True, "available_models": [], "model_found": True}
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise httpx.HTTPError("Invalid API key") from exc
            # Other errors (e.g. invalid model) still mean connectivity works
            raise httpx.HTTPError(f"Cannot reach Anthropic at {provider_url}: {exc}") from exc
        except httpx.HTTPError as exc:
            raise httpx.HTTPError(f"Cannot reach Anthropic at {provider_url}: {exc}") from exc

    # Default: Ollama
    url = f"{provider_url.rstrip('/')}/api/tags"
    try:
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        available = [m.get("name", "") for m in data.get("models", [])]
        model_found = any(model in m for m in available) if model else False
        return {"ok": True, "available_models": available[:20], "model_found": model_found}
    except httpx.HTTPError as exc:
        raise httpx.HTTPError(f"Cannot reach Ollama at {provider_url}: {exc}") from exc


# ---------------------------------------------------------------------------
# Validation / post-processing
# ---------------------------------------------------------------------------


def validate_suggestions(
    raw: dict[str, Any],
) -> dict[str, dict]:
    """Validate and normalize the LLM description suggestion."""
    validated: dict[str, dict] = {}

    suggestion = raw.get("description")
    if suggestion is None:
        return validated

    if isinstance(suggestion, dict):
        value = suggestion.get("value")
        confidence = min(1.0, max(0.0, float(suggestion.get("confidence", 0.5))))
        source = suggestion.get("source")
    else:
        value = suggestion
        confidence = 0.5
        source = None

    if value is None or not str(value).strip():
        return validated

    entry: dict[str, Any] = {
        "value": str(value).strip(),
        "confidence": round(confidence, 2),
    }
    if source:
        entry["source"] = source

    validated["description"] = entry
    return validated


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------


async def suggest_metadata(
    name: str,
    type_key: str,
    type_label: str,
    subtype: str | None,
    provider_url: str,
    model: str,
    search_provider: str = "duckduckgo",
    search_url: str = "",
    context: str | None = None,
    *,
    provider_type: str = "ollama",
    api_key: str = "",
) -> dict[str, Any]:
    """Full pipeline: web search → LLM description → validated suggestion."""
    # Step 1: Web search (always DuckDuckGo — commercial APIs have no web access)
    search_suffix = _get_search_suffix(type_key, subtype)
    query = f"{name} {search_suffix}"
    if subtype:
        query += f" {subtype}"
    logger.info("[ai] Searching for '%s' via duckduckgo", query)
    search_results = await web_search(query, "duckduckgo")
    logger.info("[ai] Search returned %d results", len(search_results))

    # Step 2: Build prompt and call LLM
    messages = build_llm_prompt(
        name=name,
        type_key=type_key,
        type_label=type_label,
        subtype=subtype,
        search_results=search_results,
        context=context,
    )
    logger.info("[ai] Calling LLM model=%s (provider=%s)", model, provider_type)
    raw_response = await call_llm(
        provider_url, model, messages, provider_type=provider_type, api_key=api_key
    )
    logger.info("[ai] LLM returned %d raw keys", len(raw_response))

    # Step 3: Validate (description only)
    suggestions = validate_suggestions(raw_response)
    logger.info("[ai] Validated to %d suggestions", len(suggestions))

    # Build source list from search results
    sources = [
        {"url": sr.get("url"), "title": sr.get("title")} for sr in search_results if sr.get("url")
    ]

    return {
        "suggestions": suggestions,
        "sources": sources,
        "model": model,
        "search_provider": "duckduckgo",
    }
