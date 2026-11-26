"""``app.services.directory_roles`` — the role-map rules both sign-in modes share.

Pure functions, no database: every rule is pinned with exact values so the
mutation gate sees a test fail for each one that is changed.
"""

from __future__ import annotations

import pytest

from app.services import directory_roles as dr

# ── claim_values ────────────────────────────────────────────────────────────


def test_claim_values_reads_a_string_claim_trimmed():
    assert dr.claim_values({"groups": "  ea-admins "}, "groups") == ("ea-admins",)


def test_claim_values_reads_a_list_claim_in_order():
    assert dr.claim_values({"groups": [" b ", "a"]}, "groups") == ("b", "a")


def test_claim_values_drops_blank_and_non_string_entries():
    claims = {"groups": ["x", "", "  ", 7, None, {"n": 1}, "y"]}
    assert dr.claim_values(claims, "groups") == ("x", "y")


@pytest.mark.parametrize(
    "claims, key",
    [
        ({"groups": "   "}, "groups"),  # blank string
        ({"groups": []}, "groups"),  # empty list
        ({"groups": 3}, "groups"),  # neither shape
        ({"groups": {"a": 1}}, "groups"),  # a mapping
        ({}, "groups"),  # absent
        ({"groups": "a"}, ""),  # no claim name
        ({"groups": "a"}, None),  # no claim name
        (None, "groups"),  # no claims at all
    ],
)
def test_claim_values_is_empty_when_there_is_nothing_to_read(claims, key):
    assert dr.claim_values(claims, key) == ()


def test_claim_values_reads_only_the_named_claim():
    assert dr.claim_values({"roles": "admin", "groups": "g"}, "roles") == ("admin",)


# ── map_role ────────────────────────────────────────────────────────────────

MAP = [("ea-admins", "admin"), ("ea-users", "member"), ("ea-readers", "viewer")]


def test_map_role_takes_the_first_match_in_map_order_not_claim_order():
    assert dr.map_role(("ea-readers", "ea-admins"), MAP) == "admin"
    assert dr.map_role(("ea-readers", "ea-users"), MAP) == "member"


def test_map_role_ignores_case_on_both_sides():
    assert dr.map_role(("EA-Users",), MAP) == "member"
    assert dr.map_role(("ea-users",), [("EA-USERS", "member")]) == "member"


def test_map_role_keeps_the_target_key_verbatim():
    assert dr.map_role(("g",), [("g", "Regional_Owner")]) == "Regional_Owner"


def test_map_role_is_none_without_a_match_or_values():
    assert dr.map_role(("other",), MAP) is None
    assert dr.map_role((), MAP) is None
    assert dr.map_role(("ea-admins",), []) is None


# ── normalise_role_map ──────────────────────────────────────────────────────


def test_normalise_keeps_order_and_the_typed_casing_trimmed():
    raw = [{"value": " EA-Admins ", "role": " admin "}, {"value": "Readers", "role": "viewer"}]
    assert dr.normalise_role_map(raw) == [
        {"value": "EA-Admins", "role": "admin"},
        {"value": "Readers", "role": "viewer"},
    ]


@pytest.mark.parametrize(
    "row",
    [
        "ea-admins:admin",
        ["ea-admins", "admin"],
        None,
        {"value": "ea-admins"},
        {"role": "admin"},
        {"value": 3, "role": "admin"},
        {"value": "ea-admins", "role": None},
        {"value": "  ", "role": "admin"},
        {"value": "ea-admins", "role": "  "},
    ],
)
def test_normalise_drops_a_malformed_row_and_keeps_the_rest(row):
    raw = [row, {"value": "ok", "role": "member"}]
    assert dr.normalise_role_map(raw) == [{"value": "ok", "role": "member"}]


def test_normalise_keeps_only_the_first_row_of_a_repeated_value():
    raw = [
        {"value": "Group", "role": "admin"},
        {"value": "GROUP", "role": "viewer"},
        {"value": "other", "role": "member"},
    ]
    assert dr.normalise_role_map(raw) == [
        {"value": "Group", "role": "admin"},
        {"value": "other", "role": "member"},
    ]


@pytest.mark.parametrize("raw", [None, "", "a:b", {"value": "a", "role": "b"}, 5])
def test_normalise_reads_anything_but_a_list_as_empty(raw):
    assert dr.normalise_role_map(raw) == []


def test_role_map_pairs_lower_cases_the_value_only():
    rows = [{"value": "EA-Admins", "role": "Admin_Role"}, {"value": "x", "role": "viewer"}]
    assert dr.role_map_pairs(rows) == [("ea-admins", "Admin_Role"), ("x", "viewer")]


# ── validate_role_map ───────────────────────────────────────────────────────


