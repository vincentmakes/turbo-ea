"""Semantic change items for the Security & admin audit log.

A metamodel or portal write changes a large JSON column — a card type's
``fields_schema`` runs to hundreds of fields, a portal's ``card_config`` nests
three levels — and neither the whole value nor a size ("12 → 13") tells a
reviewer what happened. The functions here compare the two versions and return
a list of **change items**, one per thing a person would name: *field "Cost"
added to section "Finance"*, *option "Legacy" recoloured*, *section "Ops"
moved from 3 to 1*. ``audit_log.record(..., items=...)`` stores the list under
``details["items"]`` and the Security log renders each item as a sentence from
the i18n template ``securityLog.changes.<noun>_<verb>``.

An item is ``{"kind": "<noun>.<verb>", **args}``. ``kind`` is one of
``AUDIT_ITEM_KINDS`` — the closed vocabulary the frontend has templates for —
and every argument is a scalar or a flat list of scalars, so an item can be
rendered without knowing the metamodel it came from. Values are **labels, not
keys**: a field is named by its label (its key when it has none), an option by
its label, a role by its label.

Every function is pure, never raises on malformed input (a value that is not
the expected list or mapping reads as empty), returns ``[]`` when nothing
changed, and orders its output deterministically: added, removed,
renamed/moved, changed, each in input order.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from typing import Any

AUDIT_ITEM_KINDS: frozenset[str] = frozenset(
    {
        # Card-type schema (``fields_schema``) and its layout.
        "section.added",
        "section.removed",
        "section.renamed",
        "section.moved",
        "section.changed",
        "field.added",
        "field.removed",
        "field.moved",
        "field.renamed",
        "field.changed",
        "option.added",
        "option.removed",
        "option.renamed",
        "option.changed",
        # Relation-type attributes (``attributes_schema``).
        "attribute.added",
        "attribute.removed",
        "attribute.renamed",
        "attribute.changed",
        # Keyed lists on a card type.
        "subtype.added",
        "subtype.removed",
        "subtype.renamed",
        "subtype.changed",
        "hierarchy_label.added",
        "hierarchy_label.removed",
        "hierarchy_label.renamed",
        "hierarchy_label.changed",
        "stakeholder_role.added",
        "stakeholder_role.removed",
        "stakeholder_role.renamed",
        "stakeholder_role.changed",
        # Layout (``section_config``).
        "layout.reordered",
        "quality_weight.changed",
        # Translations.
        "translation.changed",
        # Permissions.
        "permission.granted",
        "permission.revoked",
        "permission.wildcard",
        "type_permission.changed",
        # Portals.
        "portal_filter.changed",
        "portal_toggle.changed",
        "portal_option.changed",
        # Homepage dashboards (``dashboards.widgets``).
        "dashboard_widget.added",
        "dashboard_widget.removed",
        # Settings, users, misc.
        "locale.enabled",
        "locale.disabled",
        "image.replaced",
        "image.removed",
        "user.changed",
        "user.deleted",
        "more",
    }
)

# Arguments whose ``None`` is a value ("there was none"), not an omission.
_KEEP_NONE = frozenset({"old", "new"})

# Field properties reported as ``field.changed`` / ``attribute.changed``.
_FIELD_PROPS = (
    "type",
    "required",
    "weight",
    "readonly",
    "group",
    "column",
    "help",
    "badge",
    "config",
    "hidden",
)
_SECTION_PROPS = ("columns", "groups", "defaultExpanded", "hidden")
_OPTION_PROPS = ("color", "hidden")

# Flags whose absence means ``False``: reading an absent flag as ``None`` would
# report a no-op "— → No" every time an editor wrote the default explicitly.
_BOOLEAN_PROPS = frozenset({"required", "readonly", "hidden"})

# Props whose absence means a rendered default other than ``False``, read the
# same way: a section with no ``defaultExpanded`` starts expanded, so the first
# Card Layout save writing ``defaultExpanded: true`` for every section is no
# change. Relations is the one section that starts collapsed
# (``SECTION_DEFAULT_EXPANDED`` in ``frontend/src/features/cards/sectionConfig.ts``).
_PROP_DEFAULTS: Mapping[str, Any] = {"defaultExpanded": True}
_SECTION_PROP_DEFAULTS: Mapping[str, Mapping[str, Any]] = {
    "relations": {"defaultExpanded": False},
}

_ORDER_KEY = "__order"
_QUALITY_KEY = "__dataQuality"
_CUSTOM_PREFIX = "custom:"

_SCALARS = (str, int, float, bool)


def item(kind: str, **args: Any) -> dict[str, Any]:
    """One change item. Raises ``ValueError`` for a kind not in
    ``AUDIT_ITEM_KINDS``; drops ``None`` arguments except ``old`` / ``new``,
    whose null side is meaningful ("set for the first time")."""
    if kind not in AUDIT_ITEM_KINDS:
        raise ValueError(f"Unknown audit change kind {kind!r}")
    out: dict[str, Any] = {"kind": kind}
    for name, value in args.items():
        if value is not None or name in _KEEP_NONE:
            out[name] = value
    return out


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> Mapping[Any, Any]:
    return value if isinstance(value, Mapping) else {}


def _is_flat(value: Any) -> bool:
    if value is None or isinstance(value, _SCALARS):
        return True
    return isinstance(value, (list, tuple)) and all(
        v is None or isinstance(v, _SCALARS) for v in value
    )


def _compact(value: Any) -> Any:
    """``value`` itself when it is a scalar or a flat list, else its compact,
    key-sorted JSON — an item argument must be renderable as it stands."""
    if _is_flat(value):
        return list(value) if isinstance(value, tuple) else value
    return _json_or_none(value)


def _json_or_none(value: Any) -> str | None:
    """Compact, key-sorted JSON of ``value``; ``None`` stays ``None``."""
    if value is None:
        return None
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _same(old: Any, new: Any) -> bool:
    """Content equality that ignores key order inside nested mappings."""
    return json.dumps(old, sort_keys=True, default=str) == json.dumps(
        new, sort_keys=True, default=str
    )


def _prop(entry: Mapping[str, Any], prop: str, defaults: Mapping[str, Any] = _PROP_DEFAULTS) -> Any:
    value = entry.get(prop)
    if prop in _BOOLEAN_PROPS:
        return bool(value)
    if value is None:
        return defaults.get(prop)
    return value


def _label_of(entry: Mapping[str, Any], key: str = "key", label: str = "label") -> Any:
    """An entry's display name: its label, falling back to its key."""
    return entry.get(label) or entry.get(key)


