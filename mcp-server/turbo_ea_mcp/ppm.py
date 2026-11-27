"""The pure logic of the PPM tools (discussion 1457).

PPM — work packages and milestones, tasks, dependencies, status reports,
project risks and task comments — is a built-in module, so the MCP tools call
its ordinary REST routes (``backend/app/api/v1/ppm.py``) with the user's token
and every invariant (roll-ups, the task's to-do, notifications, the cycle
check) stays in the backend. What lives here is what the wrapper must decide
before it sends anything: the closed key set of each kind of row, the literals
mirrored from ``backend/app/schemas/ppm.py`` (the schemas ignore a key they do
not declare, so the wrapper must refuse it), the old → new diff a preview
shows, the payloads a commit sends, the trimmed shape of what comes back and
the structured refusal a 4xx stands for.

Standard library only, and no backend import (``tests/test_no_backend_imports``).
The decorated tools in ``server.py`` stay thin; mutmut skips decorated
functions, so the logic worth mutation-testing is kept in these plain helpers.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import date

# ── Literals mirrored from backend/app/schemas/ppm.py ──────────────────────

TASK_STATUSES = ("todo", "in_progress", "done", "blocked")
TASK_PRIORITIES = ("critical", "high", "medium", "low")
HEALTH_VALUES = ("onTrack", "atRisk", "offTrack")
RISK_STATUSES = ("open", "mitigating", "mitigated", "closed", "accepted")
DEPENDENCY_KINDS = ("task", "wbs")
#: The one dependency type the backend has: finish-to-start.
DEPENDENCY_TYPE = "FS"
SCORE_MIN = 1
SCORE_MAX = 5
COMPLETION_MIN = 0
COMPLETION_MAX = 100
COMMENT_MAX_LENGTH = 10000

#: The HTTP statuses a PPM route answers for the caller's input or rights:
#: handed back as a structured refusal, never raised.
REFUSAL_STATUSES = (400, 403, 404, 409, 422)

_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")

# ── Field kinds ─────────────────────────────────────────────────────────────
#
# A kind names how one key of a row is checked. ``None`` is accepted only by
# the nullable kinds, whose column may be empty; a ``null`` sent for a
# required column would be a 500 in the backend, so it is refused here.

TITLE = "title"  # a non-blank string, stored stripped
TEXT = "text"  # a string, or null to clear it
DATE = "date"  # YYYY-MM-DD, or null to clear it
REQUIRED_DATE = "required_date"  # YYYY-MM-DD, never null
REF_ID = "ref_id"  # a UUID, or "" / null to clear it
SCORE = "score"  # an integer 1-5
COMPLETION = "completion"  # a number 0-100
ORDER = "order"  # an integer
FLAG = "flag"  # true or false
TAGS = "tags"  # a list of strings


@dataclass(frozen=True)
class Choice:
    """A key that takes one of ``values`` (never null)."""

    values: tuple[str, ...]


@dataclass(frozen=True)
class Entity:
    """One kind of PPM row the save tools write.

    ``collection`` is the segment of ``/ppm/initiatives/{id}/<collection>``
    (list and create); ``item`` the segment of ``/ppm/<item>/{id}`` (update).
    ``dates`` is the ``(start, end)`` pair a row may not invert."""

    label: str
    collection: str
    item: str
    tab: str
    fields: dict[str, object]
    required: tuple[str, ...]
    keys: tuple[str, ...]
    dates: tuple[str, str] | None = None
    local_keys: frozenset[str] = field(default_factory=frozenset)


WORK_PACKAGE_KEYS = (
    "id",
    "parent_id",
    "title",
    "description",
    "start_date",
    "end_date",
    "is_milestone",
    "completion",
    "progress",
    "assignee_id",
    "assignee_name",
    "sort_order",
    "task_count",
)
TASK_KEYS = (
    "id",
    "wbs_id",
    "title",
    "description",
    "status",
    "priority",
    "assignee_id",
    "assignee_name",
    "start_date",
    "due_date",
    "sort_order",
    "tags",
    "comment_count",
)
DEPENDENCY_KEYS = ("id", "pred_kind", "pred_id", "succ_kind", "succ_id", "kind")
REPORT_KEYS = (
    "id",
    "report_date",
    "schedule_health",
    "cost_health",
    "scope_health",
    "summary",
    "accomplishments",
    "next_steps",
    "reporter",
    "created_at",
    "updated_at",
)
RISK_KEYS = (
    "id",
    "title",
    "description",
    "probability",
    "impact",
    "risk_score",
    "mitigation",
    "owner_id",
    "owner_name",
    "status",
)
COMMENT_KEYS = ("id", "user_id", "user_display_name", "content", "created_at", "updated_at")

WORK_PACKAGES = Entity(
    label="work package",
    collection="wbs",
    item="wbs",
    tab="gantt",
    fields={
        "title": TITLE,
        "description": TEXT,
        "parent_id": REF_ID,
        "start_date": DATE,
        "end_date": DATE,
        "sort_order": ORDER,
        "is_milestone": FLAG,
        "completion": COMPLETION,
        "assignee_id": REF_ID,
    },
    required=("title",),
    keys=WORK_PACKAGE_KEYS,
    dates=("start_date", "end_date"),
    local_keys=frozenset({"ref", "parent_ref"}),
)
TASKS = Entity(
    label="task",
    collection="tasks",
    item="tasks",
    tab="tasks",
    fields={
        "title": TITLE,
        "description": TEXT,
        "status": Choice(TASK_STATUSES),
        "priority": Choice(TASK_PRIORITIES),
        "assignee_id": REF_ID,
        "start_date": DATE,
        "due_date": DATE,
        "sort_order": ORDER,
        "tags": TAGS,
        "wbs_id": REF_ID,
    },
    required=("title",),
    keys=TASK_KEYS,
    dates=("start_date", "due_date"),
)
STATUS_REPORTS = Entity(
    label="status report",
    collection="reports",
    item="reports",
    tab="reports",
    fields={
        "report_date": REQUIRED_DATE,
        "schedule_health": Choice(HEALTH_VALUES),
        "cost_health": Choice(HEALTH_VALUES),
        "scope_health": Choice(HEALTH_VALUES),
        "summary": TEXT,
        "accomplishments": TEXT,
        "next_steps": TEXT,
    },
    required=("report_date",),
    keys=REPORT_KEYS,
)
RISKS = Entity(
    label="risk",
    collection="risks",
    item="risks",
    tab="risks",
    fields={
        "title": TITLE,
        "description": TEXT,
        "probability": SCORE,
        "impact": SCORE,
        "mitigation": TEXT,
        "owner_id": REF_ID,
        "status": Choice(RISK_STATUSES),
    },
    required=("title",),
    keys=RISK_KEYS,
)


# ── Ids, links, small checks ────────────────────────────────────────────────


def canonical_uuid(value: object) -> str | None:
    """``value`` as a canonical UUID string, or None when it is not one."""
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def normalise_ids(ids: dict[str, object]) -> tuple[dict[str, str], dict | None]:
    """``(normalised, refusal)`` for the ids a tool puts in a backend path.

    Every id is checked as a UUID before any backend call and used from there
    on in its canonical form, so a value such as ``x/../../cards/<id>`` can
    never aim a write at another route."""
    normalised: dict[str, str] = {}
    for name, value in ids.items():
        canonical = canonical_uuid(value)
        if canonical is None:
            return {}, {
                "error": "invalid_id",
                "parameter": name,
                "message": (
                    f"{name} must be a UUID. search_cards with type='Initiative' "
                    "finds an initiative; get_ppm_plan lists its work packages "
                    "and tasks."
                ),
            }
        normalised[name] = canonical
    return normalised, None


def ppm_path(initiative_id: str, tab: str) -> str:
    """The web app's page for one initiative's PPM tab."""
    return f"/ppm/{initiative_id}?tab={tab}"


def iso_date(value: object) -> str | None:
    """``value`` when it is a real ``YYYY-MM-DD`` date, else None."""
    if not isinstance(value, str) or not _ISO_DATE.fullmatch(value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def clamp_limit(limit: object, low: int = 1, high: int = 100) -> int:
    """``limit`` clamped to ``low..high``; a non-integer reads as ``low``."""
    if isinstance(limit, bool) or not isinstance(limit, int):
        return low
    return max(low, min(high, limit))


def disabled_refusal(answer: object) -> dict | None:
    """The refusal ``GET /settings/ppm-enabled`` stands for, else None.

    The PPM routes do not check the module switch themselves (only the web app
    does), so every PPM tool asks first and stops when it is off."""
    if isinstance(answer, dict) and answer.get("enabled") is True:
        return None
    return {
        "error": "ppm_disabled",
        "message": (
            "The PPM module is switched off on this Turbo EA instance. An "
            "administrator can switch it on under Settings; until then the "
            "PPM tools read and write nothing."
        ),
    }


def cap_refusal(count: int, cap: int) -> dict | None:
    """The refusal for a call naming more rows than ``cap``, else None."""
    if count <= cap:
        return None
    return {
        "error": "batch_too_large",
        "message": (
            f"This call names {count} rows but the MCP per-call cap is {cap} "
            "(MCP_MAX_PPM_ROWS_PER_CALL). Split it into several calls."
        ),
        "cap": cap,
        "received": count,
    }


def refusal(status_code: int, detail: object, error: str) -> dict | None:
    """A 400 / 403 / 404 / 409 / 422 from a PPM route as a structured answer
    carrying the backend's ``detail`` as it is; None for any other status,
    which the caller re-raises."""
    if status_code not in REFUSAL_STATUSES:
        return None
    return {"error": error, "status_code": status_code, "detail": detail}


# ── Trimming and ordering what the backend returns ─────────────────────────


def trim(row: object, keys: tuple[str, ...]) -> dict:
    """``row`` reduced to ``keys`` (a missing key reads as None)."""
    source = row if isinstance(row, dict) else {}
    return {key: source.get(key) for key in keys}


def trim_rows(rows: object, keys: tuple[str, ...]) -> list[dict]:
    """Every dict of ``rows`` trimmed to ``keys``; anything else is dropped."""
    if not isinstance(rows, list):
        return []
    return [trim(row, keys) for row in rows if isinstance(row, dict)]


def newest_first(rows: list[dict], key: str) -> list[dict]:
    """``rows`` with the latest ``key`` first (a missing value sorts last)."""
    return sorted(rows, key=lambda row: str(row.get(key) or ""), reverse=True)


def oldest_first(rows: list[dict], key: str) -> list[dict]:
    """``rows`` with the earliest ``key`` first."""
    return sorted(rows, key=lambda row: str(row.get(key) or ""))


def highest_score_first(rows: list[dict]) -> list[dict]:
    """Risks with the highest ``risk_score`` first; ties keep their order."""

    def score(row: dict) -> int:
        value = row.get("risk_score")
        return value if isinstance(value, int) and not isinstance(value, bool) else 0

    return sorted(rows, key=score, reverse=True)


def label_dependencies(deps: list[dict], tasks: list[dict], packages: list[dict]) -> list[dict]:
    """Each trimmed dependency with the title of both of its ends, so a reader
    need not look the ids up (an end not found reads as None)."""
    titles = {("task", row.get("id")): row.get("title") for row in tasks}
    titles.update({("wbs", row.get("id")): row.get("title") for row in packages})
    return [
        {
            **dep,
            "pred_title": titles.get((dep.get("pred_kind"), dep.get("pred_id"))),
            "succ_title": titles.get((dep.get("succ_kind"), dep.get("succ_id"))),
        }
        for dep in deps
    ]


def plan_counts(packages: list[dict], tasks: list[dict]) -> dict:
    """How many work packages, milestones and tasks a plan holds, and how many
    tasks are done."""
    milestones = sum(1 for row in packages if row.get("is_milestone") is True)
    return {
        "work_packages": len(packages) - milestones,
        "milestones": milestones,
        "tasks": len(tasks),
        "tasks_done": sum(1 for row in tasks if row.get("status") == "done"),
    }


# ── Checking one value ──────────────────────────────────────────────────────


def check_value(kind: object, value: object) -> tuple[object, str | None]:
    """``(value to send, problem)`` for one key of a row; ``problem`` is None
    when the value is acceptable."""
    if isinstance(kind, Choice):
        if isinstance(value, str) and value in kind.values:
            return value, None
        return None, f"takes one of {', '.join(kind.values)}"
    if kind == TITLE:
        if isinstance(value, str) and value.strip():
            return value.strip(), None
        return None, "must be a non-blank string"
    if kind == TEXT:
        if value is None or isinstance(value, str):
            return value, None
        return None, "must be a string, or null to clear it"
    if kind == DATE:
        if value is None or iso_date(value) is not None:
            return value, None
        return None, "must be a date as YYYY-MM-DD, or null to clear it"
    if kind == REQUIRED_DATE:
        if iso_date(value) is not None:
            return value, None
        return None, "must be a date as YYYY-MM-DD"
    if kind == REF_ID:
        if value is None or value == "":
            return None, None
        canonical = canonical_uuid(value)
        if canonical is not None:
            return canonical, None
        return None, 'must be a UUID, or "" / null to clear it'
    if kind == SCORE:
        if isinstance(value, int) and not isinstance(value, bool):
            if SCORE_MIN <= value <= SCORE_MAX:
                return value, None
        return None, f"must be an integer from {SCORE_MIN} to {SCORE_MAX}"
    if kind == COMPLETION:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if COMPLETION_MIN <= value <= COMPLETION_MAX:
                return value, None
        return None, f"must be a number from {COMPLETION_MIN} to {COMPLETION_MAX}"
    if kind == ORDER:
        if isinstance(value, int) and not isinstance(value, bool):
            return value, None
        return None, "must be an integer"
    if kind == FLAG:
        if isinstance(value, bool):
            return value, None
        return None, "must be true or false"
    if kind == TAGS:
        if isinstance(value, list) and all(isinstance(tag, str) for tag in value):
            return list(value), None
        return None, "must be a list of strings"
    return None, "is not a field this tool writes"


def check_comment(content: object) -> tuple[str, dict | None]:
    """``(content, refusal)`` for a task comment: 1 to 10 000 characters and
    not blank, as ``PpmTaskCommentCreate`` takes it."""
    if not isinstance(content, str) or not content.strip():
        return "", {
            "error": "invalid_value",
            "field": "content",
            "message": "content must be a non-blank string.",
        }
    if len(content) > COMMENT_MAX_LENGTH:
        return "", {
            "error": "invalid_value",
            "field": "content",
            "length": len(content),
            "message": f"content takes at most {COMMENT_MAX_LENGTH} characters.",
        }
    return content, None


# ── Validating the items of a save call ─────────────────────────────────────


def _row_error(error: str, index: int, message: str, **extra: object) -> dict:
    return {"error": error, "index": index, **extra, "message": message}


def validate_item(item: object, index: int, entity: Entity) -> tuple[dict, list[dict]]:
    """``(row, errors)`` for one item of a save call.

    ``row`` is ``{"index", "id", "fields"}`` plus ``ref`` / ``parent_ref``
    for a work package: ``id`` the canonical id of the row to update (None
    to create one) and ``fields`` the checked values, keyed as the backend
    takes them."""
    if not isinstance(item, dict):
        return {}, [_row_error("invalid_row", index, "Each item must be an object.")]
    allowed = {"id", *entity.fields, *entity.local_keys}
    errors: list[dict] = []
    row: dict = {"index": index, "id": None, "fields": {}}
    for key, value in item.items():
        if key not in allowed:
            errors.append(
                _row_error(
                    "unknown_field",
                    index,
                    "Unknown keys are refused, never silently dropped.",
                    field=key,
                    allowed_fields=sorted(allowed),
                )
            )
        elif key == "id":
            row["id"] = canonical_uuid(value)
            if row["id"] is None:
                errors.append(
                    _row_error(
                        "invalid_value",
                        index,
                        f"id must be the UUID of an existing {entity.label}; "
                        "leave it out to create one.",
                        field="id",
                    )
                )
        elif key in entity.local_keys:
            if not isinstance(value, str) or not value.strip():
                errors.append(
                    _row_error(
                        "invalid_value", index, f"{key} must be a non-blank string.", field=key
                    )
                )
            else:
                row[key] = value
        else:
            checked, problem = check_value(entity.fields[key], value)
            if problem is not None:
                errors.append(
                    _row_error("invalid_value", index, f"{key} {problem}.", field=key, value=value)
                )
            else:
                row["fields"][key] = checked
    if errors:
        return row, errors
    is_update = "id" in item
    if is_update and not row["fields"] and "parent_ref" not in row:
        errors.append(_row_error("invalid_row", index, "An update must name a field to change."))
    if not is_update:
        missing = [key for key in entity.required if key not in row["fields"]]
        if missing:
            errors.append(
                _row_error(
                    "invalid_row",
                    index,
                    f"A new {entity.label} needs {', '.join(missing)}.",
                    missing=missing,
                )
            )
    if is_update and "ref" in row:
        errors.append(
            _row_error("invalid_row", index, "ref names a new item; an update has its id.")
        )
    if "parent_ref" in row and "parent_id" in row["fields"]:
        errors.append(_row_error("invalid_row", index, "Give parent_id or parent_ref, not both."))
    if row["fields"].get("is_milestone") is True and "end_date" in row["fields"]:
        errors.append(
            _row_error(
                "invalid_row",
                index,
                "A milestone has one date: set start_date only; its end_date "
                "is always its start_date.",
            )
        )
    if entity.dates is not None:
        start, end = (row["fields"].get(key) for key in entity.dates)
        if start and end and start > end:
            errors.append(
                _row_error(
                    "invalid_row",
                    index,
                    f"{entity.dates[0]} ({start}) is after {entity.dates[1]} ({end}).",
                )
            )
    return row, errors


def validate_items(items: object, entity: Entity) -> tuple[list[dict], list[dict]]:
    """``(rows, errors)`` for a save call's whole ``items`` argument.

    Beyond each item's own check: an ``id`` named twice is ``duplicate_id``,
    a ``ref`` named twice ``duplicate_ref``, and a ``parent_ref`` must name
    the ``ref`` of an earlier item of the same call (``unknown_ref``)."""
    if not isinstance(items, list) or not items:
        return [], [
            {"error": "invalid_row", "index": None, "message": "items must be a non-empty list."}
        ]
    rows: list[dict] = []
    errors: list[dict] = []
    seen_ids: dict[str, int] = {}
    seen_refs: dict[str, int] = {}
    for index, item in enumerate(items):
        row, row_errors = validate_item(item, index, entity)
        rid = row.get("id")
        if rid is not None:
            first = seen_ids.setdefault(rid, index)
            if first != index:
                row_errors.append(
                    _row_error(
                        "duplicate_id",
                        index,
                        f"This id is already item {first}; give each row once.",
                        id=rid,
                    )
                )
        parent_ref = row.get("parent_ref")
        if parent_ref is not None and parent_ref not in seen_refs:
            row_errors.append(
                _row_error(
                    "unknown_ref",
                    index,
                    "parent_ref must be the ref of an earlier item of this call.",
                    parent_ref=parent_ref,
                )
            )
        ref = row.get("ref")
        if ref is not None:
            first = seen_refs.setdefault(ref, index)
            if first != index:
                row_errors.append(
                    _row_error("duplicate_ref", index, f"ref is already item {first}'s.", ref=ref)
                )
        rows.append(row)
        errors += row_errors
    return rows, errors


# ── Checking the items against the initiative's current rows ───────────────


def _comparable(value: object) -> object:
    canonical = canonical_uuid(value)
    return canonical if canonical is not None else value


def diff_changes(fields: dict, current: dict) -> dict:
    """``{key: {"old", "new"}}`` for every key of ``fields`` whose value
    differs from the stored row's."""
    changes: dict = {}
    for key, new in fields.items():
        old = current.get(key)
        if _comparable(old) != _comparable(new):
            changes[key] = {"old": old, "new": new}
    return changes


