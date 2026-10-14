"""Running a migration must not silence the loggers the app already created.

``alembic/env.py`` configures logging from ``alembic.ini`` with
``logging.config.fileConfig``. Its default, ``disable_existing_loggers=True``,
sets ``.disabled = True`` on every logger that already exists and is not named
in the ini — and ``app.main`` runs ``command.upgrade`` / ``command.stamp`` at
boot, after ``app.services.audit_log`` has created ``turbo_ea.audit``. So on
every boot that migrated or stamped, the audit stream was silently off for the
rest of the process, while the ``audit_log`` table kept filling.

The behavioural test runs the real ``env.py`` through Alembic in offline
(``--sql``) mode with an empty revision range, which executes the module —
``fileConfig`` included — without a database. It reads ``alembic.ini`` and
``alembic/env.py`` off disk, so the module is a ``source_scan`` and is
deselected under mutmut (``tests/mutation_plugin.py``), whose copy of the tree
is not where these files are looked up; it could not kill a mutant in ``app/``
anyway.
"""

from __future__ import annotations

import ast
import io
import logging
import logging.config
from pathlib import Path

import pytest

pytestmark = pytest.mark.source_scan

BACKEND = Path(__file__).resolve().parents[2]
ENV_PY = BACKEND / "alembic" / "env.py"
ALEMBIC_INI = BACKEND / "alembic.ini"


@pytest.fixture
def restore_logging():
    """``fileConfig`` rewrites the root logger and every existing logger's
    ``disabled`` flag; put all of it back so no other test sees the change."""
    root = logging.getLogger()
    root_state = (root.level, list(root.handlers))
    loggers = {
        name: (lg.level, lg.disabled, lg.propagate, list(lg.handlers))
        for name, lg in logging.Logger.manager.loggerDict.items()
        if isinstance(lg, logging.Logger)
    }
    try:
        yield
    finally:
        root.setLevel(root_state[0])
        root.handlers[:] = root_state[1]
        for name, (level, disabled, propagate, handlers) in loggers.items():
            lg = logging.getLogger(name)
            lg.setLevel(level)
            lg.disabled = disabled
            lg.propagate = propagate
            lg.handlers[:] = handlers


def _run_env_py_offline() -> str:
    """Execute ``alembic/env.py`` the way a boot does, minus the database."""
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.output_buffer = io.StringIO()
    command.upgrade(cfg, "head:head", sql=True)
    return cfg.output_buffer.getvalue()


def test_running_env_py_keeps_the_audit_logger_enabled(restore_logging):
    audit = logging.getLogger("turbo_ea.audit")
    audit.disabled = False
    logging.getLogger("alembic").setLevel(logging.ERROR)

    sql = _run_env_py_offline()

    # Non-vacuity: env.py really ran (offline mode wraps the empty range in a
    # transaction) and so did its fileConfig (the ini sets the alembic level).
    assert "BEGIN;" in sql and "COMMIT;" in sql
    assert logging.getLogger("alembic").level == logging.INFO
    assert audit.disabled is False


def test_the_default_would_have_disabled_it(restore_logging):
    """Control: the bug this guards against is real — ``fileConfig`` with its
    default disables a pre-existing logger the ini does not name."""
    audit = logging.getLogger("turbo_ea.audit")
    audit.disabled = False

    logging.config.fileConfig(str(ALEMBIC_INI))

    assert audit.disabled is True


def _file_config_calls() -> list[ast.Call]:
    tree = ast.parse(ENV_PY.read_text(encoding="utf-8"))
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "fileConfig"
    ]


def test_env_py_passes_disable_existing_loggers_false():
    calls = _file_config_calls()
    assert len(calls) == 1, "env.py should configure logging exactly once"
    kwargs = {kw.arg: kw.value for kw in calls[0].keywords}
    assert "disable_existing_loggers" in kwargs, (
        "alembic/env.py must call fileConfig(..., disable_existing_loggers=False): "
        "the default disables turbo_ea.audit on every boot that migrates"
    )
    value = kwargs["disable_existing_loggers"]
    assert isinstance(value, ast.Constant) and value.value is False
