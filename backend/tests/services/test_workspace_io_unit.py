"""Unit tests for the workspace_io bundle plumbing — no database required."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import openpyxl

from app.services.workspace_io import bundle as bundle_io
from app.services.workspace_io import entities, schema
from app.services.workspace_io import exporter as exp
from app.services.workspace_io.secrets import strip_secrets

# ---------------------------------------------------------------------------
# Reference encoding (the round-trip risk)
# ---------------------------------------------------------------------------


def test_encode_decode_path_roundtrip_simple():
    segs = ["Europe", "Germany", "Berlin"]
    encoded = schema.encode_path(segs)
    assert schema.split_escaped_path(encoded) == segs


def test_encode_decode_path_with_slash_and_backslash_in_names():
    # Names containing the separator characters must survive intact.
    segs = ["SAP S/4HANA", "CI/CD Pipelines", "Back\\Office"]
    encoded = schema.encode_path(segs)
    # No raw " / " separators introduced by the names themselves.
    assert schema.split_escaped_path(encoded) == segs


def test_build_ref_string_matches_resolver_format():
    ref = schema.build_ref_string(["Org", "Unit"], "App/Name")
    # Parent segments + escaped name joined by the path separator.
    assert ref == "Org / Unit / App\\/Name"
    assert schema.split_escaped_path(ref) == ["Org", "Unit", "App/Name"]


def test_empty_path():
    assert schema.split_escaped_path("") == []
    assert schema.split_escaped_path("   ") == []
    assert schema.encode_path([]) == ""


# ---------------------------------------------------------------------------
# Secret stripping
# ---------------------------------------------------------------------------


def test_strip_secrets_removes_known_credentials():
    general = {
        "currency": "EUR",
        "sso": {"enabled": True, "client_id": "abc", "client_secret": "enc:SHHH"},
        "ai": {"enabled": True, "model": "gpt", "apiKey": "enc:KEY"},
    }
    email = {
        "smtp_host": "mail",
        "smtp_user": "u",
        "smtp_password": "enc:PW",
        "method": "graph_api",
        "oauth_client_id": "client-1",
        "oauth_client_secret": "enc:CS",
        "service_account_json": "enc:SA",
    }
    g, e = strip_secrets(general, email)
    assert g["currency"] == "EUR"
    assert "client_secret" not in g["sso"]
    assert g["sso"]["client_id"] == "abc"
    assert "apiKey" not in g["ai"]
    assert g["ai"]["model"] == "gpt"
    assert "smtp_password" not in e
    # New OAuth email secrets are stripped; non-secret fields survive.
    assert "oauth_client_secret" not in e
    assert "service_account_json" not in e
    assert e["smtp_host"] == "mail"
    assert e["method"] == "graph_api"
    assert e["oauth_client_id"] == "client-1"


def test_strip_secrets_scrubs_arbitrary_encrypted_value():
    general = {"nested": {"weird_secret": "enc:LEAK", "ok": "plain"}}
    g, _ = strip_secrets(general, {})
    assert "weird_secret" not in g["nested"]
    assert g["nested"]["ok"] == "plain"


def test_strip_secrets_drops_extension_secrets_by_key():
    """``ctx.set_secret`` stores under ``ext.<key>.secret.<name>``. The key is
    what marks it, so an empty or plain-text value goes too — not only one the
    ``enc:`` scrub would catch."""
    general = {
        "ext.jira.secret.token": "",
        "ext.jira.secret.oauth.refresh": "plain",
        "ext.jira.secret": "a setting named secret",
        "ext.jira.secretive.x": 1,
        "ext.secret.mode": "an extension named secret",
        "ext.jira.project": "P",
        "extra.jira.secret.x": 2,
    }
    g, _ = strip_secrets(general, {})
    assert g == {
        "ext.jira.secret": "a setting named secret",
        "ext.jira.secretive.x": 1,
        "ext.secret.mode": "an extension named secret",
        "ext.jira.project": "P",
        "extra.jira.secret.x": 2,
    }


def test_strip_secrets_does_not_mutate_input():
    general = {"sso": {"client_secret": "enc:x"}}
    strip_secrets(general, {})
    assert general["sso"]["client_secret"] == "enc:x"


# ---------------------------------------------------------------------------
# Cell (de)serialisation + zip pack/unpack
# ---------------------------------------------------------------------------


def test_cell_json_roundtrip():
    value = {"b": 2, "a": [1, 2, 3], "n": None}
    cell = bundle_io.to_cell(value, is_json=True)
    assert isinstance(cell, str)
    assert bundle_io.from_cell(cell, is_json=True) == value


def test_cell_scalar_passthrough():
    assert bundle_io.to_cell(True, is_json=False) is True
    assert bundle_io.to_cell(None, is_json=False) is None
    assert bundle_io.from_cell("hi", is_json=False) == "hi"


def test_pack_unpack_roundtrip():
    wb = openpyxl.Workbook(write_only=True)
    bundle_io.write_sheet(wb, "Demo", ["a", "b"], [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}])
    import io

    buf = io.BytesIO()
    wb.save(buf)
    raw = bundle_io.pack({"format_version": "1"}, buf.getvalue(), {"branding/logo.png": b"PNG"})
    manifest, workbook_bytes, assets = bundle_io.unpack(raw)
    assert manifest["format_version"] == "1"
    assert assets["branding/logo.png"] == b"PNG"
    sheets = bundle_io.read_workbook(workbook_bytes)
    assert sheets["Demo"] == [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]


def test_unpack_rejects_non_zip():
    import pytest

    from app.services.workspace_io.bundle import BundleFormatError

    with pytest.raises(BundleFormatError):
        bundle_io.unpack(b"not a zip")


def test_oversized_cell_survives_via_overflow_asset():
    """A cell beyond Excel's 32,767-char limit is offloaded to an asset and
    restored verbatim on parse (openpyxl would otherwise truncate it)."""
    import io
    import json

    big = json.dumps({"blob": "y" * 50000})
    assert len(big) > 32767

    wb = openpyxl.Workbook(write_only=True)
    assets: dict[str, bytes] = {}
    bundle_io.write_sheet(wb, "Big", ["v"], [{"v": big}], assets)
    assert any(k.startswith("overflow/") for k in assets)

    buf = io.BytesIO()
    wb.save(buf)
    raw = bundle_io.pack({"format_version": "1"}, buf.getvalue(), assets)

    parsed = bundle_io.parse_bundle(raw)
    restored = parsed.rows("Big")[0]["v"]
    assert restored == big  # full value, not truncated
    assert json.loads(restored)["blob"] == "y" * 50000


def test_merge_settings_never_writes_incoming_secrets():
    """A hand-edited/malicious bundle carrying a secret must not land it —
    neither overwriting the target's value nor creating one the target lacked
    (it would be stored unencrypted)."""
    from app.services.workspace_io.applier import _merge_settings
    from app.services.workspace_io.secrets import EMAIL_SECRET_PATHS

    target = {"smtp_host": "old-host", "smtp_password": "enc:KEEP"}
    incoming = {
        "smtp_host": "new-host",
        "method": "graph_api",
        "smtp_password": "plaintext-attack",
        "oauth_client_secret": "plaintext-attack",
        "service_account_json": '{"private_key": "attack"}',
    }
    merged = _merge_settings(target, incoming, EMAIL_SECRET_PATHS)
    assert merged["smtp_host"] == "new-host"
    assert merged["method"] == "graph_api"
    assert merged["smtp_password"] == "enc:KEEP"  # target's own value preserved
    assert "oauth_client_secret" not in merged  # never created from a bundle
    assert "service_account_json" not in merged


# ---------------------------------------------------------------------------
# Importing from a path: the assets tree stays on disk until it is asked for
# ---------------------------------------------------------------------------


def _demo_bundle_bytes(assets: dict[str, bytes] | None = None) -> bytes:
    import io

    wb = openpyxl.Workbook(write_only=True)
    bundle_io.write_sheet(wb, "Demo", ["a"], [{"a": 1}])
    buf = io.BytesIO()
    wb.save(buf)
    return bundle_io.pack(
        {"format_version": "1"}, buf.getvalue(), assets or {"branding/logo.png": b"PNG"}
    )


def test_parse_bundle_from_a_path_reads_assets_lazily(tmp_path):
    """An import parses from disk, so the applier can pull one asset at a time.

    A workspace's assets are its attachments, diagrams and branding — most of a
    large bundle. Inflating them all at parse time is what made a big import a
    memory problem.
    """
    path = tmp_path / "bundle.zip"
    path.write_bytes(_demo_bundle_bytes({"branding/logo.png": b"PNG", "files/a.bin": b"DATA"}))

    with bundle_io.parse_bundle(path) as parsed:
        assert isinstance(parsed.assets, bundle_io.ZipAssetStore)
        assert parsed.rows("Demo") == [{"a": 1}]
        assert "files/a.bin" in parsed.assets
        assert "files/missing.bin" not in parsed.assets
        assert parsed.assets.get("files/a.bin") == b"DATA"
        assert parsed.assets.get("files/missing.bin") is None
        assert parsed.assets.keys() == ["branding/logo.png", "files/a.bin"]

    # Past the context manager the zip is closed; asking for more is a bug in
    # the caller, and says so rather than returning a silent None.
    import pytest

    with pytest.raises(RuntimeError, match="closed"):
        parsed.assets.get("files/a.bin")


def test_parse_bundle_still_accepts_bytes(tmp_path):
    """Content packs and the tests build bundles in memory; that must keep working."""
    parsed = bundle_io.parse_bundle(_demo_bundle_bytes())
    assert parsed.rows("Demo") == [{"a": 1}]
    assert parsed.assets.get("branding/logo.png") == b"PNG"
    parsed.close()  # closes the in-memory zip; nothing on disk


def test_a_plain_dict_satisfies_the_asset_store_contract():
    # This is what lets build_content_bundle keep passing a dict.
    bundle = bundle_io.WorkspaceBundle(manifest={}, sheets={}, assets={"x": b"y"})
    assert bundle.assets.get("x") == b"y"
    assert "x" in bundle.assets
    assert list(bundle.assets.keys()) == ["x"]
    bundle.close()


def test_an_overflow_cell_is_restored_when_parsing_from_a_path(tmp_path):
    import io
    import json

    big = json.dumps({"blob": "z" * 50000})
    wb = openpyxl.Workbook(write_only=True)
    assets: dict[str, bytes] = {}
    bundle_io.write_sheet(wb, "Big", ["v"], [{"v": big}], assets)
    buf = io.BytesIO()
    wb.save(buf)
    path = tmp_path / "overflow.zip"
    path.write_bytes(bundle_io.pack({"format_version": "1"}, buf.getvalue(), assets))

    with bundle_io.parse_bundle(path) as parsed:
        assert parsed.rows("Big")[0]["v"] == big


def test_a_member_declaring_an_implausible_size_is_refused(tmp_path, monkeypatch):
    """The central directory is checked before a single member is read."""
    import pytest

    from app.services.workspace_io.bundle import BundleFormatError

    # Above the manifest and workbook, below the asset — so it is the asset
    # that trips, which is what the cap is for.
    monkeypatch.setattr(bundle_io, "MAX_ASSET_BYTES", 100_000)
    path = tmp_path / "big-member.zip"
    path.write_bytes(_demo_bundle_bytes({"files/big.bin": b"x" * 200_000}))

    with pytest.raises(BundleFormatError, match="files/big.bin"):
        bundle_io.parse_bundle(path)


def test_a_bundle_whose_members_sum_too_high_is_refused(tmp_path, monkeypatch):
    import pytest

    from app.services.workspace_io.bundle import BundleFormatError

    monkeypatch.setattr(bundle_io, "MAX_BUNDLE_UNCOMPRESSED_BYTES", 500_000)
    path = tmp_path / "bomb.zip"
    path.write_bytes(_demo_bundle_bytes({f"files/{i}.bin": b"x" * 100_000 for i in range(8)}))

    with pytest.raises(BundleFormatError, match="refused"):
        bundle_io.parse_bundle(path)


def test_a_corrupt_file_on_disk_is_reported_as_a_bad_bundle(tmp_path):
    import pytest

    from app.services.workspace_io.bundle import BundleFormatError

    path = tmp_path / "junk.zip"
    path.write_bytes(b"not a zip at all")
    with pytest.raises(BundleFormatError, match="not a valid .zip"):
        bundle_io.parse_bundle(path)


# ---------------------------------------------------------------------------
# Card rows and their ancestor walk
# ---------------------------------------------------------------------------


def _card(name, parent=None, **fields):
    return SimpleNamespace(
        id=uuid.uuid4(),
        name=name,
        parent_id=parent.id if parent is not None else None,
        **fields,
    )


def test_ancestor_names_run_root_first():
    root = _card("Europe")
    mid = _card("Germany", root)
    leaf = _card("Berlin", mid)
    by_id = {c.id: c for c in (root, mid, leaf)}
    assert schema.ancestor_names(leaf, by_id) == ["Europe", "Germany"]
    assert schema.ancestor_names(root, by_id) == []


def test_ancestor_names_stop_at_an_ancestor_not_exported():
    archived = _card("Archived root")
    mid = _card("Kept", archived)
    leaf = _card("Leaf", mid)
    assert schema.ancestor_names(leaf, {c.id: c for c in (mid, leaf)}) == ["Kept"]


def test_ancestor_names_stop_at_a_cycle():
    a = _card("A")
    b = _card("B", a)
    a.parent_id = b.id
    leaf = _card("Leaf", b)
    assert schema.ancestor_names(leaf, {c.id: c for c in (a, b, leaf)}) == ["A", "B"]


def test_ancestor_names_stop_at_the_depth_limit():
    chain = [_card("L0")]
    for i in range(1, schema.MAX_PATH_DEPTH + 3):
        chain.append(_card(f"L{i}", chain[-1]))
    by_id = {c.id: c for c in chain}
    names = schema.ancestor_names(chain[-1], by_id)
    assert len(names) == schema.MAX_PATH_DEPTH
    assert names[-1] == chain[-2].name  # the nearest ancestors are the ones kept


def test_card_ref_escapes_every_segment():
    parent = _card("SAP S/4HANA")
    leaf = _card("Back\\Office", parent)
    assert entities.build_card_ref(leaf, {parent.id: parent, leaf.id: leaf}) == (
        "SAP S\\/4HANA / Back\\\\Office"
    )


def test_card_record_carries_every_card_column():
    parent = _card("Sales/EMEA")
    card = _card(
        "Billing",
        parent,
        type="Application",
        parent_label="Region",
        subtype="businessApplication",
        description="Bills customers",
        external_id="ext-7",
        reference="APP-0042",
        alias="BIL",
        approval_status="APPROVED",
        status="ACTIVE",
        lifecycle_stage="active",
        lifecycle={"active": "2024-01-01"},
        attributes={"criticality": "high"},
        created_via="mcp",
    )
    record = exp._card_record(card, {parent.id: parent, card.id: card})
    assert record == {
        "type": "Application",
        "name": "Billing",
        "parent_path": "Sales\\/EMEA",
        "parent_label": "Region",
        "subtype": "businessApplication",
        "description": "Bills customers",
        "external_id": "ext-7",
        "reference": "APP-0042",
        "alias": "BIL",
        "approval_status": "APPROVED",
        "status": "ACTIVE",
        "lifecycle_stage": "active",
        "lifecycle": {"active": "2024-01-01"},
        "attributes": {"criticality": "high"},
        "created_via": "mcp",
        "source_id": str(card.id),
    }
    assert set(record) == set(exp.CARD_SHEET_COLUMNS)
    assert set(exp.CARD_SHEET_COLUMNS) == {*exp.CARD_COLUMNS, "source_id"}


def test_card_record_writes_empty_dicts_for_missing_json():
    card = _card(
        "Bare",
        type="Application",
        parent_label=None,
        subtype=None,
        description=None,
        external_id=None,
        reference=None,
        alias=None,
        approval_status="DRAFT",
        status="ACTIVE",
        lifecycle_stage=None,
        lifecycle=None,
        attributes=None,
        created_via=None,
    )
    record = exp._card_record(card, {card.id: card})
    assert record["lifecycle_stage"] is None
    assert (record["parent_path"], record["lifecycle"], record["attributes"]) == ("", {}, {})


def test_a_card_matches_its_source_id_only_within_its_own_type():
    from app.services.workspace_io import applier

    cid = "aaaaaaaa-0000-0000-0000-000000000001"
    here = {cid: "Application"}
    assert applier._card_by_source_id(here, "Application", cid.upper()) == cid
    assert applier._card_by_source_id(here, "Organization", cid) is None
    assert applier._card_by_source_id(here, "Application", None) is None
    assert applier._card_by_source_id(here, "Application", "not-an-id") is None
    assert applier._card_by_source_id({}, "Application", cid) is None


# ---------------------------------------------------------------------------
# workspace_io.secrets: exact contract of the secret-exclusion authority.
# ---------------------------------------------------------------------------
import copy as _copy  # noqa: E402

import pytest as _pytest  # noqa: E402

from app.services.workspace_io import secrets as _sec  # noqa: E402


def test_secret_path_tables_are_exact():
    assert _sec.GENERAL_SECRET_PATHS == (("sso", "client_secret"), ("ai", "apiKey"))
    assert _sec.EMAIL_SECRET_PATHS == (
        ("smtp_password",),
        ("oauth_client_secret",),
        ("service_account_json",),
    )
    assert _sec.INSTANCE_LOCAL_FK_COLUMNS == frozenset(
        {"owner_id", "created_by", "updated_by", "archived_by", "user_id", "created_by_id"}
    )
    assert isinstance(_sec.INSTANCE_LOCAL_FK_COLUMNS, frozenset)


@_pytest.mark.parametrize(
    "key,expected",
    [
        ("ext.my-ext.secret.token", True),
        ("ext.my-ext.secret.a.b", True),  # name may itself contain dots
        ("ext.my-ext.secret.", True),
        ("ext.secret.secret.x", True),  # an extension named "secret" with a real secret
        ("ext.secret.token", False),  # extension named "secret": ordinary setting
        ("ext.my-ext.setting.token", False),
        ("ext.my-ext.secret", False),  # only three segments
        ("ext.my-ext", False),
        ("xext.my-ext.secret.token", False),
        ("EXT.my-ext.secret.token", False),
        ("ext.my-ext.SECRET.token", False),
        ("ext.my-ext.secrets.token", False),
        ("my-ext.secret.token.x", False),
        ("", False),
    ],
)
def test_is_extension_secret_key(key, expected):
    assert _sec.is_extension_secret_key(key) is expected


class TestDropPath:
    def test_drops_a_nested_leaf_only(self):
        blob = {"a": {"b": 1, "c": 2}, "d": 3}
        _sec._drop_path(blob, ("a", "b"))
        assert blob == {"a": {"c": 2}, "d": 3}

    def test_drops_a_top_level_key(self):
        blob = {"a": 1, "b": 2}
        _sec._drop_path(blob, ("a",))
        assert blob == {"b": 2}

    def test_missing_intermediate_or_leaf_is_a_noop(self):
        blob = {"a": {"b": 1}}
        _sec._drop_path(blob, ("x", "y"))
        _sec._drop_path(blob, ("a", "zzz"))
        _sec._drop_path(blob, ("a", "b", "c"))
        assert blob == {"a": {"b": 1}}

    def test_non_dict_intermediate_is_tolerated(self):
        blob = {"a": "text", "l": [1, 2]}
        _sec._drop_path(blob, ("a", "b"))
        _sec._drop_path(blob, ("l", "b"))
        assert blob == {"a": "text", "l": [1, 2]}

    def test_leaf_on_non_dict_parent_is_a_noop(self):
        blob = {"a": {"b": ["x"]}}
        _sec._drop_path(blob, ("a", "b", "c"))
        assert blob == {"a": {"b": ["x"]}}


class TestScrubEncrypted:
    def test_removes_enc_values_at_any_depth_and_inside_lists(self):
        node = {
            "keep": "plain",
            "gone": "enc:abc",
            "nested": {"gone": "enc:x", "keep": 1, "deeper": {"gone": "enc:y", "k": [1]}},
            "items": [{"gone": "enc:z", "keep": "a"}, "enc:list-item-kept-as-element", 3],
        }
        assert _sec._scrub_encrypted(node) == {
            "keep": "plain",
            "nested": {"keep": 1, "deeper": {"k": [1]}},
            "items": [{"keep": "a"}, "enc:list-item-kept-as-element", 3],
        }

    def test_only_string_values_with_the_prefix_are_removed(self):
        node = {
            "empty": "",
            "num": 5,
            "none": None,
            "flag": False,
            "upper": "ENC:abc",
            "mid": "x enc:abc",
            "nonstr": ["enc:a"],
        }
        assert _sec._scrub_encrypted(node) == node

    def test_scalars_pass_through_and_input_is_not_mutated(self):
        assert _sec._scrub_encrypted("enc:top") == "enc:top"
        assert _sec._scrub_encrypted(7) == 7
        assert _sec._scrub_encrypted(None) is None
        node = {"a": "enc:q", "b": [{"c": "enc:r"}]}
        before = _copy.deepcopy(node)
        _sec._scrub_encrypted(node)
        assert node == before


class TestStripSecretsContract:
    def test_none_inputs_give_two_empty_dicts(self):
        general, email = _sec.strip_secrets(None, None)
        assert general == {} and email == {}
        assert isinstance(general, dict) and isinstance(email, dict)
        general["x"] = 1  # fresh dicts, not shared
        assert _sec.strip_secrets(None, None)[0] == {}

    def test_each_known_credential_path_is_removed_and_siblings_kept(self):
        general = {
            "sso": {"client_secret": "plain-secret", "client_id": "id", "enabled": True},
            "ai": {"apiKey": "k", "model": "m"},
            "theme": "dark",
        }
        email = {
            "smtp_password": "p",
            "oauth_client_secret": "o",
            "service_account_json": "{}",
            "smtp_host": "h",
            "from": "a@b.c",
        }
        clean_general, clean_email = _sec.strip_secrets(general, email)
        assert clean_general == {
            "sso": {"client_id": "id", "enabled": True},
            "ai": {"model": "m"},
            "theme": "dark",
        }
        assert clean_email == {"smtp_host": "h", "from": "a@b.c"}

    def test_each_email_path_is_independent(self):
        for key in ("smtp_password", "oauth_client_secret", "service_account_json"):
            _, clean = _sec.strip_secrets(None, {key: "v", "keep": 1})
            assert clean == {"keep": 1}

    def test_credential_paths_are_not_cross_applied_between_blobs(self):
        general, email = _sec.strip_secrets(
            {"smtp_password": "x", "sso": {"client_secret": "y"}},
            {"sso": {"client_secret": "z"}, "ai": {"apiKey": "k"}},
        )
        assert general == {"smtp_password": "x", "sso": {}}
        assert email == {"sso": {"client_secret": "z"}, "ai": {"apiKey": "k"}}

    def test_extension_secrets_dropped_from_general_only(self):
        general = {
            "ext.a.secret.token": "plain-text-planted",
            "ext.a.secret.empty": "",
            "ext.a.setting.x": 1,
            "ext.secret.mode": "on",
        }
        email = {"ext.a.secret.token": "kept-in-email"}
        clean_general, clean_email = _sec.strip_secrets(general, email)
        assert clean_general == {"ext.a.setting.x": 1, "ext.secret.mode": "on"}
        assert clean_email == email

    def test_remaining_enc_values_are_scrubbed_in_both_blobs(self):
        general, email = _sec.strip_secrets(
            {"future": {"secret": "enc:g", "ok": 1}, "list": [{"t": "enc:h"}]},
            {"nested": {"x": "enc:e", "y": "fine"}},
        )
        assert general == {"future": {"ok": 1}, "list": [{}]}
        assert email == {"nested": {"y": "fine"}}

    def test_inputs_are_never_mutated(self):
        general = {"sso": {"client_secret": "s", "k": [1]}, "ext.a.secret.t": "v", "e": "enc:1"}
        email = {"smtp_password": "p", "n": {"x": "enc:2"}}
        g0, e0 = _copy.deepcopy(general), _copy.deepcopy(email)
        out_g, _ = _sec.strip_secrets(general, email)
        assert general == g0 and email == e0
        out_g["sso"]["k"].append(2)
        assert general["sso"]["k"] == [1]


def test_is_secret_settings_key_selects_the_right_table():
    for path in _sec.GENERAL_SECRET_PATHS:
        assert _sec.is_secret_settings_key("general", path) is True
        assert _sec.is_secret_settings_key("email", path) is False
    for path in _sec.EMAIL_SECRET_PATHS:
        assert _sec.is_secret_settings_key("email", path) is True
        assert _sec.is_secret_settings_key("general", path) is False
    assert _sec.is_secret_settings_key("general", ("sso",)) is False
    assert _sec.is_secret_settings_key("general", ("sso", "client_id")) is False
    assert _sec.is_secret_settings_key("general", ("client_secret",)) is False
    assert _sec.is_secret_settings_key("General", ("sso", "client_secret")) is False


# The discussion and timeline sections: carried dates, kept empty text
# ---------------------------------------------------------------------------


def _entity_section(sheet: str):
    from app.services.workspace_io.sections import ENTITY_SECTIONS

    return next(s for s in ENTITY_SECTIONS if s.sheet == sheet)


def test_only_the_discussion_and_the_timeline_carry_a_timestamp():
    from app.services.workspace_io.sections import ENTITY_SECTIONS

    carried = {s.sheet: s.carry_timestamps for s in ENTITY_SECTIONS if s.carry_timestamps}
    assert carried == {
        "DocumentComments": ("created_at",),
        "DocumentHistory": ("created_at",),
    }
    comments = _entity_section("DocumentComments")
    assert "created_at" in comments.value_columns()
    assert "updated_at" not in comments.value_columns()
    assert "created_at" in _entity_section("DocumentHistory").value_columns()
    assert "created_at" not in _entity_section("Adrs").value_columns()


def test_empty_text_is_kept_for_the_not_null_text_columns_of_those_two_sections():
    from app.services.workspace_io.sections import ENTITY_SECTIONS

    kept = {s.sheet: s.empty_text_columns() for s in ENTITY_SECTIONS if s.empty_text_columns()}
    assert kept == {
        "DocumentComments": frozenset({"author_name", "body", "kind"}),
        "DocumentHistory": frozenset({"kind"}),
    }


def test_import_value_reads_an_empty_cell_as_empty_text_only_where_kept():
    from app.models.document_comment import DocumentComment

    kept = frozenset({"body"})
    assert entities.import_value(DocumentComment, "body", None, kept) == ""
    assert entities.import_value(DocumentComment, "body", "", kept) == ""
    assert entities.import_value(DocumentComment, "body", "<p>x</p>", kept) == "<p>x</p>"
    assert entities.import_value(DocumentComment, "section", None, kept) is None
    assert entities.import_value(DocumentComment, "body", None, frozenset()) is None
    assert entities.import_value(
        DocumentComment, "created_at", "2026-03-02T09:00:00+00:00", kept
    ) == datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc)


def test_invoice_ids_starting_equals_roundtrip_as_literal_text():
    import io

    from openpyxl import Workbook, load_workbook

    from app.services.workspace_io import bundle as bundle_io

    workbook = Workbook(write_only=True)
    bundle_io.write_sheet(
        workbook,
        "PpmInvoices",
        ["invoice_id", "amount"],
        [{"invoice_id": "=00038", "amount": "30.11"}, {"invoice_id": "00038", "amount": "0"}],
    )
    output = io.BytesIO()
    workbook.save(output)
    rows = bundle_io.read_workbook(output.getvalue())["PpmInvoices"]
    assert [row["invoice_id"] for row in rows] == ["=00038", "00038"]
    reopened = load_workbook(io.BytesIO(output.getvalue()), data_only=False)
    assert reopened["PpmInvoices"]["A2"].data_type == "s"
