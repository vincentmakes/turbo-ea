---
paths:
  - "docs/**"
  - "mkdocs.yml"
  - "scripts/screenshots/**"
---

# The user manual (MkDocs) and screenshot automation

> Loaded when you touch `docs/**`, `mkdocs.yml`, `scripts/screenshots/**` (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

### User Documentation (User Manual)

Every feature or UI change **must** include updates to the user manual. The user manual lives in `docs/` and is built with **MkDocs Material** + **mkdocs-static-i18n**. It deploys automatically to Cloudflare Pages on every push to `main`. See `CONTRIBUTING.md` for the full documentation guide — the rules below are the mandatory checklist for every change.

#### Documentation Structure

```
docs/
├── index.md / index.{locale}.md          ← Homepage
├── assets/img/{en,es,de,...}/            ← Per-language screenshots
├── getting-started/                      ← Onboarding pages
├── guide/                                ← Feature documentation
├── admin/                                ← Administration guides
└── reference/glossary.md / .{locale}.md  ← Glossary
```

Files use **suffix-based** i18n: `page.md` is English (default), `page.es.md` is Spanish, `page.de.md` is German, etc. Untranslated pages fall back to English automatically.

#### When to Update Docs

| Change Type | Required Doc Update |
|-------------|-------------------|
| **New feature** | Add or update the relevant guide/admin page in **all supported languages** (currently `en` + locale suffixes for `es`, `de`, `fr`, `it`, `pt`, `zh`, `ru`, `da`). |
| **UI change** | Replace affected screenshots in **all locale folders** under `docs/assets/img/`. |
| **New admin setting** | Update the appropriate admin page (e.g., `docs/admin/settings.md`). |
| **New API endpoint** | Document in the relevant guide page if user-facing. |
| **Terminology change** | Update the glossary (`docs/reference/glossary.md` + all locale variants). |
| **New page** | Create `docs/path/page.md` (English) + all locale variants. Add to `nav:` in `mkdocs.yml` including locale-specific nav labels. |

#### Documentation Checklist for Code Changes

Before marking a feature task as complete, verify:

- [ ] **Guide page updated**: The relevant page under `docs/guide/` or `docs/admin/` describes the new/changed behavior in all supported languages.
- [ ] **Screenshots updated**: Any new or changed UI is captured in `docs/assets/img/{locale}/` for all **10** locales. Follow the `NN_short_description.png` naming convention. **Every screenshot added to `scripts/screenshots/pages.ts` MUST also be referenced in the corresponding documentation page** (`docs/guide/` or `docs/admin/`) in ALL 10 locale files — otherwise the screenshot is captured but never displayed.
- [ ] **Screenshot script updated**: New pages/screens are added to `scripts/screenshots/pages.ts` (see section below). **Never add a screenshot to the script without also adding the `![Alt Text](../assets/img/{locale}/{filename}.png)` reference to the matching doc page in all locales.**
- [ ] **Navigation updated**: New pages are added to `nav:` in `mkdocs.yml` with translated labels for all locales.
- [ ] **Glossary updated**: New terms are added to `docs/reference/glossary.md` and all locale variants.
- [ ] **Grammar checked**: All documentation text has correct grammar, spelling, and diacritical marks (accents, umlauts, cedillas, tildes) in every supported language. Do not strip or omit diacritics — use proper characters (e.g., `ä ö ü ß` for German, `é è ê ç à` for French, `á é í ó ú ñ` for Spanish, `è é à ù ò` for Italian, `á â ã ç é ê í ó ô õ ú` for Portuguese).
- [ ] **Docs build passes**: Run `mkdocs build --strict` to verify no broken links or missing files.

#### Previewing Docs Locally

```bash
pip install -r requirements-docs.txt
mkdocs serve
# → http://127.0.0.1:8000
```

### Screenshot Automation

The project includes a **Playwright-based screenshot capture script** at `scripts/screenshots/` that automatically generates all documentation and marketing screenshots. When you add a new page, UI feature, or change existing UI, you **must** update the screenshot definitions so that automated captures stay in sync.

**IMPORTANT**: Screenshots and documentation are a **two-way contract**. Adding a screenshot to `pages.ts` without referencing it in the docs means it will be captured but never displayed. Adding an image reference in a doc without a `pages.ts` entry means it will never be auto-captured. Always update both together:
1. Add/update the entry in `scripts/screenshots/pages.ts`. Provide `filenames` for the 8 locales that use translated names (`en`, `de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`); **`da` and `ar` deliberately carry no key** and fall back to the entry `id`, so their files are named exactly like the English one.
2. Add the `![Alt Text](../assets/img/{locale}/{filename}.png)` reference in the corresponding doc page in **all 10 locale files** (`.md`, `.de.md`, `.fr.md`, `.es.md`, `.it.md`, `.pt.md`, `.zh.md`, `.ru.md`, `.da.md`, `.ar.md`)

**Never hardcode UI label strings in `pages.ts` selectors.** Tab/button labels are resolved from
`frontend/src/i18n/locales/*` via `i18nLabels("namespace:key")`, so every locale in `LOCALES` is
matched automatically and a translation change can't silently break a click. A failed click is only
a `WARNING` — the run still captures a screenshot, just of the wrong tab.

#### How It Works

1. Launches headless Chromium via Playwright at 2x device scale (Retina quality).
2. Authenticates via `POST /api/v1/auth/login`, which sets the httpOnly `access_token` cookie on the browser context Playwright shares with the page (the script's extra `sessionStorage` write is vestigial — the SPA no longer reads one).
3. Resolves card UUIDs from demo data (e.g., `{{cardId:sampleApp}}` → the SAP S/4HANA UUID).
4. Switches locale per capture run (EN, ES, etc.) via API + localStorage.
5. Navigates to each configured route, executes pre-capture actions (scroll, click, hover, wait), and saves screenshots to `docs/assets/img/{locale}/`.

#### Configuration

All screenshot definitions live in **`scripts/screenshots/pages.ts`**:

- **`DOC_PAGES`** array: Documentation screenshots (saved to `docs/assets/img/{locale}/`). Each entry has an `id`, `route`, optional `waitFor`/`actions`, and `filenames` per locale.
- **`MARKETING_PAGES`** array: Marketing site screenshots (saved to `marketing-site/assets/screenshots/`).
- **`CARD_LOOKUPS`**: Maps card names to search queries for UUID resolution from demo data.

Example entry:
```typescript
{
  id: "26_admin_settings_ai",
  route: "/admin/settings?tab=ai",
  waitFor: ".MuiPaper-root",
  actions: [{ type: "wait", ms: 600 }],
  filenames: {
    en: "26_admin_settings_ai",
    es: "26_admin_config_ia",
  },
},
```

#### When to Update the Screenshot Script

| Change Type | What to Update in `scripts/screenshots/pages.ts` |
|-------------|--------------------------------------------------|
| **New page/route** | Add a new entry to `DOC_PAGES` with the next sequential `id` number. Include `filenames` for all supported locales (`en`, `es` at minimum). |
| **Changed route path** | Update the `route` field on the affected entry. |
| **New UI section requiring interaction** | Add `actions` (click tab, scroll, wait) to capture the specific state. |
| **New card type in demo data** | Add a `CARD_LOOKUPS` entry if the screenshot needs to navigate to a specific card. |
| **Removed page** | Remove the corresponding entry from `DOC_PAGES` or `MARKETING_PAGES`. |

#### Running the Screenshot Script

```bash
cd scripts/screenshots
npm install && npm run install-browsers

# Prerequisites: Turbo EA running with demo data
# SEED_DEMO=true docker compose up --build -d

npm run capture              # All docs + marketing, all locales
npm run capture:en           # English only
npm run capture:marketing    # Marketing screenshots only
npx tsx capture.ts --only 26 # Specific screenshot by ID prefix
npx tsx capture.ts --dry-run # Preview without saving files
```
