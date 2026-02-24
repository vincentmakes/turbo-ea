# Changelog

All notable changes to Turbo EA are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.16.0] - 2026-02-24

### Added
- Successor / Predecessor relationships: new `has_successors` toggle on card types enables a dedicated Lineage section on card detail pages
- Built-in successor relation types for Application, IT Component, Initiative, Platform, Business Process, Interface, and Data Object card types
- Admin UI toggle and card layout support for the Lineage section

## [0.15.1] - 2026-02-24

### Fixed
- Hardcoded English strings in report filter/legend areas (Portfolio, Capability Map, Lifecycle) now use i18n translation keys
- Report filter dropdowns (group-by, color-by, field filters, option labels, color legends) now resolve metamodel field and option translations for the current locale, falling back to the entity key when no translation exists
- Cost report field and group-by dropdowns now resolve metamodel translations; replaced hardcoded "Unspecified" with localized fallback

## [0.15.0] - 2026-02-24

### Added
- Admin-configurable enabled languages setting under General Settings — controls which locales are available in the language picker and translation dialog
- Alembic migration to backfill English translations from label fields into the translations JSONB
- Seed helper to auto-inject English translations so `en` is treated as a first-class locale

### Changed
- Translation architecture: English is now stored in translations JSONB alongside all other locales, rather than implicitly in the label column
- Metamodel label resolution falls back to the entity key when no translation exists for the current locale, instead of always showing the English label
- TranslationDialog now shows all enabled locales (including English) and uses the entity key as reference instead of the English label
- Metamodel form fields (type label, field label, etc.) now save against the admin's current UI locale
- Removed all inline translation accordions from FieldEditorDialog, CardLayoutEditor, StakeholderRolePanel, and MetamodelAdmin — translations are managed exclusively via the centralized TranslationDialog
- Language picker in the nav bar is filtered to only show admin-enabled locales

### Fixed
- SoAW editor displaying "Part I: Part I: Statement of Architecture Work" — removed duplicate Part prefix from section headers

## [0.14.2] - 2026-02-23

### Added
- Translation checklist in CLAUDE.md to ensure all new content includes i18n translations
- Comprehensive i18n test suites for both frontend (locale file completeness, interpolation, plurals, resolveLabel) and backend (seed data translation coverage for all types, subtypes, sections, fields, options, relations)

### Changed
- Moved "Manage Translations" button to the TypeDetailDrawer header bar for quicker access

### Fixed
- Seed metamodel now merges translations into existing built-in types on upgrade (subtypes, sections, fields, and options were missing translations in pre-existing instances)
- Icon field alignment in TypeDetailDrawer first row

## [0.14.1] - 2026-02-23

### Added
- Dedicated TranslationDialog for managing all metamodel translations (type labels, subtypes, sections, fields, options) in a single focused dialog with locale tabs and completion badges
- Seed translations for all subtypes, section names, field labels, and select option labels across all 6 non-English locales (DE, FR, ES, IT, PT, ZH)

### Changed
- Replaced scattered inline translation accordions in TypeDetailDrawer with a centralized "Manage Translations" button and dialog
- Simplified subtype management UI in TypeDetailDrawer by removing nested translation accordions

### Fixed
- Section names not translated in public web portals (PortalViewer)
- Field and option labels not translated in survey response forms (SurveyRespond)
- Field labels not translated in survey results admin view (SurveyResults)
- Hardcoded English subtype labels in BPM ProcessNavigator replaced with metamodel-driven translation resolution

## [0.14.0] - 2026-02-23

### Added
- Complete translations for all 6 non-English locales (DE, FR, ES, IT, PT, ZH) across all 12 namespaces — 2,014 keys per language, no empty placeholders remaining
- i18n English fallback for missing or empty translations (`returnEmptyString: false`) so untranslated strings show English instead of blank text
- CLAUDE.md documentation for i18n conventions and step-by-step guide for adding new languages

### Fixed
- Invalid JSON in Chinese locale files caused by unescaped double quotes (replaced with CJK corner brackets `「」`)

## [0.13.0] - 2026-02-23

