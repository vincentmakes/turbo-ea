---
title: Keep booked costs independent of manually assigned lifecycle stages
author: Tom
date: 2026-11-22
branch: feat/custom-lifecycle-stages
id: l-497da97e
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - docs/guide/card-details.de.md
  - docs/guide/inventory.de.md
  - backend/app/models/card.py
  - backend/app/services/lifecycle.py
  - backend/app/services/cost_report.py
---

## Decided
An application in testing or being retired can still incur booked costs.

## Tried and ruled out
We considered using the assigned stage to exclude it from the fiscal-year total and kept the existing date-based cost rule instead.

## Watch out
Use an explicit filter when the question is how much the operational portfolio costs.

In the code: backend/app/models/card.py stores the assigned lifecycle_stage. backend/app/services/lifecycle.py defines is_live_in_fiscal_year, which backend/app/services/cost_report.py uses for cost eligibility.
