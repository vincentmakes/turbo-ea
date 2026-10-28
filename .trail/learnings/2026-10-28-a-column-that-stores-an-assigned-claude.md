---
title: "A column that stores an assigned role key is as wide as roles.key, and a guard test discovers every such column so widening never has to be remembered"
author: Claude
date: 2026-10-28
branch: fix/role-key-length-1330
cost: { minutes: 24, tokens: 163474 }
id: l-9c15983b
scope: repo
status: active
src: agent
touches:
  - backend/app/models/user.py
  - backend/app/models/sso_invitation.py
  - backend/tests/conftest.py
  - backend/app/models/role.py
  - backend/alembic/versions/158_fix_arabic_relation_verbs.py
---

## Decided
- Roles can be created with keys up to 50 characters, but the two columns that store an *assigned* key (a user's role, an SSO invitation's role) were 20 wide, so a long role was creatable and never assignable (#1330, fixed in 2.180.3). The fix widens those columns to the width of roles.key; capping keys at 20 instead would have stranded roles that already exist with longer keys.
- The guard test discovers every String column whose name contains "role" from the live model metadata and requires it to be at least as wide as roles.key, with a reasoned allowlist for the columns that hold something else (a card's part in a risk, a stakeholder role key). A new table storing a role key is therefore guarded without anyone listing it.
- Migration 159 exposes the (table, column) pairs it widens as a constant, and the unit test runs upgrade/downgrade against a patched `op` and pins the exact alter_column calls, so the migration itself carries a mutation score.
- The create-role helper text now states the 3–50 character range, next to the input's maxLength: a silent cap on paste would otherwise create a role under a different key than the one typed.

## Tried and ruled out
- Expecting the mutation gate to have caught this: it scores whether tests notice changes to code they already run. No test ever assigned a role key longer than 20 characters, so a mutated column width behaves identically under every fixture, and the PR gate is diff-scoped so the old `String(20)` never sat on a changed line. A cross-table invariant (two columns must agree in width) needs its own test; a per-function mutation score never surfaces it.
- A foreign key from sso_invitations.role to roles.key while here: it would change what deleting or archiving a role must do to pending invitations, which is a separate decision.

## Watch out
- The regression tests read the row back with `populate_existing=True` (helper `stored_role` in conftest); asserting on the response alone would pass against the session's cached object even if the write failed later.
- The pattern maximum is exactly 50 (`^[a-z][a-z0-9_]{1,48}[a-z0-9]$`); `LONG_ROLE_KEY` in conftest is pinned to that length with an assert.

In the code:
- backend/app/models/user.py, backend/app/models/sso_invitation.py: `role` is `String(50)`.
- backend/alembic/versions/159_widen_user_role_columns.py: `ROLE_KEY_COLUMNS`, `OLD_LENGTH`, `NEW_LENGTH`.
- backend/tests/services/test_role_key_column_widths.py: `_role_named_columns`, `NOT_A_ROLE_KEY`.
- backend/tests/conftest.py: `LONG_ROLE_KEY`, `create_role(..., is_default=)`, `stored_role`.
