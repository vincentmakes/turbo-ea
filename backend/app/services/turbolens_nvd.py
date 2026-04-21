"""NVD REST client for Turbo EA security scanning.

Queries NIST's National Vulnerability Database for CVE records affecting
a given vendor/product/version, then maps the response into plain dicts
that the security scan orchestrator can enrich via AI prioritization.

NVD rate limits:
- Unauthenticated: 5 requests / 30 seconds
- With API key:   50 requests / 30 seconds

The key is read from settings.NVD_API_KEY. When set, requests include
the `apiKey` header and use a faster inter-request delay.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger("turboea.turbolens.nvd")

NVD_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
NVD_VIEW_URL = "https://nvd.nist.gov/vuln/detail/"

# Per-call delay between NVD requests.
_DELAY_WITH_KEY = 0.6
_DELAY_WITHOUT_KEY = 6.0

# In-memory cache { (vendor, product, version) -> (expiry_epoch, records) }.
_CACHE_TTL_SECONDS = 24 * 60 * 60
_CACHE: dict[tuple[str, str, str], tuple[float, list[dict[str, Any]]]] = {}

_client: httpx.AsyncClient | None = None
_semaphore = asyncio.Semaphore(1)  # NVD wants serialized requests


async def _get_client() -> httpx.AsyncClient:
    global _client  # noqa: N816
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9_\-]")


def slugify(value: str) -> str:
    """Lowercase and strip to the subset CPE expects (a-z, 0-9, _, -)."""
    if not value:
        return ""
    lowered = value.strip().lower().replace(" ", "_")
    return _SLUG_RE.sub("", lowered)


def normalize_version(value: str | None) -> tuple[str, bool]:
    """Return (cpe_version_segment, is_guess).

    * Empty / "latest" / generic → `*` with `is_guess=True`.
    * Leading "v" is stripped; everything else kept as-is.
    """
    if not value:
        return "*", True
    v = value.strip().lower()
    if v in ("", "latest", "current", "n/a", "unknown"):
        return "*", True
    if v.startswith("v"):
        v = v[1:]
    return v, False


def map_severity(score: float | None) -> str:
    """NVD severity bands per CVSS v3.1 specification."""
    if score is None:
        return "unknown"
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "medium"
    if score > 0:
        return "low"
    return "unknown"


def derive_probability(
    exploitability: float | None,
    attack_vector: str | None,
    patch_age_days: int | None,
) -> str:
    """Deterministic probability label used before AI enrichment.

    Higher when:
    * attack vector is NETWORK (reachable remotely)
    * exploitability score is high
    * no patch available (patch_age_days is None)
    """
    vector = (attack_vector or "").upper()
    exp = exploitability or 0.0
    patched = patch_age_days is not None

    if vector == "NETWORK" and exp >= 3.0 and not patched:
        return "very_high"
    if vector == "NETWORK" and patched:
        return "medium"
    if vector == "NETWORK" and exp >= 2.0:
        return "high"
    if vector == "ADJACENT":
        return "medium"
    if vector in ("LOCAL", "PHYSICAL"):
        return "low"
    if exp >= 2.5:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


@dataclass
class CveRecord:
    """A lightweight CVE snapshot used inside the scan pipeline."""

    cve_id: str
    description: str = ""
    cvss_score: float | None = None
    cvss_vector: str | None = None
    severity: str = "unknown"
    attack_vector: str | None = None
    exploitability_score: float | None = None
    impact_score: float | None = None
    published_date: date | None = None
    last_modified_date: date | None = None
    patch_available: bool = False
    references: list[dict[str, Any]] = field(default_factory=list)

    def view_url(self) -> str:
        return f"{NVD_VIEW_URL}{self.cve_id}"


def _parse_iso_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _pick_best_metric(metrics: dict[str, Any]) -> dict[str, Any] | None:
    """Choose the most useful CVSS metric — prefer v3.1 > v3.0 > v2."""
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        items = metrics.get(key) or []
        if items:
            # Prefer the primary scorer if present.
            primary = next((m for m in items if m.get("type") == "Primary"), items[0])
            return primary
    return None


def _parse_cve(raw: dict[str, Any]) -> CveRecord | None:
    """Turn an NVD `cve` dict into our lightweight record."""
    cve = raw.get("cve") if "cve" in raw else raw
    if not cve or not cve.get("id"):
        return None

    descriptions = cve.get("descriptions") or []
    english = next(
        (d.get("value", "") for d in descriptions if d.get("lang") == "en"),
        (descriptions[0].get("value", "") if descriptions else ""),
    )

    metric = _pick_best_metric(cve.get("metrics") or {})
    cvss_score: float | None = None
    cvss_vector: str | None = None
    attack_vector: str | None = None
    exploitability_score: float | None = None
    impact_score: float | None = None
    if metric:
        data = metric.get("cvssData") or {}
        cvss_score = data.get("baseScore")
        cvss_vector = data.get("vectorString")
        attack_vector = data.get("attackVector")
        exploitability_score = metric.get("exploitabilityScore")
        impact_score = metric.get("impactScore")

    refs = cve.get("references") or []
    references = [
        {
            "url": ref.get("url", ""),
            "tags": ref.get("tags") or [],
            "source": ref.get("source", ""),
        }
        for ref in refs
        if ref.get("url")
    ]
    patch_tags = {"patch", "vendor advisory", "mitigation"}
    patch_available = any(
        (tag or "").strip().lower() in patch_tags for ref in refs for tag in (ref.get("tags") or [])
    )

    return CveRecord(
        cve_id=cve["id"],
        description=english,
        cvss_score=cvss_score,
        cvss_vector=cvss_vector,
        severity=map_severity(cvss_score),
        attack_vector=attack_vector,
        exploitability_score=exploitability_score,
        impact_score=impact_score,
        published_date=_parse_iso_date(cve.get("published")),
        last_modified_date=_parse_iso_date(cve.get("lastModified")),
        patch_available=patch_available,
        references=references,
    )


# ---------------------------------------------------------------------------
# Request layer
# ---------------------------------------------------------------------------


def _headers() -> dict[str, str]:
    headers = {"User-Agent": "turbo-ea-security-scan/1.0"}
    if settings.NVD_API_KEY:
        headers["apiKey"] = settings.NVD_API_KEY
    return headers


async def _throttle() -> None:
    """Sleep between requests to respect NVD rate limits."""
    await asyncio.sleep(_DELAY_WITH_KEY if settings.NVD_API_KEY else _DELAY_WITHOUT_KEY)


async def _fetch_once(params: dict[str, Any]) -> list[dict[str, Any]]:
    client = await _get_client()
    for attempt in range(3):
        try:
            resp = await client.get(NVD_BASE_URL, params=params, headers=_headers())
        except httpx.HTTPError as exc:
            logger.warning("NVD request transport error (attempt %d): %s", attempt + 1, exc)
            await asyncio.sleep(2 * (attempt + 1))
            continue
        if resp.status_code == 429:
            logger.info("NVD rate-limited, backing off")
            await asyncio.sleep(8 * (attempt + 1))
            continue
        if resp.status_code >= 500:
            logger.info("NVD 5xx (%s), retrying", resp.status_code)
            await asyncio.sleep(2 * (attempt + 1))
            continue
        if resp.status_code == 404:
            return []
        if not resp.is_success:
            logger.warning("NVD returned %s: %s", resp.status_code, resp.text[:200])
            return []
        payload = resp.json()
        return payload.get("vulnerabilities") or []
    return []


def build_cpe_match(vendor: str, product: str, version: str | None) -> str | None:
    v = slugify(vendor)
    p = slugify(product)
    if not v or not p:
        return None
    version_seg, _ = normalize_version(version)
    return f"cpe:2.3:a:{v}:{p}:{version_seg}:*:*:*:*:*:*:*"


async def search_cves(
    vendor: str,
    product: str,
    version: str | None,
    max_results: int = 25,
) -> list[CveRecord]:
    """Return CVEs matching the given vendor/product/version triple.

    Primary: CPE match string.
    Fallback: keyword search if the CPE returns nothing (NVD can be strict
    about canonical vendor/product slugs).
    """
    if not vendor and not product:
        return []

    cache_key = (slugify(vendor), slugify(product), (version or "").lower())
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached and cached[0] > now:
        return [CveRecord(**r) for r in cached[1]]

    records: list[CveRecord] = []
    cpe_match = build_cpe_match(vendor, product, version)

    async with _semaphore:
        if cpe_match:
            raw = await _fetch_once({"cpeName": cpe_match, "resultsPerPage": max_results})
            records = [rec for rec in (_parse_cve(r) for r in raw) if rec is not None]
            if raw:
                await _throttle()

        if not records:
            keyword = " ".join(p for p in (vendor, product) if p).strip()
            if keyword:
                raw = await _fetch_once(
                    {
                        "keywordSearch": keyword,
                        "keywordExactMatch": "true" if product else None,
                        "resultsPerPage": max_results,
                    }
                )
                records = [rec for rec in (_parse_cve(r) for r in raw) if rec is not None]
                if raw:
                    await _throttle()

    # Cache serializable form (dataclass field dict) to avoid pickle issues.
    _CACHE[cache_key] = (
        now + _CACHE_TTL_SECONDS,
        [rec.__dict__ for rec in records],
    )
    return records


def patch_age_days(published: date | None) -> int | None:
    if published is None:
        return None
    today = datetime.now(timezone.utc).date()
    return max((today - published).days, 0)


async def close_client() -> None:
    global _client  # noqa: N816
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
