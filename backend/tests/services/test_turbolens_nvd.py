"""Unit tests for the TurboLens NVD client helpers.

Covers the pure helpers that don't need HTTP — slug/version normalization,
severity banding, deterministic probability derivation, CPE string builder,
and NVD payload parsing.
"""

from __future__ import annotations

from datetime import date

from app.services.turbolens_nvd import (
    _parse_cve,
    build_cpe_match,
    derive_probability,
    map_severity,
    normalize_version,
    patch_age_days,
    slugify,
)

# ---------------------------------------------------------------------------
# slugify / normalize_version
# ---------------------------------------------------------------------------


def test_slugify_lowercases_strips_and_replaces_spaces():
    assert slugify("Red Hat Enterprise Linux") == "red_hat_enterprise_linux"
    assert slugify("Apache HTTP Server!") == "apache_http_server"
    assert slugify("") == ""
    assert slugify("  Nginx  ") == "nginx"


def test_normalize_version_guesses_when_missing_or_generic():
    assert normalize_version(None) == ("*", True)
    assert normalize_version("") == ("*", True)
    assert normalize_version("latest") == ("*", True)
    assert normalize_version("v1.2.3") == ("1.2.3", False)
    assert normalize_version("2.4.58") == ("2.4.58", False)


# ---------------------------------------------------------------------------
# CVSS severity bands (per NVD spec)
# ---------------------------------------------------------------------------


def test_map_severity_bands_match_nvd_spec():
    assert map_severity(9.5) == "critical"
    assert map_severity(9.0) == "critical"
    assert map_severity(8.9) == "high"
    assert map_severity(7.2) == "high"
    assert map_severity(6.9) == "medium"
    assert map_severity(4.0) == "medium"
    assert map_severity(3.9) == "low"
    assert map_severity(0.1) == "low"
    assert map_severity(None) == "unknown"


# ---------------------------------------------------------------------------
# derive_probability — deterministic pre-AI ranking
# ---------------------------------------------------------------------------


def test_probability_network_unpatched_high_exploitability_is_very_high():
    assert derive_probability(3.5, "NETWORK", patch_age_days=None) == "very_high"


def test_probability_network_with_patch_is_medium():
    assert derive_probability(3.5, "NETWORK", patch_age_days=10) == "medium"


def test_probability_adjacent_is_medium():
    assert derive_probability(2.5, "ADJACENT", patch_age_days=None) == "medium"


def test_probability_local_physical_is_low():
    assert derive_probability(3.5, "LOCAL", patch_age_days=None) == "low"
    assert derive_probability(3.5, "PHYSICAL", patch_age_days=None) == "low"


def test_probability_unknown_vector_falls_back_to_exploitability():
    assert derive_probability(3.0, None, patch_age_days=None) == "medium"
    assert derive_probability(1.0, None, patch_age_days=None) == "low"


# ---------------------------------------------------------------------------
# CPE match builder
# ---------------------------------------------------------------------------


def test_build_cpe_match_uses_slugified_vendor_product_and_version():
    cpe = build_cpe_match("Apache Foundation", "HTTP Server", "2.4.58")
    assert cpe == "cpe:2.3:a:apache_foundation:http_server:2.4.58:*:*:*:*:*:*:*"


def test_build_cpe_match_returns_none_if_missing_parts():
    assert build_cpe_match("", "", "1.0") is None
    assert build_cpe_match("apache", "", None) is None


def test_build_cpe_match_star_on_missing_version():
    cpe = build_cpe_match("nginx", "nginx", None)
    assert ":nginx:nginx:*:" in cpe


# ---------------------------------------------------------------------------
# NVD payload parsing
# ---------------------------------------------------------------------------


_NVD_SAMPLE = {
    "cve": {
        "id": "CVE-2024-12345",
        "descriptions": [{"lang": "en", "value": "Remote code execution in Example App."}],
        "published": "2024-05-01T00:00:00.000",
        "lastModified": "2024-06-15T00:00:00.000",
        "metrics": {
            "cvssMetricV31": [
                {
                    "type": "Primary",
                    "cvssData": {
                        "baseScore": 9.8,
                        "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                        "attackVector": "NETWORK",
                    },
                    "exploitabilityScore": 3.9,
                    "impactScore": 5.9,
                }
            ]
        },
        "references": [
            {"url": "https://advisory.example.com/1", "tags": ["Vendor Advisory"]},
            {"url": "https://github.com/x/y/commit/abc", "tags": ["Patch"]},
        ],
    }
}


def test_parse_cve_extracts_primary_metric_and_patch_flag():
    rec = _parse_cve(_NVD_SAMPLE)
    assert rec is not None
    assert rec.cve_id == "CVE-2024-12345"
    assert rec.severity == "critical"
    assert rec.cvss_score == 9.8
    assert rec.attack_vector == "NETWORK"
    assert rec.exploitability_score == 3.9
    assert rec.impact_score == 5.9
    assert rec.patch_available is True
    assert rec.published_date == date(2024, 5, 1)
    assert rec.description.startswith("Remote code execution")
    assert len(rec.references) == 2


def test_parse_cve_returns_none_when_id_missing():
    assert _parse_cve({"cve": {"id": None}}) is None
    assert _parse_cve({}) is None


def test_parse_cve_falls_back_to_cvss_v2_when_v31_missing():
    sample = {
        "cve": {
            "id": "CVE-2019-0001",
            "descriptions": [{"lang": "en", "value": "Old bug."}],
            "metrics": {
                "cvssMetricV2": [
                    {
                        "type": "Primary",
                        "cvssData": {"baseScore": 5.0, "vectorString": "AV:N/AC:L"},
                    }
                ]
            },
        }
    }
    rec = _parse_cve(sample)
    assert rec is not None
    assert rec.cvss_score == 5.0
    assert rec.severity == "medium"


# ---------------------------------------------------------------------------
# patch_age_days
# ---------------------------------------------------------------------------


def test_patch_age_days_returns_none_for_missing_date():
    assert patch_age_days(None) is None


def test_patch_age_days_returns_non_negative():
    # A date in the past should yield a positive non-negative int.
    assert patch_age_days(date(2000, 1, 1)) >= 0
