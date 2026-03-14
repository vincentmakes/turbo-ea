"""ArchLens shared AI caller — reuses Turbo EA's AI configuration.

Reads provider settings from app_settings.general_settings.ai and calls
the appropriate LLM API (Claude, OpenAI, DeepSeek, Gemini).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value
from app.models.app_settings import AppSettings

logger = logging.getLogger("turboea.archlens.ai")

# Reuse a module-level client for LLM calls
_llm_client: httpx.AsyncClient | None = None


async def _get_llm_client() -> httpx.AsyncClient:
    global _llm_client  # noqa: N816
    if _llm_client is None or _llm_client.is_closed:
        _llm_client = httpx.AsyncClient(timeout=180.0)
    return _llm_client


# ---------------------------------------------------------------------------
# AI config from DB
# ---------------------------------------------------------------------------


async def get_ai_config(db: AsyncSession) -> dict[str, str]:
    """Read AI provider type and API key from app_settings."""
    result = await db.execute(select(AppSettings))
    settings = result.scalar_one_or_none()
    if not settings or not settings.general_settings:
        return {"provider": "", "api_key": "", "provider_url": "", "model": ""}

    ai = settings.general_settings.get("ai", {})
    provider_type = ai.get("providerType", "")
    encrypted_key = ai.get("apiKey", "")
    api_key = decrypt_value(encrypted_key) if encrypted_key else ""

    # Map Turbo EA provider types to ArchLens provider names
    provider_map = {
        "anthropic": "claude",
        "openai": "openai",
        "openai_compatible": "openai",
        "ollama": "ollama",
    }
    provider = provider_map.get(provider_type, provider_type)

    # For openai_compatible, use the custom provider URL
    provider_url = ai.get("providerUrl", "")

    return {
        "provider": provider,
        "api_key": api_key,
        "provider_url": provider_url,
        "model": ai.get("model", ""),
    }


def is_ai_configured(ai_config: dict[str, str]) -> bool:
    """Check if AI is configured with a supported provider."""
    provider = ai_config.get("provider", "")
    api_key = ai_config.get("api_key", "")
    provider_url = ai_config.get("provider_url", "")
    model = ai_config.get("model", "")
    if provider in ("claude", "openai", "deepseek", "gemini") and api_key:
        return True
    if provider == "ollama" and (provider_url or model):
        return True
    return False


# ---------------------------------------------------------------------------
# Call AI — unified multi-provider caller
# ---------------------------------------------------------------------------


async def call_ai(
    db: AsyncSession,
    prompt: str,
    max_tokens: int = 2048,
    system_prompt: str = "",
) -> dict[str, Any]:
    """Call the configured LLM and return {text, truncated}.

    Supports Claude, OpenAI, DeepSeek, Gemini via direct HTTP.
    """
    config = await get_ai_config(db)
    provider = config["provider"]
    api_key = config["api_key"]
    model = config["model"]
    provider_url = config["provider_url"]

    if not api_key and provider != "ollama":
        raise ValueError("AI_KEY_MISSING")

    messages = [{"role": "user", "content": prompt}]
    url: str
    headers: dict[str, str]
    body: dict[str, Any]

    if provider == "claude":
        url = "https://api.anthropic.com/v1/messages"
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        body = {
            "model": model or "claude-sonnet-4-20250514",
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system_prompt:
            body["system"] = system_prompt
    elif provider == "openai":
        base_url = provider_url or "https://api.openai.com"
        url = f"{base_url.rstrip('/')}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}"}
        msgs = (
            [{"role": "system", "content": system_prompt}, *messages] if system_prompt else messages
        )
        body = {"model": model or "gpt-4o", "max_tokens": max_tokens, "messages": msgs}
    elif provider == "deepseek":
        url = "https://api.deepseek.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}"}
        msgs = (
            [{"role": "system", "content": system_prompt}, *messages] if system_prompt else messages
        )
        body = {
            "model": model or "deepseek-chat",
            "max_tokens": max_tokens,
            "messages": msgs,
        }
    elif provider == "gemini":
        gemini_model = model or "gemini-1.5-pro"
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{gemini_model}:generateContent?key={api_key}"
        )
        headers = {}
        all_text = (system_prompt + "\n\n" + prompt) if system_prompt else prompt
        body = {
            "contents": [{"parts": [{"text": all_text}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": 0.2,
            },
        }
    elif provider == "ollama":
        base_url = provider_url or "http://localhost:11434"
        url = f"{base_url.rstrip('/')}/api/chat"
        headers = {}
        msgs = (
            [{"role": "system", "content": system_prompt}, *messages] if system_prompt else messages
        )
        body = {"model": model, "messages": msgs, "stream": False}
    else:
        raise ValueError(f"Unknown AI provider: {provider}")

    client = await _get_llm_client()
    resp = await client.post(
        url,
        json=body,
        headers={"Content-Type": "application/json", **headers},
    )

    if not resp.is_success:
        text = resp.text[:200]
        if resp.status_code in (401, 403):
            raise ValueError(f"AI_KEY_INVALID:{provider}")
        if resp.status_code in (429, 402):
            raise ValueError(f"AI_QUOTA_EXCEEDED:{provider}")
        raise ValueError(f"{provider} API error {resp.status_code}: {text}")

    j = resp.json()

    # Detect truncation
    truncated = False
    if provider == "claude":
        truncated = j.get("stop_reason") == "max_tokens"
        text_out = j["content"][0]["text"]
    elif provider == "gemini":
        text_out = j["candidates"][0]["content"]["parts"][0]["text"]
    elif provider == "ollama":
        text_out = j.get("message", {}).get("content", "")
        truncated = not j.get("done", True)
    else:
        truncated = j.get("choices", [{}])[0].get("finish_reason") == "length"
        text_out = j["choices"][0]["message"]["content"]

    if truncated:
        logger.warning(
            "AI response truncated (max_tokens=%d) — output may be incomplete",
            max_tokens,
        )

    return {"text": text_out, "truncated": truncated}


# ---------------------------------------------------------------------------
# JSON parsing + repair utilities
# ---------------------------------------------------------------------------


def parse_json(raw: str) -> Any:
    """Parse JSON from AI response, with repair for truncated output."""
    text = re.sub(r"```json\s*", "", raw)
    text = re.sub(r"```\s*", "", text).strip()

    # 1. Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Extract outermost JSON
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 3. Try truncated JSON repair
    repaired = repair_truncated_json(text)
    if repaired:
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            pass

    # 4. Bracket-scan salvage — extract individual objects
    results = _salvage_objects(text)
    if results:
        return results

    raise ValueError(f"Could not parse AI response as JSON: {text[:300]}")


def repair_truncated_json(text: str) -> str | None:
    """Attempt to repair truncated JSON by closing open brackets."""
    start_obj = text.find("{")
    start_arr = text.find("[")
    if start_obj == -1 and start_arr == -1:
        return None
    start = (
        start_obj
        if start_arr == -1
        else start_arr
        if start_obj == -1
        else min(start_obj, start_arr)
    )
    json_str = text[start:]

    # Fix odd quotes (truncated string)
    quote_count = len(re.findall(r'(?<!\\)"', json_str))
    if quote_count % 2 != 0:
        last_quote = json_str.rfind('"')
        json_str = json_str[: last_quote + 1]

    # Remove trailing comma or colon
    json_str = re.sub(r"[,:\s]+$", "", json_str)

    # Close open brackets
    opens: list[str] = []
    in_string = False
    escape = False
    for ch in json_str:
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ("{", "["):
            opens.append(ch)
        if ch in ("}", "]"):
            if opens:
                opens.pop()

    while opens:
        bracket = opens.pop()
        json_str += "}" if bracket == "{" else "]"

    return json_str


def _salvage_objects(text: str) -> list[dict[str, Any]]:
    """Extract complete JSON objects from a possibly-truncated array."""
    results: list[dict[str, Any]] = []
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                chunk = text[start : i + 1]
                try:
                    obj = json.loads(chunk)
                    if isinstance(obj, dict):
                        results.append(obj)
                except json.JSONDecodeError:
                    # Try fixing trailing commas
                    fixed = re.sub(r",\s*([}\]])", r"\1", chunk)
                    try:
                        obj = json.loads(fixed)
                        if isinstance(obj, dict):
                            results.append(obj)
                    except json.JSONDecodeError:
                        pass
                start = -1
    return results
