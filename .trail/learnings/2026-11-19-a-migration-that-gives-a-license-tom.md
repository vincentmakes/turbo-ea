---
title: A migration that gives a license type a second metric must drop the old unique key before it copies the row
author: Tom
date: 2026-11-19
branch: feat/licensing-metrics
cost: { minutes: 114, tokens: 1524134 }
id: l-253b5627
scope: repo
status: active
src: agent
touches:
  - backend/alembic/versions/192_license_metrics.py
  - backend/app/services/license_metrics_migration.py
  - backend/app/services/workspace_io/applier.py
  - backend/app/services/workspace_io/license_compat.py
---

## Decided
Migration 192 runs in this order: add metric_key nullable, fill it from the cells, drop unique(key), duplicate the rows of a type used under both metrics, then set NOT NULL and add unique(metric_key, key).
The import treats a bundle as written before license metrics when the LicenseMetrics sheet is absent from the bundle, or when LicenseTypes rows have no metric_key column.

## Tried and ruled out
Swapping the unique constraint first and duplicating after: the copy of a row has the same key, so it violates the old unique(key) before the new constraint exists.
Testing bundle.rows("LicenseMetrics") for emptiness: it returns [] both for an absent sheet and an empty one, so a new bundle from an instance with an empty metric catalogue would be converted as if it were old.
An empty metric_key cell as the signal: one hand-edited row switched the whole bundle to old mode, which makes every metric insert-only.

## Watch out
The plan itself had the wrong order until a fresh reader caught it. Any migration that widens a uniqueness from one column to two must be checked for the same trap.

In the code: backend/alembic/versions/192_license_metrics.py, backend/app/services/license_metrics_migration.py (apply_type_plan).
Old-bundle rows are insert-only and never change archived or sort_order of rows the target already has.

In the code: backend/app/services/workspace_io/applier.py (_apply_license_catalogue), backend/app/services/workspace_io/license_compat.py.
