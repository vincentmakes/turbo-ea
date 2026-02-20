## Summary

<!-- What does this PR do and why? Keep it brief (1-3 sentences). -->

## Changes

<!-- Bulleted list of the key changes. -->

-

## Test Plan

<!-- How did you verify this works? Be specific. -->

- [ ] Backend linting passes (`ruff check . && ruff format --check .`)
- [ ] Frontend linting passes (`npm run lint`)
- [ ] Frontend builds without errors (`npm run build`)
- [ ] Manually tested the affected feature
- [ ] Existing tests pass (`pytest`)

## Checklist

- [ ] My changes follow the conventions in `CLAUDE.md`
- [ ] I added permission checks to any new mutating endpoints
- [ ] I created an Alembic migration for any schema changes
- [ ] I did not introduce hardcoded card types or fields (metamodel is data-driven)
- [ ] I used `async def` for all new route handlers and DB operations
- [ ] I did not expose sensitive fields (password hashes, encrypted secrets) in API responses
- [ ] Screenshots attached for UI changes (if applicable)
