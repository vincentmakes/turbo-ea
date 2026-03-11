# Changelog

All notable changes to Turbo EA are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.32.3] - 2026-03-11

### Added
- Gantt table shows start date and end date columns alongside the title for at-a-glance visibility
- Create Task button in Gantt toolbar to add tasks directly from the Gantt view
- Work Package selector now visible when editing tasks from the Gantt tab
- Right-click context menu on Gantt rows for quick edit, add task, mark done, and delete
- Context menu also available on the table list side (right-click on rows)
- Delete confirmation dialogs for both WBS items and tasks to prevent accidental deletion
- Delete button in task edit dialog (previously only available from the Task Board)
- Progress bar dragging on WBS items to adjust completion directly in the Gantt chart
- Task bars use distinct blue color to visually differentiate them from WBS summary bars
- Resizable table columns in Gantt (drag column borders to adjust width)

### Changed
- Gantt bar label text is now white for better contrast on colored bars
- Gantt chart uses full page width for more timeline space
- Date columns use compact format (dd MMM 'yy) to prevent cropping
- Today button in Gantt toolbar now scrolls the chart to the current date
- PPM navigation icon changed to view_kanban

## [0.32.2] - 2026-03-11

### Added
- PPM budget/cost rollup: budget and cost line totals automatically sync to Initiative card attributes (costBudget/costActual)
- Cost fields marked as auto-computed (readonly with badge) in Card Detail when PPM lines exist
- New endpoint `GET /ppm/initiatives/{id}/has-costs` for lightweight PPM cost existence check

### Changed
- Portfolio dashboard group headers use darker background for better visual separation
- Gantt bar resizing no longer jumps to week/month boundaries — custom `roundDate` ensures smooth 1-day snapping

### Fixed
- Gantt bar drag/resize caused bars to snap to week or month boundaries instead of individual days

## [0.32.1] - 2026-03-11

### Changed
- Gantt chart bar resizing is now 1-day granular regardless of zoom level (day/week/month)
- PPM color palette aligned with MUI theme (primary, success, warning, error) across all components
- Financials KPI and Budget/Costs cards merged into a single combined card in project overview
- Card Details tab in PPM project detail now shows full card detail with all tabs (comments, todos, stakeholders, resources, history)

### Removed
- Standalone PpmCardDetailsTab component replaced by reusable CardDetailContent

## [0.32.0] - 2026-03-10

### Added
- Project Portfolio Management (PPM) module with enable/disable toggle in admin settings
- Portfolio dashboard with KPI cards, health pie charts, and status distribution
- Gantt chart with quarterly ticks, timeline bars, RAG health indicators, and budget progress
- Per-initiative detail view with overview, monthly status reports, and task management tabs
- Status reports with RAG health tracking (schedule/cost/scope), cost line items (CapEx/OpEx), and risk register
- AG Grid-based task manager with filter sidebar, inline editing, and assignee management
- New permissions: `ppm.view`, `ppm.manage`, `reports.ppm_dashboard`
- Database tables: `ppm_status_reports`, `ppm_tasks`

## [0.31.0] - 2026-03-10

### Added
- Subtype sub-templates: each subtype can now control field visibility, hiding irrelevant fields from card detail and creation forms
- Hidden fields are excluded from data quality scoring so users are only scored on visible fields
- Subtype template editor in the metamodel admin with per-field visibility toggles
- Last login date/time column on the User Management admin page

## [0.30.0] - 2026-03-10

### Added
- Russian language support for the application and documentation (8th supported locale)

## [0.29.0] - 2026-03-09

### Added
- Artefact filter toggle (with/without artefacts) on Initiatives tab
- Search field in Link Diagrams dialog for quick filtering
- Linked initiative names shown as chips on each diagram in the Link Diagrams dialog

### Changed
- Redesigned Initiatives tab in EA Delivery with cleaner two-row card headers, parent-child hierarchy visualization, and 3-column artefact layout (SoAW / Diagrams / ADRs)
- Streamlined Initiatives list view from 9 columns to 7 with hierarchy indentation and artefact-focused layout
- Decomposed 1750-line EADeliveryPage monolith into 6 focused sub-components for better maintainability
- Responsive artefact grid collapses to single column on narrow screens

## [0.28.0] - 2026-03-09

### Added
- Diagrams section in the Resources tab of card details — link and unlink diagrams from any card type, not just initiatives
- Card-level permission `card.manage_diagram_links` for controlling diagram link management per stakeholder role

### Changed
- Generalized diagram-card linking from initiative-only to all card types (renamed `diagram_initiatives` table to `diagram_cards`)
- API fields renamed from `initiative_ids` to `card_ids` in diagram endpoints

## [0.27.0] - 2026-03-09

### Added
- Architecture Decisions tab now uses AG Grid with a persistent filter sidebar for card types, status, and date ranges
- Link type dropdown (Documentation, Security, Compliance, Architecture, Operations, Support, Other) when adding document links in the Resources tab
- Document category dropdown (Architecture, Security, Compliance, Operations, Meeting Notes, Design, Other) when uploading files in the Resources tab
- Colored pills in ADR listings matching linked card type colors throughout Resources tab and EA Delivery page
- Full-text search and right-click context menu on the ADR grid

### Changed
- Architecture Decisions tab in EA Delivery replaced card-based list with AG Grid table view
- Document link icons now reflect the link type category

## [0.26.2] - 2026-03-08

### Fixed
- ADRs not shown in artifacts column of EA Delivery initiatives table view

## [0.26.1] - 2026-03-08

### Changed
- ADR initiative linking now uses standard card links instead of a dedicated field — initiatives are linked like any other card
- ADR list view now shows all linked cards as chips instead of a single initiative name
- Initiative filter on Decisions tab works via linked cards, supporting ADRs linked to multiple initiatives
- Create ADR and Signature Request dialogs no longer resize when search results appear or disappear

### Removed
- Dedicated initiative dropdown from ADR editor and create dialog (use card linking instead)
- `initiative_id` column from architecture decisions (migrated to card link junction table)

## [0.26.0] - 2026-03-08

### Added
- Architecture Decision Records (ADR) with TOGAF-style approval workflow (draft, in review, signed)
- ADR editor with rich text sections: Context, Decision, Alternatives Considered, Consequences
- ADR reference numbering (ADR-001, ADR-002, ...) with duplication and revision chain support
- Architecture Decisions tab in EA Delivery panel with search, status, and initiative filters
- ADRs linkable to Initiatives in EA Delivery and visible under initiative artefacts
- Resources tab on card detail with three sections: Architecture Decisions, File Attachments, Document Links
- Create ADR with inline card linking from Resources tab, EA Delivery, or initiative context
- Initiative-level create button offers choice between SoAW and ADR
- File attachment uploads (up to 10 MB) stored in database with download support
- Document link management on card detail
- ADR signing workflow reusing SoAW pattern (request signatures, sign, revise)
- Search-based signature request dialog for both SoAW and ADR (replaces flat user list)
- Read-only ADR preview page
- New permissions: adr.view, adr.manage, adr.sign, adr.delete, card.manage_adr_links

## [0.25.2] - 2026-03-04

### Changed
- AI portfolio insights now use an advisory tone — findings are presented as expert EA guidance without severity pills or timeline suggestions
- AI portfolio insights now consider the active grouping and filters displayed in the report
- Insight structure simplified to title, observation, and recommendation

## [0.25.1] - 2026-03-04

### Changed
- EA Principles rationale and implications now render each new line as a bullet point for better readability
- AI portfolio insights now return structured results with title, observation, risk, action, and severity for clearer actionable guidance

### Added
- EA Principles read-only tab in the EA Delivery page showing all active principles to all users

## [0.25.0] - 2026-03-04

### Added
- AI-driven portfolio insights: generate on-demand strategic analysis of the application portfolio using the configured AI provider
- AI provider settings separated from AI description settings — provider configuration is now shared across all AI features
- New `ai.portfolio_insights` permission controlling access to portfolio AI insights
- EA Principles tab in Metamodel Configuration for defining architecture principles (title, statement, rationale, implications)
- Active EA principles are automatically included in AI portfolio insights analysis for principle-compliance evaluation

### Changed
- AI admin settings page reorganised into three sections: Provider Configuration, Description Suggestions, and Portfolio Insights
- AI portfolio insights prompt refined with structured 5-lens EA framework and principle-compliance analysis

## [0.24.0] - 2026-03-03

### Added
- AI suggestions now recommend Commercial Application and Hosting Type fields for Application cards when evidence is found in web search results
- Commercial Application boolean field added to Application card type

## [0.23.3] - 2026-03-03

### Added
- User Manual link in the profile menu that opens the documentation site in a new tab

## [0.23.2] - 2026-02-28

### Added
- MCP Integration admin documentation page with full setup guide, tool reference, security details, and troubleshooting (all 7 locales)
- MCP Server section in README with feature description and project structure entry
- MCP glossary term added to all 7 locale glossaries
- Navigation entry for MCP Integration in mkdocs.yml with translated labels for all 6 non-English locales

### Fixed
- Frontend nginx crash on startup when MCP server is not running — deferred DNS resolution to request time so missing upstream returns 502 instead of crashing

## [0.23.1] - 2026-02-28

### Fixed
- Backend startup hang caused by nested asyncio event loops during Alembic migrations — now passes the existing engine connection directly to Alembic
- Increased Docker health check start_period from 30s to 60s to accommodate slower first-run migrations

## [0.23.0] - 2026-02-28

### Added
- MCP server for AI tool integration — allows Claude, Copilot, Cursor, and other AI tools to query Turbo EA data with per-user RBAC
- SSO-delegated OAuth 2.1 authentication for MCP — users authenticate via their existing corporate SSO provider (Entra ID, Google, Okta, or generic OIDC)
- Automatic token refresh for MCP sessions — users stay connected without re-authentication
- Admin MCP integration settings with enable/disable toggle and setup instructions
- `admin.mcp` permission key for managing MCP settings

## [0.22.6] - 2026-02-28

### Fixed
- Restored missing diacritical marks (accents) in all French and Italian documentation files
- Fixed English language selector link from `/en/` to `/` (root) since English is the default locale

### Added
- Localized navigation menu labels in mkdocs.yml for all 6 non-English languages (Spanish, German, French, Italian, Portuguese, Chinese)

## [0.22.5] - 2026-02-28

### Added
- User manual translations for 5 new languages: French, German, Italian, Portuguese, and Chinese (125 translated documentation files)
- Enabled French, German, Italian, Portuguese, and Chinese in mkdocs i18n plugin, search, and language selector
- Placeholder screenshot directories for all 5 new locales (using English images as baseline)

## [0.22.4] - 2026-02-28

### Added
- Comprehensive user manual rewrite: expanded 4 stub pages (Diagrams, EA Delivery, Tasks, Metamodel) from placeholders to full documentation
- 8 new admin guide pages: General Settings, Calculations, Tags, End-of-Life, Surveys, Web Portals, ServiceNow Integration, Saved Reports
- 2 new user guide pages: Notifications, Saved Reports
- Integrated the ServiceNow admin guide (previously a standalone root-level file) into the documentation site
- TOGAF reference and description added to the SoAW (Statement of Architecture Work) section
- 17 new terms added to the glossary (Approval Status, BPMN, Calculation, Data Quality, Diagram, DrawIO, EOL, Notification, Relation, Saved Report, Section, Survey, Tag, TOGAF, Web Portal, and more)
- Spanish translations for all new and updated documentation pages

### Changed
- Expanded Inventory guide with saved views/bookmarks, advanced filtering (subtypes, relations, attributes), Excel import/export details, AG Grid features, and the System card type
- Expanded Card Details guide with lifecycle phases, custom attribute sections, hierarchy, relations, tags, documents, EOL section, approval workflow, archiving behavior, and process flow tab
- Expanded Reports guide with detailed descriptions of all 9 report types including configurable axes, heatmap coloring, treemap visualization, and cross-reference grids
- Expanded BPM guide with BPMN editor, starter templates, element extraction, element linking, approval workflow, process assessments, and BPM reports
- Expanded Dashboard guide with recent activity feed and quick navigation
- Updated login page with correct language names (added accents, added Italiano)
- Updated introduction page with new key benefits (diagrams, BPM, ServiceNow integration)
- Updated mkdocs.yml navigation to include all new pages
- Updated glossary from 15 to 32 terms, removed hardcoded version from footer
- Fixed docker compose command in AI admin guide (removed incorrect -f flag)

## [0.22.3] - 2026-02-28

### Security
- Updated rollup from 4.57.1 to 4.59.0 to fix arbitrary file write via path traversal (CVE-2026-27606)
- Updated minimatch to 3.1.5 and 9.0.9 to fix ReDoS via matchOne() combinatorial backtracking (CVE-2026-27903)

## [0.22.2] - 2026-02-28

### Added
- AI Description Suggestions documentation page in the user manual (English and Spanish) covering setup, usage, providers, permissions, and troubleshooting
- AI-related terms (AI Suggestion, LLM, Ollama, Confidence Score) added to the glossary

### Changed
- User manual introduction rewritten for all users (architects, analysts, admins) instead of only executives and decision makers
- Expanded AI-powered descriptions benefit to cover commercial LLM providers and confidence scoring
- README AI section updated to list all supported LLM providers and admin controls
- README SSO section updated to list all supported identity providers (Microsoft Entra ID, Google Workspace, Okta, Generic OIDC) and removed outdated untested warning

## [0.22.1] - 2026-02-27

### Fixed
- Auth cookie now detects HTTPS via X-Forwarded-Proto header instead of hardcoding Secure flag based on ENVIRONMENT, fixing login failures on HTTP deployments (e.g. local networks without TLS)

### Added
- Manual OIDC endpoint configuration (authorization, token, JWKS URI) as fallback when the backend cannot reach the provider's discovery document (e.g. Docker networking or self-signed certificates)
- Admin ability to change a user's authentication method (Local / SSO) in the edit dialog, enabling linking of existing local accounts to SSO
- Invitation email now uses the actual configured SSO provider name instead of hardcoded provider references

## [0.22.0] - 2026-02-27

### Added
- Support for multiple SSO identity providers: Google Workspace, Okta, and Generic OIDC, in addition to the existing Microsoft Entra ID
- Dedicated Authentication tab in admin settings for SSO and registration configuration
- Provider-specific login button with appropriate branding on the sign-in page
- Google hosted domain restriction and Okta domain configuration options
- Generic OIDC provider with automatic discovery document support
- Support for commercial LLM providers (OpenAI, Google Gemini, Azure OpenAI, OpenRouter, Anthropic Claude) for AI description suggestions
- Encrypted API key storage for commercial LLM providers
- Provider type selector in AI admin settings with conditional form fields

### Changed
- SSO and self-registration settings moved from the General tab to a new Authentication tab
- SSO login button now shows the configured provider name instead of always displaying Microsoft
- Simplified AI search provider — DuckDuckGo is always used automatically for web context
- AI admin UI now shows provider-specific fields (URL, API key, model placeholders) based on selected provider type

## [0.21.1] - 2026-02-27

### Changed
- AI admin page now uses Ollama-specific terminology instead of generic LLM references, with gemma3:4b recommended as the default model for description generation

## [0.21.0] - 2026-02-26

### Changed
- AI suggestions now generate only a type-aware description instead of populating multiple metadata fields — cleaner, more reliable results
- AI web search queries are type-aware: searches for Applications use "software application", Organizations use "company", Providers use "technology vendor", etc.
- Simplified AI suggestion panel UI to show a single editable description with confidence score and clickable source links

### Removed
- Removed per-field `ai_suggest` flag from the metamodel — no longer needed since only description is suggested

## [0.20.0] - 2026-02-26

### Changed
- AI settings moved to a dedicated tab in the admin settings page, organized under an "AI Cards" section to prepare for additional AI use cases

## [0.19.1] - 2026-02-26

### Added
- Bundled Ollama container as an opt-in Docker Compose profile (`--profile ai`) with a persistent volume for model storage — no model re-download on rebuilds
- AI status endpoint now returns the currently loaded Ollama model, displayed as a chip in the suggestion panel

### Changed
- AI suggestions now skip internal assessment fields (business criticality, technical suitability, costs, maturity, risk level, etc.) that cannot be determined from external sources — only externally verifiable metadata is suggested

## [0.19.0] - 2026-02-26

### Added
- Auto-configuration of AI settings on startup when `AI_AUTO_CONFIGURE=true` is set, so pointing to an external Ollama instance requires only env vars — no manual admin setup
- Background model pull on startup when the configured model is not yet available in Ollama

## [0.18.0] - 2026-02-26

### Added
- AI-powered metadata suggestions for cards: search the web and use a local LLM (Ollama) to propose description, vendor, status, and other field values when creating or editing cards
- Three web search provider options: DuckDuckGo (default, zero-config), Google Custom Search API, and SearXNG (self-hosted)
- Admin settings panel for AI configuration: enable/disable, LLM provider URL, model selection, search provider, and per-card-type enablement
- AI suggest button on card detail page header for populating metadata on existing cards
- New `ai.suggest` permission key for controlling access to AI suggestions

## [0.17.4] - 2026-02-25

### Changed
- Redesigned card detail header badges for a cleaner, more harmonious look: smaller data quality ring, outlined chips with colored dots, and merged approval status badge with action menu into a single interactive chip

## [0.17.3] - 2026-02-25

### Security
- Moved JWT storage from sessionStorage to httpOnly cookies, preventing JavaScript access to authentication tokens (CWE-922)
- Added `POST /auth/logout` endpoint to clear the auth cookie server-side

### Fixed
- Login session no longer lost on page refresh

## [0.17.2] - 2026-02-24

### Security
- Suppressed implicit exception chaining on all ServiceNow endpoint error responses to prevent potential stack trace exposure (CWE-209)

## [0.17.1] - 2026-02-24

### Fixed
- Hidden successor/lineage relation types from admin Card Type drawer, Relation Types tab, and metamodel graph since they are already managed via the Lineage toggle
- Limited the Add Relation dialog on card detail pages to only show relation types not already visible as dedicated sections

## [0.17.0] - 2026-02-24

### Added
- Visible and Mandatory toggles per relation type in the Card Type admin drawer, configurable independently for source and target sides
- Visible/mandatory relation types are always displayed on card detail pages, even when empty
- Inline add button per relation type group on card detail pages for faster relation creation without a generic dialog
- Required badge on mandatory relation types in card detail view

### Changed
- Redesigned Relations section on card detail pages with grouped card-style layout and per-relation-type inline search

## [0.16.2] - 2026-02-24

### Security
- Fixed exception information exposure in ServiceNow integration endpoints — all external service calls now catch exceptions and return sanitized error messages instead of leaking internal details
- Fixed unhandled httpx exception in SSO token exchange that could expose the identity provider URL and tenant ID on network failures

## [0.16.1] - 2026-02-24

### Security
- Fixed remaining information exposure through exceptions in calculation engine, ServiceNow sync, and EOL proxy endpoints — error responses no longer leak internal exception details

## [0.16.0] - 2026-02-24
### Added
- Successor / Predecessor relationships: new `has_successors` toggle on card types enables a dedicated Lineage section on card detail pages
- Built-in successor relation types for Application, IT Component, Initiative, Platform, Business Process, Interface, and Data Object card types
- Admin UI toggle and card layout support for the Lineage section
-
## [0.15.3] - 2026-02-24

### Security
- Fixed incomplete HTML sanitization in PortalViewer and SoAW export — replaced regex-based tag stripping with DOMParser for safe text extraction
- Fixed DOM-based XSS in SoAW PDF export — user-controlled values are now HTML-escaped before interpolation into document.write
- Moved JWT token from sessionStorage to in-memory storage to prevent exfiltration via XSS accessing browser storage APIs
- Fixed ReDoS vulnerability in calculation engine — replaced polynomial regex with string-based assignment parsing
- Fixed path traversal in BPM template endpoint — template keys are now validated and resolved paths are confined to the template directory
- Fixed information exposure in ServiceNow connection test, calculation test, and formula validation endpoints — error responses no longer leak internal exception details

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
