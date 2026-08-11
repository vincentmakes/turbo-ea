"""First coverage of extension startup wiring: context memoization.

``on_startup`` (startup.py), the job supervisor (jobs.py) and the event
dispatcher (events.py) all obtain their ExtensionContext through
``build_context`` — memoization is what guarantees they share ONE instance
per extension, so state an extension stashes at startup is visible from
its jobs and event handlers."""

from __future__ import annotations

from app.services.extensions.jobs import build_context, reset_contexts


class TestContextMemoization:
    def setup_method(self):
        reset_contexts()

    def teardown_method(self):
        reset_contexts()

    def test_same_key_returns_same_instance(self):
        assert build_context("jira-sync") is build_context("jira-sync")

    def test_different_keys_get_different_contexts(self):
        assert build_context("jira-sync") is not build_context("planner-sync")

    def test_reset_contexts_drops_cache(self):
        first = build_context("jira-sync")
        reset_contexts()
        assert build_context("jira-sync") is not first

    def test_context_carries_sdk_1_2_surfaces(self):
        ctx = build_context("jira-sync")
        assert ctx.todos is not None
        assert ctx.get_secret is not None
        assert ctx.set_secret is not None
        assert ctx.settings_namespace == "ext.jira-sync."

    def test_context_carries_sdk_1_4_batch_settings(self):
        ctx = build_context("jira-sync")
        assert ctx.get_settings is not None
        assert ctx.set_settings is not None
