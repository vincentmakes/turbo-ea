"""The two small helpers behind the diagram dry run, without a database."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.api.v1.diagrams import _discard_dry_run, _xml_of


class TestXmlOf:
    def test_reads_the_xml(self):
        assert _xml_of({"xml": "<mxGraphModel/>"}) == "<mxGraphModel/>"

    def test_no_data_or_no_xml_is_empty(self):
        assert _xml_of(None) == ""
        assert _xml_of({}) == ""
        assert _xml_of({"xml": None}) == ""


class TestDiscardDryRun:
    async def test_rolls_back_an_open_savepoint(self):
        savepoint = SimpleNamespace(is_active=True, rollback=AsyncMock())
        await _discard_dry_run(savepoint)
        savepoint.rollback.assert_awaited_once_with()

    async def test_leaves_a_closed_savepoint_alone(self):
        savepoint = SimpleNamespace(is_active=False, rollback=AsyncMock())
        await _discard_dry_run(savepoint)
        savepoint.rollback.assert_not_awaited()

    async def test_a_real_write_has_no_savepoint(self):
        await _discard_dry_run(None)