def _index(entries: Iterable[Any], key: str) -> dict[Any, dict]:
    """``{key: entry}`` in input order; the first entry wins a duplicate key and
    an entry that is not a mapping or carries no key is skipped."""
    out: dict[Any, dict] = {}
    for entry in entries:
        if not isinstance(entry, Mapping):
            continue
        k = entry.get(key)
        if k is None or k in out:
            continue
        out[k] = dict(entry)
    return out


def _translation_items(prefix: str, old: Any, new: Any) -> list[dict[str, Any]]:
    """``translation.changed`` for each locale of one ``{locale: text}`` map."""
    before, after = _as_dict(old), _as_dict(new)
    out = []
    for locale in [*before, *(loc for loc in after if loc not in before)]:
        old_text, new_text = before.get(locale), after.get(locale)
        if old_text != new_text:
            out.append(
                item(
                    "translation.changed",
                    property=prefix,
                    locale=locale,
                    old=_compact(old_text),
                    new=_compact(new_text),
                )
            )
    return out


def keyed_list_items(
    old: Any,
    new: Any,
    *,
    noun: str,
    key: str = "key",
    label: str = "label",
    props: Iterable[str] = (),
) -> list[dict[str, Any]]:
    """Items for a list of ``{key, label, …}`` entries matched by ``key``.

    ``<noun>.added`` / ``.removed`` {label}, ``.renamed`` {old, new} when the
    label changed, ``.changed`` {label, property, old, new} for each prop in
    ``props`` that differs, and ``translation.changed`` (property
    ``"<noun>:<label>"``) for an entry's ``translations``. ``noun`` is
    ``subtype``, ``hierarchy_label`` or ``stakeholder_role``.
    """
    before, after = _index(_as_list(old), key), _index(_as_list(new), key)
    added = [
        item(f"{noun}.added", label=_label_of(e, key, label))
        for k, e in after.items()
        if k not in before
    ]
    removed = [
        item(f"{noun}.removed", label=_label_of(e, key, label))
        for k, e in before.items()
        if k not in after
    ]
    renamed, changed, translated = [], [], []
    for k, now in after.items():
        was = before.get(k)
        if was is None:
            continue
        old_label, new_label = _label_of(was, key, label), _label_of(now, key, label)
        if old_label != new_label:
            renamed.append(item(f"{noun}.renamed", old=old_label, new=new_label))
        for prop in props:
            a, b = was.get(prop), now.get(prop)
            if not _same(a, b):
                changed.append(
                    item(
                        f"{noun}.changed",
                        label=new_label,
                        property=prop,
                        old=_compact(a),
                        new=_compact(b),
                    )
                )
        translated += _translation_items(
            f"{noun}:{new_label}", was.get("translations"), now.get("translations")
        )
    return added + removed + renamed + changed + translated


