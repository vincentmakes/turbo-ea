"""Every notification a person causes must name that person as the actor.

``create_notification`` drops a notification whose actor is its recipient
unless the type is in ``allow_self_types`` — but the check is only reachable
when the call site passes ``actor_id``. Thirteen sites did not, so the
suppression was dead code on those paths and people were told about their own
edits, signatures and rejections. That is invisible in behaviour tests of the
service (which pass an actor) and invisible in review, so it is guarded at the
source instead.

A system emitter has no actor by definition; those files are listed explicitly
rather than detected, so adding one is a deliberate act.
"""

from __future__ import annotations

import ast
import pathlib

APP = pathlib.Path(__file__).resolve().parents[2] / "app"

NOTIFY_FUNCS = {
    "create_notification",
    "create_notifications_for_subscribers",
    "deliver_notification_batch",
    "notify_all_users",
}

#: Emitters with no human actor: a scheduled scan, a release announcement, the
#: break-glass access path. Nothing to suppress, so nothing to pass.
SYSTEM_EMITTERS = {
    "api/v1/ops.py",  # ops_rescue_access — bypasses preferences by design
    "services/compliance_scanner.py",  # security_scan_complete — a scheduled run
    "services/update_check.py",  # app_update_available — a release poll
    "services/upgrade_announce.py",  # app_updated — announced to everyone
    "services/extension_store_check.py",  # extension_available — a catalogue poll
    "services/notification_service.py",  # the service's own internal fan-out
}

#: Types core deliberately sends to the actor (batch/admin actions, and
#: sign-offs where the record matters more than the noise). Passing the actor
#: on these changes nothing, so their call sites are not required to.
SELF_ALLOWED = {
    "survey_request",
    "todo_assigned",
    "task_assigned",
    "risk_assigned",
    "process_flow_approval_requested",
    "process_flow_approved",
    "process_flow_rejected",
    "process_flow_withdrawn",
}


def _notify_target(node: ast.Call) -> str | None:
    """The notification function this call reaches, direct or deferred.

    Two shapes matter beyond a plain call. ``notify_all_users`` is its own
    entry point, and a notification is sometimes handed to FastAPI to run
    later — ``background_tasks.add_task(deliver_notification_batch, …)`` —
    where the callee is an *argument*, so the call's own name is ``add_task``
    and a naive scan sees nothing at all.
    """
    fn = node.func
    name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
    if name in NOTIFY_FUNCS:
        return name
    if name == "add_task" and node.args:
        first = node.args[0]
        deferred = first.attr if isinstance(first, ast.Attribute) else getattr(first, "id", None)
        if deferred in NOTIFY_FUNCS:
            return deferred
    return None


def _call_sites():
    for path in sorted(APP.rglob("*.py")):
        rel = str(path.relative_to(APP))
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or _notify_target(node) is None:
                continue
            kwargs = {k.arg for k in node.keywords if k.arg}
            ntype = next(
                (
                    k.value.value
                    for k in node.keywords
                    if k.arg == "notif_type" and isinstance(k.value, ast.Constant)
                ),
                None,
            )
            yield rel, node.lineno, ntype, "actor_id" in kwargs


def test_every_human_caused_notification_passes_its_actor():
    offenders = [
        f"{rel}:{lineno} ({ntype})"
        for rel, lineno, ntype, has_actor in _call_sites()
        if not has_actor and rel not in SYSTEM_EMITTERS and ntype not in SELF_ALLOWED
    ]
    assert not offenders, (
        "these notifications cannot suppress a self-notification because they "
        "never say who acted — pass actor_id, or add the file to "
        "SYSTEM_EMITTERS if nobody acted:\n  " + "\n  ".join(offenders)
    )


def test_the_guard_is_actually_looking_at_something():
    """A pattern-matching guard that matches nothing passes for the wrong reason."""
    sites = list(_call_sites())
    assert len(sites) > 20, f"only found {len(sites)} notification call sites"
    assert any(has_actor for *_, has_actor in sites)
