---
title: "pytest 9.2 breaks the mutation jobs: keep pytest below 9.2 until mutmut is bumped"
author: Claude
date: 2026-10-28
branch: feat/mcp-batches-and-record-provenance
cost: { minutes: 2, tokens: 42228 }
id: l-8c350551
scope: repo
status: active
src: agent
touches:
  - backend/pyproject.toml
  - mcp-server/pyproject.toml
  - CHANGELOG.md
  - VERSION
  - backend/alembic/versions/157_record_provenance.py
  - backend/app/api/v1/adr.py
  - backend/app/api/v1/bpm_workflow.py
  - backend/app/api/v1/cards.py
  - backend/app/api/v1/comments.py
  - backend/app/api/v1/diagrams.py
---

## Decided
- Both Python suites cap pytest below 9.2 next to the exact mutmut 3.8.0 pin. pytest 9.2.0 removed the private `Node._nodeid`; mutmut 3.8.0's stats collector reads `item._nodeid` in its `pytest_runtest_teardown` hook. Any mutation job that has new tests to collect stats for therefore crashes on the first one, whatever the PR changed. pytest 9.1.x still sets the attribute.
- Lift the cap only together with a mutmut release that reads `nodeid` instead, and check the PR mutation jobs on that bump.

## Tried and ruled out
- Treating the red MCP Mutation Tests job as a problem with the new tests: the error names pytest-asyncio's `Coroutine` item, which makes it look async-specific, but every item type lacks `_nodeid` on 9.2. The nightly stayed green only because its cached stats meant no new tests were collected.

## Watch out
- The symptom is "failed to collect stats. runner returned 1" with `AttributeError: 'Coroutine' object has no attribute '_nodeid'` in the job log, and no score at all.
- Backend and MCP dev deps are unpinned ranges installed fresh by CI (`pip install -e ".[dev]"`), so a new upstream release can break a job with no change in this repo.

In the code:
- `backend/pyproject.toml` and `mcp-server/pyproject.toml`: `pytest>=8.0…,<9.2` beside `mutmut==3.8.0`
- mutmut 3.8.0 `mutmut/runners/harness.py` `StatsCollector.pytest_runtest_teardown`