def _property_items(
    kind: str,
    names: Mapping[str, Any],
    was: Mapping[str, Any],
    now: Mapping[str, Any],
    props: Iterable[str],
    defaults: Mapping[str, Any] = _PROP_DEFAULTS,
) -> list[dict[str, Any]]:
    """``kind`` items {**names, property, old, new} for each prop that differs,
    an absent prop read as its rendered default (``_BOOLEAN_PROPS``,
    ``defaults``)."""
    out = []
    for prop in props:
        a, b = _prop(was, prop, defaults), _prop(now, prop, defaults)
        if _same(a, b):
            continue
        if prop == "config":
            a, b = _json_or_none(a), _json_or_none(b)
        out.append(item(kind, **names, property=prop, old=_compact(a), new=_compact(b)))
    return out


def _option_items(field_label: Any, old: Any, new: Any) -> list[dict[str, Any]]:
    """``option.*`` items for one field's ``options``, matched by key."""
    before, after = _index(_as_list(old), "key"), _index(_as_list(new), "key")
    added = [
        item("option.added", field=field_label, option=_label_of(o))
        for k, o in after.items()
        if k not in before
    ]
    removed = [
        item("option.removed", field=field_label, option=_label_of(o))
        for k, o in before.items()
        if k not in after
    ]
    renamed, changed, translated = [], [], []
    for k, now in after.items():
        was = before.get(k)
        if was is None:
            continue
        name = _label_of(now)
        if _label_of(was) != name:
            renamed.append(item("option.renamed", field=field_label, old=_label_of(was), new=name))
        changed += _property_items(
            "option.changed", {"field": field_label, "option": name}, was, now, _OPTION_PROPS
        )
        translated += _translation_items(
            f"option:{name}", was.get("translations"), now.get("translations")
        )
    return added + removed + renamed + changed + translated


def _field_translation_items(label: Any, was: Mapping, now: Mapping) -> list[dict[str, Any]]:
    return (
        _translation_items(f"field:{label}", was.get("translations"), now.get("translations"))
        + _translation_items(
            f"field_help:{label}", was.get("helpTranslations"), now.get("helpTranslations")
        )
        + _translation_items(
            f"field_badge:{label}", was.get("badgeTranslations"), now.get("badgeTranslations")
        )
    )


def _section_field_keys(section: Mapping[str, Any]) -> set:
    return set(_index(_as_list(section.get("fields")), "key"))