def test_validate_returns_the_trimmed_rows_in_order():
    raw = [{"value": " Admins ", "role": " admin "}, {"value": "readers", "role": "viewer"}]
    assert dr.validate_role_map(raw) == [
        {"value": "Admins", "role": "admin"},
        {"value": "readers", "role": "viewer"},
    ]


def test_validate_accepts_an_empty_map():
    assert dr.validate_role_map([]) == []


def test_validate_refuses_a_malformed_row():
    with pytest.raises(ValueError) as exc:
        dr.validate_role_map([{"value": "a"}])
    assert str(exc.value) == "Each role mapping row needs a directory value and a role."


def test_validate_refuses_an_empty_value():
    with pytest.raises(ValueError) as exc:
        dr.validate_role_map([{"value": "   ", "role": "admin"}])
    assert str(exc.value) == "A role mapping row has an empty directory value."


def test_validate_refuses_an_empty_role():
    with pytest.raises(ValueError) as exc:
        dr.validate_role_map([{"value": "Admins", "role": " "}])
    assert str(exc.value) == "The role mapping row for 'Admins' has no role."


def test_validate_refuses_a_value_repeated_in_another_case():
    with pytest.raises(ValueError) as exc:
        dr.validate_role_map(
            [{"value": "Admins", "role": "admin"}, {"value": "ADMINS", "role": "viewer"}]
        )
    assert str(exc.value) == (
        "The directory value 'ADMINS' appears more than once in the role map "
        "(values are compared without regard to case)."
    )


def test_validate_accepts_a_value_of_exactly_256_characters():
    value = "v" * 256
    assert dr.validate_role_map([{"value": value, "role": "admin"}]) == [
        {"value": value, "role": "admin"}
    ]


def test_validate_refuses_a_value_of_257_characters():
    with pytest.raises(ValueError) as exc:
        dr.validate_role_map([{"value": "v" * 257, "role": "admin"}])
    assert str(exc.value) == f"The directory value '{'v' * 40}…' is longer than 256 characters."


def test_the_value_length_is_judged_after_trimming():
    value = "v" * 256
    rows = dr.validate_role_map([{"value": f"  {value}  ", "role": "admin"}])
    assert rows == [{"value": value, "role": "admin"}]


def _rows(n: int) -> list[dict[str, str]]:
    return [{"value": f"group-{i}", "role": "member"} for i in range(n)]


def test_validate_accepts_exactly_100_rows():
    assert len(dr.validate_role_map(_rows(100))) == 100


def test_validate_refuses_101_rows():
    with pytest.raises(ValueError) as exc:
        dr.validate_role_map(_rows(101))
    assert str(exc.value) == "A role map holds at most 100 rows."


def test_validate_takes_any_iterable():
    assert dr.validate_role_map(iter(_rows(2))) == _rows(2)


# ── roles_to_check ──────────────────────────────────────────────────────────


def test_every_role_is_checked_when_nothing_is_stored():
    rows = [{"value": "a", "role": "admin"}, {"value": "b", "role": "viewer"}]
    assert dr.roles_to_check(rows, None) == ["admin", "viewer"]


def test_a_row_resent_unchanged_is_not_checked_whatever_its_casing():
    stored = [{"value": "Old-Group", "role": "retired"}]
    rows = [{"value": "old-group", "role": "retired"}, {"value": "new", "role": "viewer"}]
    assert dr.roles_to_check(rows, stored) == ["viewer"]


def test_a_row_whose_role_changed_is_checked():
    stored = [{"value": "g", "role": "member"}]
    assert dr.roles_to_check([{"value": "g", "role": "retired"}], stored) == ["retired"]


def test_a_stored_role_under_a_new_value_is_checked():
    stored = [{"value": "g", "role": "retired"}]
    assert dr.roles_to_check([{"value": "h", "role": "retired"}], stored) == ["retired"]


def test_each_role_is_checked_once_in_first_seen_order():
    rows = [
        {"value": "a", "role": "viewer"},
        {"value": "b", "role": "admin"},
        {"value": "c", "role": "viewer"},
    ]
    assert dr.roles_to_check(rows, []) == ["viewer", "admin"]


# ── is_multi_tenant / role_claim / check_role_map_config ────────────────────


@pytest.mark.parametrize(
    "tenant", ["organizations", "common", "consumers", " Common ", "ORGANIZATIONS", None, "", 5]
)
def test_multi_tenant_settings(tenant):
    assert dr.is_multi_tenant(tenant) is True


@pytest.mark.parametrize(
    "tenant", ["contoso.onmicrosoft.com", "1b2c3d4e-0000-4000-8000-123456789abc"]
)
def test_a_specific_tenant_is_not_multi_tenant(tenant):
    assert dr.is_multi_tenant(tenant) is False


