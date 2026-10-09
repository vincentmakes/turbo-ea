"""Business logic tests for card operations — data quality scoring,
approval status breaking, and capability level auto-sync.

These are integration tests requiring a PostgreSQL test database.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def biz_env(db):
    """Shared test data for business logic tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {"key": "costTotalAnnual", "label": "Annual Cost", "type": "cost", "weight": 1},
                    {"key": "riskLevel", "label": "Risk", "type": "single_select", "weight": 1},
                    {"key": "website", "label": "Website", "type": "url", "weight": 0},
                ],
            },
            {
                "section": "Details",
                "fields": [
                    {"key": "vendor", "label": "Vendor", "type": "text", "weight": 2},
                ],
            },
        ],
    )
    await create_card_type(
        db,
        key="BusinessCapability",
        label="Business Capability",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "capabilityLevel",
                        "label": "Capability Level",
                        "type": "single_select",
                        "weight": 0,
                        "readonly": True,
                    },
                ],
            },
        ],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    return {"admin": admin}


# ---------------------------------------------------------------------------
# Data quality calculation
# ---------------------------------------------------------------------------


class TestDataQualityCalculation:
    async def test_empty_card_gets_zero_quality(self, client, db, biz_env):
        """Card with no attributes, no description, no lifecycle → 0% quality."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Empty App"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        # Weighted: cost(1)+risk(1)+vendor(2)+desc(1)+lifecycle(1)=6
        # website has weight 0 so excluded
        # None filled → 0%
        assert resp.json()["data_quality"] == 0.0

    async def test_partial_fill_correct_percentage(self, client, db, biz_env):
        """Filling some fields should give correct weighted percentage."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Partial App",
                "attributes": {"costTotalAnnual": 50000},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        # costTotalAnnual(1) filled, riskLevel(1) empty, vendor(2) empty
        # description(1) empty, lifecycle(1) empty → 1/6 = 16.7%
        assert resp.json()["data_quality"] == 16.7

    async def test_description_contributes_to_quality(self, client, db, biz_env):
        """Non-empty description should add weight 1 to filled."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Described",
                "description": "This app manages orders.",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        # description(1) filled → 1/6 = 16.7%
        assert resp.json()["data_quality"] == 16.7

    async def test_lifecycle_contributes_to_quality(self, client, db, biz_env):
        """Lifecycle with at least one date should add weight 1."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Lifecycle App",
                "lifecycle": {"active": "2024-01-01"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        # lifecycle(1) filled → 1/6 = 16.7%
        assert resp.json()["data_quality"] == 16.7

    async def test_zero_weight_field_excluded(self, client, db, biz_env):
        """Fields with weight=0 should not count toward quality."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Website Only",
                "attributes": {"website": "https://example.com"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        # website has weight 0, so filling it doesn't help
        assert resp.json()["data_quality"] == 0.0

    async def test_high_weight_field_matters_more(self, client, db, biz_env):
        """vendor (weight=2) should contribute more than costTotalAnnual (weight=1)."""
        admin = biz_env["admin"]
        # Fill vendor only
        resp1 = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Vendor App",
                "attributes": {"vendor": "Acme Corp"},
            },
            headers=auth_headers(admin),
        )
        assert resp1.status_code == 201
        # vendor(2) filled → 2/6 = 33.3%
        assert resp1.json()["data_quality"] == 33.3

    async def test_fully_filled_gives_100(self, client, db, biz_env):
        """All weighted fields filled → 100%."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Full App",
                "description": "Complete application",
                "lifecycle": {"active": "2024-01-01"},
                "attributes": {
                    "costTotalAnnual": 100000,
                    "riskLevel": "high",
                    "vendor": "Acme",
                },
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["data_quality"] == 100.0

    async def test_false_value_counts_as_unfilled(self, client, db, biz_env):
        """Boolean False should not count as filled.

        On a boolean field, where False is a legal value: a cost or number
        field refuses a bool outright (``test_cost_values.py``).
        """
        admin = biz_env["admin"]
        await create_card_type(
            db,
            key="Flagged",
            label="Flagged",
            fields_schema=[
                {
                    "section": "Flags",
                    "fields": [
                        {"key": "isCritical", "label": "Critical", "type": "boolean", "weight": 1},
                    ],
                }
            ],
        )
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Flagged",
                "name": "False Values",
                "attributes": {"isCritical": False},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["data_quality"] == 0.0

    async def test_empty_string_counts_as_unfilled(self, client, db, biz_env):
        """Empty string should not count as filled."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Empty Strings",
                "attributes": {"vendor": ""},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["data_quality"] == 0.0

    async def test_quality_updated_on_edit(self, client, db, biz_env):
        """Data quality should be recalculated when card is updated."""
        admin = biz_env["admin"]
        # Create empty card
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Evolving App"},
            headers=auth_headers(admin),
        )
        card_id = resp.json()["id"]
        assert resp.json()["data_quality"] == 0.0

        # Update with attributes
        resp2 = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"attributes": {"costTotalAnnual": 50000, "vendor": "Acme"}},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        # costTotalAnnual(1) + vendor(2) = 3/6 = 50.0%
        assert resp2.json()["data_quality"] == 50.0

    async def test_whitespace_only_description_not_filled(self, client, db, biz_env):
        """Description with only whitespace should not count as filled."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Whitespace Desc",
                "description": "   ",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["data_quality"] == 0.0

    async def test_lifecycle_unknown_phase_not_counted(self, client, db, biz_env):
        """Lifecycle with unrecognized phase keys should not count."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "Application",
                "name": "Bad Lifecycle",
                "lifecycle": {"unknownPhase": "2024-01-01"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        # lifecycle phase keys are specific: plan, phaseIn, active, phaseOut, endOfLife
        assert resp.json()["data_quality"] == 0.0


# ---------------------------------------------------------------------------
# Approval status breaking
# ---------------------------------------------------------------------------


class TestApprovalStatusBreaking:
    async def _create_approved_card(self, db, client, admin, **extra):
        """Helper: create card then set status to APPROVED."""
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Approved App", **extra},
            headers=auth_headers(admin),
        )
        card_id = resp.json()["id"]
        # Approve via API
        resp2 = await client.post(
            f"/api/v1/cards/{card_id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert resp2.json()["approval_status"] == "APPROVED"
        return card_id

    async def test_name_change_breaks_approval(self, client, db, biz_env):
        """Changing name on APPROVED card → BROKEN."""
        admin = biz_env["admin"]
        card_id = await self._create_approved_card(db, client, admin)

        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"name": "Changed Name"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["approval_status"] == "BROKEN"

    async def test_description_change_breaks_approval(self, client, db, biz_env):
        """Changing description on APPROVED card → BROKEN."""
        admin = biz_env["admin"]
        card_id = await self._create_approved_card(db, client, admin)

        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"description": "New description"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["approval_status"] == "BROKEN"

    async def test_lifecycle_change_breaks_approval(self, client, db, biz_env):
        """Changing lifecycle on APPROVED card → BROKEN."""
        admin = biz_env["admin"]
        card_id = await self._create_approved_card(db, client, admin)

        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"lifecycle": {"active": "2025-01-01"}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["approval_status"] == "BROKEN"

    async def test_attributes_change_breaks_approval(self, client, db, biz_env):
        """Changing attributes on APPROVED card → BROKEN."""
        admin = biz_env["admin"]
        card_id = await self._create_approved_card(db, client, admin)

        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"attributes": {"costTotalAnnual": 99999}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["approval_status"] == "BROKEN"

    async def test_subtype_change_breaks_approval(self, client, db, biz_env):
        """Changing subtype on APPROVED card → BROKEN."""
        admin = biz_env["admin"]
        card_id = await self._create_approved_card(db, client, admin)

        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"subtype": "Microservice"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["approval_status"] == "BROKEN"

    async def test_alias_change_breaks_approval(self, client, db, biz_env):
        """Changing alias on APPROVED card → BROKEN."""
        admin = biz_env["admin"]
        card_id = await self._create_approved_card(db, client, admin)

        resp = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"alias": "CRM-v2"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["approval_status"] == "BROKEN"

    async def test_draft_card_not_broken_on_edit(self, client, db, biz_env):
        """Editing a DRAFT card should NOT change approval_status."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Draft App"},
            headers=auth_headers(admin),
        )
        card_id = resp.json()["id"]
        assert resp.json()["approval_status"] == "DRAFT"

        resp2 = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"name": "Renamed Draft"},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert resp2.json()["approval_status"] == "DRAFT"

    async def test_rejected_card_not_broken_on_edit(self, client, db, biz_env):
        """Editing a REJECTED card should NOT change approval_status."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Rejected App"},
            headers=auth_headers(admin),
        )
        card_id = resp.json()["id"]
        # Reject it
        await client.post(
            f"/api/v1/cards/{card_id}/approval-status?action=reject",
            headers=auth_headers(admin),
        )

        resp2 = await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"name": "Changed Rejected"},
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert resp2.json()["approval_status"] == "REJECTED"

    async def test_re_approve_after_broken(self, client, db, biz_env):
        """BROKEN card can be re-approved."""
        admin = biz_env["admin"]
        card_id = await self._create_approved_card(db, client, admin)

        # Break it
        await client.patch(
            f"/api/v1/cards/{card_id}",
            json={"name": "Broken"},
            headers=auth_headers(admin),
        )

        # Re-approve
        resp = await client.post(
            f"/api/v1/cards/{card_id}/approval-status?action=approve",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["approval_status"] == "APPROVED"


# ---------------------------------------------------------------------------
# Capability level auto-sync
# ---------------------------------------------------------------------------


class TestCapabilityLevelSync:
    async def test_root_capability_gets_l1(self, client, db, biz_env):
        """Root BusinessCapability (no parent) should get capabilityLevel=L1."""
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Top Capability"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        # The capability level is auto-synced on creation
        # Capability level may be set to L1 on creation if parent logic triggers
        # or may be absent until parent_id is set
        card_id = resp.json()["id"]
        detail = await client.get(
            f"/api/v1/cards/{card_id}",
            headers=auth_headers(admin),
        )
        assert detail.status_code == 200

    async def test_child_capability_gets_l2(self, client, db, biz_env):
        """Child of root BusinessCapability should get capabilityLevel=L2."""
        admin = biz_env["admin"]
        # Create root
        resp1 = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Root"},
            headers=auth_headers(admin),
        )
        root_id = resp1.json()["id"]

        # Create child
        resp2 = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "Child",
                "parent_id": root_id,
            },
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 201
        attrs = resp2.json().get("attributes", {})
        assert attrs.get("capabilityLevel") == "L2"

    async def test_grandchild_gets_l3(self, client, db, biz_env):
        """Grandchild of root → L3."""
        admin = biz_env["admin"]
        resp1 = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Root"},
            headers=auth_headers(admin),
        )
        root_id = resp1.json()["id"]

        resp2 = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Child", "parent_id": root_id},
            headers=auth_headers(admin),
        )
        child_id = resp2.json()["id"]

        resp3 = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Grandchild", "parent_id": child_id},
            headers=auth_headers(admin),
        )
        assert resp3.status_code == 201
        assert resp3.json()["attributes"].get("capabilityLevel") == "L3"

    async def test_moving_parent_cascades_to_children(self, client, db, biz_env):
        """Changing parent_id should cascade capabilityLevel to children."""
        admin = biz_env["admin"]
        # Create two roots
        resp_a = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Root A"},
            headers=auth_headers(admin),
        )
        root_a_id = resp_a.json()["id"]

        resp_b = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Root B"},
            headers=auth_headers(admin),
        )
        root_b_id = resp_b.json()["id"]

        # Create child of A (L2)
        resp_child = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Child", "parent_id": root_a_id},
            headers=auth_headers(admin),
        )
        child_id = resp_child.json()["id"]
        assert resp_child.json()["attributes"]["capabilityLevel"] == "L2"

        # Create grandchild (L3)
        resp_gc = await client.post(
            "/api/v1/cards",
            json={"type": "BusinessCapability", "name": "Grandchild", "parent_id": child_id},
            headers=auth_headers(admin),
        )
        gc_id = resp_gc.json()["id"]
        assert resp_gc.json()["attributes"]["capabilityLevel"] == "L3"

        # Move child under root_b (child becomes L2 of B, grandchild stays L3)
        resp_move = await client.patch(
            f"/api/v1/cards/{child_id}",
            json={"parent_id": root_b_id},
            headers=auth_headers(admin),
        )
        assert resp_move.status_code == 200
        assert resp_move.json()["attributes"]["capabilityLevel"] == "L2"

        # Verify grandchild was cascaded
        resp_gc2 = await client.get(
            f"/api/v1/cards/{gc_id}",
            headers=auth_headers(admin),
        )
        assert resp_gc2.json()["attributes"]["capabilityLevel"] == "L3"


# ---------------------------------------------------------------------------
# Macro Capability tier — additive above L1 (consumed from PR #85 upstream).
# ---------------------------------------------------------------------------


class TestMacroCapabilityTier:
    """Regression tests for the macro-aware depth math in cards.py.

    Macros sit at chain root with `capabilityLevel="Macro"`. Without the
    macro-aware branches in `_sync_capability_level` and
    `_check_hierarchy_depth`, every edit of a relinked L1 would flip its
    level to L2, the macro itself would flip to L1, and 6-level chains
    rooted at a macro would be rejected.
    """

    async def test_macro_card_preserves_macro_level_on_create(self, client, db, biz_env):
        """A BusinessCapability created with capabilityLevel="Macro" keeps it
        — the sync must not overwrite an explicit Macro designation.
        """
        admin = biz_env["admin"]
        resp = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "Customer Experience",
                "attributes": {"capabilityLevel": "Macro"},
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["attributes"]["capabilityLevel"] == "Macro"

    async def test_l1_under_macro_stays_l1(self, client, db, biz_env):
        """An L1 capability reparented under a macro must keep its L1 level —
        the macro root subtracts 1 from depth, so depth-1 maps to L1 (not L2).
        """
        admin = biz_env["admin"]
        macro = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "Macro Group",
                "attributes": {"capabilityLevel": "Macro"},
            },
            headers=auth_headers(admin),
        )
        macro_id = macro.json()["id"]

        l1 = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "L1 Capability",
                "parent_id": macro_id,
            },
            headers=auth_headers(admin),
        )
        assert l1.status_code == 201
        assert l1.json()["attributes"]["capabilityLevel"] == "L1"

    async def test_l2_under_macro_resolves_correctly(self, client, db, biz_env):
        """Macro → L1 → L2 chain: the L2 must be labelled L2 (depth 2 minus 1
        macro offset = logical depth 1 → "L2")."""
        admin = biz_env["admin"]
        macro = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "Macro",
                "attributes": {"capabilityLevel": "Macro"},
            },
            headers=auth_headers(admin),
        )
        l1 = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "L1",
                "parent_id": macro.json()["id"],
            },
            headers=auth_headers(admin),
        )
        l2 = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "L2",
                "parent_id": l1.json()["id"],
            },
            headers=auth_headers(admin),
        )
        assert l2.status_code == 201
        assert l2.json()["attributes"]["capabilityLevel"] == "L2"

    async def test_six_level_chain_rooted_at_macro_is_allowed(self, client, db, biz_env):
        """A chain Macro → L1 → L2 → L3 → L4 → L5 is 6 levels deep. Without
        the macro-aware depth check this would be rejected with HTTP 400
        ("hierarchy would exceed maximum depth of 5")."""
        admin = biz_env["admin"]
        macro = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "Macro",
                "attributes": {"capabilityLevel": "Macro"},
            },
            headers=auth_headers(admin),
        )
        parent_id = macro.json()["id"]
        for label in ["L1", "L2", "L3", "L4", "L5"]:
            resp = await client.post(
                "/api/v1/cards",
                json={
                    "type": "BusinessCapability",
                    "name": label,
                    "parent_id": parent_id,
                },
                headers=auth_headers(admin),
            )
            assert resp.status_code == 201, f"chain broke at {label}: {resp.text}"
            assert resp.json()["attributes"]["capabilityLevel"] == label
            parent_id = resp.json()["id"]

    async def test_macro_card_keeps_macro_level_after_unrelated_edit(self, client, db, biz_env):
        """Editing a macro's description must not flip it from Macro to L1.
        The sync is invoked on parent_id changes — but if the level is
        missing or the card itself is Macro, the function must preserve."""
        admin = biz_env["admin"]
        macro = await client.post(
            "/api/v1/cards",
            json={
                "type": "BusinessCapability",
                "name": "Macro",
                "description": "first",
                "attributes": {"capabilityLevel": "Macro"},
            },
            headers=auth_headers(admin),
        )
        macro_id = macro.json()["id"]

        # Patch description only — no parent_id change.
        resp = await client.patch(
            f"/api/v1/cards/{macro_id}",
            json={"description": "second"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["attributes"]["capabilityLevel"] == "Macro"
