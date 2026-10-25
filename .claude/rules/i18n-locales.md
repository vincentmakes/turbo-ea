---
paths:
  - "frontend/src/i18n/**"
  - "frontend/src/hooks/useResolveLabel.ts"
  - "backend/app/services/seed.py"
  - "backend/app/api/v1/settings.py"
  - "backend/app/api/v1/users.py"
  - "scripts/i18n/**"
---

# Locale files, metamodel translations and adding a language

> Loaded when you touch `frontend/src/i18n/**`, `frontend/src/hooks/useResolveLabel.ts`, `backend/app/services/seed.py`, `backend/app/api/v1/settings.py`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

> **Translations are produced by the `/translate` skill** (Sonnet subagent `.claude/agents/translator.md`) through `scripts/i18n/check_locales.py` (`report` / `todo` / `apply`), not by the implementation session; see the rule in `CLAUDE.md` and "Translating with `/translate`" in `CONTRIBUTING.md`. The checklist below is what that skill satisfies.

- **In French a card is « fiche », never « carte ».** The first translation pass used *fiche* (the glossary term, `docs/reference/glossary.fr.md`); later pages drifted to the literal *carte* until 2.127.0 swept both the `fr` locale and every `.fr.md` page back. *Carte* survives only where it is a map — *carte des capacités*, *carte thermique* / *carte de chaleur*, *carte des processus*, the ownership map — so a regex over `\bcartes?\b` is never safe on its own; check the tail. Same gender, so `cette` / `nouvelle` / `aucune` carry over unchanged. Extensions follow the same rule in their own string maps.