def _rename_share(old_section: Mapping[str, Any], new_section: Mapping[str, Any]) -> float:
    """How many field keys two sections share, over the larger of the two."""
    a, b = _section_field_keys(old_section), _section_field_keys(new_section)
    shared = a & b
    if not shared:
        return 0.0
    return len(shared) / max(len(a), len(b))


def fields_schema_items(old: Any, new: Any) -> list[dict[str, Any]]:
    """Items for a card type's ``fields_schema`` (a list of sections).

    Sections are matched by name; a name that vanished and one that appeared
    sharing at least half their field keys (over the larger section) are one
    section renamed. Fields are matched by key across *all* sections, so a
    field that changed section is ``field.moved``, not removed and re-added.
    Options are matched by key within a field. The ``__description``
    pseudo-section is reported under that name.
    """
    before = _index(_as_list(old), "section")
    after = _index(_as_list(new), "section")

    # Pair old section names with new ones: same name, else the rename heuristic.
    pairs: dict[Any, Any] = {name: name for name in before if name in after}
    vanished = [name for name in before if name not in after]
    appeared = [name for name in after if name not in before]
    renamed_sections = []
    for old_name in vanished:
        best, best_share = None, 0.0
        for new_name in appeared:
            if new_name in pairs.values():
                continue
            share = _rename_share(before[old_name], after[new_name])
            if share >= 0.5 and share > best_share:
                best, best_share = new_name, share
        if best is not None:
            pairs[old_name] = best
            renamed_sections.append(item("section.renamed", old=old_name, new=best))
    paired_new = set(pairs.values())

    items = [item("section.added", section=n) for n in appeared if n not in paired_new]
    items += [item("section.removed", section=n) for n in vanished if n not in pairs]
    items += renamed_sections

    old_positions = {name: i for i, name in enumerate(n for n in before if n in pairs)}
    new_positions = {name: i for i, name in enumerate(n for n in after if n in paired_new)}
    for old_name, new_name in pairs.items():
        if old_positions[old_name] != new_positions[new_name]:
            items.append(
                item(
                    "section.moved",
                    section=new_name,
                    **{"from": old_positions[old_name] + 1, "to": new_positions[new_name] + 1},
                )
            )

    section_changed, section_translated = [], []
    old_name_of = {n: o for o, n in pairs.items()}
    for new_name in after:
        if new_name not in old_name_of:
            continue
        old_name = old_name_of[new_name]
        was, now = before[old_name], after[new_name]
        section_changed += _property_items(
            "section.changed", {"section": new_name}, was, now, _SECTION_PROPS
        )
        section_translated += _translation_items(
            f"section:{new_name}", was.get("translations"), now.get("translations")
        )
        old_groups = _as_dict(was.get("groupTranslations"))
        new_groups = _as_dict(now.get("groupTranslations"))
        for group in [*old_groups, *(g for g in new_groups if g not in old_groups)]:
            section_translated += _translation_items(
                f"group:{group}", old_groups.get(group), new_groups.get(group)
            )
    items += section_changed

    # Fields, matched by key across every section: key → (section name, field).
    def fields_by_key(sections: Mapping[Any, dict]) -> dict[Any, tuple[Any, dict]]:
        out: dict[Any, tuple[Any, dict]] = {}
        for name, section in sections.items():
            for k, f in _index(_as_list(section.get("fields")), "key").items():
                out.setdefault(k, (name, f))
        return out

    old_fields, new_fields = fields_by_key(before), fields_by_key(after)
    items += [
        item("field.added", section=sec, field=_label_of(f), type=f.get("type"))
        for k, (sec, f) in new_fields.items()
        if k not in old_fields
    ]
    items += [
        item("field.removed", section=sec, field=_label_of(f))
        for k, (sec, f) in old_fields.items()
        if k not in new_fields
    ]
    moved, field_renamed, field_changed, options, field_translated = [], [], [], [], []
    for k, (new_sec, now) in new_fields.items():
        if k not in old_fields:
            continue
        old_sec, was = old_fields[k]
        label = _label_of(now)
        if pairs.get(old_sec) != new_sec:
            moved.append(item("field.moved", field=label, from_section=old_sec, to_section=new_sec))
        if _label_of(was) != label:
            field_renamed.append(
                item("field.renamed", section=new_sec, old=_label_of(was), new=label)
            )
        field_changed += _property_items(
            "field.changed", {"section": new_sec, "field": label}, was, now, _FIELD_PROPS
        )
        options += _option_items(label, was.get("options"), now.get("options"))
        field_translated += _field_translation_items(label, was, now)
    return (
        items
        + moved
        + field_renamed
        + field_changed
        + options
        + section_translated
        + field_translated
    )