### Added
- Metamodel translation support: card types, relation types, and stakeholder roles now store per-locale translations in a JSONB `translations` column
- Admin UI translation inputs in TypeDetailDrawer, FieldEditorDialog, StakeholderRolePanel, and CardLayoutEditor for managing label translations across all supported locales
- `resolveLabel()` / `useResolveLabel()` / `useResolveMetaLabel()` frontend helpers that resolve translated metamodel labels based on the user's current locale
- All metamodel-driven components (inventory, card detail, reports, diagrams, dashboard, admin) now display type/relation/field/option labels in the user's chosen language
- Seed data includes translations for all 14 built-in card types and 30+ relation types across 6 non-English locales (DE, FR, ES, IT, PT, ZH)

## [0.12.0] - 2026-02-23

### Added
- Full internationalization (i18n) support: all UI strings across the entire frontend are now translatable via react-i18next
- 2,014 translation keys across 12 namespaces covering every page, component, dialog, and error message
- 7 supported locales: English (complete), German, French, Spanish, Italian, Portuguese, Chinese (skeleton files ready for translation)
- Language selector in user menu with server-side locale persistence
- User locale preference stored in the database and synced on login
- All locale skeleton files synchronized with the complete English key set

### Changed
- ErrorBoundary, CardDetailContent, CardDetailSidePanel, EditableTable, FilterSelect, and IconPicker now use translation keys instead of hardcoded strings

## [0.11.0] - 2026-02-23

### Added
- i18n Phase 3: all ~80 feature files now use translation keys via react-i18next
- ~1,900 English translation keys across 12 namespaces (inventory, cards, reports, admin, bpm, diagrams, delivery, common, auth, nav, notifications, validation)
- All inventory pages (grid, filters, import, export, mass edit/archive/delete) fully translatable
- All card detail sections and tabs (description, lifecycle, attributes, hierarchy, relations, stakeholders, comments, todos, history) fully translatable
- All 15 report pages (portfolio, capability map, lifecycle, dependencies, cost, matrix, data quality, EOL, process map, saved reports) fully translatable
- All 18 admin pages (metamodel, roles, users, settings, calculations, tags, card layout, EOL admin, surveys, web portals, ServiceNow) fully translatable
- All 10 BPM pages (dashboard, process flow, assessments, templates, modeler, viewer, element linker, navigator, reports) fully translatable
- All 7 diagram pages (gallery, editor, sync panel, card sidebar/picker, create/relation dialogs) fully translatable
- All other features (EA delivery, SoAW editor/preview/export, todos, surveys, web portals) fully translatable
- German locale skeleton files updated with all 1,983 translation keys (empty values, ready for translation)

## [0.10.0] - 2026-02-23

### Added
- i18n Phase 2: all core UI components now use translation keys (auth pages, dashboard, shared components)
- German (DE) added as the 7th supported locale
- English translation files populated with ~200 keys across 5 namespaces (common, auth, cards, notifications, validation)
- All hardcoded strings in LoginPage, SetPasswordPage, SsoCallback, Dashboard, CreateCardDialog, NotificationBell, NotificationPreferencesDialog, LifecycleBadge, ApprovalStatusBadge, EolLinkSection, VendorField, ColorPicker, KeyInput, and TimelineSlider now use `t()` calls

## [0.9.0] - 2026-02-23

### Added
- Internationalization (i18n) infrastructure: react-i18next with 12 translation namespaces and 7 supported locales (EN, DE, FR, ES, IT, PT, ZH)
- Language switcher in the user menu to change the UI language
- User locale preference stored on the backend and synced on login
- Navigation bar labels, search placeholder, and action buttons now use translation keys

## [0.8.1] - 2026-02-23

### Fixed
- Matrix report dark mode: heatmap cells, dots, highlights, depth controls, and count text now use theme-aware colors instead of hardcoded light-mode values
- Time travel date from a saved report no longer leaks into the regular report view

## [0.8.0] - 2026-02-23

### Added
- All reports and BPM pages now open card details in a right-side panel instead of navigating away, so users can browse cards without losing their current view