def unknown_id_errors(rows: list[dict], current: dict[str, dict], entity: Entity) -> list[dict]:
    """``unknown_id`` for each update whose id is not a row of this initiative."""
    return [
        _row_error(
            "unknown_id",
            row["index"],
            f"This id is not a {entity.label} of this initiative; get_ppm_plan "
            "and the list tools give the ids.",
            id=row["id"],
        )
        for row in rows
        if row.get("id") is not None and row["id"] not in current
    ]


def work_package_errors(rows: list[dict], packages: dict[str, dict]) -> list[dict]:
    """A ``parent_id`` that is not a work package of this initiative, or the
    row itself; an ``end_date`` for a row that is a milestone after the call."""
    errors: list[dict] = []
    for row in rows:
        fields = row["fields"]
        parent = fields.get("parent_id")
        if parent is not None and parent == row.get("id"):
            errors.append(
                _row_error(
                    "invalid_value", row["index"], "A work package cannot be its own parent."
                )
            )
        elif parent is not None and parent not in packages:
            errors.append(
                _row_error(
                    "unknown_ref",
                    row["index"],
                    "parent_id is not a work package of this initiative.",
                    field="parent_id",
                    value=parent,
                )
            )
        current = packages.get(row.get("id") or "", {})
        milestone = fields.get("is_milestone", current.get("is_milestone") is True)
        if milestone and "end_date" in fields and "is_milestone" not in fields:
            errors.append(
                _row_error(
                    "invalid_row",
                    row["index"],
                    "This work package is a milestone: set its start_date; its "
                    "end_date is always its start_date.",
                )
            )
    return errors


