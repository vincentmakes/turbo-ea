"""SDK 1.12 — the per-card permission helpers an extension route gates on.

These are wrappers, not logic: they must hand the question to
``PermissionService`` unchanged and answer with what it says. So what is worth
pinning is the SEAM — that the arguments arrive in the right order, that the
non-raising and raising forms map to the right methods, and that neither
re-implements the decision. The decision itself (app-level OR a stakeholder
role on that specific card, type overrides, the admin wildcard) is core's and
is covered by ``test_permission_service_extended.py``; asserting it again
through the wrapper would test core's engine twice and the seam not at all.

The seam is where a wrapper goes wrong: swap ``card_id`` and
``card_permission`` and every call still type-checks, still returns a bool, and
silently answers a different question.
"""

from __future__ import annotations

import pytest

from app.services.extensions import bundle, sdk


class _Recorder:
    """Stands in for PermissionService and records how it was called."""

    def __init__(self, answer: bool = True):
        self.answer = answer
        self.check_calls: list[tuple] = []
        self.require_calls: list[tuple] = []

    async def check_permission(self, db, user, app_permission, card_id, card_permission):
        self.check_calls.append((db, user, app_permission, card_id, card_permission))
        return self.answer

    async def require_permission(self, db, user, app_permission, card_id, card_permission):
        self.require_calls.append((db, user, app_permission, card_id, card_permission))


@pytest.fixture
def recorder(monkeypatch):
    import app.services.permission_service as ps

    rec = _Recorder()
    monkeypatch.setattr(ps.PermissionService, "check_permission", rec.check_permission)
    monkeypatch.setattr(ps.PermissionService, "require_permission", rec.require_permission)
    return rec


async def test_check_forwards_every_argument_in_order(recorder):
    result = await sdk.check_card_permission("DB", "USER", "inventory.view", "CARD-1", "card.view")
    assert result is True
    assert recorder.check_calls == [("DB", "USER", "inventory.view", "CARD-1", "card.view")]
    # The raising form is a different method, not this one with a flag.
    assert recorder.require_calls == []


async def test_check_returns_what_permission_service_says(recorder):
    recorder.answer = False
    assert (
        await sdk.check_card_permission("DB", "USER", "inventory.view", "CARD-1", "card.view")
        is False
    )


async def test_require_forwards_every_argument_in_order(recorder):
    await sdk.require_card_permission("DB", "USER", "inventory.edit", "CARD-9", "card.edit")
    assert recorder.require_calls == [("DB", "USER", "inventory.edit", "CARD-9", "card.edit")]
    assert recorder.check_calls == []


async def test_the_canonical_view_pair_reaches_the_service_unchanged(recorder):
    """`("inventory.view", "card.view")` is the literal core repeats at every
    card-scoped read of its own; an extension gating a per-card read spells it
    the same way."""
    await sdk.check_card_permission("DB", "USER", "inventory.view", "CARD-1", "card.view")
    _db, _user, app_perm, _card, card_perm = recorder.check_calls[0]
    assert (app_perm, card_perm) == ("inventory.view", "card.view")


def test_the_helpers_are_not_grant_gated():
    """Deliberately ungated, like the route dependencies and unlike every
    bridge on ExtensionContext. Grants mark DATA an extension would not
    otherwise hold; this returns one boolean about the caller, adds no content
    and can only subtract — and core already lets any authenticated user ask
    strictly more of any card through GET /cards/{id}/my-permissions. Gating it
    would mean an extension without the grant can only write a LESS safe route.
    """
    assert not any("permission" in grant for grant in bundle.VALID_GRANTS)


def test_the_helpers_do_not_reimplement_the_decision():
    """They must delegate. A wrapper that grew its own stakeholder lookup would
    drift from core's the first time core changed."""
    import ast
    import inspect
    import textwrap

    for fn in (sdk.check_card_permission, sdk.require_card_permission):
        tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
        body = tree.body[0].body
        if isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            body = body[1:]  # the docstring explains the decision; it is not code
        code = "\n".join(ast.unparse(node) for node in body)
        assert "PermissionService" in code, fn.__name__
        # No query of its own: the moment a wrapper grows a stakeholder lookup
        # it drifts from core's the first time core changes.
        assert "select(" not in code, fn.__name__
        assert "Stakeholder" not in code, fn.__name__
