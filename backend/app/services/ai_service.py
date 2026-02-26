"""AI service — web search + local LLM structured extraction for card metadata.

Two-step pipeline:
  1. Web search (DuckDuckGo HTML scrape or SearXNG) for the card name
  2. LLM prompt with search snippets + field schema → structured JSON
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
        logger.debug("Could not fetch running models from %s: %s", provider_url, exc)
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
# LLM prompt builder
# ---------------------------------------------------------------------------


def _build_field_schema_description(fields_schema: list[dict]) -> str:
    """Build a human-readable field description for the LLM prompt.

    Fields with ``"ai_suggest": false`` are excluded — these are internal
    organisational assessments (e.g. business criticality, cost) that
    cannot be determined from external sources.
    """
    lines: list[str] = []
    for section in fields_schema:
        for field in section.get("fields", []):
            if field.get("ai_suggest") is False:
                continue
            key = field["key"]
            ftype = field.get("type", "text")
            label = field.get("label", key)
            desc = f'- "{key}" ({label}): type={ftype}'
            if ftype in ("single_select", "multiple_select"):
                options = field.get("options", [])
                option_keys = [o["key"] for o in options]
                desc += f", allowed values: {option_keys}"
            lines.append(desc)
    return "\n".join(lines)


def build_llm_prompt(
    name: str,
    type_label: str,
    subtype: str | None,
    fields_schema: list[dict],
    search_results: list[dict[str, str]],
    context: str | None = None,
) -> list[dict[str, str]]:
    """Build the chat messages for the LLM extraction prompt."""
    field_desc = _build_field_schema_description(fields_schema)

    snippets_text = ""
    for i, sr in enumerate(search_results, 1):
        snippets_text += (
            f"[{i}] {sr.get('title', '')} ({sr.get('url', '')})\n    {sr.get('snippet', '')}\n\n"
        )

    has_search = bool(snippets_text.strip())

    if has_search:
        search_instruction = (
            "Use the web search results below as your primary source. "
            "For each populated field, include the domain the info came from in "
            '"source".'
        )
    else:
        search_instruction = (
            "No web search results are available. Use your general knowledge about "
            "this product/technology to fill in what you know with reasonable "
            "confidence. Set confidence lower (0.4-0.6) when relying on general "
            'knowledge. Set "source" to "general knowledge".'
        )

    system_msg = (
        "You are a metadata extractor for an enterprise architecture management tool. "
        "Given information about a software product or IT asset, extract structured "
        "metadata for the fields listed below. Return ONLY valid JSON.\n\n"
        f"{search_instruction}\n\n"
        "Rules:\n"
        "- For select fields, use ONLY the allowed option keys listed.\n"
        "- Set a field to null if you truly have no information.\n"
        '- Include a "description" field with a 2-3 sentence summary.\n'
        '- For each populated field, include "confidence" (0.0-1.0) and "source".\n\n'
        f"Available fields:\n{field_desc}\n\n"
        "Response format (JSON):\n"
        "{\n"
        '  "fieldKey": {"value": ..., "confidence": 0.9, "source": "example.com"},\n'
        '  "description": {"value": "...", "confidence": 0.8, "source": "example.com"},\n'
        "  ...\n"
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
# LLM call
# ---------------------------------------------------------------------------


async def call_llm(
    provider_url: str,
    model: str,
    messages: list[dict[str, str]],
) -> dict[str, Any]:
    """Call the LLM API (Ollama-compatible /api/chat endpoint)."""
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
        logger.warning("LLM API call failed: %s", exc)
        raise

    data = resp.json()
    content = data.get("message", {}).get("content", "{}")

    try:
        parsed: dict[str, Any] = json.loads(content)
        return parsed
    except json.JSONDecodeError:
        # Try to extract JSON from markdown code block
        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", content)
        if json_match:
            parsed = json.loads(json_match.group(1))
            return parsed
        logger.warning("LLM returned non-JSON content: %.200s", content)
        return {}


# ---------------------------------------------------------------------------
# Validation / post-processing
# ---------------------------------------------------------------------------


def validate_suggestions(
    raw: dict[str, Any],
    fields_schema: list[dict],
) -> dict[str, dict]:
    """Validate and normalize LLM suggestions against the field schema.

    Drops invalid option keys, normalizes confidence scores, etc.
    """
    # Build a lookup: field_key → field definition (skip ai_suggest=false)
    field_map: dict[str, dict] = {"description": {"key": "description", "type": "text"}}
    for section in fields_schema:
        for field in section.get("fields", []):
            if field.get("ai_suggest") is False:
                continue
            field_map[field["key"]] = field

    validated: dict[str, dict] = {}

    for key, suggestion in raw.items():
        if key not in field_map:
            continue

        field_def = field_map[key]

        # Normalize: suggestion might be a plain value or a dict
        if isinstance(suggestion, dict):
            value = suggestion.get("value")
            confidence = min(1.0, max(0.0, float(suggestion.get("confidence", 0.5))))
            source = suggestion.get("source")
            alternatives = suggestion.get("alternatives")
            note = suggestion.get("note")
        else:
            value = suggestion
            confidence = 0.5
            source = None
            alternatives = None
            note = None

        if value is None:
            continue

        # Validate select field values
        ftype = field_def.get("type", "text")
        if ftype in ("single_select", "multiple_select"):
            valid_keys = {o["key"] for o in field_def.get("options", [])}
            if isinstance(value, str) and value not in valid_keys:
                # Try case-insensitive match
                lower_map = {k.lower(): k for k in valid_keys}
                if value.lower() in lower_map:
                    value = lower_map[value.lower()]
                else:
                    # Skip invalid option
                    continue

        entry: dict[str, Any] = {
            "value": value,
            "confidence": round(confidence, 2),
        }
        if source:
            entry["source"] = source
        if alternatives:
            # Filter alternatives to valid keys for select fields
            if ftype in ("single_select", "multiple_select"):
                valid_keys = {o["key"] for o in field_def.get("options", [])}
                alternatives = [a for a in alternatives if a in valid_keys]
            if alternatives:
                entry["alternatives"] = alternatives
        if note:
            entry["note"] = note

        validated[key] = entry

    return validated


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------


async def suggest_metadata(
    name: str,
    type_key: str,
    type_label: str,
    subtype: str | None,
    fields_schema: list[dict],
    provider_url: str,
    model: str,
    search_provider: str = "duckduckgo",
    search_url: str = "",
    context: str | None = None,
) -> dict[str, Any]:
    """Full pipeline: web search → LLM extraction → validated suggestions."""
    # Step 1: Web search
    query = f"{name} software"
    if subtype:
        query += f" {subtype}"
    logger.info("[ai] Searching for '%s' via %s", query, search_provider)
    search_results = await web_search(query, search_provider, search_url)
    logger.info("[ai] Search returned %d results", len(search_results))

    # Step 2: Build prompt and call LLM
    messages = build_llm_prompt(
        name=name,
        type_label=type_label,
        subtype=subtype,
        fields_schema=fields_schema,
        search_results=search_results,
        context=context,
    )
    logger.info("[ai] Calling LLM %s at %s", model, provider_url)
    raw_response = await call_llm(provider_url, model, messages)
    logger.info("[ai] LLM returned %d raw keys", len(raw_response))

    # Step 3: Validate
    suggestions = validate_suggestions(raw_response, fields_schema)
    logger.info("[ai] Validated to %d suggestions", len(suggestions))

    # Build source list from search results
    sources = [
        {"url": sr.get("url"), "title": sr.get("title")} for sr in search_results if sr.get("url")
    ]

    return {
        "suggestions": suggestions,
        "sources": sources,
        "model": model,
        "search_provider": search_provider,
    }