def task_errors(rows: list[dict], packages: dict[str, dict]) -> list[dict]:
    """A ``wbs_id`` that is not a work package of this initiative, or is a
    milestone (a milestone holds no tasks)."""
    errors: list[dict] = []
    for row in rows:
        wbs_id = row["fields"].get("wbs_id")
        if wbs_id is None:
            continue
        package = packages.get(wbs_id)
        if package is None:
            errors.append(
                _row_error(
                    "unknown_ref",
                    row["index"],
                    "wbs_id is not a work package of this initiative; save the "
                    "work package first with save_ppm_work_packages.",
                    field="wbs_id",
                    value=wbs_id,
                )
            )
        elif package.get("is_milestone") is True:
            errors.append(
                _row_error(
                    "invalid_value",
                    row["index"],
                    "wbs_id is a milestone; a task sits in a work package.",
                    field="wbs_id",
                    value=wbs_id,
                )
            )
    return errors


def milestone_fields(fields: dict, current: dict) -> dict:
    """``fields`` with a milestone's ``end_date`` set to its start date, as the
    web app's work-package dialog saves one; anything else unchanged."""
    milestone = fields.get("is_milestone", current.get("is_milestone") is True)
    if milestone is not True:
        return fields
    if "start_date" not in fields and "is_milestone" not in fields:
        return fields
    return {**fields, "end_date": fields.get("start_date", current.get("start_date"))}