def attributes_schema_items(old: Any, new: Any) -> list[dict[str, Any]]:
    """Items for a relation type's ``attributes_schema`` (a list of field
    definitions): ``attribute.*`` matched by key, ``option.*`` with ``field`` =
    the attribute label, and ``translation.changed`` (``field:<label>`` /
    ``option:<label>``)."""
    before, after = _index(_as_list(old), "key"), _index(_as_list(new), "key")
    items = [
        item("attribute.added", attribute=_label_of(a), type=a.get("type"))
        for k, a in after.items()
        if k not in before
    ]
    items += [
        item("attribute.removed", attribute=_label_of(a))
        for k, a in before.items()
        if k not in after
    ]
    renamed, changed, options, translated = [], [], [], []
    for k, now in after.items():
        was = before.get(k)
        if was is None:
            continue
        label = _label_of(now)
        if _label_of(was) != label:
            renamed.append(item("attribute.renamed", old=_label_of(was), new=label))
        changed += _property_items(
            "attribute.changed", {"attribute": label}, was, now, _FIELD_PROPS
        )
        options += _option_items(label, was.get("options"), now.get("options"))
        translated += _field_translation_items(label, was, now)
    return items + renamed + changed + options + translated


def _resolve_section(key: Any, section_names: list[Any]) -> Any:
    """``custom:N`` → the N-th section's name; any other key as it is."""
    if isinstance(key, str) and key.startswith(_CUSTOM_PREFIX):
        index = key[len(_CUSTOM_PREFIX) :]
        if index.isdigit() and int(index) < len(section_names):
            return section_names[int(index)]
    return key


def section_config_items(old: Any, new: Any, section_names: Any) -> list[dict[str, Any]]:
    """Items for a card type's ``section_config``.

    ``layout.reordered`` {old, new} when ``__order`` changed (``custom:N``
    resolved through ``section_names``, the type's section names in
    ``fields_schema`` order; built-in keys such as ``description`` reported as
    they are), ``section.changed`` for a section's ``hidden`` /
    ``defaultExpanded``, and ``quality_weight.changed`` {component, old, new}
    for each ``__dataQuality`` weight that moved.
    """
    before, after = _as_dict(old), _as_dict(new)
    names = list(section_names) if isinstance(section_names, (list, tuple)) else []

    def order(config: Mapping[str, Any]) -> list[Any] | None:
        raw = config.get(_ORDER_KEY)
        if not isinstance(raw, list):
            return None
        return [_resolve_section(k, names) for k in raw]

    items = []
    old_order, new_order = order(before), order(after)
    if old_order != new_order:
        items.append(item("layout.reordered", old=old_order, new=new_order))

    for key in [*before, *(k for k in after if k not in before)]:
        if key in (_ORDER_KEY, _QUALITY_KEY):
            continue
        was, now = _as_dict(before.get(key)), _as_dict(after.get(key))
        items += _property_items(
            "section.changed",
            {"section": _resolve_section(key, names)},
            was,
            now,
            ("hidden", "defaultExpanded"),
            {**_PROP_DEFAULTS, **_SECTION_PROP_DEFAULTS.get(key, {})},
        )

    old_weights, new_weights = _as_dict(before.get(_QUALITY_KEY)), _as_dict(after.get(_QUALITY_KEY))
    for component in [*old_weights, *(c for c in new_weights if c not in old_weights)]:
        a, b = old_weights.get(component), new_weights.get(component)
        if a != b:
            items.append(
                item(
                    "quality_weight.changed",
                    component=component,
                    old=_compact(a),
                    new=_compact(b),
                )
            )
    return items


