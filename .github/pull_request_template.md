## Summary

<!-- What does this PR do and why? Keep it brief (1-3 sentences). -->

## Type

<!-- Check all that apply. -->

- [ ] feature
- [ ] fix
- [ ] refactor
- [ ] docs
- [ ] chore (CI / build / dependency / housekeeping)
- [ ] security

## Changes

<!-- Bulleted list of the key changes. -->

-

## Test Plan

<!-- How did you verify this works? Be specific — "ran the tests" is not enough. List the concrete steps you took, the data you used, and the result. CI runs automatically on every PR. -->

-

- [ ] All CI checks pass (backend lint, backend tests, frontend lint, frontend build, frontend tests, mutation tests)
- [ ] Manually tested the affected feature
- [ ] Added/updated tests for new or changed behavior
- [ ] Mutation gate: my tests kill the mutants on the lines I changed (`make mutation-diff`). Score: ___ %. Every surviving mutant I kept and every `no mutate` / `Stryker disable` pragma I added is listed below with its reason

## Checklist

- [ ] My changes follow the conventions in `CLAUDE.md`
- [ ] I added permission checks to any new mutating endpoints
- [ ] I created an Alembic migration for any schema changes
- [ ] I did not introduce hardcoded card types or fields (metamodel is data-driven)
- [ ] I used `async def` for all new route handlers and DB operations
- [ ] I did not expose sensitive fields (password hashes, encrypted secrets) in API responses
- [ ] I bumped `/VERSION` and added a `CHANGELOG.md` entry (if user-facing change)
- [ ] I added translations for new UI strings in all 10 locales (if applicable)
- [ ] I updated user documentation in `docs/` (if UI or feature change)
- [ ] Screenshots attached for UI changes (if applicable)