def plan_saves(
    rows: list[dict], current: dict[str, dict], *, milestones: bool = False
) -> list[dict]:
    """The plan of a save call: per row ``action`` create, update or
    unchanged, with the ``fields`` a create sends, or the ``changes`` (old →
    new) an update sends. ``milestones`` applies the milestone date rule."""
    plan: list[dict] = []
    for row in rows:
        rid = row.get("id")
        stored = current.get(rid, {}) if rid is not None else {}
        fields = milestone_fields(row["fields"], stored) if milestones else row["fields"]
        local = {key: row[key] for key in ("ref", "parent_ref") if key in row}
        if rid is None:
            plan.append({"index": row["index"], "action": "create", "fields": fields, **local})
            continue
        changes = diff_changes(fields, stored)
        if "parent_ref" in row:
            changes["parent_id"] = {
                "old": stored.get("parent_id"),
                "new": {"ref": row["parent_ref"]},
            }
        entry = {"index": row["index"], "id": rid, "title": stored.get("title")}
        if changes:
            plan.append({**entry, "action": "update", "changes": changes, **local})
        else:
            plan.append({**entry, "action": "unchanged"})
    return plan


def request_body(entry: dict, created: dict[str, str]) -> dict:
    """The JSON body one plan entry sends: a create's fields, or only the
    changed keys of an update; a ``parent_ref`` becomes the ``parent_id`` of
    the item created under that ref earlier in the run."""
    if entry["action"] == "create":
        body = dict(entry["fields"])
    else:
        body = {key: change["new"] for key, change in entry["changes"].items()}
    if "parent_ref" in entry:
        body["parent_id"] = created[entry["parent_ref"]]
    return body