def translations_items(old: Any, new: Any) -> list[dict[str, Any]]:
    """``translation.changed`` {property, locale, old, new} for a
    ``{property: {locale: text}}`` map (a type's, relation type's, regulation's
    or resource type's ``translations``). A side that has no text is ``None``."""
    before, after = _as_dict(old), _as_dict(new)
    out = []
    for prop in [*before, *(p for p in after if p not in before)]:
        out += _translation_items(prop, before.get(prop), after.get(prop))
    return out


_CELL_STATE = {True: "allow", False: "deny", None: "inherit"}


def role_permissions_items(
    old: Any, new: Any, role_labels: Mapping[str, str] | None = None
) -> list[dict[str, Any]]:
    """``type_permission.changed`` {role, permission, old, new} for each per-role
    override cell of a card type that changed. ``old`` / ``new`` are ``allow``
    (``True``), ``deny`` (``False``) or ``inherit`` (absent); ``role`` is the
    role's label from ``role_labels``, its key when unknown."""
    from app.services.audit_log import permission_changes

    before, after = _as_dict(old), _as_dict(new)
    labels = _as_dict(role_labels)
    out = []
    for role in [*before, *(r for r in after if r not in before)]:
        cells = permission_changes(
            _as_dict(before.get(role)), _as_dict(after.get(role)), absent=None
        )
        for permission in cells.get("old", {}):
            out.append(
                item(
                    "type_permission.changed",
                    role=labels.get(role) or role,
                    permission=permission,
                    old=_CELL_STATE[cells["old"][permission]],
                    new=_CELL_STATE[cells["new"][permission]],
                )
            )
    return out


def permission_items(old: Any, new: Any) -> list[dict[str, Any]]:
    """``permission.granted`` / ``.revoked`` {permission} for each permission
    key whose grant changed, and ``permission.wildcard`` {granted} for ``*``."""
    from app.services.audit_log import permission_changes

    cells = permission_changes(_as_dict(old), _as_dict(new))
    out = []
    for permission, granted in cells.get("new", {}).items():
        if permission == "*":
            out.append(item("permission.wildcard", granted=granted))
        elif granted:
            out.append(item("permission.granted", permission=permission))
        else:
            out.append(item("permission.revoked", permission=permission))
    return out


#: The "(empty)" pick of the shared card filter set (``EMPTY_FILTER_KEY``).
_EMPTY_PICK = "__empty__"
#: What an "(empty)" pick reads as in a ``Facet: value`` label.
_EMPTY_LABEL = "—"


def _portal_filter_view(filters: Any) -> dict[str, Any]:
    """What a portal's ``filters`` narrow the page to, one entry per filter
    row, whichever shape stores it: the shared card filter set under
    ``card_filters``, or the ``subtypes`` / ``tag_ids`` every portal had
    before. Moving a portal from one shape to the other with the same picks is
    therefore not a change."""
    d = _as_dict(filters)
    cf = d.get("card_filters")
    view: dict[str, Any] = {"approval_statuses": _as_list(d.get("approval_statuses"))}
    if not isinstance(cf, Mapping):
        view.update(
            tag_matching="any_tag",
            subtypes=_as_list(d.get("subtypes")),
            tags=_as_list(d.get("tag_ids")),
            related_cards={},
            card_fields={},
            relation_subtypes={},
            include_sub_cards=False,
        )
        return view
    view.update(
        tag_matching="tag_per_group",
        subtypes=_as_list(cf.get("subtypeFilters")),
        tags=_as_list(cf.get("tagFilterIds")),
        related_cards=_as_dict(cf.get("relationFilters")),
        card_fields=_as_dict(cf.get("attrFilters")),
        relation_subtypes=_as_dict(cf.get("relSubtypeFilters")),
        include_sub_cards=cf.get("includeDescendants") is True,
    )
    return view


