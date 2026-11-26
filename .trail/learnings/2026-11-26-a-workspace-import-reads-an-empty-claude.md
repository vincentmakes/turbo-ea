---
title: "A workspace import reads an empty text cell back as an empty string in every section, and a column the sheet lacks takes its default"
author: Claude
date: 2026-11-26
branch: claude/busy-hopper-jb83hf
cost: { minutes: 35, tokens: 466877 }
id: l-4444c3ea
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/admin/WorkspaceTransferAdmin.test.tsx
  - ".env.example"
  - ".github/workflows/ci.yml"
  - CHANGELOG.md
  - CLAUDE.md
  - Dockerfile
  - README.md
  - VERSION
  - backend/alembic/versions/177_custom_locales.py
  - backend/app/api/v1/ai_suggest.py
---

## Decided
Issue #1435: a cost line saved without a description failed the whole workspace import with a NOT NULL violation. The workbook stores "" as an empty cell, which comes back as None. Only the two discussion sections had opted in to reading it back as "". The opt-in is gone: every entity section now reads an empty cell in a NOT NULL text column as "". Cost lines, to-dos, comments and PPM titles can all legitimately hold "".

A column that no row of the sheet carries is a bundle older than the column, not an empty value. It is left out of the insert so the model default applies. Only empty-text columns get that treatment.

The owner chose to keep imported users deactivated, because no password travels. The preview and the result now say how many users that is, through `SectionResult.notes` ("users_deactivated"), shown as a banner above the report table.
A call written as t(key, "English default", { count }) falls back to the default text when the key is emptied. That default is the plural sentence, so a test using a count of 2 renders the same words either way, and Stryker's StringLiteral mutant on the key survives. One extra test with a count of 1 catches it: the real key gives the _one form ("1 user was…"), the fallback gives "1 users were…". This was PR #1438, the deactivated-users banner.

## Tried and ruled out
Leaving out every column the sheet lacks, for all columns: several rewriters in remap.py read kwargs["col"] directly and would raise KeyError on an older bundle.

Restoring is_active from the source: a local user would then be active with no password.
Suppressing the key mutant with a pragma: it is not equivalent, because a wrong key would ship the English plural to every locale. The mutants on the fallback sentences themselves are a different case. They are equivalent while the en bundle is loaded, since t() never returns the default, so they were reported as kept survivors, not suppressed.

## Watch out
SQLAlchemy already drops an explicit None and fires the Python default for a column that has one. So the missing-column case only matters once empty text becomes "", and that is the case its test guards.

One bad row still fails the whole import, because the entity pass flushes once per section with no savepoint per row. That is a known follow-up.

In the code: workspace_io/entities.py `empty_text_columns`, `apply_entity_section` (`absent_text`); applier.py `SectionResult.note`, `_apply_users`; WorkspaceTransferAdmin.tsx `ReportTable`.
The applied and preview wordings are separate keys, so each needs its own singular test. A frontend mutation gate passing at 76% can still hide a real survivor like this one; read the survivor list, not just the score.

In the code: frontend/src/features/admin/WorkspaceTransferAdmin.tsx ReportTable banner; test "uses the singular for one user the applied import created deactivated" in WorkspaceTransferAdmin.test.tsx.