def plan_refusal(errors: list[dict]) -> dict | None:
    """The refusal a list of row errors stands for, else None. An unknown id
    names the top-level error, since it says the call aims at another
    initiative's rows."""
    if not errors:
        return None
    unknown = any(error.get("error") == "unknown_id" for error in errors)
    return {
        "error": "unknown_id" if unknown else "invalid_items",
        "errors": errors,
        "message": "Nothing was saved. Fix the items listed and call again.",
    }


def plan_tally(plan: list[dict]) -> dict:
    """How many entries of a plan each action has."""
    return {
        action: sum(1 for entry in plan if entry["action"] == action)
        for action in ("create", "update", "unchanged")
    }


def index_rows(rows: object) -> dict[str, dict]:
    """The dict rows of a backend list keyed by their canonical id."""
    indexed: dict[str, dict] = {}
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and canonical_uuid(row.get("id")) is not None:
            indexed[canonical_uuid(row.get("id"))] = row
    return indexed


# ── Dependencies ────────────────────────────────────────────────────────────

_DEPENDENCY_ENTRY_KEYS = ("pred_kind", "pred_id", "succ_kind", "succ_id")


def link_key(entry: dict) -> tuple:
    """What makes two dependency links the same link."""
    return tuple(entry.get(key) for key in _DEPENDENCY_ENTRY_KEYS)