def _picks(value: Mapping[Any, Any]) -> list[tuple[str, str]]:
    """``{key: [values]}`` as sorted ``(key, value)`` pairs."""
    return sorted(
        (str(k), str(v)) for k, vals in value.items() for v in _as_list(vals) if v is not None
    )


def portal_filter_items(
    old: Any,
    new: Any,
    *,
    subtype_labels: Mapping[str, str] | None = None,
    tag_labels: Mapping[str, str] | None = None,
    card_labels: Mapping[str, str] | None = None,
    facet_labels: Mapping[str, str] | None = None,
    option_labels: Mapping[str, str] | None = None,
    tag_groups: Mapping[str, str] | None = None,
) -> list[dict[str, Any]]:
    """``portal_filter.changed`` {filter, old, new} for a portal's ``filters``,
    each side a list of labels; order alone is not a change.

    ``filter`` is one row of the filter set: ``subtypes``, ``tags``,
    ``related_cards`` / ``card_fields`` / ``relation_subtypes`` (each value a
    ``Facet: value`` label — the facet a relation verb, a card type or a
    field, the value a card name or an option label), ``include_sub_cards``
    (``old`` / ``new`` booleans) and ``approval_statuses`` (status codes).

    ``facet_labels`` maps a facet key (a relation-filter key, an attribute
    key, a ``<relation type>::<field>`` composite) to its label;
    ``option_labels`` maps ``<facet key>:<option key>`` to the option's.

    ``tag_matching`` (codes ``any_tag`` / ``tag_per_group``) records the one
    change a move between the two storage shapes makes with the same picks:
    the legacy preset kept a card carrying any picked tag, the card filter set
    wants one from every group. It is logged only when that changes what the
    portal shows — tags on both sides, spanning more than one group
    (``tag_groups`` maps a tag id to its group id).
    """
    before, after = _portal_filter_view(old), _portal_filter_view(new)
    subtypes, tags = _as_dict(subtype_labels), _as_dict(tag_labels)
    cards, facets, options = _as_dict(card_labels), _as_dict(facet_labels), _as_dict(option_labels)
    out: list[dict[str, Any]] = []

    groups = _as_dict(tag_groups)
    picked = {str(v) for v in [*before["tags"], *after["tags"]] if v is not None}
    if (
        before["tag_matching"] != after["tag_matching"]
        and before["tags"]
        and after["tags"]
        and len({groups.get(t, t) for t in picked}) > 1
    ):
        out.append(
            item(
                "portal_filter.changed",
                filter="tag_matching",
                old=before["tag_matching"],
                new=after["tag_matching"],
            )
        )

    for name, labels in (("subtypes", subtypes), ("tags", tags)):
        a = [v for v in before[name] if v is not None]
        b = [v for v in after[name] if v is not None]
        if sorted(map(str, a)) != sorted(map(str, b)):
            out.append(
                item(
                    "portal_filter.changed",
                    filter=name,
                    old=[labels.get(str(v)) or str(v) for v in a],
                    new=[labels.get(str(v)) or str(v) for v in b],
                )
            )

    def pick_label(name: str, key: str, value: str) -> str:
        facet = facets.get(key) or key
        if value == _EMPTY_PICK:
            shown = _EMPTY_LABEL
        elif name == "related_cards":
            shown = cards.get(value) or value
        else:
            shown = options.get(f"{key}:{value}") or value
        return f"{facet}: {shown}"

    for name in ("related_cards", "card_fields", "relation_subtypes"):
        a, b = _picks(before[name]), _picks(after[name])
        if a != b:
            out.append(
                item(
                    "portal_filter.changed",
                    filter=name,
                    old=[pick_label(name, k, v) for k, v in a],
                    new=[pick_label(name, k, v) for k, v in b],
                )
            )

    if before["include_sub_cards"] != after["include_sub_cards"]:
        out.append(
            item(
                "portal_filter.changed",
                filter="include_sub_cards",
                old=before["include_sub_cards"],
                new=after["include_sub_cards"],
            )
        )

    a = sorted(str(v) for v in before["approval_statuses"] if v is not None)
    b = sorted(str(v) for v in after["approval_statuses"] if v is not None)
    if a != b:
        out.append(item("portal_filter.changed", filter="approval_statuses", old=a, new=b))
    return out