### Changed
- Extracted shared card detail rendering into a reusable `CardDetailContent` component used by both the full card page and the new side panel

## [0.7.6] - 2026-02-23

### Fixed
- Portfolio report leaf cards no longer show an incorrect percentage when apps belong to multiple groups

### Changed
- Portfolio report leaf cards now show a 100% stacked bar chart illustrating the color-by distribution instead of a single-color percentage bar
- Version is now only maintained in `/VERSION` — `pyproject.toml` and `package.json` use a static placeholder to avoid triggering unnecessary CI jobs

## [0.7.5] - 2026-02-22

### Changed
- CI workflow now skips backend jobs on frontend-only changes and vice versa, using path-based change detection

## [0.7.4] - 2026-02-22

### Changed
- Settings page tabs now use the standard app tab style (matching Metamodel and other admin pages)
- Settings and Metamodel page tabs are now horizontally scrollable on mobile viewports

## [0.7.3] - 2026-02-22

### Added
- Report filter dropdowns now include an "(empty)" option to filter cards with missing field values or no relations
- Extracted shared FilterSelect component used across Portfolio, Capability Map, and Process Map reports

### Changed
- Filter dropdowns now show all selected values as chips that wrap within the field, expanding downward as needed
- Filter label font reduced for better fit; long labels truncate with ellipsis before the dropdown chevron

## [0.7.2] - 2026-02-22

### Fixed
- CSP inline script violation in BPM process flow print view by replacing inline onclick handlers with addEventListener

## [0.7.1] - 2026-02-22

### Fixed
- Donut chart labels on Dashboard no longer clipped and now show per-segment colors (reverted to Recharts native label positioning)
- BPM Dashboard bar/pie chart hover highlight now adapts to dark mode (aligned with main Dashboard pattern)

## [0.7.0] - 2026-02-22

### Changed
- Settings page now uses a tabbed layout with General, EOL Search, Web Portals, and ServiceNow tabs
- General tab groups existing settings into Appearance, Modules, Authentication, and Email sections
- EOL Search, Web Portals, and ServiceNow admin pages consolidated under Settings
- Old admin routes (/admin/eol, /admin/web-portals, /admin/servicenow) redirect to the new Settings tabs

## [0.6.0] - 2026-02-22

### Added
- Dark theme with toggle in account menu, persisted via localStorage
- Dependabot configuration for pip, npm, and GitHub Actions ecosystems
- Security scanning in CI (pip-audit for Python, npm audit for Node)
- Backend test coverage threshold (40% ratchet — prevents regression)
- Structured JSON logging in production (human-readable in development)
- Python lockfile workflow via pip-compile
- Branch protection recommendations documentation

### Fixed
- Dark theme: replaced all hardcoded light backgrounds, borders, and text colors with theme-aware tokens across 20+ components

### Changed
- CI pipeline now enforces `--cov-fail-under=40` on backend tests

## [0.5.0] - 2025-12-15

### Added
- ServiceNow CMDB bi-directional sync integration
- Web portals with public slug-based URLs
- Survey system for data-maintenance workflows
- Saved report configurations with thumbnails
- End-of-Life (EOL) tracking via endoflife.date proxy
- Notification system with in-app bell and email delivery
- BPM process flow version approval workflow
- Process assessment scoring (efficiency, effectiveness, compliance)
- BPM reports: maturity dashboard, risk overview, automation analysis
- DrawIO diagram sync panel (card-to-diagram linking)
- Statement of Architecture Work (SoAW) editor with DOCX export
- Calculated fields engine with sandboxed formula evaluation
- Multi-level RBAC: app-level roles + per-card stakeholder roles
- AG Grid inventory with Excel import/export
- SSO OAuth support (OIDC)
- Rate limiting on auth endpoints (slowapi)
- Fernet encryption for database-stored secrets
- Docker hardening: non-root users, cap_drop ALL, memory limits

### Security
- JWT tokens now validate issuer and audience claims
- Default SECRET_KEY blocked in non-development environments
- Nginx security headers (CSP, HSTS, X-Frame-Options, etc.)
