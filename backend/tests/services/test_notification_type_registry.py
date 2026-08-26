"""The types the code emits and the types the registry knows must agree.

``NOTIFICATION_TYPE_SPECS`` (``app/models/user.py``) is what the preferences
dialog renders and what every channel resolves a per-type opt-in against. An
extension channel has **no** per-type default — it is always opt-in-off — so a
type the registry has never heard of cannot be switched on for it at all. A
missing entry is therefore not untidiness: it is a notification that can never
be delivered anywhere but the bell, with nothing anywhere to say so.

Emitted-but-unregistered fails. Registered-but-never-emitted only reports: a
type may legitimately be emitted from a variable, and the registry is allowed
to run ahead of the code.
"""

from __future__ import annotations

import ast
import pathlib

from app.models.user import NOTIFICATION_TYPE_SPECS

APP = pathlib.Path(__file__).resolve().parents[2] / "app"
NOTIFY_FUNCS = {
    "create_notification",
    "create_notifications_for_subscribers",
    "deliver_notification_batch",
    "notify_all_users",
}
REGISTERED = {spec.key for spec in NOTIFICATION_TYPE_SPECS}


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


def _module_constants(tree: ast.Module) -> dict[str, str]:
    """Module-level ``NAME = "literal"`` bindings.

    The announcement emitters pass a constant rather than a literal
    (``NOTIFICATION_TYPE = "app_updated"``), so a literals-only scan would
    silently report them as unemitted and hide a genuine gap among the noise.
    """
    out: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            if isinstance(node.value.value, str):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        out[target.id] = node.value.value
    return out


def _emitted() -> dict[str, list[str]]:
    """notif_type values — literals, and module constants resolved to theirs."""
    found: dict[str, list[str]] = {}
    for path in sorted(APP.rglob("*.py")):
        rel = str(path.relative_to(APP))
        tree = ast.parse(path.read_text())
        consts = _module_constants(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or _notify_target(node) is None:
                continue
            for kw in node.keywords:
                if kw.arg != "notif_type":
                    continue
                value = None
                if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    value = kw.value.value
                elif isinstance(kw.value, ast.Name):
                    value = consts.get(kw.value.id)
                if value:
                    found.setdefault(value, []).append(f"{rel}:{node.lineno}")
    return found


def test_every_emitted_type_is_registered():
    emitted = _emitted()
    unknown = {t: where for t, where in emitted.items() if t not in REGISTERED}
    assert not unknown, (
        "these types are emitted but missing from NOTIFICATION_TYPE_SPECS, so no "
        "user can switch them on for any channel beyond the bell:\n  "
        + "\n  ".join(f"{t} — {', '.join(w)}" for t, w in sorted(unknown.items()))
    )


def test_the_scan_finds_the_types_we_know_are_there():
    """Guard the guard: a scan matching nothing would pass silently."""
    emitted = _emitted()
    assert {"card_updated", "comment_added", "todo_assigned"} <= set(emitted)


def test_report_registered_but_never_emitted_literally(capsys):
    """Reported, never failed — a type may be emitted from a computed value."""
    unused = sorted(REGISTERED - set(_emitted()))
    with capsys.disabled():
        if unused:
            print(
                f"\n  [registry report] {len(unused)} registered type(s) with no literal "
                f"emitter in app/:\n    " + "\n    ".join(unused)
            )
