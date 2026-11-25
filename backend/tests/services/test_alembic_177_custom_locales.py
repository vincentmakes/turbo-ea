"""Migration 177 builds the two custom-language tables exactly as the models do.

The CI rollback job builds the schema with ``create_all`` and then downgrades
one step, so every constraint name the migration uses must be the model's. No
DB: names and columns are read off the models and the migration source.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa

from app.models.custom_locale import CustomLocale, CustomLocaleString

_MIG_PATH = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "177_custom_locales.py"
_spec = importlib.util.spec_from_file_location("mig177", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)
SOURCE = _MIG_PATH.read_text()


def test_revision_chain():
    assert (mig.revision, mig.down_revision) == ("177", "176")


def test_the_migration_imports_no_app_code():
    assert "from app" not in SOURCE
    assert "import app" not in SOURCE


def test_table_names_match_the_models():
    assert mig.LOCALES == CustomLocale.__table__.name == "custom_locales"
    assert mig.STRINGS == CustomLocaleString.__table__.name == "custom_locale_strings"


def test_the_named_unique_constraint_is_the_models():
    uniques = [
        c for c in CustomLocaleString.__table__.constraints if isinstance(c, sa.UniqueConstraint)
    ]
    assert [(c.name, [col.name for col in c.columns]) for c in uniques] == [
        ("uq_custom_locale_strings_locale_ns", ["locale_id", "namespace"])
    ]
    assert mig.UNIQUE_LOCALE_NAMESPACE == "uq_custom_locale_strings_locale_ns"


def test_the_code_is_unique_by_column_flag_on_both_sides():
    """``unique=True`` on the column in model and migration alike, so PostgreSQL
    names it ``custom_locales_code_key`` on a fresh install and an upgrade."""
    assert CustomLocale.__table__.columns["code"].unique is True
    assert 'sa.Column("code", sa.String(length=10), nullable=False, unique=True)' in SOURCE
    assert not [
        c
        for c in CustomLocale.__table__.constraints
        if isinstance(c, sa.UniqueConstraint) and c.name
    ]


def test_columns_and_types():
    loc = CustomLocale.__table__.columns
    assert {
        name: (type(loc[name].type).__name__, getattr(loc[name].type, "length", None))
        for name in ("code", "name", "english_name")
    } == {
        "code": ("String", 10),
        "name": ("String", 100),
        "english_name": ("String", 100),
    }
    assert loc["translate_job"].nullable is True
    assert loc["enabled"].nullable is False and loc["rtl"].nullable is False
    strings = CustomLocaleString.__table__.columns
    assert strings["namespace"].type.length == 50
    (fk,) = strings["locale_id"].foreign_keys
    assert fk.target_fullname == "custom_locales.id"
    assert fk.ondelete == "CASCADE"
    assert 'ondelete="CASCADE"' in SOURCE
    assert SOURCE.count("server_default=sa.func.now()") == 2
    assert "def downgrade" in SOURCE and "op.drop_table(STRINGS)" in SOURCE
