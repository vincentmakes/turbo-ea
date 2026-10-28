---
title: "The translator agent can report success while leaving English or a child's word behind: check its output"
author: Claude
date: 2026-10-28
branch: claude/busy-sagan-7kbwf1
cost: { minutes: 25, tokens: 356046 }
id: l-6299d06e
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/alembic/versions/157_record_provenance.py
  - backend/app/api/v1/adr.py
  - backend/app/api/v1/bpm_workflow.py
  - backend/app/api/v1/cards.py
  - backend/app/api/v1/comments.py
  - backend/app/api/v1/diagrams.py
  - backend/app/api/v1/soaw.py
  - backend/app/models/architecture_decision.py
---

## Decided
After `/translate`, read back what it wrote instead of trusting its report. On #1327 it reported 4 UI keys translated in all nine locales and "no value equals its English text", yet every `metamodel.relationValueErrors.*` key in the nine `admin.json` files was the English sentence copied verbatim. It also gave relProcessToApp's "Usage" field the text of its last option, "Orchestrates", in all nine languages (the Danish #152 slip again). The seed tests passed because the parent/child leak test compared a relation's verb with its attributes, but never a relation *field* with its own options.

## Tried and ruled out
- Relying on the translator's table and its own test run: its i18n checks are parity and placeholder checks, so an English value in a locale file passes them.
- Re-running `/translate` for four keys: it was quicker and more reliable to write the 36 strings by hand, reusing each locale's existing words for "type", "value" and "hide" and its quote style (`„…“`, `« … »`, `「…」`).

## Watch out
- A one-line check finds copied English: grep the new key in a non-English locale and compare it with `en`.
- The relation `attributes_schema` boot merge (`_fill_builtin_attribute_translations`) fills missing locales only, so a wrong translation that ships needs a guarded migration (152 Danish, 158 Arabic) to reach existing installs.

In the code: `backend/tests/services/test_i18n_seed.py` `_parent_child_pairs` now yields relation field → options pairs, and `TestRelationAttributeTranslations` requires every relation attribute and option to be translated; `frontend/src/i18n/locales/*/admin.json` `metamodel.relationValueErrors.*`.
