"""TurboLens routes over the test app: status, the dashboard overview,
the four background analyses (vendor categorisation, vendor resolution,
duplicate detection, modernization) driven to completion under the
patched session, the architect lookups and phases, analysis runs,
assessments, the commit, and the compliance-scan trigger — each with
its permission denial, and the per-card-type View deny wherever the
route applies the card read scope."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.api.v1.turbolens import _run_analysis
from app.core.permissions import ALL_APP_PERMISSION_KEYS
from app.models.card import Card
from app.models.relation import Relation
from app.models.turbolens import (
    TurboLensAnalysisRun,
    TurboLensAssessment,
    TurboLensDuplicateCluster,
    TurboLensModernization,
    TurboLensVendorAnalysis,
    TurboLensVendorHierarchy,
)
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_analysis_run,
    create_card,
    create_card_type,
    create_compliance_finding,
    create_relation_type,
    create_role,
    create_user,
)
from tests.seams import ai_settings

API = "/api/v1/turbolens"
COMPLIANCE = "/api/v1/compliance"


@pytest.fixture
async def env(db):
    """Five roles, a small landscape with one card type hidden from the
    ``restricted`` role and the Provider type hidden from ``noprov``."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions={"turbolens.view": True, "compliance.view": True},
    )
    await create_role(db, key="nobody", label="Nobody", permissions={})
    everything = {k: True for k in ALL_APP_PERMISSION_KEYS if not k.startswith("admin.")}
    await create_role(db, key="restricted", label="Restricted", permissions=everything)
    await create_role(db, key="noprov", label="No Provider", permissions=everything)

    for key in ("Application", "Objective", "ITComponent", "Initiative"):
        await create_card_type(db, key=key, label=key)
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_card_type(
        db,
        key="Provider",
        label="Provider",
        role_permissions={"noprov": {"inventory.view": False}},
    )
    await create_card_type(
        db,
        key="Secret",
        label="Secret",
        role_permissions={"restricted": {"inventory.view": False}},
    )
    for key, src, tgt in (
        ("relAppToProvider", "Application", "Provider"),
        ("relObjectiveToBC", "Objective", "BusinessCapability"),
        ("relAppToBC", "Application", "BusinessCapability"),
        ("relObjectiveToSecret", "Objective", "Secret"),
        ("relInitiativeToObjective", "Initiative", "Objective"),
    ):
        await create_relation_type(db, key=key, label=key, source_type_key=src, target_type_key=tgt)
    PermissionService.invalidate_type_permission_cache()

    users = {
        role: await create_user(db, email=f"{role}@tl.test", role=role)
        for role in ("admin", "viewer", "nobody", "restricted", "noprov")
    }

    app_a = await create_card(
        db,
        card_type="Application",
        name="App A",
        data_quality=90,
        attributes={"costTotalAnnual": 100},
    )
    app_b = await create_card(
        db,
        card_type="Application",
        name="App B",
        data_quality=50,
        attributes={"costTotalAnnual": 50},
    )
    secret = await create_card(db, card_type="Secret", name="Secret One", data_quality=10)
    provider = await create_card(db, card_type="Provider", name="SAP", data_quality=60)
    objective = await create_card(db, card_type="Objective", name="Grow revenue", data_quality=60)
    cut_cost = await create_card(db, card_type="Objective", name="Cut cost", data_quality=60)
    commerce = await create_card(
        db, card_type="BusinessCapability", name="Commerce", data_quality=60
    )
    sales = await create_card(
        db, card_type="BusinessCapability", name="Sales", parent_id=commerce.id, data_quality=60
    )
    await create_card(db, card_type="Application", name="Old", status="ARCHIVED", data_quality=5)
    db.add_all(
        [
            Relation(type="relAppToProvider", source_id=app_a.id, target_id=provider.id),
            Relation(type="relObjectiveToBC", source_id=objective.id, target_id=sales.id),
            Relation(type="relObjectiveToSecret", source_id=objective.id, target_id=secret.id),
            Relation(type="relAppToBC", source_id=app_a.id, target_id=sales.id),
        ]
    )
    await db.flush()
    return {
        **users,
        "app_a": app_a,
        "app_b": app_b,
        "secret": secret,
        "provider": provider,
        "objective": objective,
        "cut_cost": cut_cost,
        "commerce": commerce,
        "sales": sales,
    }


async def _run(db, run_id: str) -> TurboLensAnalysisRun:
    return await db.get(TurboLensAnalysisRun, uuid.UUID(run_id))


# ── Status ────────────────────────────────────────────────────────────────