_PORTAL_SURFACES = ("card", "detail")
_PORTAL_BLOCKS = ("ppm", "bpm")


def portal_card_config_items(
    old: Any, new: Any, *, item_labels: Mapping[str, str] | None = None
) -> list[dict[str, Any]]:
    """Items for a portal's ``card_config``.

    ``portal_toggle.changed`` {item, surface, old, new} for each per-item
    exposure switch (``toggles[<item>][card|detail]``; ``item`` is the label
    from ``item_labels``, the key when unknown; an unset switch is ``None``),
    then ``portal_option.changed`` {option, old, new} for the board settings —
    ``ppm_<key>`` / ``bpm_<key>`` — and ``show_logo`` (unset reads as ``True``,
    as the portal renders it).
    """
    before, after = _as_dict(old), _as_dict(new)
    labels = _as_dict(item_labels)
    out = []
    old_toggles, new_toggles = _as_dict(before.get("toggles")), _as_dict(after.get("toggles"))
    for key in [*old_toggles, *(k for k in new_toggles if k not in old_toggles)]:
        was, now = _as_dict(old_toggles.get(key)), _as_dict(new_toggles.get(key))
        for surface in _PORTAL_SURFACES:
            a, b = was.get(surface), now.get(surface)
            if a != b:
                out.append(
                    item(
                        "portal_toggle.changed",
                        item=labels.get(key) or key,
                        surface=surface,
                        old=_compact(a),
                        new=_compact(b),
                    )
                )
    for block in _PORTAL_BLOCKS:
        was, now = _as_dict(before.get(block)), _as_dict(after.get(block))
        for key in [*was, *(k for k in now if k not in was)]:
            a, b = was.get(key), now.get(key)
            if not _same(a, b):
                out.append(
                    item(
                        "portal_option.changed",
                        option=f"{block}_{key}",
                        old=_compact(a),
                        new=_compact(b),
                    )
                )
    old_logo, new_logo = before.get("show_logo", True), after.get("show_logo", True)
    if old_logo != new_logo:
        out.append(
            item(
                "portal_option.changed",
                option="show_logo",
                old=_compact(old_logo),
                new=_compact(new_logo),
            )
        )
    return out


def list_items(
    old: Any, new: Any, *, kind_added: str, kind_removed: str, arg: str
) -> list[dict[str, Any]]:
    """``kind_added`` {arg: value} for each value of ``new`` not in ``old`` and
    ``kind_removed`` for each value of ``old`` not in ``new`` — e.g. the
    enabled locales as ``locale.enabled`` / ``locale.disabled`` {locale}."""
    before, after = _as_list(old), _as_list(new)
    added = [item(kind_added, **{arg: v}) for v in after if v not in before]
    removed = [item(kind_removed, **{arg: v}) for v in before if v not in after]
    return added + removed


def cap_items(items: list[dict[str, Any]], limit: int = 200) -> list[dict[str, Any]]:
    """The first ``limit`` items, plus a ``more`` {count} item for the rest, so
    one bulk edit cannot make an audit row arbitrarily large."""
    if len(items) <= limit:
        return list(items)
    return [*items[:limit], item("more", count=len(items) - limit)]
