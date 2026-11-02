---
title: "A security entry in public text names the mechanism, never what it protected; a pushed commit message is public text too"
author: Claude
date: 2026-11-02
branch: claude/charming-wozniak-jamr5e
id: l-1054e5dd
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs/admin/extensions.md
  - backend/app/services/extensions/license.py
  - backend/alembic/versions/162_encrypt_extension_license_text.py
---

## Decided
- When a change hardens how something is stored (encryption at rest, a credential moved under the shared helper), every public text says what the product now does and nothing about what was exposed before: the CHANGELOG entry, the PR title and body, the user manual in all ten locales, the commit message, and the docstrings of the helper, model, migration and tests. "Licence files are now stored encrypted at rest" is the whole entry. The vendor sells the product behind these files, so a sentence explaining why the fix was needed is a disclosure about their commercial offering, written in the public repository.
- Rationale that needs the sensitive fact belongs in the private extensions repository, not in a core docstring. A core docstring may justify a design by a mechanism that is already public (the signature covers the envelope's exact bytes, so the whole text is encrypted) and stop there.
- The commit message is public the moment the branch is pushed, and it survives a squash merge as a reachable object on GitHub. Write it clean the first time; rewriting it afterwards needs a force-push, which the auto-mode classifier refuses and the user must approve or run themselves.

## Tried and ruled out
- Editing the PR description after the fact. It works, but GitHub keeps the previous revision behind the "edited" dropdown, so a repo admin still has to delete that revision by hand.
- Leaving the old wording in the branch commits because the squash merge replaces them. The old SHAs stay fetchable until GitHub garbage-collects them, which is why the user asked for the rewrite.

## Watch out
- The first draft of this very PR named the credential in six places (changelog, PR summary and test plan, manual paragraph, commit message, four docstrings, one test docstring) before the user caught it. Grep the branch diff for the credential's name before opening a PR that touches secret storage.

In the code:
- Clean wording: CHANGELOG.md 2.186.5 Security; docs/admin/extensions.md step 4 paragraph; backend/app/services/extensions/license.py seal_license_text docstring; backend/alembic/versions/162_encrypt_extension_license_text.py module docstring.
- Check before a PR: `git diff origin/main --name-only | xargs grep -n -i "<credential name>"` over everything that is not a test fixture or an existing public field.