def dependency_entry(raw: object, index: int) -> tuple[dict, list[dict]]:
    """``(entry, errors)`` for one ``add`` entry: exactly the four keys, the
    two kinds ``task`` / ``wbs``, two UUIDs, and not a row depending on itself."""
    if not isinstance(raw, dict):
        return {}, [_row_error("invalid_row", index, "Each add entry must be an object.")]
    errors: list[dict] = []
    unknown = sorted(set(raw) - set(_DEPENDENCY_ENTRY_KEYS))
    if unknown:
        errors.append(
            _row_error(
                "unknown_field",
                index,
                "Unknown keys are refused; every link is finish-to-start.",
                fields=unknown,
                allowed_fields=list(_DEPENDENCY_ENTRY_KEYS),
            )
        )
    entry: dict = {}
    for side in ("pred", "succ"):
        kind = raw.get(f"{side}_kind")
        if kind not in DEPENDENCY_KINDS:
            errors.append(
                _row_error(
                    "invalid_value",
                    index,
                    f"{side}_kind takes one of {', '.join(DEPENDENCY_KINDS)}.",
                    field=f"{side}_kind",
                )
            )
        ident = canonical_uuid(raw.get(f"{side}_id"))
        if ident is None:
            errors.append(
                _row_error(
                    "invalid_value",
                    index,
                    f"{side}_id must be the UUID of a task or work package.",
                    field=f"{side}_id",
                )
            )
        entry[f"{side}_kind"] = kind
        entry[f"{side}_id"] = ident
    if not errors and link_key(entry)[:2] == link_key(entry)[2:]:
        errors.append(_row_error("invalid_row", index, "A row cannot depend on itself."))
    return entry, errors


