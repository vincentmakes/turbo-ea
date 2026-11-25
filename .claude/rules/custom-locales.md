---
paths:
  - "backend/app/services/language_pack.py"
  - "backend/app/services/custom_locale_translate.py"
  - "backend/app/api/v1/custom_locales.py"
  - "backend/app/models/custom_locale*.py"
  - "backend/alembic/versions/*custom_locales*.py"
  - "frontend/src/i18n/customLocales.ts"
  - "frontend/src/hooks/useCustomLocales.ts"
  - "frontend/src/features/admin/customLocales/**"
  - "docs/admin/custom-languages.md"
---

# Custom languages (admin-added UI locales)

> Loaded when you touch the custom-language service, routes, models, the frontend registry or its admin section (full list in the frontmatter).

- **A custom language is data; the ten built-in languages are code and stay exactly as they are.** `custom_locales` (code, native `name`, `english_name`, `rtl`, `enabled`, transient `translate_job`) and `custom_locale_strings` (one row per locale + namespace: `strings` `{flat_key: text}` and `meta` `{flat_key: {"h": source hash, "o": manual|ai|import|mcp}}`). A code must match `^[a-z]{2,3}(-[A-Z]{2})?$` and is never a built-in code. Built-in locales keep their bundled files, `SUPPORTED_LOCALES` and `useEnabledLocales`; never route a built-in through the custom path, and never add a custom code to those lists. Adding a *bundled* language is the recipe in `i18n-locales.md`, not this. Scope is the 14 UI namespaces only: metamodel labels (`translations` JSONB) and the docs site are not covered.
- **The English catalogue is the source of truth on the backend too.** `app/services/language_pack.py` is pure (no DB, no FastAPI — a future community-pack CI reuses it) and reads `frontend/src/i18n/locales/en` (copied into the backend image at `/app/i18n/en`; `I18N_EN_DIR` overrides). A flat key is the English JSON path joined with `"."`. Missing catalogue at runtime: management routes answer 503 `catalog_unavailable`, the bundle still serves what is stored.
- **One validator is the single gate for every untrusted value** — file import, AI output, MCP `submit_translations`, manual edits. Per key, with a reason code (`unknown_key|empty|too_long|placeholder_mismatch|nesting_mismatch|markup_not_in_source|url_not_in_source|control_chars|not_a_string`): the `{{placeholder}}` multiset and `$t(...)` references equal English's, no tag or URL that English lacks, no control characters but `\n`/`\t`, length ≤ `4 × English + 200`. A rejected key never blocks the others. Never add a second, looser path that writes strings without it.
- **Staleness is a source-hash diff, never a timestamp.** `source_hash` = first 12 hex of sha256 of the English text, stored per key in `meta`. Status: `missing` (no value), `stale` (hash ≠ current English hash — still served, an old translation beats English), `translated`, `obsolete` (key gone from English: never served, pruned on write). An import that carries `source_hashes` stores those, so a pack made on an older version shows as stale where English moved. Plural keys beyond `_one`/`_other` are accepted as `<base>_<zero|one|two|few|many|other>` when `<base>_other` exists, validated against it.
- **The bundle has the shape of a built-in file.** `GET /custom-locales/{code}/bundle` rebuilds each namespace by walking the English tree, so i18next resolves it exactly like a bundled locale; it is public for an enabled locale (ETag = content hash, `If-None-Match` → 304) and `admin.settings`-only for a disabled one (else 404).
- **Never hold a DB session across an LLM call.** `custom_locale_translate.py` runs one in-process task per locale: read what to translate → commit/close → call the LLM → a fresh short session to merge the chunk and update `translate_job`. Chunks are ≤ 40 strings / ~6000 chars with numeric ids, not keys; every answer goes through the validator; `mode: "all"` skips `manual` strings unless `include_manual`. A job still `running` at startup is marked `interrupted`.
- **Every route is `admin.settings`**, every mutation goes through `audit_log.record`, `translate` is rate-limited, `users.locale` accepts only an *enabled* custom code, and deleting a locale resets its users to `en`. The AI suggestion language for a custom locale is its stored `english_name`, never client text.
- **MCP** (`list_custom_languages`, `get_untranslated_strings`, `submit_translations`) lives in `mcp-server/turbo_ea_mcp/server.py` under the rules of `mcp-server.md`: the write tool forwards `dry_run` and `origin: "mcp"` to `POST …/strings`, caps at `MCP_MAX_TRANSLATIONS_PER_CALL`, refuses `null` (clearing stays in the web app) and is not reversible by `rollback_batch`. Its translation instructions mirror the export file's — change both together.
- **Workspace transfer**: both tables transfer (the two JSONB blobs as JSON assets, `translate_job` excluded) — follow `workspace-transfer.md`.
