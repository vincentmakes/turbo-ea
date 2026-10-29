---
title: "A test constant named like a key trips the secret scan, and once pushed only an exact-value allowlist clears it, not a rename"
author: Claude
date: 2026-10-28
branch: fix/role-key-length-1330
cost: { minutes: 2, tokens: 21381 }
id: l-1d4a7996
scope: repo
status: active
src: agent
touches:
  - ".gitleaks.toml"
  - CHANGELOG.md
  - VERSION
  - backend/alembic/versions/159_widen_user_role_columns.py
  - backend/app/models/sso_invitation.py
  - backend/app/models/user.py
  - backend/tests/api/test_auth.py
  - backend/tests/api/test_auth_sso_callback.py
  - backend/tests/api/test_users.py
  - backend/tests/api/test_users_bulk.py
---

## Decided
- The Secret Scan (gitleaks) scans the PR's whole commit range, base to head. A finding in a commit that is already pushed stays red on every later run even after the line is renamed or removed, so the answer is an exact-value allowlist entry in the gitleaks config, scoped to the one file, with a reason — the form the config's existing fixture entries use. Never a directory, a rule id or a `.gitleaksignore` fingerprint (the bot's suggestion); the config's header says so.
- Pick fixture names that do not end in KEY, TOKEN, SECRET, PASSWORD or similar when the value is a long identifier-like string: the generic-api-key rule matches on the variable name plus a high-entropy value, and a 50-character snake_case role name has enough entropy.

## Tried and ruled out
- Renaming the constant: the first commit still carries the value, and the scan covers it.
- Running gitleaks locally in the cloud session: the release-binary download is refused by the sandbox, so CI is the only verification; validate the TOML with `tomllib` before pushing.

## Watch out
- The bot comments the fingerprint command on the PR; the repo rule still applies — nothing is posted back, the allowlist commit is the answer.

In the code:
- `.gitleaks.toml`: `[[allowlists]]` with `paths = ['''^backend/tests/conftest\.py$''']`, `regexTarget = "secret"`, the value as an anchored regex.
- Validate: `python -c "import tomllib; tomllib.load(open('.gitleaks.toml','rb'))"`.