def dependency_changes(add: object, remove: object) -> tuple[list[dict], list[str], list[dict]]:
    """``(adds, removes, errors)`` for ``set_ppm_dependencies``' arguments."""
    adds: list[dict] = []
    removes: list[str] = []
    errors: list[dict] = []
    add = [] if add is None else add
    remove = [] if remove is None else remove
    if not isinstance(add, list) or not isinstance(remove, list):
        return (
            [],
            [],
            [{"error": "invalid_row", "index": None, "message": "add and remove must be lists."}],
        )
    if not add and not remove:
        return (
            [],
            [],
            [
                {
                    "error": "invalid_row",
                    "index": None,
                    "message": "Give at least one add or remove.",
                }
            ],
        )
    seen: dict[tuple, int] = {}
    for index, raw in enumerate(add):
        entry, entry_errors = dependency_entry(raw, index)
        if not entry_errors:
            first = seen.setdefault(link_key(entry), index)
            if first != index:
                entry_errors.append(
                    _row_error("duplicate_link", index, f"This link is already add entry {first}.")
                )
        errors += [{**error, "list": "add"} for error in entry_errors]
        adds.append(entry)
    for index, raw in enumerate(remove):
        dep_id = canonical_uuid(raw)
        if dep_id is None:
            errors.append(
                {
                    **_row_error("invalid_value", index, "Each remove entry is a dependency UUID."),
                    "list": "remove",
                }
            )
        elif dep_id in removes:
            errors.append(
                {
                    **_row_error("duplicate_id", index, "This dependency is already removed."),
                    "list": "remove",
                }
            )
        removes.append(dep_id or "")
    return adds, removes, errors


