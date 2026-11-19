---
title: A migration that gives a license type a second metric must drop the old unique key before it copies the row
author: Tom
date: 2026-11-19
branch: feat/licensing-metrics
cost: { minutes: 56, tokens: 759081 }
id: l-253b5627
scope: repo
status: active
src: agent
touches:
  - backend/alembic/versions/192_license_metrics.py
  - backend/app/services/license_metrics_migration.py
---

## Decided
Migration 192 runs in this order: add metric_key nullable, fill it from the cells, drop unique(key), duplicate the rows of a type used under both metrics, then set NOT NULL and add unique(metric_key, key).

## Tried and ruled out
Swapping the unique constraint first and duplicating after: the copy of a row has the same key, so it violates the old unique(key) before the new constraint exists.

## Watch out
The plan itself had the wrong order until a fresh reader caught it. Any migration that widens a uniqueness from one column to two must be checked for the same trap.

In the code: backend/alembic/versions/192_license_metrics.py, backend/app/services/license_metrics_migration.py (apply_type_plan).
