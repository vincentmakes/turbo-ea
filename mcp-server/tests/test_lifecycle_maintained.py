"""Lifecycle phases an installed extension maintains on a card.

While the lock holds, the backend refuses a write that changes one of those
phases with 403 ``detail.error == "lifecycle_maintained"``. The lifecycle
tools answer that with a plain refusal (never the ``pending`` /
missing-permission deep link, which no human could complete either), and
``transition_card_lifecycle`` refuses up front when the fetched card already
says the phase is maintained, so its preview is truthful.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from turbo_ea_mcp import server


@pytest.fixture
def fake_token(monkeypatch):
    monkeypatch.setattr(server, "_stdio_token", "test-token")
    yield "test-token"


def _http_error(status: int, detail: object) -> httpx.HTTPStatusError:
    request = httpx.Request("PATCH", "http://backend/api/v1/cards/c1")
    response = httpx.Response(status, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError(f"{status} error", request=request, response=response)


def _maintained_detail(**extra) -> dict:
    return {
        "error": "lifecycle_maintained",
        "message": "The End of Life date is maintained by Acme Sync.",
        "phases": ["endOfLife"],
        "extension": "Acme Sync",
        **extra,
    }


def _batch_post():
    calls: list[tuple[str, dict | None]] = []

    async def post(path, json=None):
        calls.append((path, json))
        if path.endswith("/commit"):
            return {"id": "B-1"}
        if path.startswith("/mutation-batches"):
            return {"id": "B-1", "dry_run": (json or {}).get("dry_run", False)}
        return {}

    return post, calls


class TestRefusalMessage:
    def test_names_the_phase_and_the_extension(self):
        out = server._lifecycle_maintained_refusal(["endOfLife"], "Acme Sync")
        assert out["error"] == "lifecycle_maintained"
        assert out["message"].startswith(
            "The End of Life date of this card is set automatically by an installed "
            "extension (Acme Sync) and cannot be set by hand while it is active."
        )
        assert out["phases"] == ["endOfLife"]
        assert out["extension"] == "Acme Sync"
        assert "cards" not in out

    def test_several_phases_and_cards(self):
        out = server._lifecycle_maintained_refusal(["active", "endOfLife"], "", cards=["c1", "c2"])
        assert out["message"].startswith(
            "The Active, End of Life dates of these cards are set automatically by an "
            "installed extension and cannot"
        )
        assert out["extension"] is None
        assert out["cards"] == ["c1", "c2"]

    def test_the_whole_message(self):
        out = server._lifecycle_maintained_refusal(["endOfLife"], "Acme Sync")
        assert out["message"] == (
            "The End of Life date of this card is set automatically by an installed "
            "extension (Acme Sync) and cannot be set by hand while it is active. Leave "
            "those phases out of the change, or ask an administrator to disable the "
            "extension's rule."
        )

    def test_an_unknown_phase_is_named_as_sent(self):
        out = server._lifecycle_maintained_refusal(["retired"], "Acme Sync")
        assert out["message"].startswith("The retired date of this card is set")
        assert out["phases"] == ["retired"]

    def test_no_phase_names_the_lifecycle(self):
        out = server._lifecycle_maintained_refusal([], "Acme Sync")
        assert out["message"].startswith("The lifecycle date of this card is set")
        assert out["phases"] == []

    def test_detail_is_recognised_only_on_a_lifecycle_403(self):
        assert server._lifecycle_maintained_detail(_http_error(403, _maintained_detail()))
        assert (
            server._lifecycle_maintained_detail(_http_error(403, "Not enough permissions")) is None
        )
        assert (
            server._lifecycle_maintained_detail(
                _http_error(403, {"error": "other", "message": "x"})
            )
            is None
        )
        assert server._lifecycle_maintained_detail(_http_error(409, _maintained_detail())) is None
        assert server._lifecycle_maintained_detail(ValueError("403")) is None


class TestTransitionCardLifecycle:
    @pytest.mark.asyncio
    async def test_preview_refuses_a_maintained_phase(self, fake_token):
        card = {
            "id": "c1",
            "lifecycle": {"endOfLife": "2030-01-01"},
            "lifecycle_maintained": {
                "ext": "acme-sync",
                "name": "Acme Sync",
                "phases": ["endOfLife"],
            },
        }
        post, calls = _batch_post()
        patch_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", AsyncMock(return_value=card)),
            patch.object(server.TurboEAClient, "patch", patch_mock),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.transition_card_lifecycle(
                    card_id="c1", target="endOfLife", effective_date="2031-01-01"
                )
            )
        patch_mock.assert_not_called()
        assert out["error"] == "lifecycle_maintained"
        assert "(Acme Sync)" in out["message"]
        assert out["phases"] == ["endOfLife"]
        assert out["card_id"] == "c1"
        assert out["batch_id"] == "B-1"
        assert "would_transition" not in out
        assert calls[-1] == (
            "/mutation-batches/B-1/commit",
            {"summary": {"card_id": "c1", "target": "endOfLife", "status": "refused"}},
        )

    @pytest.mark.asyncio
    async def test_commit_refuses_up_front_without_writing(self, fake_token):
        card = {
            "id": "c1",
            "lifecycle": {},
            "lifecycle_maintained": {"ext": "acme-sync", "name": "Acme Sync", "phases": ["active"]},
        }
        post, _calls = _batch_post()
        patch_mock = AsyncMock()
        with (
            patch.object(server.TurboEAClient, "get", AsyncMock(return_value=card)),
            patch.object(server.TurboEAClient, "patch", patch_mock),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.transition_card_lifecycle(card_id="c1", target="active", dry_run=False)
            )
        patch_mock.assert_not_called()
        assert out["error"] == "lifecycle_maintained"
        assert out["phases"] == ["active"]

    @pytest.mark.asyncio
    async def test_an_unmaintained_phase_is_still_written(self, fake_token):
        card = {
            "id": "c1",
            "lifecycle": {"endOfLife": "2030-01-01"},
            "lifecycle_maintained": {
                "ext": "acme-sync",
                "name": "Acme Sync",
                "phases": ["endOfLife"],
            },
        }
        post, _calls = _batch_post()
        patch_mock = AsyncMock(return_value={"id": "c1"})
        with (
            patch.object(server.TurboEAClient, "get", AsyncMock(return_value=card)),
            patch.object(server.TurboEAClient, "patch", patch_mock),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.transition_card_lifecycle(
                    card_id="c1", target="active", effective_date="2026-01-01", dry_run=False
                )
            )
        assert "error" not in out
        # The maintained End of Life is left out of the write: the backend
        # carries it over at its CURRENT value, which the extension may have
        # moved since the card was read.
        assert patch_mock.call_args[1]["json"] == {"lifecycle": {"active": "2026-01-01"}}

    @pytest.mark.asyncio
    async def test_preview_shows_the_stored_maintained_dates(self, fake_token):
        card = {
            "id": "c1",
            "lifecycle": {"plan": "2020-01-01", "endOfLife": "2030-01-01"},
            "lifecycle_maintained": {
                "ext": "acme-sync",
                "name": "Acme Sync",
                "phases": ["endOfLife"],
            },
        }
        post, _calls = _batch_post()
        with (
            patch.object(server.TurboEAClient, "get", AsyncMock(return_value=card)),
            patch.object(server.TurboEAClient, "patch", AsyncMock()),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.transition_card_lifecycle(
                    card_id="c1", target="active", effective_date="2026-01-01"
                )
            )
        assert out["would_transition"]["lifecycle_after"] == {
            "plan": "2020-01-01",
            "active": "2026-01-01",
            "endOfLife": "2030-01-01",
        }
        assert "lifecycle_note" not in out["would_transition"]

    @pytest.mark.asyncio
    async def test_preview_shows_the_date_the_backend_will_clamp_to(self, fake_token):
        card = {
            "id": "c1",
            "lifecycle": {"active": "2022-01-01", "endOfLife": "2030-01-01"},
            "lifecycle_maintained": {
                "ext": "acme-sync",
                "name": "Acme Sync",
                "phases": ["active", "endOfLife"],
            },
        }
        post, _calls = _batch_post()
        with (
            patch.object(server.TurboEAClient, "get", AsyncMock(return_value=card)),
            patch.object(server.TurboEAClient, "patch", AsyncMock()),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.transition_card_lifecycle(
                    card_id="c1", target="phaseOut", effective_date="2035-01-01"
                )
            )
        assert out["would_transition"]["lifecycle_after"]["phaseOut"] == "2030-01-01"
        assert out["would_transition"]["lifecycle_note"] == (
            "The Phase Out date was adjusted from 2035-01-01 to 2030-01-01 to stay in "
            "order with the dates an installed extension sets automatically on this card."
        )


class TestClampToMaintained:
    def test_an_undated_maintained_phase_sets_no_bound(self):
        # The first maintained phase has no date; a later one still bounds.
        assert server._clamp_to_maintained(
            {"active": "2025-01-01", "phaseOut": "2020-01-01"}, ["plan", "active"]
        ) == {"active": "2025-01-01", "phaseOut": "2025-01-01"}

    def test_lower_bound_is_the_latest_earlier_maintained_date(self):
        clamp = server._clamp_to_maintained
        lc = {"plan": "2020-01-01", "active": "2023-01-01", "phaseOut": "2021-01-01"}
        assert clamp(lc, ["plan", "active"])["phaseOut"] == "2023-01-01"
        lc = {"plan": "2023-01-01", "active": "2020-01-01", "phaseOut": "2021-01-01"}
        assert clamp(lc, ["plan", "active"])["phaseOut"] == "2023-01-01"

    def test_upper_bound_is_the_earliest_later_maintained_date(self):
        clamp = server._clamp_to_maintained
        lc = {"plan": "2031-01-01", "active": "2028-01-01", "endOfLife": "2026-01-01"}
        assert clamp(lc, ["active", "endOfLife"])["plan"] == "2026-01-01"
        lc = {"plan": "2031-01-01", "active": "2026-01-01", "endOfLife": "2028-01-01"}
        assert clamp(lc, ["active", "endOfLife"])["plan"] == "2026-01-01"

    def test_a_tie_keeps_the_earliest_phases_stored_value(self):
        clamp = server._clamp_to_maintained
        lc = {"plan": "2022-01-01", "active": "2022-01-01T00:00:00", "phaseOut": "2020-01-01"}
        assert clamp(lc, ["plan", "active"])["phaseOut"] == "2022-01-01"
        lc = {"plan": "2030-01-01", "active": "2025-01-01T00:00:00", "endOfLife": "2025-01-01"}
        assert clamp(lc, ["active", "endOfLife"])["plan"] == "2025-01-01T00:00:00"

    def test_a_date_equal_to_its_bound_is_kept_verbatim(self):
        clamp = server._clamp_to_maintained
        lc = {"active": "2022-01-01T00:00:00", "phaseOut": "2022-01-01"}
        assert clamp(lc, ["active"]) == lc
        lc = {"plan": "2025-01-01", "active": "2025-01-01T00:00:00"}
        assert clamp(lc, ["active"]) == lc

    def test_only_neighbours_on_the_right_side_bound(self):
        clamp = server._clamp_to_maintained
        # The phase just before bounds from below only.
        lc = {"active": "2022-01-01", "phaseOut": "2025-01-01"}
        assert clamp(lc, ["active"]) == lc
        # The phase just after bounds from above.
        assert clamp({"plan": "2030-01-01", "phaseIn": "2025-01-01"}, ["phaseIn"]) == {
            "plan": "2025-01-01",
            "phaseIn": "2025-01-01",
        }

    def test_mirrors_the_backend_rule(self):
        clamp = server._clamp_to_maintained
        # Lower bound: the latest maintained date of an earlier phase.
        assert clamp({"active": "2022-01-01", "phaseOut": "2020-01-01"}, ["active"]) == {
            "active": "2022-01-01",
            "phaseOut": "2022-01-01",
        }
        # Upper bound: the earliest maintained date of a later phase.
        assert (
            clamp(
                {"plan": "2031-01-01", "active": "2025-01-01", "endOfLife": "2030-01-01"},
                ["active", "endOfLife"],
            )["plan"]
            == "2025-01-01"
        )
        # Lower first, then upper: contradicting maintained dates, the later wins.
        assert (
            clamp(
                {"plan": "2030-01-01", "phaseIn": "2020-01-01", "active": "2025-01-01"},
                ["plan", "active"],
            )["phaseIn"]
            == "2025-01-01"
        )
        # In order, unreadable or no lock: untouched.
        lc = {"active": "2022-01-01", "phaseOut": "2025-01-01", "endOfLife": "x"}
        assert clamp(lc, ["endOfLife"]) == lc
        assert clamp({"phaseOut": "2000-01-01"}, []) == {"phaseOut": "2000-01-01"}
        assert (
            clamp({"active": "2022-01-01T00:00:00", "phaseOut": "2020-01-01"}, ["active"])[
                "phaseOut"
            ]
            == "2022-01-01T00:00:00"
        )

    @pytest.mark.asyncio
    async def test_a_backend_refusal_is_not_reported_as_pending(self, fake_token):
        # The card read did not show the lock (it took effect since); the
        # backend's 403 must read as the lifecycle refusal, not as a missing
        # permission with a deep link.
        post, _calls = _batch_post()
        with (
            patch.object(
                server.TurboEAClient, "get", AsyncMock(return_value={"id": "c1", "lifecycle": {}})
            ),
            patch.object(
                server.TurboEAClient,
                "patch",
                AsyncMock(side_effect=_http_error(403, _maintained_detail())),
            ),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.transition_card_lifecycle(
                    card_id="c1", target="endOfLife", dry_run=False
                )
            )
        assert out["error"] == "lifecycle_maintained"
        assert "status" not in out
        assert "deep_link" not in out
        assert out["extension"] == "Acme Sync"
        assert out["batch_id"] == "B-1"

    @pytest.mark.asyncio
    async def test_another_403_stays_pending(self, fake_token):
        post, _calls = _batch_post()
        with (
            patch.object(
                server.TurboEAClient, "get", AsyncMock(return_value={"id": "c1", "lifecycle": {}})
            ),
            patch.object(
                server.TurboEAClient,
                "patch",
                AsyncMock(side_effect=_http_error(403, "Not enough permissions")),
            ),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.transition_card_lifecycle(card_id="c1", target="active", dry_run=False)
            )
        assert out["status"] == "pending"
        assert out["reason"] == "missing_permission"


class TestUpdateCardsBulk:
    @pytest.mark.asyncio
    async def test_preview_refusal_names_phases_and_cards(self, fake_token):
        post, calls = _batch_post()
        err = _http_error(403, _maintained_detail(cards=["c2"]))
        with (
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=err)),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.update_cards_bulk(
                    updates=[
                        {"card_id": "c1", "lifecycle": {"endOfLife": "2031-01-01"}},
                        {"card_id": "c2", "lifecycle": {"endOfLife": "2031-01-01"}},
                    ]
                )
            )
        assert out["error"] == "lifecycle_maintained"
        assert out["cards"] == ["c2"]
        assert out["phases"] == ["endOfLife"]
        assert "these cards" in out["message"]
        assert out["dry_run"] is True
        assert "applied_card_ids" not in out
        assert calls[-1] == (
            "/mutation-batches/B-1/commit",
            {"summary": {"rows": 2, "status": "refused"}},
        )

    @pytest.mark.asyncio
    async def test_commit_reports_rows_already_applied(self, fake_token):
        post, _calls = _batch_post()
        responses = [{"updated": 1}, _http_error(403, _maintained_detail())]

        async def patch_router(path, json=None):
            item = responses.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        with (
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=patch_router)),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
        ):
            out = json.loads(
                await server.update_cards_bulk(
                    updates=[
                        {"card_id": "c1", "name": "Renamed"},
                        {"card_id": "c2", "lifecycle": {"endOfLife": "2031-01-01"}},
                    ],
                    dry_run=False,
                )
            )
        assert out["error"] == "lifecycle_maintained"
        # No `cards` in the detail: the refused group's own ids stand in.
        assert out["cards"] == ["c2"]
        assert out["applied_card_ids"] == ["c1"]
        assert out["dry_run"] is False

    @pytest.mark.asyncio
    async def test_another_error_still_raises(self, fake_token):
        post, _calls = _batch_post()
        err = _http_error(403, "Not enough permissions")
        with (
            patch.object(server.TurboEAClient, "patch", AsyncMock(side_effect=err)),
            patch.object(server.TurboEAClient, "post", AsyncMock(side_effect=post)),
            pytest.raises(httpx.HTTPStatusError),
        ):
            await server.update_cards_bulk(updates=[{"card_id": "c1", "name": "x"}])