def test_role_claim_is_trimmed_and_empty_when_unset():
    assert dr.role_claim({"role_claim": "  groups "}) == "groups"
    assert dr.role_claim({}) == ""
    assert dr.role_claim({"role_claim": None}) == ""
    assert dr.role_claim({"role_claim": ["groups"]}) == ""


ROW = [{"value": "g", "role": "admin"}]


def test_an_empty_map_needs_nothing():
    dr.check_role_map_config(provider="microsoft", tenant_id="common", claim="", rows=[])


def test_a_map_needs_a_claim_name():
    with pytest.raises(ValueError) as exc:
        dr.check_role_map_config(provider="oidc", tenant_id=None, claim="", rows=ROW)
    assert str(exc.value) == (
        "A role map needs a claim name: set the ID token claim that carries "
        "the user's groups or roles."
    )


@pytest.mark.parametrize("tenant", ["organizations", "common", "consumers", None])
def test_microsoft_with_a_multi_tenant_tenant_refuses_a_map(tenant):
    with pytest.raises(ValueError) as exc:
        dr.check_role_map_config(provider="microsoft", tenant_id=tenant, claim="roles", rows=ROW)
    assert str(exc.value) == (
        "Role mapping with Microsoft needs a specific tenant ID. With a "
        "multi-tenant setting (organizations, common or consumers) another "
        "tenant could assign itself this app's roles."
    )


def test_microsoft_with_a_specific_tenant_accepts_a_map():
    dr.check_role_map_config(provider="microsoft", tenant_id="contoso", claim="roles", rows=ROW)


@pytest.mark.parametrize("provider", ["okta", "oidc", "google"])
def test_other_providers_ignore_the_tenant(provider):
    dr.check_role_map_config(provider=provider, tenant_id="common", claim="groups", rows=ROW)


# ── native_role_map ─────────────────────────────────────────────────────────

ON = {
    "enabled": True,
    "provider": "oidc",
    "role_claim": "groups",
    "role_map": [{"value": "EA-Admins", "role": "admin"}, {"value": "readers", "role": "viewer"}],
}


def test_a_complete_configuration_is_in_force():
    assert dr.native_role_map(ON) == [("ea-admins", "admin"), ("readers", "viewer")]


def test_microsoft_with_a_specific_tenant_is_in_force():
    sso = {**ON, "provider": "microsoft", "tenant_id": "contoso.onmicrosoft.com"}
    assert dr.native_role_map(sso) == [("ea-admins", "admin"), ("readers", "viewer")]


def test_the_stored_map_is_normalised_at_read_time():
    sso = {**ON, "role_map": [{"value": "x"}, {"value": " Y ", "role": " member "}]}
    assert dr.native_role_map(sso) == [("y", "member")]


@pytest.mark.parametrize(
    "change",
    [
        {"enabled": False},
        {"enabled": None},
        {"provider": "google"},
        {"provider": "microsoft", "tenant_id": "organizations"},
        {"provider": "microsoft", "tenant_id": "common"},
        {"provider": "microsoft", "tenant_id": "consumers"},
        {"provider": "microsoft"},  # no tenant: the default is "organizations"
        {"role_claim": ""},
        {"role_claim": "   "},
        {"role_claim": None},
        {"role_map": []},
        {"role_map": None},
    ],
)
def test_the_map_is_off(change):
    assert dr.native_role_map({**ON, **change}) == []


def test_a_missing_provider_reads_as_microsoft():
    sso = {key: value for key, value in ON.items() if key != "provider"}
    assert dr.native_role_map(sso) == []
    assert dr.native_role_map({**sso, "tenant_id": "contoso"}) == [
        ("ea-admins", "admin"),
        ("readers", "viewer"),
    ]


@pytest.mark.parametrize("sso", [None, {}, "sso", []])
def test_no_sso_block_means_no_map(sso):
    assert dr.native_role_map(sso) == []


# ── scopes ──────────────────────────────────────────────────────────────────


def test_validate_scopes_joins_on_single_spaces_and_drops_repeats():
    assert dr.validate_scopes("  groups\toffline_access\n groups ") == "groups offline_access"


def test_validate_scopes_accepts_an_empty_value():
    assert dr.validate_scopes("") == ""
    assert dr.validate_scopes("   ") == ""


def test_validate_scopes_accepts_every_scope_token_character():
    # %x21, %x23-5B, %x5D-7E: everything printable but space, " and \
    token = (
        "!"
        + "".join(chr(c) for c in range(0x23, 0x5C))
        + "".join(chr(c) for c in range(0x5D, 0x7F))
    )
    assert len(token) == 92
    assert dr.validate_scopes(token) == token


