"""Unit tests for TurboLens Security scan pure helpers.

Covers priority heuristics, landscape summary, risk matrix aggregation,
compliance score weighting and output dict shaping.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.services.turbolens_security import (
    ScanCard,
    _landscape_summary,
    _priority_from_cvss_and_criticality,
    build_risk_matrix,
    compliance_score,
    compliance_to_dict,
    finding_to_dict,
)

# ---------------------------------------------------------------------------
# Priority heuristic
# ---------------------------------------------------------------------------


def test_priority_promotes_high_cvss_on_critical_card():
    assert _priority_from_cvss_and_criticality(7.5, "missionCritical") == "critical"
    assert _priority_from_cvss_and_criticality(7.5, "critical") == "critical"


def test_priority_medium_cvss_raised_for_critical_card():
    assert _priority_from_cvss_and_criticality(5.0, "high") == "high"
    assert _priority_from_cvss_and_criticality(5.0, None) == "medium"


def test_priority_low_cvss_always_low():
    assert _priority_from_cvss_and_criticality(3.0, "critical") == "low"


def test_priority_no_cvss_is_medium():
    assert _priority_from_cvss_and_criticality(None, "critical") == "medium"


# ---------------------------------------------------------------------------
# Landscape summary
# ---------------------------------------------------------------------------


def _scan_card(**overrides):
    base = {
        "id": str(uuid.uuid4()),
        "name": "Card",
        "type": "Application",
        "subtype": None,
        "description": "",
        "vendor": "",
        "product": "",
        "version": None,
        "business_criticality": None,
        "lifecycle_phase": None,
        "attributes": {},
    }
    base.update(overrides)
    return ScanCard(**base)


def test_landscape_summary_counts_types_subtypes_vendors_and_criticals():
    cards = [
        _scan_card(type="Application", subtype="AI Agent", vendor="Vendor-A"),
        _scan_card(type="Application", subtype="Business Application", vendor="Vendor-A"),
        _scan_card(
            type="ITComponent",
            subtype="SaaS",
            vendor="Vendor-B",
            business_criticality="missionCritical",
            name="Core ERP",
        ),
    ]
    summary = _landscape_summary(cards)
    assert summary["counts_by_type"] == {"Application": 2, "ITComponent": 1}
    assert summary["counts_by_subtype"]["AI Agent"] == 1
    assert summary["top_vendors"][0] == ("Vendor-A", 2)
    assert "Core ERP" in summary["high_criticality_cards"]
    assert summary["total"] == 3


# ---------------------------------------------------------------------------
# Risk matrix
# ---------------------------------------------------------------------------


def _row(severity, probability):
    # The aggregator only reads severity + probability attrs, so a simple
    # namespace is sufficient.
    return SimpleNamespace(severity=severity, probability=probability)


def test_risk_matrix_places_entries_by_probability_and_severity():
    rows = [
        _row("critical", "very_high"),
        _row("critical", "very_high"),
        _row("high", "medium"),
        _row("low", "low"),
        _row("unknown", "unknown"),
    ]
    matrix = build_risk_matrix(rows)
    # very_high × critical
    assert matrix[0][0] == 2
    # medium × high
    assert matrix[2][1] == 1
    # low × low
    assert matrix[3][3] == 1
    # unknown × unknown goes to the 5th row / column.
    assert matrix[4][4] == 1


# ---------------------------------------------------------------------------
# Compliance score weighting
# ---------------------------------------------------------------------------


def test_compliance_score_is_perfect_for_empty_landscape():
    assert compliance_score([]) == 100


def test_compliance_score_weights_statuses():
    rows = [
        SimpleNamespace(status="compliant"),
        SimpleNamespace(status="compliant"),
        SimpleNamespace(status="partial"),
        SimpleNamespace(status="non_compliant"),
        SimpleNamespace(status="review_needed"),
    ]
    # (1 + 1 + 0.5 + 0 + 0.3) / 5 = 0.56 → 56
    assert compliance_score(rows) == 56


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _cve_row(**overrides):
    base = {
        "id": uuid.uuid4(),
        "run_id": uuid.uuid4(),
        "card_id": uuid.uuid4(),
        "card_type": "Application",
        "cve_id": "CVE-2024-0001",
        "vendor": "apache",
        "product": "http_server",
        "version": "2.4.58",
        "cvss_score": 9.1,
        "cvss_vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        "severity": "critical",
        "attack_vector": "NETWORK",
        "exploitability_score": 3.9,
        "impact_score": 5.9,
        "patch_available": True,
        "published_date": date(2024, 5, 1),
        "last_modified_date": date(2024, 6, 1),
        "description": "desc",
        "nvd_references": [{"url": "https://x"}],
        "priority": "critical",
        "probability": "very_high",
        "business_impact": "bi",
        "remediation": "upgrade",
        "status": "open",
        "risk_id": None,
        "created_at": datetime.now(timezone.utc),
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_finding_to_dict_includes_card_name_and_serialises_dates():
    row = _cve_row()
    d = finding_to_dict(row, "Core ERP")
    assert d["card_name"] == "Core ERP"
    assert d["cve_id"] == "CVE-2024-0001"
    assert d["published_date"] == "2024-05-01"
    assert d["created_at"].endswith("+00:00") or "T" in d["created_at"]


def test_service_exposes_split_scan_entry_points():
    """Smoke test: both scan halves should be importable under their new names.

    Guards against accidental removal / rename of the split entry points —
    a breaking change would fail here immediately rather than at runtime.
    """
    from app.services import turbolens_security as svc

    assert hasattr(svc, "run_cve_scan")
    assert hasattr(svc, "run_compliance_scan")
    # The old combined entry point must be gone to keep the API layer clean.
    assert not hasattr(svc, "run_security_scan")


def test_compliance_to_dict_handles_landscape_scope():
    row = SimpleNamespace(
        id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        regulation="eu_ai_act",
        regulation_article="Art. 6",
        card_id=None,
        scope_type="landscape",
        category="ai_governance",
        requirement="Maintain a registry of high-risk AI systems.",
        status="non_compliant",
        severity="high",
        gap_description="No registry exists.",
        evidence=None,
        remediation="Create a registry.",
        ai_detected=False,
        risk_id=None,
        created_at=datetime.now(timezone.utc),
    )
    d = compliance_to_dict(row, None)
    assert d["card_id"] is None
    assert d["scope_type"] == "landscape"
    assert d["regulation"] == "eu_ai_act"
    assert d["requirement"].startswith("Maintain")