def dependency_plan(
    adds: list[dict],
    removes: list[str],
    deps: dict[str, dict],
    tasks: dict[str, dict],
    packages: dict[str, dict],
) -> tuple[list[dict], list[dict], list[dict]]:
    """``(add_plan, remove_plan, errors)`` against the initiative's rows.

    Both ends of an added link must be rows of this initiative and a removed
    id one of its dependencies (``unknown_id``). A link already present, and
    not removed by the same call, is reported ``exists`` and not sent."""
    errors: list[dict] = []
    remove_plan: list[dict] = []
    for index, dep_id in enumerate(removes):
        dep = deps.get(dep_id)
        if dep is None:
            errors.append(
                {
                    **_row_error(
                        "unknown_id",
                        index,
                        "This id is not a dependency of this initiative; get_ppm_plan lists them.",
                        id=dep_id,
                    ),
                    "list": "remove",
                }
            )
            continue
        remove_plan.append({"index": index, "action": "remove", **trim(dep, DEPENDENCY_KEYS)})
    kept = {link_key(dep): dep_id for dep_id, dep in deps.items() if dep_id not in set(removes)}
    rows = {"task": tasks, "wbs": packages}
    add_plan: list[dict] = []
    for index, entry in enumerate(adds):
        missing = [
            side
            for side in ("pred", "succ")
            if entry[f"{side}_id"] not in rows[entry[f"{side}_kind"]]
        ]
        if missing:
            errors.append(
                {
                    **_row_error(
                        "unknown_id",
                        index,
                        "Both ends must be a task or work package of this initiative "
                        "(of the kind given).",
                        ends=missing,
                    ),
                    "list": "add",
                }
            )
            continue
        existing = kept.get(link_key(entry))
        action = "exists" if existing else "add"
        planned = {"index": index, "action": action, **entry}
        if existing:
            planned["id"] = existing
        add_plan.append(planned)
    return add_plan, remove_plan, errors
