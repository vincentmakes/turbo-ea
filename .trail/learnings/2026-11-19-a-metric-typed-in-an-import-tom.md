---
title: "A metric typed in an import file is matched by exact key first, then legacy alias, then a unique label"
author: Tom
date: 2026-11-19
branch: notes/metric-matching
cost: { minutes: 67, tokens: 778621 }
id: l-51946217
scope: repo
status: active
src: agent
touches:
  - backend/app/services/license_import.py
---

## Decided
An import row's metric text is resolved in this order: exact metric key, then the legacy alias (the pre-metric names like "Users"), then a label that matches one metric. Two metrics sharing the label give the skip reason ambiguous_metric.

## Tried and ruled out
Matching by label first: a metric whose key equals another metric's label resolved to the wrong one and the row was refused as invalid_metric.

## Watch out
type_not_in_metric must also fire when the type's label is ambiguous in another metric; the skip carries the resolved metric key (or the file's own text when unresolved) so the preview can name the pair.

In the code: backend/app/services/license_import.py (_match_metric, _match_type).