@pytest.mark.parametrize("token", ['gro"ups', "back\\slash", "café", "nul\x00", "del\x7f"])
def test_validate_scopes_refuses_a_character_outside_the_scope_token_set(token):
    with pytest.raises(ValueError) as exc:
        dr.validate_scopes(f"openid {token}")
    assert str(exc.value) == f"'{token}' is not a valid OAuth scope."


def test_validate_scopes_accepts_exactly_200_characters():
    value = "a" * 99 + " " + "b" * 100
    assert len(value) == 200
    assert dr.validate_scopes(value) == value


def test_validate_scopes_refuses_201_characters():
    with pytest.raises(ValueError) as exc:
        dr.validate_scopes("a" * 100 + " " + "b" * 100)
    assert str(exc.value) == "Extra scopes may be at most 200 characters."


def test_the_scope_length_is_judged_after_normalising():
    assert dr.validate_scopes("   " + "a" * 200 + "   ") == "a" * 200
    assert dr.validate_scopes(("a" * 150 + " ") * 2) == "a" * 150


def test_merge_scopes_keeps_the_base_first_and_adds_what_is_new():
    assert (
        dr.merge_scopes("openid email profile", "groups email offline_access groups")
        == "openid email profile groups offline_access"
    )


@pytest.mark.parametrize("extra", ["", "   ", None, 5, ["groups"]])
def test_merge_scopes_without_extras_is_the_base(extra):
    assert dr.merge_scopes("openid email profile", extra) == "openid email profile"


def test_merge_scopes_skips_an_invalid_token_from_storage():
    assert dr.merge_scopes("openid", 'groups bad"one roles') == "openid groups roles"


# ── role_mapping_changed ────────────────────────────────────────────────────

_ROWS = [{"value": "EA-Admins", "role": "admin"}, {"value": "Readers", "role": "viewer"}]


def test_an_unchanged_resend_is_no_change():
    stored = {"role_claim": "groups", "role_map": _ROWS, "client_id": "a"}
    updated = {"role_claim": " groups ", "role_map": list(_ROWS), "client_id": "b"}
    assert dr.role_mapping_changed(stored, updated) is False


def test_nothing_stored_and_empty_values_sent_is_no_change():
    assert dr.role_mapping_changed({}, {"role_claim": "", "role_map": []}) is False


def test_a_new_claim_name_is_a_change():
    assert dr.role_mapping_changed({"role_claim": "groups"}, {"role_claim": "roles"}) is True


def test_a_first_map_is_a_change():
    assert dr.role_mapping_changed({}, {"role_map": _ROWS[:1]}) is True


@pytest.mark.parametrize(
    "updated",
    [
        _ROWS[::-1],
        _ROWS[:1],
        [_ROWS[0], {"value": "Readers", "role": "admin"}],
        [_ROWS[0], {"value": "readers", "role": "viewer"}],
    ],
)
def test_any_edit_of_the_rows_is_a_change(updated):
    stored = {"role_claim": "groups", "role_map": _ROWS}
    assert dr.role_mapping_changed(stored, {"role_claim": "groups", "role_map": updated}) is True


def test_extra_scopes_are_not_a_role_mapping_change():
    stored = {"role_claim": "groups", "role_map": _ROWS, "extra_scopes": ""}
    updated = {**stored, "extra_scopes": "groups"}
    assert dr.role_mapping_changed(stored, updated) is False


# ── login_scopes ────────────────────────────────────────────────────────────


def test_login_scopes_for_google_are_the_base_only():
    sso = {"provider": "google", "extra_scopes": "groups offline_access"}
    assert dr.login_scopes(sso, "openid email profile") == "openid email profile"


@pytest.mark.parametrize("provider", ["microsoft", "okta", "oidc"])
def test_login_scopes_for_other_providers_carry_the_extras(provider):
    sso = {"provider": provider, "extra_scopes": "groups email offline_access"}
    assert (
        dr.login_scopes(sso, "openid email profile") == "openid email profile groups offline_access"
    )


def test_login_scopes_without_a_provider_key_read_as_microsoft():
    assert dr.login_scopes({"extra_scopes": "groups"}, "openid") == "openid groups"


def test_login_scopes_without_extras_are_the_base():
    assert dr.login_scopes({"provider": "okta"}, "openid email") == "openid email"


# ── role_is_directory_managed ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "provider, native, proxy, managed",
    [
        ("sso", True, False, True),
        ("sso", False, True, True),
        ("sso", True, True, True),
        ("sso", False, False, False),
        ("local", True, True, False),
        (None, True, True, False),
        ("SSO", True, True, False),
    ],
)
def test_role_is_directory_managed(provider, native, proxy, managed):
    assert (
        dr.role_is_directory_managed(provider, native_active=native, proxy_active=proxy) is managed
    )