class TestStatus:
    async def test_nothing_configured(self, client, env):
        resp = await client.get(f"{API}/status", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 200
        assert resp.json() == {"ai_configured": False, "ready": False, "enabled": True}

    async def test_configured_but_switched_off(self, db, client, env):
        await ai_settings(db, general={"turboLensEnabled": False})
        resp = await client.get(f"{API}/status", headers=auth_headers(env["viewer"]))
        assert resp.json() == {"ai_configured": True, "ready": False, "enabled": False}

    async def test_ready(self, db, client, env):
        await ai_settings(db)
        resp = await client.get(f"{API}/status", headers=auth_headers(env["nobody"]))
        assert resp.json() == {"ai_configured": True, "ready": True, "enabled": True}


# ── Overview ──────────────────────────────────────────────────────────────


class TestOverview:
    async def test_counts_every_active_card_for_an_unrestricted_reader(self, db, client, env):
        db.add(TurboLensVendorAnalysis(vendor_name="V", category="Other"))
        db.add(TurboLensDuplicateCluster(cluster_name="C", card_type="Application"))
        db.add(TurboLensModernization(target_type="Application"))
        await db.flush()

        resp = await client.get(f"{API}/overview", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 200
        body = resp.json()
        assert body["cards_by_type"] == {
            "Application": 2,
            "Secret": 1,
            "Provider": 1,
            "Objective": 2,
            "BusinessCapability": 2,
        }
        assert body["total_cards"] == 8  # the archived card is not counted
        assert (body["quality_bronze"], body["quality_silver"], body["quality_gold"]) == (1, 6, 1)
        assert body["quality_avg"] == 56.2
        assert body["total_cost"] == 150.0
        assert (body["vendor_count"], body["duplicate_clusters"], body["modernization_count"]) == (
            1,
            1,
            1,
        )
        assert [i["name"] for i in body["top_issues"]] == ["Secret One"]

    async def test_a_hidden_type_is_absent_from_every_kpi(self, client, env):
        resp = await client.get(f"{API}/overview", headers=auth_headers(env["restricted"]))
        body = resp.json()
        assert "Secret" not in body["cards_by_type"]
        assert body["total_cards"] == 7 and body["quality_bronze"] == 0
        assert body["top_issues"] == []

    async def test_requires_turbolens_view(self, client, env):
        resp = await client.get(f"{API}/overview", headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403


# ── Vendors ───────────────────────────────────────────────────────────────


class TestVendorAnalysis:
    async def test_the_run_completes_in_the_background(
        self, db, client, env, fake_call_ai, patched_async_session
    ):
        fake_call_ai.queue(
            [{"name": "SAP", "category": "ERP & Finance", "sub_category": "ERP", "reasoning": "r"}]
        )
        resp = await client.post(f"{API}/vendors/analyse", headers=auth_headers(env["admin"]))
        assert resp.status_code == 200
        assert resp.json()["status"] == "running"

        run = await _run(db, resp.json()["run_id"])
        assert run.status == "completed" and run.completed_at is not None
        assert run.results == {"analysed": 1, "total": 1}
        assert run.analysis_type == "vendor_analysis" and run.created_by == env["admin"].id

        listing = await client.get(f"{API}/vendors", headers=auth_headers(env["viewer"]))
        (vendor,) = listing.json()
        assert vendor["vendor_name"] == "SAP" and vendor["category"] == "ERP & Finance"
        assert vendor["app_list"] == ["App A"] and vendor["app_count"] == 1

    async def test_a_failing_service_marks_the_run_failed(
        self, db, client, env, monkeypatch, patched_async_session
    ):
        monkeypatch.setattr(
            "app.services.turbolens_vendors.analyse_vendors",
            AsyncMock(side_effect=ValueError("boom")),
        )
        resp = await client.post(f"{API}/vendors/analyse", headers=auth_headers(env["admin"]))
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "failed" and run.error_message == "boom"
        assert run.completed_at is not None and run.results is None

    async def test_one_analysis_of_a_kind_at_a_time(self, db, client, env):
        await create_analysis_run(db, analysis_type="vendor_analysis", status="running")
        resp = await client.post(f"{API}/vendors/analyse", headers=auth_headers(env["admin"]))
        assert resp.status_code == 409
        assert "already running" in resp.json()["detail"]

    async def test_requires_turbolens_manage(self, client, env):
        resp = await client.post(f"{API}/vendors/analyse", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403


class TestVendorList:
    @pytest.fixture
    async def vendors(self, db, env):
        db.add_all(
            [
                TurboLensVendorAnalysis(
                    vendor_name="Vendor X",
                    category="ERP",
                    app_count=2,
                    app_list=["App A", "Secret One"],
                ),
                TurboLensVendorAnalysis(
                    vendor_name="Vendor Y", category="CRM", app_count=1, app_list=["Secret One"]
                ),
                TurboLensVendorAnalysis(vendor_name="Vendor Z", category="Other", app_count=0),
            ]
        )
        await db.flush()

    async def test_ordered_by_app_count(self, client, env, vendors):
        resp = await client.get(f"{API}/vendors", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 200
        assert [v["vendor_name"] for v in resp.json()] == ["Vendor X", "Vendor Y", "Vendor Z"]

    async def test_hidden_cards_drop_out_of_every_list(self, client, env, vendors):
        resp = await client.get(f"{API}/vendors", headers=auth_headers(env["restricted"]))
        by_name = {v["vendor_name"]: v for v in resp.json()}
        # Y exists only through the hidden card; Z names no card at all.
        assert set(by_name) == {"Vendor X", "Vendor Z"}
        assert by_name["Vendor X"]["app_list"] == ["App A"]
        assert by_name["Vendor X"]["app_count"] == 1
        assert by_name["Vendor Z"]["app_list"] == [] and by_name["Vendor Z"]["app_count"] == 0

    async def test_a_reader_denied_provider_sees_no_vendors(self, client, env, vendors):
        resp = await client.get(f"{API}/vendors", headers=auth_headers(env["noprov"]))
        assert resp.status_code == 200 and resp.json() == []

    async def test_requires_turbolens_view(self, client, env, vendors):
        resp = await client.get(f"{API}/vendors", headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403


class TestVendorResolution:
    async def test_the_run_rebuilds_the_hierarchy(
        self, db, client, env, fake_call_ai, patched_async_session
    ):
        db.add(TurboLensVendorAnalysis(vendor_name="SAP", category="ERP & Finance"))
        await db.flush()
        fake_call_ai.queue(
            [
                {
                    "raw_name": "SAP",
                    "canonical_name": "SAP SE",
                    "vendor_type": "vendor",
                    "parent_canonical": None,
                    "confidence": 0.9,
                }
            ]
        )
        resp = await client.post(f"{API}/vendors/resolve", headers=auth_headers(env["admin"]))
        assert resp.status_code == 200
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "completed" and run.analysis_type == "vendor_resolution"
        assert run.results == {"saved": 1, "rawCount": 1}

        tree = await client.get(f"{API}/vendors/hierarchy", headers=auth_headers(env["viewer"]))
        (node,) = tree.json()
        assert node["canonical_name"] == "SAP SE" and node["app_count"] == 1
        assert node["aliases"] == ["SAP"] and node["confidence"] == 0.9

    async def test_requires_turbolens_manage(self, client, env):
        resp = await client.post(f"{API}/vendors/resolve", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403


class TestVendorHierarchy:
    @pytest.fixture
    async def tree(self, db, env):
        db.add_all(
            [
                TurboLensVendorHierarchy(canonical_name="Microsoft", app_count=1),
                TurboLensVendorHierarchy(canonical_name="SAP SE", app_count=3, aliases=["SAP"]),
            ]
        )
        await db.flush()

    async def test_ordered_by_app_count(self, client, env, tree):
        resp = await client.get(f"{API}/vendors/hierarchy", headers=auth_headers(env["viewer"]))
        assert [n["canonical_name"] for n in resp.json()] == ["SAP SE", "Microsoft"]

    async def test_a_reader_denied_provider_sees_nothing(self, client, env, tree):
        resp = await client.get(f"{API}/vendors/hierarchy", headers=auth_headers(env["noprov"]))
        assert resp.status_code == 200 and resp.json() == []

    async def test_requires_turbolens_view(self, client, env, tree):
        resp = await client.get(f"{API}/vendors/hierarchy", headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403


# ── Duplicates ────────────────────────────────────────────────────────────


class TestDuplicateDetection:
    async def test_the_run_persists_the_clusters(
        self, db, client, env, fake_call_ai, patched_async_session
    ):
        a, b = str(env["app_a"].id), str(env["app_b"].id)
        fake_call_ai.default = "[]"
        fake_call_ai.route(
            contains="Items to analyse (Application)",
            text=[
                {
                    "cluster_name": "Apps",
                    "functional_domain": "ops",
                    "member_ids": [a, b],
                    "member_names": ["App A", "App B"],
                    "evidence": "same",
                    "recommendation": "merge",
                }
            ],
        )
        resp = await client.post(f"{API}/duplicates/analyse", headers=auth_headers(env["admin"]))
        assert resp.status_code == 200
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "completed" and run.results == {"clusters": 1}

        listing = await client.get(f"{API}/duplicates", headers=auth_headers(env["viewer"]))
        (cluster,) = listing.json()
        assert cluster["cluster_name"] == "Apps" and cluster["card_type"] == "Application"
        assert sorted(cluster["card_ids"]) == sorted([a, b]) and cluster["status"] == "pending"

    async def test_requires_turbolens_manage(self, client, env):
        resp = await client.post(f"{API}/duplicates/analyse", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 403


class TestDuplicateList:
    @pytest.fixture
    async def clusters(self, db, env):
        a, b, s = str(env["app_a"].id), str(env["app_b"].id), str(env["secret"].id)
        rows = {
            "three": TurboLensDuplicateCluster(
                cluster_name="three",
                card_type="Application",
                card_ids=[a, b, s],
                card_names=["App A", "App B", "Secret One"],
            ),
            "pair": TurboLensDuplicateCluster(
                cluster_name="pair",
                card_type="Application",
                card_ids=[a, s],
                card_names=["App A", "Secret One"],
            ),
            "odd": TurboLensDuplicateCluster(
                cluster_name="odd",
                card_type="Application",
                card_ids=["not-a-uuid", a],
                card_names=["Ghost"],
            ),
        }
        db.add_all(rows.values())
        await db.flush()
        return rows

    async def test_an_unrestricted_reader_sees_every_cluster(self, client, env, clusters):
        resp = await client.get(f"{API}/duplicates", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 200
        by_name = {c["cluster_name"]: c for c in resp.json()}
        assert set(by_name) == {"three", "pair", "odd"}
        assert by_name["three"]["card_names"] == ["App A", "App B", "Secret One"]

    async def test_hidden_members_are_dropped_and_a_pair_losing_one_vanishes(
        self, client, env, clusters
    ):
        a, b = str(env["app_a"].id), str(env["app_b"].id)
        resp = await client.get(f"{API}/duplicates", headers=auth_headers(env["restricted"]))
        by_name = {c["cluster_name"]: c for c in resp.json()}
        assert set(by_name) == {"three", "odd"}
        assert by_name["three"]["card_ids"] == [a, b]
        assert by_name["three"]["card_names"] == ["App A", "App B"]
        # A malformed id is neither hidden nor resolvable: it stays, and names
        # of a different length are left as stored.
        assert by_name["odd"]["card_ids"] == ["not-a-uuid", a]
        assert by_name["odd"]["card_names"] == ["Ghost"]

    async def test_requires_turbolens_view(self, client, env, clusters):
        resp = await client.get(f"{API}/duplicates", headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403


class TestDuplicateStatus:
    @pytest.fixture
    async def cluster(self, db, env):
        row = TurboLensDuplicateCluster(
            cluster_name="c", card_type="Application", card_ids=[], card_names=[]
        )
        db.add(row)
        await db.flush()
        return row

    async def test_sets_a_valid_status(self, db, client, env, cluster):
        resp = await client.patch(
            f"{API}/duplicates/{cluster.id}/status",
            json={"status": "dismissed"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "dismissed" and resp.json()["id"] == str(cluster.id)
        assert (await db.get(TurboLensDuplicateCluster, cluster.id)).status == "dismissed"

    async def test_rejects_an_unknown_status(self, client, env, cluster):
        resp = await client.patch(
            f"{API}/duplicates/{cluster.id}/status",
            json={"status": "maybe"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 400 and "Invalid status" in resp.json()["detail"]

    async def test_unknown_cluster(self, client, env):
        resp = await client.patch(
            f"{API}/duplicates/{uuid.uuid4()}/status",
            json={"status": "confirmed"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 404

    async def test_requires_turbolens_manage(self, client, env, cluster):
        resp = await client.patch(
            f"{API}/duplicates/{cluster.id}/status",
            json={"status": "confirmed"},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 403


class TestModernization:
    async def test_the_run_assesses_the_requested_type(
        self, db, client, env, fake_call_ai, patched_async_session
    ):
        fake_call_ai.queue(
            [
                {
                    "fs_id": str(env["app_a"].id),
                    "fs_name": "App A",
                    "current_tech": "COBOL",
                    "modernization_type": "cloud",
                    "recommendation": "move",
                    "effort": "high",
                    "priority": "critical",
                }
            ]
        )
        resp = await client.post(
            f"{API}/duplicates/modernize",
            json={"target_type": "Application", "modernization_type": "cloud"},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "completed" and run.analysis_type == "modernization"
        assert run.results == {"assessments": 1, "targetType": "Application"}

        listing = await client.get(
            f"{API}/duplicates/modernizations", headers=auth_headers(env["viewer"])
        )
        (item,) = listing.json()
        assert item["card_id"] == str(env["app_a"].id) and item["current_tech"] == "COBOL"
        assert item["effort"] == "high" and item["priority"] == "critical"

    async def test_requires_turbolens_manage(self, client, env):
        resp = await client.post(
            f"{API}/duplicates/modernize", json={}, headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403


class TestModernizationList:
    @pytest.fixture
    async def items(self, db, env):
        db.add_all(
            [
                TurboLensModernization(
                    target_type="Application", card_id=env["app_a"].id, card_name="App A"
                ),
                TurboLensModernization(
                    target_type="Application", card_id=env["secret"].id, card_name="Secret One"
                ),
                TurboLensModernization(target_type="Secret", card_name="type-wide"),
                TurboLensModernization(target_type="Application", card_name="unbound"),
            ]
        )
        await db.flush()

    async def test_an_unrestricted_reader_sees_all(self, client, env, items):
        resp = await client.get(
            f"{API}/duplicates/modernizations", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 200 and len(resp.json()) == 4

    async def test_a_hidden_card_and_a_hidden_type_drop_out(self, client, env, items):
        resp = await client.get(
            f"{API}/duplicates/modernizations", headers=auth_headers(env["restricted"])
        )
        assert sorted(m["card_name"] for m in resp.json()) == ["App A", "unbound"]

    async def test_requires_turbolens_view(self, client, env, items):
        resp = await client.get(
            f"{API}/duplicates/modernizations", headers=auth_headers(env["nobody"])
        )
        assert resp.status_code == 403


# ── Architect lookups ─────────────────────────────────────────────────────


class TestArchitectLookups:
    async def test_objectives_alphabetical_then_ranked(self, client, env):
        headers = auth_headers(env["admin"])
        resp = await client.get(f"{API}/architect/objectives", headers=headers)
        assert resp.status_code == 200
        assert [o["name"] for o in resp.json()] == ["Cut cost", "Grow revenue"]
        assert set(resp.json()[0]) == {"id", "name", "description", "subtype"}

        resp = await client.get(f"{API}/architect/objectives?search=grow", headers=headers)
        assert [o["name"] for o in resp.json()] == ["Grow revenue"]

    async def test_capabilities_alphabetical_then_ranked(self, client, env):
        headers = auth_headers(env["admin"])
        resp = await client.get(f"{API}/architect/capabilities", headers=headers)
        assert [c["name"] for c in resp.json()] == ["Commerce", "Sales"]
        assert set(resp.json()[0]) == {"id", "name", "description"}

        resp = await client.get(f"{API}/architect/capabilities?search=sal", headers=headers)
        assert [c["name"] for c in resp.json()] == ["Sales"]

    async def test_lookups_require_turbolens_manage(self, client, env):
        for path in ("objectives", "capabilities", "objective-dependencies"):
            resp = await client.get(f"{API}/architect/{path}", headers=auth_headers(env["viewer"]))
            assert resp.status_code == 403, path


class TestObjectiveDependencies:
    async def test_nothing_selected_or_nothing_known(self, client, env):
        headers = auth_headers(env["admin"])
        empty = {"nodes": [], "edges": []}
        resp = await client.get(f"{API}/architect/objective-dependencies", headers=headers)
        assert resp.status_code == 200 and resp.json() == empty
        resp = await client.get(
            f"{API}/architect/objective-dependencies?objective_ids=, {uuid.uuid4()}",
            headers=headers,
        )
        assert resp.json() == empty

    async def test_direct_neighbours_with_ancestor_paths(self, client, env):
        obj, sales, secret = env["objective"], env["sales"], env["secret"]
        resp = await client.get(
            f"{API}/architect/objective-dependencies?objective_ids={obj.id},junk",
            headers=auth_headers(env["admin"]),
        )
        body = resp.json()
        nodes = {n["name"]: n for n in body["nodes"]}
        # App A is two hops away: not part of the depth-1 subgraph.
        assert set(nodes) == {"Grow revenue", "Sales", "Secret One"}
        assert nodes["Sales"]["path"] == ["Commerce"]
        assert nodes["Sales"]["parent_id"] == str(env["commerce"].id)
        assert nodes["Grow revenue"]["path"] == [] and nodes["Grow revenue"]["type"] == "Objective"
        edges = {(e["source"], e["target"], e["type"]): e for e in body["edges"]}
        assert set(edges) == {
            (str(obj.id), str(sales.id), "relObjectiveToBC"),
            (str(obj.id), str(secret.id), "relObjectiveToSecret"),
        }
        assert edges[(str(obj.id), str(sales.id), "relObjectiveToBC")]["label"] == (
            "relObjectiveToBC"
        )

    async def test_a_hidden_card_is_neither_node_nor_edge(self, client, env):
        obj = env["objective"]
        resp = await client.get(
            f"{API}/architect/objective-dependencies?objective_ids={obj.id}",
            headers=auth_headers(env["restricted"]),
        )
        body = resp.json()
        assert sorted(n["name"] for n in body["nodes"]) == ["Grow revenue", "Sales"]
        assert [e["type"] for e in body["edges"]] == ["relObjectiveToBC"]


# ── Architect phases ──────────────────────────────────────────────────────


class TestArchitectPhases:
    @pytest.mark.parametrize(
        ("path", "body", "detail"),
        [
            ("phase1", {}, "Requirement is required"),
            ("phase2", {"requirement": "r"}, "phase1QA"),
            ("phase3/options", {"requirement": "r"}, "allQA"),
            ("phase3/gaps", {"requirement": "r", "allQA": [{}]}, "selectedOption"),
            (
                "phase3/deps",
                {"requirement": "r", "allQA": [{}], "selectedOption": {"title": "t"}},
                "selectedProducts",
            ),
            ("phase3", {"allQA": [{}]}, "Phase 3"),
        ],
    )
    async def test_missing_input_is_rejected(self, client, env, path, body, detail):
        resp = await client.post(
            f"{API}/architect/{path}", json=body, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 400, resp.text
        assert detail in resp.json()["detail"]

    @pytest.mark.parametrize(
        "path", ["phase1", "phase2", "phase3/options", "phase3/gaps", "phase3/deps", "phase3"]
    )
    async def test_a_restricted_reader_may_not_run_the_architect(self, client, env, path):
        resp = await client.post(
            f"{API}/architect/{path}",
            json={"requirement": "r"},
            headers=auth_headers(env["restricted"]),
        )
        assert resp.status_code == 403
        assert "every card type" in resp.json()["detail"]

    async def test_phases_require_turbolens_manage(self, client, env):
        resp = await client.post(
            f"{API}/architect/phase1",
            json={"requirement": "r"},
            headers=auth_headers(env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_phase1_returns_the_model_answer(self, client, env, fake_call_ai):
        fake_call_ai.queue({"summary": "s", "questions": [{"id": "q1"}]})
        resp = await client.post(
            f"{API}/architect/phase1",
            json={
                "requirement": "Build a CRM",
                "objectiveIds": [str(env["objective"].id)],
                "selectedCapabilities": [{"name": "Sales"}],
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == {"summary": "s", "questions": [{"id": "q1"}]}
        prompt = fake_call_ai.calls[0][0]
        assert "Grow revenue" in prompt and "  - Sales" in prompt

    async def test_phase2_options_gaps_and_deps_pass_their_inputs_through(
        self, client, env, fake_call_ai
    ):
        headers = auth_headers(env["admin"])
        fake_call_ai.queue({"phase": 2})
        resp = await client.post(
            f"{API}/architect/phase2",
            json={"requirement": "r", "phase1QA": [{"question": "Who?", "answer": "Sales"}]},
            headers=headers,
        )
        assert resp.json() == {"phase": 2} and "Q: Who?\nA: Sales" in fake_call_ai.calls[-1][0]

        fake_call_ai.queue({"options": []})
        resp = await client.post(
            f"{API}/architect/phase3/options",
            json={"requirement": "r", "allQA": [{"question": "q", "answer": "a"}]},
            headers=headers,
        )
        assert resp.json() == {"options": []} and "Q1: q\nA: a" in fake_call_ai.calls[-1][0]

        fake_call_ai.queue({"gaps": []})
        resp = await client.post(
            f"{API}/architect/phase3/gaps",
            json={
                "requirement": "r",
                "allQA": [{"question": "q", "answer": "a"}],
                "selectedOption": {"approach": "buy", "title": "Buy it"},
            },
            headers=headers,
        )
        assert resp.json() == {"gaps": []} and "Title: Buy it" in fake_call_ai.calls[-1][0]

        fake_call_ai.queue({"dependencies": []})
        resp = await client.post(
            f"{API}/architect/phase3/deps",
            json={
                "requirement": "r",
                "allQA": [{"question": "q", "answer": "a"}],
                "selectedOption": {"approach": "buy", "title": "Buy it"},
                "selectedProducts": [{"name": "ZoomInfo", "gap": "Leads"}],
            },
            headers=headers,
        )
        assert resp.json() == {"dependencies": []} and "ZoomInfo" in fake_call_ai.calls[-1][0]

    async def test_phase3_builds_the_dependency_subgraph_and_records_a_run(
        self, db, client, env, fake_call_ai
    ):
        obj, sales, secret = env["objective"], env["sales"], env["secret"]
        answer = {"summary": "impact", "capabilities": [], "proposedCards": []}
        fake_call_ai.queue({**answer, "proposedRelations": []})
        resp = await client.post(
            f"{API}/architect/phase3",
            json={
                "requirement": "Build a CRM",
                "allQA": [{"question": "q", "answer": "a"}],
                "objectiveIds": [str(obj.id), str(uuid.uuid4())],
                "selectedOption": {"approach": "buy", "title": "Buy it"},
                "selectedRecommendations": [],
            },
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["summary"] == "impact"
        deps = body["existingDependencies"]
        assert sorted(n["name"] for n in deps["nodes"]) == ["Grow revenue", "Sales", "Secret One"]
        assert {(e["source"], e["target"], e["type"]) for e in deps["edges"]} == {
            (str(obj.id), str(sales.id), "relObjectiveToBC"),
            (str(obj.id), str(secret.id), "relObjectiveToSecret"),
        }
        prompt = fake_call_ai.calls[0][0]
        assert "=== EXISTING DEPENDENCY SUBGRAPH" in prompt and "Grow revenue" in prompt

        run = (
            await db.execute(
                select(TurboLensAnalysisRun).where(
                    TurboLensAnalysisRun.analysis_type == "architect"
                )
            )
        ).scalar_one()
        assert run.status == "completed" and run.results == body
        assert run.created_by == env["admin"].id and run.completed_at is not None

    async def test_phase3_without_objectives_skips_the_graph(self, client, env, fake_call_ai):
        fake_call_ai.queue(
            {"summary": "x", "capabilities": [], "proposedCards": [], "proposedRelations": []}
        )
        resp = await client.post(
            f"{API}/architect/phase3",
            json={"requirement": "r", "allQA": [{"question": "q", "answer": "a"}]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["existingDependencies"] == {"nodes": [], "edges": []}


# ── Analysis runs ─────────────────────────────────────────────────────────


class TestAnalysisRuns:
    async def test_list_newest_first_and_get(self, db, client, env):
        older = await create_analysis_run(db, analysis_type="vendor_analysis", status="completed")
        newer = await create_analysis_run(
            db, analysis_type="compliance", status="failed", results={"n": 1}
        )
        headers = auth_headers(env["viewer"])
        resp = await client.get(f"{API}/analysis-runs", headers=headers)
        assert resp.status_code == 200
        assert [r["id"] for r in resp.json()] == [str(newer.id), str(older.id)]

        resp = await client.get(f"{API}/analysis-runs/{newer.id}", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["analysis_type"] == "compliance" and body["status"] == "failed"
        assert body["results"] == {"n": 1} and body["error_message"] is None

    async def test_unknown_run(self, client, env):
        resp = await client.get(
            f"{API}/analysis-runs/{uuid.uuid4()}", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 404

    async def test_require_turbolens_view(self, client, env):
        headers = auth_headers(env["nobody"])
        assert (await client.get(f"{API}/analysis-runs", headers=headers)).status_code == 403
        resp = await client.get(f"{API}/analysis-runs/{uuid.uuid4()}", headers=headers)
        assert resp.status_code == 403


class TestRunAnalysisHelper:
    async def test_a_vanished_run_is_ignored_on_both_paths(self, db, patched_async_session):
        missing = str(uuid.uuid4())

        async def ok(_db):
            return {"x": 1}

        async def bad(_db):
            raise ValueError("nope")

        await _run_analysis(missing, ok, "ok")
        await _run_analysis(missing, bad, "bad")
        assert await _run(db, missing) is None


# ── Assessments ───────────────────────────────────────────────────────────


class TestAssessments:
    async def test_create_list_get_and_update(self, db, client, env):
        headers = auth_headers(env["admin"])
        resp = await client.post(
            f"{API}/assessments",
            json={"title": "T", "requirement": "R", "sessionData": {"a": 1}},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        created = resp.json()
        assert created["status"] == "saved" and created["session_data"] == {"a": 1}
        assert created["created_by"] == str(env["admin"].id)
        assert created["created_by_name"] == env["admin"].display_name
        assert created["initiative_id"] is None and created["initiative_name"] is None

        listing = await client.get(f"{API}/assessments", headers=auth_headers(env["viewer"]))
        assert [a["id"] for a in listing.json()] == [created["id"]]
        assert listing.json()[0]["session_data"] is None  # the list never carries the payload

        full = await client.get(
            f"{API}/assessments/{created['id']}", headers=auth_headers(env["viewer"])
        )
        assert full.json()["session_data"] == {"a": 1}

        resp = await client.patch(
            f"{API}/assessments/{created['id']}",
            json={"title": "T2", "requirement": "R2", "sessionData": {"a": 2}},
            headers=headers,
        )
        assert resp.status_code == 200
        assert (resp.json()["title"], resp.json()["requirement"]) == ("T2", "R2")
        assert resp.json()["session_data"] == {"a": 2}
        row = await db.get(TurboLensAssessment, uuid.UUID(created["id"]))
        assert row.title == "T2" and row.session_data == {"a": 2}

    async def test_a_committed_assessment_is_frozen(self, db, client, env):
        initiative = await create_card(db, card_type="Initiative", name="Prog")
        row = TurboLensAssessment(
            title="T",
            requirement="R",
            session_data={},
            status="committed",
            initiative_id=initiative.id,
        )
        db.add(row)
        await db.flush()
        resp = await client.patch(
            f"{API}/assessments/{row.id}", json={"title": "x"}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 409

        full = await client.get(f"{API}/assessments/{row.id}", headers=auth_headers(env["admin"]))
        assert full.json()["initiative_name"] == "Prog"
        assert full.json()["created_by"] is None and full.json()["created_by_name"] is None

    async def test_unknown_assessment(self, client, env):
        headers = auth_headers(env["admin"])
        missing = uuid.uuid4()
        assert (
            await client.get(f"{API}/assessments/{missing}", headers=headers)
        ).status_code == 404
        resp = await client.patch(f"{API}/assessments/{missing}", json={}, headers=headers)
        assert resp.status_code == 404

    async def test_writes_require_turbolens_manage(self, client, env):
        headers = auth_headers(env["viewer"])
        resp = await client.post(
            f"{API}/assessments",
            json={"title": "T", "requirement": "R", "sessionData": {}},
            headers=headers,
        )
        assert resp.status_code == 403
        resp = await client.patch(
            f"{API}/assessments/{uuid.uuid4()}", json={"title": "x"}, headers=headers
        )
        assert resp.status_code == 403


# ── Commit ────────────────────────────────────────────────────────────────


def _commit_body(assessment_id: str) -> dict:
    return {
        "assessmentId": assessment_id,
        "initiativeName": "Lead scoring programme",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "selectedCardIds": [],
        "selectedRelationIndices": [],
    }


class TestCommit:
    @pytest.fixture
    async def assessment(self, db, env):
        row = TurboLensAssessment(
            title="T",
            requirement="Just this",
            session_data={"requirement": "Just this"},
            status="saved",
            created_by=env["admin"].id,
        )
        db.add(row)
        await db.flush()
        return row

    async def test_the_commit_runs_to_completion(
        self, db, client, env, assessment, patched_async_session
    ):
        resp = await client.post(
            f"{API}/architect/commit",
            json={**_commit_body(str(assessment.id)), "objectiveIds": [str(env["objective"].id)]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200, resp.text
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "completed" and run.analysis_type == "architect_commit"
        assert run.results["card_count"] == 0 and run.results["relation_count"] == 0

        initiative = (
            await db.execute(select(Card).where(Card.name == "Lead scoring programme"))
        ).scalar_one()
        assert initiative.type == "Initiative"
        assert str(initiative.id) == run.results["initiative_id"]
        assert assessment.status == "committed" and assessment.initiative_id == initiative.id
        linked = (
            await db.execute(
                select(Relation).where(
                    Relation.type == "relInitiativeToObjective",
                    Relation.source_id == initiative.id,
                )
            )
        ).scalar_one()
        assert linked.target_id == env["objective"].id

    async def test_a_failing_commit_marks_the_run_failed(
        self, db, client, env, assessment, monkeypatch, patched_async_session
    ):
        monkeypatch.setattr(
            "app.services.turbolens_commit.execute_commit",
            AsyncMock(side_effect=ValueError("boom")),
        )
        resp = await client.post(
            f"{API}/architect/commit",
            json=_commit_body(str(assessment.id)),
            headers=auth_headers(env["admin"]),
        )
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "failed" and run.error_message == "boom"
        assert assessment.status == "saved"

    async def test_unknown_or_committed_assessment(self, db, client, env, assessment):
        headers = auth_headers(env["admin"])
        resp = await client.post(
            f"{API}/architect/commit", json=_commit_body(str(uuid.uuid4())), headers=headers
        )
        assert resp.status_code == 404
        assessment.status = "committed"
        await db.flush()
        resp = await client.post(
            f"{API}/architect/commit", json=_commit_body(str(assessment.id)), headers=headers
        )
        assert resp.status_code == 409 and "already committed" in resp.json()["detail"]

    async def test_one_commit_at_a_time(self, db, client, env, assessment):
        await create_analysis_run(db, analysis_type="architect_commit", status="running")
        resp = await client.post(
            f"{API}/architect/commit",
            json=_commit_body(str(assessment.id)),
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 409

    async def test_denied_readers_and_viewers(self, client, env, assessment):
        body = _commit_body(str(assessment.id))
        resp = await client.post(
            f"{API}/architect/commit", json=body, headers=auth_headers(env["restricted"])
        )
        assert resp.status_code == 403 and "every card type" in resp.json()["detail"]
        resp = await client.post(
            f"{API}/architect/commit", json=body, headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403


# ── Compliance scan trigger ───────────────────────────────────────────────


class TestComplianceScan:
    async def test_an_unmatched_filter_completes_as_a_skipped_run(
        self, db, client, env, patched_async_session
    ):
        resp = await client.post(
            f"{COMPLIANCE}/compliance-scan",
            json={"regulations": ["nope"]},
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "completed" and run.analysis_type == "compliance"
        assert run.results["skipped_reason"] == "no_matching_enabled_regulations"
        assert run.results["regulations_requested"] == ["nope"]

    async def test_no_filter_scans_every_enabled_regulation(
        self, db, client, env, patched_async_session
    ):
        # An options object without ``regulations`` asks for every enabled one.
        resp = await client.post(
            f"{COMPLIANCE}/compliance-scan", json={}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200, resp.text
        run = await _run(db, resp.json()["run_id"])
        assert run.status == "completed"
        # Nothing is enabled on a bare install: the run still completes cleanly.
        assert run.results["regulations"] == [] and run.results["compliance_findings"] == 0
        assert run.results["cards_scanned"] == 2  # the two active Applications

    async def test_one_scan_at_a_time(self, db, client, env):
        await create_analysis_run(db, analysis_type="compliance", status="running")
        resp = await client.post(
            f"{COMPLIANCE}/compliance-scan", json={}, headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 409

    async def test_requires_compliance_manage(self, client, env):
        resp = await client.post(
            f"{COMPLIANCE}/compliance-scan", json={}, headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403


class TestActiveRuns:
    async def test_null_when_nothing_runs(self, db, client, env):
        await create_analysis_run(db, analysis_type="compliance", status="completed")
        await create_analysis_run(db, analysis_type="vendor_analysis", status="running")
        resp = await client.get(f"{COMPLIANCE}/active-runs", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 200 and resp.json() == {"compliance": None}

    async def test_the_running_scan(self, db, client, env):
        run = await create_analysis_run(
            db, analysis_type="compliance", status="running", results={"progress": {"p": 1}}
        )
        resp = await client.get(f"{COMPLIANCE}/active-runs", headers=auth_headers(env["viewer"]))
        body = resp.json()["compliance"]
        assert body["id"] == str(run.id) and body["status"] == "running"
        assert body["results"] == {"progress": {"p": 1}}

    async def test_requires_compliance_view(self, client, env):
        resp = await client.get(f"{COMPLIANCE}/active-runs", headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403


class TestComplianceOverview:
    async def test_empty(self, client, env):
        resp = await client.get(f"{COMPLIANCE}/overview", headers=auth_headers(env["viewer"]))
        assert resp.status_code == 200
        body = resp.json()
        assert body["compliance_run"]["run_id"] is None
        assert body["compliance_scores"] == {} and body["compliance_by_status"] == {}

    async def test_a_running_scan_reports_progress_not_a_summary(self, db, client, env):
        run = await create_analysis_run(
            db,
            analysis_type="compliance",
            status="running",
            results={"progress": {"phase": "regulation"}},
        )
        resp = await client.get(f"{COMPLIANCE}/overview", headers=auth_headers(env["viewer"]))
        latest = resp.json()["compliance_run"]
        assert latest["run_id"] == str(run.id) and latest["status"] == "running"
        assert latest["progress"] == {"phase": "regulation"} and latest["summary"] is None

    async def test_scores_and_status_counts_per_regulation(self, db, client, env):
        run = await create_analysis_run(
            db, analysis_type="compliance", status="completed", results={"scan": "compliance"}
        )
        await create_compliance_finding(db, run.id, regulation="gdpr", status="non_compliant")
        await create_compliance_finding(db, run.id, regulation="gdpr", status="compliant")
        await create_compliance_finding(db, run.id, regulation="nis2", status="partial")
        resp = await client.get(f"{COMPLIANCE}/overview", headers=auth_headers(env["viewer"]))
        body = resp.json()
        assert body["compliance_run"]["summary"] == {"scan": "compliance"}
        assert body["compliance_run"]["progress"] is None
        assert body["compliance_scores"] == {"gdpr": 50, "nis2": 50}
        assert body["compliance_by_status"] == {
            "gdpr": {"non_compliant": 1, "compliant": 1},
            "nis2": {"partial": 1},
        }

    async def test_requires_compliance_view(self, client, env):
        resp = await client.get(f"{COMPLIANCE}/overview", headers=auth_headers(env["nobody"]))
        assert resp.status_code == 403
