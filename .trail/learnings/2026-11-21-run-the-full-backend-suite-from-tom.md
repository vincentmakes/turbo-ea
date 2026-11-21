---
title: Run the full backend suite from a writable Linux copy of the reviewed commit
author: Tom
date: 2026-11-21
branch: fix/align-upstream-main
id: l-161cabe9
scope: repo
status: active
src: agent
touches:
  - backend/tests/services/test_archimate_generator.py
---

## Decided

Extract the reviewed Git tree into the disposable Linux container and run it there against isolated PostgreSQL.

## Tried and ruled out

A read-only bind mount makes the full suite fail, even when the same test passes in a writable checkout.

## Watch out

The ArchiMate generator test writes a temporary XML fixture next to the test file.

In the code: `backend/tests/services/test_archimate_generator.py`.
