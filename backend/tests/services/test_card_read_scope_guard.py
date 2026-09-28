"""Static guard: every module that reads cards on a user's behalf applies the read scope.

A card-type View deny only means something if *every* read surface honours it,
and the surfaces are scattered — reports, relation lists, linked-card chips,
activity feeds. This scan fails on any API module (and any read-serving
service) that queries cards without going through
``app.services.card_read_scope``, unless it sits in an allowlist below with the
reason its reads are not a user's read. A new endpoint that returns cards must
either apply the scope or be listed here after a conscious decision.

It is deliberately module-level and coarse: it proves a module *considered*
the scope, not that every query in it applies one. The sentinel sweep in
``tests/api/test_read_scope_sentinel_sweep.py`` is the behavioural half.
"""

from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"

CARD_QUERY = re.compile(
    r"select\(\s*Card\b|aliased\(Card\)|(?:outer)?join\(\s*Card\b|db\.get\(\s*Card\b"
    r"|selectinload\(\w+\.card\)"
)
SCOPE_MARKERS = ("card_read_scope", "CardReadScope", "require_card_readable", "is_card_readable")

# Services whose output is served to users by read routes: they take an
# optional scope and must mention it.
READ_SERVICES = (
    "services/card_lifecycle.py",
    "services/card_resolver.py",
    "services/ppm_portfolio_service.py",
    "services/process_map_service.py",
    "services/risk_service.py",
)

# API modules that query cards but whose reads are not a user browsing cards.
NOT_A_USER_READ: dict[str, str] = {
    "calculations.py": "admin formula test-run over one named card (admin.metamodel)",
    "metamodel.py": "admin usage counts for fields/options/sections (admin.metamodel)",
    "surveys.py": "a survey is addressed to its respondents by an admin; results are admin",
    "web_portals.py": "public portals are an explicit publication with their own type config",
}


def _api_modules() -> dict[str, str]:
    return {f.name: f.read_text() for f in sorted((APP / "api" / "v1").glob("*.py"))}


def test_every_api_module_reading_cards_applies_the_read_scope():
    unguarded = [
        name
        for name, text in _api_modules().items()
        if CARD_QUERY.search(text)
        and name not in NOT_A_USER_READ
        and not any(marker in text for marker in SCOPE_MARKERS)
    ]
    assert not unguarded, (
        "These API modules read cards without app.services.card_read_scope — "
        "apply the caller's read scope (CardReadScope / require_card_readable), "
        f"or list the module in NOT_A_USER_READ with the reason: {unguarded}"
    )


def test_read_serving_services_take_a_scope():
    missing = [
        path
        for path in READ_SERVICES
        if not any(marker in (APP / path).read_text() for marker in SCOPE_MARKERS)
    ]
    assert not missing, f"These services serve user reads but take no read scope: {missing}"


def test_allowlist_is_not_stale():
    modules = _api_modules()
    for name in NOT_A_USER_READ:
        assert name in modules, f"{name} no longer exists; drop it from NOT_A_USER_READ"
        assert CARD_QUERY.search(modules[name]), (
            f"{name} no longer queries cards; drop it from NOT_A_USER_READ"
        )
