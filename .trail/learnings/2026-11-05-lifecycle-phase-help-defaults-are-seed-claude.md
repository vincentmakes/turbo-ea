---
title: Lifecycle phase help defaults are seed data served while the setting key is absent; a saved empty map means no help
author: Claude
date: 2026-11-05
branch: feat/help-tooltips-roles-lifecycle
cost: { minutes: 21, tokens: 425786 }
id: l-e7204faf
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - backend/app/services/lifecycle_phase_help.py
  - backend/app/services/seed.py
  - backend/tests/api/test_settings_lifecycle_phase_help.py
  - backend/tests/services/test_i18n_seed.py
  - backend/tests/services/test_lifecycle_phase_help.py
  - docs/admin/metamodel.ar.md
  - docs/admin/metamodel.da.md
  - docs/admin/metamodel.de.md
  - docs/admin/metamodel.es.md
---

## Decided
- The default explanation of each lifecycle phase lives beside the other built-in labels in the seed module, one entry per phase with an English label and nine translations, and is served whenever the app-settings key for phase help has never been written. Once an admin saves, the stored map wins whole, so saving all five phases empty removes the help rather than restoring the defaults. The admin panel therefore opens prefilled on a fresh install, and the first save's audit row records the default texts it replaced.
- The defaults are read from the seed inside the function, not at import time, because the seed module pulls in half the services layer.

## Tried and ruled out
- Writing the defaults into the database at seed time: a code-level default keeps them translatable with the rest of the seed and needs no migration or marker, like the currency and date-format defaults.
- Frontend i18n keys as the fallback: the admin panel could not show them as editable text and the bootstrap payload would not carry them.

## Watch out
- The seed parity test checks every lifecycle phase entry in all nine locales, so a new or reworded default fails it until the translate skill has run.

In the code:
- `LIFECYCLE_PHASE_HELP` in `backend/app/services/seed.py`; `default_phase_help` and `read_phase_help` in `backend/app/services/lifecycle_phase_help.py`; tests in `backend/tests/services/test_lifecycle_phase_help.py`, `test_i18n_seed.py::TestLifecyclePhaseHelpTranslations`, `backend/tests/api/test_settings_lifecycle_phase_help.py`.