- **Metamodel labels — always resolve with the entity-aware resolvers; NEVER pass `.key` as the fallback.** Card-type, relation-type, field, option, and subtype display names are translated via the `translations` JSONB column on `card_types` / `relation_types` (and inline on fields/options/subtypes). Resolve them with the **entity-aware** helpers from `frontend/src/hooks/useResolveLabel.ts`: `useTypeLabel()` / `typeLabel(entity, locale)` for card types (also portal type info and stakeholder role defs), `useRelationLabel()` / `relationLabel(rt, locale, reverse?)` for relation verbs (pass `reverse=true` for the incoming direction), and `useFieldLabel()` / `useOptionLabel()` / `useSubtypeLabel()` (`fieldLabel` / `optionLabel` / `subtypeLabel(entity, locale)`) for fields, options, and subtypes. Pass the **whole entity** — these compute the correct `entity.label || entity.key` fallback internally. **Do NOT call the low-level `useResolveLabel()` / `useResolveMetaLabel()` (`rl` / `rml`, `resolveLabel` / `resolveMetaLabel`) with `entity.key` as the fallback** (e.g. `rml(type.key, type.translations, "label")`). Admin-created custom entities ship with an **empty `translations` map**, so the fallback is exactly what renders — passing `.key` leaks the internal slug ("itAsset") instead of the display name ("IT Asset"). This bug recurred twice (#661 subtypes, #731 card/relation types) precisely because the `.key`-fallback pattern was copied between call sites; the entity-aware resolvers exist so it cannot recur. Use the low-level primitives only for loose string values that have no entity object, and even then pass the human label, never the key. In non-React code (`excelExport.ts`, `excelImport.ts`, plain helpers) use the pure `typeLabel` / `relationLabel` / `fieldLabel` variants with `i18n.language`.

#### Adding a New Language

The locale code is the ISO 639-1 two-letter code throughout (`da`, not `da-DK`). The recipe touches code in three layers (frontend, backend, docs) plus a one-shot data migration. PR [#623](https://github.com/vincentmakes/turbo-ea/pull/623) (Danish) is the canonical worked example.

1. **Frontend locale files**: copy `frontend/src/i18n/locales/en/` to `frontend/src/i18n/locales/{code}/` and translate the values in all 14 JSON files. Keys, placeholders, and `_one`/`_other` plural variants must match the English source exactly — verify with the JSON-parity check below.
2. **Frontend i18n config** (`frontend/src/i18n/index.ts`): add imports for all 14 namespace files, extend the `resources` object, append the code to the `SUPPORTED_LOCALES` tuple, and add a display label to `LOCALE_LABELS`. The `SupportedLocale` type updates automatically.
3. **Metamodel translations** (`backend/app/services/seed.py`): every `translations` dict on card types, subtypes, fields, sections, options, and relation types (label + reverse_label) needs the new locale. A Python regex pass that walks every leaf `"de":` dict and injects the matching value before the closing brace works well — see PR #623's `/tmp/add_da_seed.py` helper for the pattern.
4. **Backend allow-lists** — extend the hardcoded `SUPPORTED_LOCALES` in **both** places: `backend/app/api/v1/settings.py` (governs the `/settings/enabled-locales` validator and the `/settings/bootstrap` fallback) and `backend/app/api/v1/users.py` (governs the `users.locale` write validator). Keeping them in sync is enforced by convention only — there is no shared constant today.
5. **Test fixtures** — bump the hardcoded locale lists in `backend/tests/services/test_i18n_seed.py` (metamodel translation completeness check) and `frontend/src/i18n/i18n.test.ts` (placeholder/plural parity check). Both are pinned arrays, not imports, so they will not pick up the new locale automatically.
6. **MkDocs config** (`mkdocs.yml`) — **two places**: (a) a new language block under `plugins.i18n.languages` with `locale`, `name`, `build: true`, and a full `nav_translations` map mirroring the existing locales; (b) a matching entry in `theme.alternate` (the header dropdown). Omitting `theme.alternate` builds the `/{code}/` site but leaves users no way to switch into it from the UI. Add the code to `plugins.search.lang` as well — `lunr-languages` supports `da` and the major locales out of the box.
7. **Backend `User.locale`**: no migration needed — the column is `String(10)` with no enum constraint.
8. **Backfill existing installs**: an admin who has touched **Admin → Settings → Languages** at least once has the full locale list persisted as `app_settings.general_settings.enabledLocales` (JSONB). That stored list will not pick up the new locale on its own, so the picker hides it even though the constant exposes it. Ship a small Alembic migration that walks the singleton `app_settings` row and appends the new locale if missing. The canonical implementation is `backend/alembic/versions/099_backfill_danish_enabled_locale.py` — Python-side fetch-mutate-update with a `CAST(:s AS jsonb)` write. Don't use a single SQL `UPDATE … jsonb_set(…) WHERE general_settings ? '...' AND … @> …`; the `?` JSONB key-existence operator interacts badly with SQLAlchemy's `text()` named-parameter scanner and silently rolls back in the migration runner.
9. **Docs translations**: create `.{code}.md` siblings for every English `.md` under `docs/` (top-level index, `getting-started/`, `beginners-guide/`, `guide/`, `admin/`, `reference/`). The site builds without them — mkdocs-static-i18n falls back to English per page — but the language picker existing without translated pages confuses users.
10. **Validate**:
    - `python3 -c "import json, glob; [json.load(open(f)) for f in glob.glob('frontend/src/i18n/locales/{code}/*.json')]"` — JSON validity.
    - A second parity script (en keys == new-locale keys, en placeholders == new-locale placeholders) catches the common omissions.
    - `cd backend && ruff format . && ruff check . && python -m pytest tests/services/test_i18n_seed.py -q`.
    - `cd frontend && npm run build && npm run test:run`.
    - `mkdocs build --strict` (catches broken links in the new docs).

Screenshots can stay in `docs/assets/img/en/` and the new docs can reference `../assets/img/en/...` — translating UI screenshots is a separate, optional pass.

#### Translation Checklist for Code Changes

Every change that introduces user-visible content must include translations. Before marking a task as complete, verify:

- [ ] **New UI strings**: Added translation keys to `frontend/src/i18n/locales/en/{namespace}.json` and all 9 non-English locale files (`de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`, `da`, `ar`). Never hardcode English text in components.
- [ ] **New metamodel content** (card types, subtypes, fields, options, sections, relation types): Added `"translations"` dicts with all 9 non-English locales (`de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`, `da`, `ar`) in `backend/app/services/seed.py`.
- [ ] **New select options** (in seed data or reusable option arrays): Each option object includes a `"translations"` dict.
- [ ] **New field labels**: Each field in `fields_schema` includes a `"translations"` dict.
- [ ] **New section names**: Each section in `fields_schema` includes a `"translations"` dict.
- [ ] **New subtypes**: Each subtype includes a `"translations"` dict.
- [ ] **Interpolation preserved**: `{{variable}}` placeholders are identical across all locales.
- [ ] **Plurals**: Keys using counts include both `_one` and `_other` variants in all locales.
- [ ] **JSON valid**: No unescaped double quotes in JSON values. Chinese uses `「」`, others use `«»` or `\"`.
