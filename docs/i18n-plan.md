# Turbo EA — Internationalization (i18n) Plan

> **Version**: 1.0
> **Date**: 2026-02-23
> **Status**: Draft — awaiting approval
> **Target locales**: English (base), German, French, Spanish, Italian, Portuguese, Chinese

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architectural Decisions](#2-architectural-decisions)
3. [Current State Assessment](#3-current-state-assessment)
4. [Technology Choices](#4-technology-choices)
5. [Backend Changes](#5-backend-changes)
6. [Frontend Changes](#6-frontend-changes)
7. [Translation Namespace Structure](#7-translation-namespace-structure)
8. [String Extraction Inventory](#8-string-extraction-inventory)
9. [Notification Refactoring](#9-notification-refactoring)
10. [Metamodel Translation Support](#10-metamodel-translation-support)
11. [MUI & AG Grid Locale Configuration](#11-mui--ag-grid-locale-configuration)
12. [Migration Strategy](#12-migration-strategy)
13. [File-by-File Migration Checklist](#13-file-by-file-migration-checklist)
14. [Translation Workflow](#14-translation-workflow)
15. [Testing Strategy](#15-testing-strategy)
16. [Phase Plan & Milestones](#16-phase-plan--milestones)
17. [Risk Register](#17-risk-register)
18. [Appendix: String Counts by File](#appendix-string-counts-by-file)

---

## 1. Executive Summary

Turbo EA's frontend currently contains **~2,500–3,400 unique hardcoded user-facing strings** across **~150 component files** with **zero existing i18n infrastructure**. This plan documents the full scope, architectural decisions, and step-by-step approach to add internationalization support for six locales: English (base), French, Spanish, Italian, Portuguese, and Chinese.

The backend requires a user locale preference field, and the notification system needs refactoring from pre-rendered English text to structured codes with client-side rendering. The metamodel (card types, fields, options) needs translation support in both the seed and the admin UI.

---

## 2. Architectural Decisions

These decisions were made during the assessment phase and guide all implementation work.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | **Metamodel labels** | Translate the seed data + allow admin to provide translations when creating new types/fields/lists/groups | Users in non-English markets need localized type names, field labels, and option labels. Admin-configurable translations future-proof the system. |
| 2 | **Notification rendering** | Client-side (structured codes) | Store structured data in DB (`{type, actor_id, card_id, ...}`), render translated text in frontend. Old notifications update when user switches language. |
| 3 | **Target locales** | EN, DE, FR, ES, IT, PT, ZH | Initial set covers major European markets, German-speaking markets, and Chinese. |
| 4 | **RTL support** | Not included | No Arabic/Hebrew support needed currently. Eliminates layout complexity. |
| 5 | **URL structure** | User preference only | No locale in URL path (e.g., no `/fr/inventory`). Language is stored on the user profile and applied globally. |
| 6 | **Translation workflow** | Manual JSON files | No external platform (Crowdin/Lokalise). Translation files live in the repo under `frontend/src/i18n/locales/`. |
| 7 | **i18n library** | `react-i18next` + `i18next` | Industry standard, excellent React 18 support, ICU pluralization, namespaces, ~15-20KB gzipped. |

---

## 3. Current State Assessment

### 3.1 Frontend — Zero i18n Infrastructure

- **No i18n library** installed (no react-intl, no i18next, no formatjs)
- **~2,500–3,400 unique strings** hardcoded across ~150 `.tsx`/`.ts` files
- **Broken pluralization**: Uses `card(s)` convention (incorrect even in English — shows "1 card(s)" instead of "1 card")
- **Mixed date formatting**: Some `toLocaleDateString()`, some hardcoded `"en-US"`
- **Currency formatting**: Already centralized via `useCurrency` hook with `Intl.NumberFormat` (good — minimal migration needed)
- **MUI components**: Using English defaults for date pickers, pagination, accessibility labels
- **AG Grid**: No locale support configured (column headers mix static English and dynamic metamodel labels)

### 3.2 String Pattern Distribution

| Pattern | % of Strings | Migration Difficulty | Example |
|---------|-------------|---------------------|---------|
| Direct JSX strings | ~70% | Easy — wrap with `t()` | `<Button>Save</Button>` |
| Constants/objects | ~15% | Medium — refactor to use `t()` | `{ label: "Text", value: "text" }` |
| String interpolation | ~10% | Medium — use interpolation params | `` `${count} card(s) selected` `` |
| Dynamic error handling | ~5% | Hard — need translation keys for API errors | `err.message \|\| "Failed to create card"` |

### 3.3 String Categories

| Category | Est. Count | Examples |
|----------|-----------|---------|
| UI control labels (buttons, tabs, menus) | ~1,000 | "Save", "Cancel", "Delete", "Create" |
| Form placeholders & help text | ~500 | "Search cards...", "e.g. smtp.gmail.com" |
| Table/grid headers | ~300 | "Type", "Name", "Status", "Actions" |
| Error/success messages | ~250 | "Failed to create card", "Saved successfully" |
| Report titles & chart labels | ~200 | "Application Portfolio", "Cost Analysis" |
| Status labels & badges | ~100 | "Draft", "Approved", "Active", "End of Life" |
| Dialog descriptions & confirmations | ~100 | "Are you sure you want to archive...?" |
| Tooltips | ~50 | "Archive this card", "Copy URL" |

### 3.4 Backend

- **No user locale field** on the `users` table
- **Notifications** store pre-rendered English `title` and `message` strings
- **Metamodel seed** (`seed.py`) contains English-only labels for all 14 card types, ~200 fields, ~30 relation types
- **API error messages** are English-only (FastAPI `HTTPException` detail strings)

---

## 4. Technology Choices

### 4.1 Frontend Library: `react-i18next`

```
Package                         Version   Size (gzipped)
i18next                         ^25.x     ~8KB
react-i18next                   ^16.x     ~6KB
i18next-browser-languagedetector ^8.x     ~2KB
─────────────────────────────────────────────────
Total                                     ~16KB
```

**Why react-i18next?**
- Most popular React i18n library (8M+ weekly npm downloads)
- Full ICU plural support out of the box
- Namespace-based code splitting
- React Suspense integration
- `useTranslation()` hook fits our functional component architecture
- Interpolation syntax: `t('key', { count: 5 })` → proper plurals

### 4.2 Translation File Format: JSON

Flat key-value JSON files organized by namespace and locale:

```
frontend/src/i18n/locales/
├── en/
│   ├── common.json
│   ├── auth.json
│   ├── nav.json
│   ├── inventory.json
│   ├── cards.json
│   ├── reports.json
│   ├── admin.json
│   ├── bpm.json
│   ├── diagrams.json
│   ├── delivery.json
│   ├── notifications.json
│   └── validation.json
├── de/
│   └── (same structure)
├── fr/
│   └── (same structure)
├── es/
├── it/
├── pt/
└── zh/
```

### 4.3 Key Naming Convention

Keys use **dot-separated descriptive paths** within each namespace:

```json
{
  "page.title": "Inventory",
  "actions.create": "Create",
  "actions.export": "Export",
  "dialogs.archive.title": "Archive Card",
  "dialogs.archive.confirm": "Are you sure you want to archive {{name}}?",
  "status.draft": "Draft",
  "status.approved": "Approved",
  "errors.createFailed": "Failed to create card",
  "items_one": "{{count}} item",
  "items_other": "{{count}} items"
}
```

Pluralization uses i18next's `_one` / `_other` suffix convention.

---

## 5. Backend Changes

### 5.1 User Locale Preference

| File | Change |
|------|--------|
| `backend/app/models/user.py` | Added `locale` column (`String(10)`, default `"en"`, server_default `"en"`) |
| `backend/alembic/versions/036_add_user_locale.py` | Migration to add `locale` column to `users` table |
| `backend/app/schemas/auth.py` | Added `locale` field to `UserResponse` schema |
| `backend/app/api/v1/auth.py` | `/auth/me` now returns `locale` field |
| `backend/app/api/v1/users.py` | `UserUpdate` accepts `locale` field; non-admin users can update their own locale; validates against `SUPPORTED_LOCALES = {"en", "fr", "es", "it", "pt", "zh"}` |

### 5.2 Supported Locales Constant

The `SUPPORTED_LOCALES` set in `users.py` is the backend source of truth. When adding new locales, update this set.

### 5.3 API Error Messages (Future Phase)

API error messages (e.g., `"Email already registered"`, `"Invalid credentials"`) are currently English-only. Two options for the future:

- **Option A (Recommended)**: Keep backend errors in English, map them to translation keys on the frontend using error codes or known message patterns.
- **Option B**: Add an `Accept-Language` header and localize backend errors. This is more complex and less useful since most errors are shown via frontend-controlled UI.

For now, backend errors remain English. The frontend wraps error display with `t()` for known error messages and falls back to the raw API message for unknown ones.

---

## 6. Frontend Changes

### 6.1 i18n Configuration

**Already installed**: `i18next`, `react-i18next`, `i18next-browser-languagedetector`

Create `frontend/src/i18n/index.ts`:

```typescript
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import all English namespace files
import commonEn from "./locales/en/common.json";
import authEn from "./locales/en/auth.json";
import navEn from "./locales/en/nav.json";
import inventoryEn from "./locales/en/inventory.json";
import cardsEn from "./locales/en/cards.json";
import reportsEn from "./locales/en/reports.json";
import adminEn from "./locales/en/admin.json";
import bpmEn from "./locales/en/bpm.json";
import diagramsEn from "./locales/en/diagrams.json";
import deliveryEn from "./locales/en/delivery.json";
import notificationsEn from "./locales/en/notifications.json";
import validationEn from "./locales/en/validation.json";

// ... repeat for other locales (fr, es, it, pt, zh)

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        auth: authEn,
        nav: navEn,
        inventory: inventoryEn,
        cards: cardsEn,
        reports: reportsEn,
        admin: adminEn,
        bpm: bpmEn,
        diagrams: diagramsEn,
        delivery: deliveryEn,
        notifications: notificationsEn,
        validation: validationEn,
      },
      // fr: { ... }, es: { ... }, etc.
    },
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["querystring", "localStorage"],
      caches: ["localStorage"],
    },
  });

export default i18n;
```

### 6.2 Entry Point Integration

In `frontend/src/main.tsx`, import the i18n config before the app:

```typescript
import "./i18n";  // Initialize i18next before React renders
import React from "react";
// ...
```

### 6.3 User Locale Sync

In `useAuth.ts`, after loading the user profile, sync the locale with i18next:

```typescript
import { useTranslation } from "react-i18next";

// Inside loadUser:
const u = await auth.me();
setUser(u as User);
i18n.changeLanguage(u.locale || "en");
```

When the user changes language via the switcher:
1. Call `PATCH /users/{id}` with `{ locale: "fr" }` to persist
2. Call `i18n.changeLanguage("fr")` to apply immediately
3. React re-renders all components using `t()`

### 6.4 TypeScript Types

Add `locale` to the `User` interface in `frontend/src/types/index.ts`:

```typescript
export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  locale?: string;  // ← new
  // ...
}
```

### 6.5 Language Switcher Component

Add to the user menu in `AppLayout.tsx`, between "Dark Mode" toggle and admin section:

```tsx
<MenuItem onClick={(e) => setLangMenu(e.currentTarget)}>
  <ListItemIcon>
    <MaterialSymbol icon="translate" size={18} />
  </ListItemIcon>
  <ListItemText>Language</ListItemText>
  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
    {LOCALE_LABELS[i18n.language] || "English"}
  </Typography>
</MenuItem>
```

With a submenu showing:

| Code | Label |
|------|-------|
| `en` | English |
| `de` | Deutsch |
| `fr` | Français |
| `es` | Español |
| `it` | Italiano |
| `pt` | Português |
| `zh` | 中文 |

### 6.6 Component Migration Pattern

Before:
```tsx
<Button onClick={handleSave}>Save</Button>
<Typography>No cards found.</Typography>
```

After:
```tsx
import { useTranslation } from "react-i18next";

const { t } = useTranslation("common");

<Button onClick={handleSave}>{t("actions.save")}</Button>
<Typography>{t("emptyStates.noCards")}</Typography>
```

For plurals (fixing the broken `card(s)` pattern):

Before:
```tsx
`${count} card(s) selected`
```

After:
```tsx
t("inventory.selectedCount", { count })
// en: { "selectedCount_one": "{{count}} card selected", "selectedCount_other": "{{count}} cards selected" }
// fr: { "selectedCount_one": "{{count}} carte sélectionnée", "selectedCount_other": "{{count}} cartes sélectionnées" }
```

For interpolation:

Before:
```tsx
`Are you sure you want to archive "${card.name}"?`
```

After:
```tsx
t("dialogs.archive.confirm", { name: card.name })
// en: "Are you sure you want to archive \"{{name}}\"?"
```

---

## 7. Translation Namespace Structure

| Namespace | File | Scope | Est. Keys |
|-----------|------|-------|-----------|
| `common` | `common.json` | Shared UI labels, actions, statuses, lifecycle phases, approval statuses, field types, empty states, time/date labels | ~200 |
| `auth` | `auth.json` | Login, register, SSO, password setup | ~30 |
| `nav` | `nav.json` | Navigation items, admin menu items, user menu | ~40 |
| `inventory` | `inventory.json` | Inventory page, filter sidebar, import/export dialogs, mass edit, bookmarks/views | ~200 |
| `cards` | `cards.json` | Card detail, all section components (description, lifecycle, attributes, hierarchy, relations, stakeholders, comments, todos, history) | ~250 |
| `reports` | `reports.json` | All report pages (portfolio, capability map, lifecycle, dependencies, cost, matrix, data quality, EOL, process map), saved reports, report shell | ~300 |
| `admin` | `admin.json` | Metamodel admin, type drawer, field editor, roles, users, settings, calculations, tags, card layout editor, surveys, web portals, ServiceNow | ~500 |
| `bpm` | `bpm.json` | BPM dashboard, process flow editor/tab, assessments, templates, element linker, BPM reports | ~200 |
| `diagrams` | `diagrams.json` | Diagram gallery, editor, sync panel, card sidebar, card picker, relation picker | ~100 |
| `delivery` | `delivery.json` | EA Delivery page, SoAW editor/preview, rich text editor | ~80 |
| `notifications` | `notifications.json` | Notification bell, preferences dialog, notification type labels, structured notification templates | ~50 |
| `validation` | `validation.json` | Form validation messages, API error mappings, password rules | ~50 |

**Total estimated keys: ~2,000** (some strings are deduplicated into `common`)

---

## 8. String Extraction Inventory

### 8.1 Shared Components (`src/components/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `CreateCardDialog.tsx` | ~40 | "Create Card", form labels, type/subtype selectors, EOL linking |
| `NotificationBell.tsx` | ~15 | "Notifications", "Mark all read", "No notifications", `timeAgo()` labels |
| `NotificationPreferencesDialog.tsx` | ~20 | "Notification Preferences", type labels ("Todo Assigned", etc.), "In-App", "Email" |
| `LifecycleBadge.tsx` | ~6 | Phase names: "Plan", "Phase In", "Active", "Phase Out", "End of Life" |
| `ApprovalStatusBadge.tsx` | ~4 | "Draft", "Approved", "Rejected", "Broken" |
| `EolLinkSection.tsx` | ~20 | "End of Life", "Link to endoflife.date", search labels |
| `VendorField.tsx` | ~5 | "Vendor", "Search providers..." |
| `ColorPicker.tsx` | ~2 | "Pick a color" |
| `KeyInput.tsx` | ~3 | "Key", validation messages |
| `TimelineSlider.tsx` | ~4 | Date range labels |

### 8.2 Auth Pages (`src/features/auth/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `LoginPage.tsx` | ~12 | "Enterprise Architecture Management", "Sign in with Microsoft", "Login", "Register", form labels |
| `SetPasswordPage.tsx` | ~13 | "Set Your Password", "Welcome!", validation messages, error states |
| `SsoCallback.tsx` | ~4 | "Completing sign-in...", error messages |

### 8.3 Dashboard (`src/features/dashboard/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `Dashboard.tsx` | ~30 | "Dashboard", metric labels, chart titles, "No cards yet", lifecycle phase names |

### 8.4 Inventory (`src/features/inventory/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `InventoryPage.tsx` | ~80 | Column headers, toolbar buttons, mass edit/archive/delete dialogs, grid edit mode |
| `InventoryFilterSidebar.tsx` | ~70 | Filter labels, view management, bookmark CRUD, visibility options |
| `ImportDialog.tsx` | ~50 | Multi-step import wizard: upload, validation, progress, results |
| `excelExport.ts` | ~5 | Sheet names, header labels |
| `excelImport.ts` | ~10 | Error messages, column mapping |
| `RelationCellPopover.tsx` | ~5 | Popover labels |

### 8.5 Card Detail (`src/features/cards/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `CardDetail.tsx` | ~35 | Tab labels, approval actions, archive/delete dialogs, archived banner |
| `sections/DescriptionSection.tsx` | ~8 | "Description", "Name", "No description provided" |
| `sections/LifecycleSection.tsx` | ~8 | "Lifecycle", phase labels, date labels |
| `sections/AttributeSection.tsx` | ~6 | "calculated", "auto", Save/Cancel |
| `sections/HierarchySection.tsx` | ~25 | "Hierarchy", parent/child labels, search, create dialogs |
| `sections/RelationsSection.tsx` | ~20 | "Relations", "Add Relation", type selector, create inline |
| `sections/StakeholdersTab.tsx` | ~12 | "Add Stakeholder", role/user selectors |
| `sections/CommentsTab.tsx` | ~6 | "Write a comment...", "Post", "No comments yet" |
| `sections/TodosTab.tsx` | ~12 | "Add Todo", form fields, "No todos yet" |
| `sections/HistoryTab.tsx` | ~20 | Event type labels, field change labels |
| `sections/cardDetailUtils.tsx` | ~10 | Lifecycle phase names, URL validation, "None" |

### 8.6 Reports (`src/features/reports/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `PortfolioReport.tsx` | ~25 | "Application Portfolio", filter/group controls, empty states |
| `CapabilityMapReport.tsx` | ~20 | "Business Capability Map", heatmap controls |
| `LifecycleReport.tsx` | ~15 | "Technology Lifecycle", date range, phase labels |
| `DependencyReport.tsx` | ~20 | "Dependencies", graph controls, node tooltips |
| `CostReport.tsx` | ~15 | "Cost Analysis", metric labels |
| `MatrixReport.tsx` | ~20 | "Matrix", sort/display options, hierarchy controls |
| `DataQualityReport.tsx` | ~20 | "Data Quality", metric labels, quality ranges |
| `EolReport.tsx` | ~25 | "End-of-Life & Impact", status labels, filter controls |
| `ProcessMapReport.tsx` | ~20 | "Process Landscape Map", scope/filter controls |
| `SavedReportsPage.tsx` | ~15 | "Saved Reports", tab labels, empty states, delete confirmation |
| `ReportShell.tsx` | ~10 | Chart/table view toggles, save/print actions |
| `SaveReportDialog.tsx` | ~12 | Save form fields, visibility options |
| `EditReportDialog.tsx` | ~10 | Edit form fields, share controls |
| `MetricCard.tsx` | ~2 | Label display |
| `ReportLegend.tsx` | ~2 | Legend display |

### 8.7 Admin (`src/features/admin/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `MetamodelAdmin.tsx` | ~50 | Tab labels, type/relation CRUD dialogs, badges |
| `metamodel/TypeDetailDrawer.tsx` | ~40 | Property editor, subtypes, field/section CRUD with usage checks |
| `metamodel/FieldEditorDialog.tsx` | ~25 | Field config form, option management, usage warnings |
| `metamodel/StakeholderRolePanel.tsx` | ~30 | Role CRUD, permission editor, archive/restore |
| `metamodel/MetamodelGraph.tsx` | ~5 | Graph labels |
| `metamodel/constants.ts` | ~15 | Field type labels, category names, cardinality labels |
| `RolesAdmin.tsx` | ~50 | Role management, permission editor, archive dialog |
| `UsersAdmin.tsx` | ~50 | User table, invite/edit dialogs, auth provider labels |
| `SettingsAdmin.tsx` | ~80 | Tabs (General, EOL, Portals, ServiceNow), all settings sections |
| `CalculationsAdmin.tsx` | ~60 | Formula editor, test dialog, reference panel, autocomplete |
| `TagsAdmin.tsx` | ~15 | Tag group/tag CRUD |
| `CardLayoutEditor.tsx` | ~20 | Section/field DnD, column/group management |
| `EolAdmin.tsx` | ~20 | Mass EOL linking |
| `SurveysAdmin.tsx` | ~30 | Survey list, status management |
| `SurveyBuilder.tsx` | ~40 | Survey builder form, field configuration, preview |
| `SurveyResults.tsx` | ~25 | Response table, apply actions |
| `WebPortalsAdmin.tsx` | ~25 | Portal CRUD, field configuration |
| `ServiceNowAdmin.tsx` | ~40 | Connection management, mapping editor, sync controls |

### 8.8 BPM (`src/features/bpm/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `BpmDashboard.tsx` | ~20 | "Business Process Management", metric cards, chart labels |
| `ProcessFlowEditorPage.tsx` | ~15 | BPMN editor controls, save/export |
| `ProcessFlowTab.tsx` | ~60 | Published/Drafts/Archived tabs, approval workflow dialogs, element table |
| `ProcessAssessmentPanel.tsx` | ~20 | Assessment form, score labels |
| `BpmnTemplateChooser.tsx` | ~6 | Template selection dialog |
| `BpmnViewer.tsx` | ~3 | Viewer controls |
| `ElementLinker.tsx` | ~8 | Card linking dialog |
| `ProcessNavigator.tsx` | ~5 | Navigator labels |
| `BpmReportPage.tsx` | ~30 | Report tabs, matrix/dependency views |

### 8.9 Diagrams (`src/features/diagrams/`)

| File | String Count | Key Strings |
|------|-------------|-------------|
| `DiagramsPage.tsx` | ~25 | Gallery, CRUD dialogs, type labels |
| `DiagramEditor.tsx` | ~20 | Toolbar actions, sync messages |
| `DiagramSyncPanel.tsx` | ~15 | Sync categories, action buttons |
| `CardSidebar.tsx` | ~8 | Card browser |
| `CardPickerDialog.tsx` | ~8 | Search/select dialog |
| `CreateOnDiagramDialog.tsx` | ~10 | Create card from shape |
| `RelationPickerDialog.tsx` | ~10 | Relation management |

### 8.10 Other Features

| File | String Count | Key Strings |
|------|-------------|-------------|
| `ea-delivery/EADeliveryPage.tsx` | ~40 | Initiative list, SoAW/diagram linking |
| `ea-delivery/SoAWEditor.tsx` | ~30 | Document editor, section management |
| `ea-delivery/SoAWPreview.tsx` | ~15 | Preview mode, signatory display |
| `todos/TodosPage.tsx` | ~15 | Tabs, filter controls, empty states |
| `surveys/SurveyRespond.tsx` | ~8 | Response form |
| `surveys/MySurveys.tsx` | ~8 | Survey list |
| `web-portals/PortalViewer.tsx` | ~10 | Public portal display |

### 8.11 Hooks & Utilities

| File | String Count | Key Strings |
|------|-------------|-------------|
| `api/client.ts` | ~5 | Error messages in `ApiError` formatting |
| `features/inventory/excelExport.ts` | ~5 | Sheet names, headers |
| `features/inventory/excelImport.ts` | ~10 | Validation messages |
| `features/ea-delivery/soawTemplate.ts` | ~15 | SoAW section titles |
| `features/ea-delivery/soawExport.ts` | ~10 | DOCX export labels |

---

## 9. Notification Refactoring

### 9.1 Current State

The `Notification` model stores pre-rendered English strings:

```python
class Notification(Base, UUIDMixin, TimestampMixin):
    type: str          # e.g., "card_updated"
    title: str         # e.g., "John updated Application 'SAP ERP'"
    message: str       # e.g., "Description was changed"
    link: str | None   # e.g., "/cards/uuid"
    data: dict | None  # Currently unused or minimal
```

The `notification_service.py` receives pre-rendered `title` and `message` from the caller.

### 9.2 Target State

Store structured data instead of rendered text:

```python
# New notification creation call:
await create_notification(
    db,
    user_id=stakeholder.user_id,
    notif_type="card_updated",
    title="",     # ← deprecated, keep for backwards compat
    message="",   # ← deprecated
    data={
        "card_name": card.name,
        "card_type": card.type,
        "actor_name": current_user.display_name,
        "changes": ["description", "lifecycle"],
    },
    card_id=card.id,
    actor_id=current_user.id,
)
```

### 9.3 Frontend Rendering

Create a `renderNotification(notif, t)` utility that maps notification types to translated templates:

```typescript
// notifications.json
{
  "types.card_updated.title": "{{actorName}} updated {{cardName}}",
  "types.card_updated.message": "Changed: {{changes}}",
  "types.todo_assigned.title": "{{actorName}} assigned you a todo",
  "types.todo_assigned.message": "{{description}}",
  "types.comment_added.title": "{{actorName}} commented on {{cardName}}",
  "types.approval_status_changed.title": "{{cardName}} was {{status}}",
  "types.soaw_sign_requested.title": "Signature requested for {{documentName}}",
  "types.soaw_signed.title": "{{signerName}} signed {{documentName}}",
  "types.survey_request.title": "New survey: {{surveyName}}"
}
```

```typescript
function renderNotification(notif: Notification, t: TFunction) {
  const data = notif.data || {};
  // New structured notifications
  if (data.card_name || data.actor_name) {
    return {
      title: t(`notifications:types.${notif.type}.title`, data),
      message: t(`notifications:types.${notif.type}.message`, data),
    };
  }
  // Legacy: fall back to stored title/message
  return { title: notif.title, message: notif.message };
}
```

### 9.4 Migration Strategy

1. **Phase 1**: Add structured `data` to new notifications (keep `title`/`message` for backwards compat)
2. **Phase 2**: Update `NotificationBell.tsx` to prefer `data`-based rendering
3. **Phase 3**: Existing notifications with only `title`/`message` display as-is (English)
4. No database migration needed — `data` column already exists as `JSONB`

### 9.5 Notification Type Labels

The `NotificationPreferencesDialog.tsx` has hardcoded labels:

```typescript
const NOTIFICATION_TYPES = [
  { key: "todo_assigned", label: "Todo Assigned" },
  { key: "card_updated", label: "Card Updated" },
  // ...
];
```

These must be migrated to:

```typescript
const NOTIFICATION_TYPES = [
  { key: "todo_assigned", labelKey: "notifications:preferences.todoAssigned" },
  { key: "card_updated", labelKey: "notifications:preferences.cardUpdated" },
  // ...
];
```

---

## 10. Metamodel Translation Support

### 10.1 Current Metamodel Structure

Card types store labels in `fields_schema` as plain strings:

```json
{
  "section": "Technical Details",
  "fields": [
    { "key": "riskLevel", "label": "Risk Level", "type": "single_select",
      "options": [
        { "key": "low", "label": "Low", "color": "#4caf50" },
        { "key": "high", "label": "High", "color": "#f44336" }
      ]
    }
  ]
}
```

### 10.2 Target: Translation-Aware Metamodel

Add an optional `translations` object at each translatable level:

```json
{
  "section": "Technical Details",
  "translations": {
    "de": "Technische Details",
    "fr": "Détails Techniques",
    "es": "Detalles Técnicos"
  },
  "fields": [
    {
      "key": "riskLevel",
      "label": "Risk Level",
      "translations": {
        "de": "Risikostufe",
        "fr": "Niveau de Risque",
        "es": "Nivel de Riesgo"
      },
      "type": "single_select",
      "options": [
        {
          "key": "low", "label": "Low", "color": "#4caf50",
          "translations": { "de": "Niedrig", "fr": "Faible", "es": "Bajo" }
        }
      ]
    }
  ]
}
```

### 10.3 Where Translations Are Needed

| Entity | Field | Translatable? |
|--------|-------|--------------|
| `CardType.label` | Type display name | Yes — add `translations` JSONB column |
| `CardType.description` | Type description | Yes — add to `translations` |
| `CardType.subtypes[].label` | Subtype display names | Yes — via `translations` in JSONB |
| `CardType.fields_schema[].section` | Section headings | Yes — via `translations` in section object |
| `CardType.fields_schema[].fields[].label` | Field display names | Yes — via `translations` in field object |
| `CardType.fields_schema[].fields[].options[].label` | Select option labels | Yes — via `translations` in option object |
| `CardType.fields_schema[].groups[]` | Group headings | Yes — via `translations` in group object |
| `RelationType.label` | Relation verb | Yes — add `translations` JSONB column |
| `RelationType.reverse_label` | Reverse verb | Yes — include in `translations` |
| `StakeholderRoleDefinition.label` | Role name | Yes — add `translations` JSONB column |
| `TagGroup.name` | Tag group name | Optionally |
| `Tag.name` | Tag name | Optionally |

### 10.4 Database Changes

Add a `translations` JSONB column to `card_types`, `relation_types`, and `stakeholder_role_definitions`:

```python
# Migration 037
op.add_column("card_types", sa.Column("translations", JSONB, server_default="{}"))
op.add_column("relation_types", sa.Column("translations", JSONB, server_default="{}"))
op.add_column("stakeholder_role_definitions", sa.Column("translations", JSONB, server_default="{}"))
```

The `translations` column stores:
```json
{
  "label": { "fr": "Application", "es": "Aplicación" },
  "description": { "fr": "...", "es": "..." }
}
```

### 10.5 Seed Data Translations

Update `seed.py` to include translations for all 14 built-in card types. Example:

```python
{
    "key": "Application",
    "label": "Application",
    "translations": {
        "label": {
            "de": "Anwendung",
            "fr": "Application",
            "es": "Aplicación",
            "it": "Applicazione",
            "pt": "Aplicação",
            "zh": "应用程序"
        }
    },
    # ...
}
```

### 10.6 Admin UI Changes — Translation Tab Pattern

Every dialog or drawer that creates or edits a metamodel entity must include a **"Translations" tab** alongside its existing content. This tab shows translation inputs for all translatable labels in the entity being edited. The pattern applies to:

- **TypeDetailDrawer**: Translations tab for the card type's `label` and `description`, each subtype label, each section heading, each group heading
- **FieldEditorDialog**: Translations tab for the field `label` and each select option `label`
- **StakeholderRolePanel** (create/edit role dialog): Translations tab for the role `label` and `description`
- **MetamodelAdmin** (create/edit relation type dialog): Translations tab for the relation `label` and `reverse_label`
- **TagsAdmin** (create/edit tag group / tag dialogs): Translations tab for tag group `name` and tag `name`

**Tab UX pattern:**

```
┌─── General ──┬── Translations ──┐
│                                  │
│  (normal form fields)            │
│  ← shown on General tab          │
│                                  │
│  ── OR ──                        │
│                                  │
│  Field: "Risk Level"             │
│                                  │
│  German (de):     [Risikostufe ] │
│  French (fr):     [Niveau de…  ] │
│  Spanish (es):    [Nivel de …  ] │
│  Italian (it):    [Livello di…]  │
│  Portuguese (pt): [Nível de … ]  │
│  Chinese (zh):    [风险级别    ]  │
│                                  │
│  (one row per translatable label │
│   in the entity being edited)    │
│                                  │
└──────────────────────────────────┘
```

**Implementation details:**

- The tabs use MUI `Tabs` / `Tab` components inside the dialog
- The "General" tab contains the existing form fields (no change to current layout)
- The "Translations" tab shows a form with one text field per supported locale (excluding `en`) for each translatable string in the entity
- When the entity has multiple translatable strings (e.g., a field label + its option labels), group them with section headings
- Empty translation fields are omitted from the saved `translations` object (only non-empty values are stored)
- The translations object structure follows section 10.2 format
- A shared `TranslationFields` component encapsulates the locale input rows to avoid duplication across dialogs

### 10.7 Frontend Resolution

Create a helper to resolve translated labels:

```typescript
function resolveLabel(
  label: string,
  translations?: Record<string, string>,
  locale?: string
): string {
  if (!translations || !locale || locale === "en") return label;
  return translations[locale] || label;
}
```

Use in metamodel-driven components:

```tsx
const typeLabel = resolveLabel(type.label, type.translations?.label, i18n.language);
```

---

## 11. MUI & AG Grid Locale Configuration

### 11.1 MUI Localization

MUI provides locale packs for component text (date pickers, pagination, data grid, etc.).

```typescript
import { deDE, zhCN, frFR, esES, itIT, ptBR } from "@mui/material/locale";

const MUI_LOCALES: Record<string, object> = {
  en: {},  // MUI defaults to English
  de: deDE,
  fr: frFR,
  es: esES,
  it: itIT,
  pt: ptBR,
  zh: zhCN,
};

// In App.tsx, apply to theme:
const theme = useMemo(() =>
  createTheme(themeOptions, MUI_LOCALES[i18n.language] || {}),
  [themeOptions, i18n.language]
);
```

### 11.2 AG Grid Localization

AG Grid supports locale text via `localeText` grid option.

```typescript
import { AG_GRID_LOCALE_FR } from "@ag-grid-community/locale";
// Or define custom locale objects for each language

const AG_GRID_LOCALES: Record<string, object> = {
  en: {},
  fr: AG_GRID_LOCALE_FR,
  // ... custom objects for es, it, pt, zh
};

// In InventoryPage.tsx:
<AgGridReact
  localeText={AG_GRID_LOCALES[i18n.language]}
  // ...
/>
```

AG Grid provides official locale packs for French and German. For other languages, we'll need to create custom `localeText` objects (~50 keys for pagination, filtering, column menu).

### 11.3 Date Formatting

Currently mixed — some `toLocaleDateString()`, some hardcoded `"en-US"`. Standardize to:

```typescript
function formatDate(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
```

Pass `i18n.language` as the locale parameter. The `Intl.DateTimeFormat` API handles locale-specific formatting automatically.

---

## 12. Migration Strategy

### 12.1 Incremental Approach

The migration is designed to be **incremental and non-breaking**. At every step, the app remains fully functional in English.

1. **Infrastructure first**: i18n setup, English translations, language switcher — all existing code continues working unchanged
2. **File-by-file migration**: Each component is migrated independently by replacing hardcoded strings with `t()` calls
3. **No big-bang switch**: Components can be migrated over multiple PRs

### 12.2 Migration Pattern per File

For each `.tsx` file:

1. Add `import { useTranslation } from "react-i18next";`
2. Add `const { t } = useTranslation("namespace");` at the top of the component
3. Replace each hardcoded string with `t("key")`
4. For strings with dynamic values, use `t("key", { name, count })` with interpolation
5. For plural strings, create `_one` / `_other` keys
6. For constants/arrays defined outside components, either:
   - Move them inside the component to access `t()`
   - Convert to a function that takes `t` as a parameter
   - Use `i18n.t()` for module-level code (less ideal)

### 12.3 Constants Migration Example

Before:
```typescript
const NAV_ITEMS = [
  { label: "Dashboard", icon: "dashboard", path: "/" },
  { label: "Inventory", icon: "inventory_2", path: "/inventory" },
];
```

After:
```typescript
function getNavItems(t: TFunction): NavItem[] {
  return [
    { label: t("nav:dashboard"), icon: "dashboard", path: "/" },
    { label: t("nav:inventory"), icon: "inventory_2", path: "/inventory" },
  ];
}

// Inside component:
const navItems = useMemo(() => getNavItems(t), [t]);
```

---

## 13. File-by-File Migration Checklist

This is the complete list of files requiring migration, grouped by priority.

### Priority 1: Infrastructure (must be done first) ✅

- [x] `src/i18n/index.ts` — i18n configuration
- [x] `src/i18n/locales/en/*.json` — all 12 English namespace files
- [x] `src/main.tsx` — import i18n
- [x] `src/types/index.ts` — add `locale` to User type
- [x] `src/hooks/useAuth.ts` — sync locale with i18next on login

### Priority 2: Layout & Navigation (high visibility) ✅

- [x] `src/layouts/AppLayout.tsx` — nav items, admin menu, user menu, search, language switcher
- [x] `src/App.tsx` — loading fallback text (if any)

### Priority 3: Auth Pages ✅

- [x] `src/features/auth/LoginPage.tsx`
- [x] `src/features/auth/SetPasswordPage.tsx`
- [x] `src/features/auth/SsoCallback.tsx`

### Priority 4: Dashboard & Core ✅

- [x] `src/features/dashboard/Dashboard.tsx`
- [x] `src/components/CreateCardDialog.tsx`
- [x] `src/components/LifecycleBadge.tsx`
- [x] `src/components/ApprovalStatusBadge.tsx`
- [x] `src/components/NotificationBell.tsx`
- [x] `src/components/NotificationPreferencesDialog.tsx`
- [x] `src/components/EolLinkSection.tsx`
- [x] `src/components/VendorField.tsx`
- [x] `src/components/ColorPicker.tsx`
- [x] `src/components/KeyInput.tsx`
- [x] `src/components/TimelineSlider.tsx`

### Priority 5: Inventory ✅

- [x] `src/features/inventory/InventoryPage.tsx`
- [x] `src/features/inventory/InventoryFilterSidebar.tsx`
- [x] `src/features/inventory/ImportDialog.tsx`
- [x] `src/features/inventory/RelationCellPopover.tsx`
- [x] `src/features/inventory/excelExport.ts`
- [x] `src/features/inventory/excelImport.ts`

### Priority 6: Card Detail ✅

- [x] `src/features/cards/CardDetail.tsx`
- [x] `src/features/cards/sections/DescriptionSection.tsx`
- [x] `src/features/cards/sections/LifecycleSection.tsx`
- [x] `src/features/cards/sections/AttributeSection.tsx`
- [x] `src/features/cards/sections/HierarchySection.tsx`
- [x] `src/features/cards/sections/RelationsSection.tsx`
- [x] `src/features/cards/sections/StakeholdersTab.tsx`
- [x] `src/features/cards/sections/CommentsTab.tsx`
- [x] `src/features/cards/sections/TodosTab.tsx`
- [x] `src/features/cards/sections/HistoryTab.tsx`
- [x] `src/features/cards/sections/cardDetailUtils.tsx`

### Priority 7: Reports ✅

- [x] `src/features/reports/ReportShell.tsx`
- [x] `src/features/reports/MetricCard.tsx` (presentational — no hardcoded strings)
- [x] `src/features/reports/ReportLegend.tsx` (presentational — no hardcoded strings)
- [x] `src/features/reports/SaveReportDialog.tsx`
- [x] `src/features/reports/EditReportDialog.tsx`
- [x] `src/features/reports/SavedReportsPage.tsx`
- [x] `src/features/reports/PortfolioReport.tsx`
- [x] `src/features/reports/CapabilityMapReport.tsx`
- [x] `src/features/reports/LifecycleReport.tsx`
- [x] `src/features/reports/DependencyReport.tsx`
- [x] `src/features/reports/CostReport.tsx`
- [x] `src/features/reports/MatrixReport.tsx`
- [x] `src/features/reports/DataQualityReport.tsx`
- [x] `src/features/reports/EolReport.tsx`
- [x] `src/features/reports/ProcessMapReport.tsx`

### Priority 8: BPM ✅

- [x] `src/features/bpm/BpmDashboard.tsx`
- [x] `src/features/bpm/ProcessFlowEditorPage.tsx`
- [x] `src/features/bpm/ProcessFlowTab.tsx`
- [x] `src/features/bpm/ProcessAssessmentPanel.tsx`
- [x] `src/features/bpm/BpmnTemplateChooser.tsx`
- [x] `src/features/bpm/BpmnViewer.tsx`
- [x] `src/features/bpm/ElementLinker.tsx`
- [x] `src/features/bpm/ProcessNavigator.tsx`
- [x] `src/features/bpm/BpmReportPage.tsx`
- [x] `src/features/bpm/BpmnModeler.tsx`

### Priority 9: Diagrams ✅

- [x] `src/features/diagrams/DiagramsPage.tsx`
- [x] `src/features/diagrams/DiagramEditor.tsx`
- [x] `src/features/diagrams/DiagramSyncPanel.tsx`
- [x] `src/features/diagrams/CardSidebar.tsx`
- [x] `src/features/diagrams/CardPickerDialog.tsx`
- [x] `src/features/diagrams/CreateOnDiagramDialog.tsx`
- [x] `src/features/diagrams/RelationPickerDialog.tsx`

### Priority 10: Admin ✅

- [x] `src/features/admin/MetamodelAdmin.tsx`
- [x] `src/features/admin/metamodel/TypeDetailDrawer.tsx`
- [x] `src/features/admin/metamodel/FieldEditorDialog.tsx`
- [x] `src/features/admin/metamodel/StakeholderRolePanel.tsx`
- [x] `src/features/admin/metamodel/MetamodelGraph.tsx`
- [x] `src/features/admin/metamodel/constants.ts`
- [x] `src/features/admin/RolesAdmin.tsx`
- [x] `src/features/admin/UsersAdmin.tsx`
- [x] `src/features/admin/SettingsAdmin.tsx`
- [x] `src/features/admin/CalculationsAdmin.tsx`
- [x] `src/features/admin/TagsAdmin.tsx`
- [x] `src/features/admin/CardLayoutEditor.tsx`
- [x] `src/features/admin/EolAdmin.tsx`
- [x] `src/features/admin/SurveysAdmin.tsx`
- [x] `src/features/admin/SurveyBuilder.tsx`
- [x] `src/features/admin/SurveyResults.tsx`
- [x] `src/features/admin/WebPortalsAdmin.tsx`
- [x] `src/features/admin/ServiceNowAdmin.tsx`

### Priority 11: Other Features ✅

- [x] `src/features/ea-delivery/EADeliveryPage.tsx`
- [x] `src/features/ea-delivery/SoAWEditor.tsx`
- [x] `src/features/ea-delivery/SoAWPreview.tsx`
- [x] `src/features/ea-delivery/RichTextEditor.tsx`
- [x] `src/features/ea-delivery/soawTemplate.ts`
- [x] `src/features/ea-delivery/soawExport.ts`
- [x] `src/features/todos/TodosPage.tsx`
- [x] `src/features/surveys/SurveyRespond.tsx`
- [x] `src/features/surveys/MySurveys.tsx`
- [x] `src/features/web-portals/PortalViewer.tsx`

### Priority 12: MUI & AG Grid Locale

- [ ] `src/App.tsx` — MUI locale injection
- [ ] `src/features/inventory/InventoryPage.tsx` — AG Grid `localeText`
- [ ] Create AG Grid locale files for es, it, pt, zh (DE and FR are provided by AG Grid)

---

## 14. Translation Workflow

### 14.1 Process

1. **Developer** adds new strings to the English JSON file
2. **Developer** adds the corresponding `t()` call in the component
3. **Translator** receives the English JSON file and creates translations
4. **Translator** places translated JSON files in the appropriate locale directory
5. **Developer** reviews and merges translations
6. **QA** tests each locale for layout issues (text overflow, truncation)

### 14.2 Translation File Management

Each namespace file is independent. Translators work on one namespace at a time.

Missing keys fall back to English automatically (i18next `fallbackLng: "en"`), so partial translations are safe — the app shows English for any untranslated strings.

### 14.3 Translation Key Guidelines

- Use descriptive dot-separated paths: `dialogs.archive.title`, not `archDlgTtl`
- Group by UI context, not by English word
- Never reuse keys for strings that might translate differently (e.g., "Save" as button vs "Save" as noun)
- Use interpolation (`{{name}}`) instead of string concatenation
- Use plural suffixes (`_one`, `_other`) for countable items
- Include translator context as comments in the JSON where ambiguous

---

## 15. Testing Strategy

### 15.1 Frontend Tests

- **Existing tests**: Mock `react-i18next` globally in test setup:
  ```typescript
  vi.mock("react-i18next", () => ({
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "en", changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: any) => children,
    initReactI18next: { type: "3rdParty", init: () => {} },
  }));
  ```
- **New tests**: Verify that key UI elements render correctly with `t()` (assert translation keys appear)
- **Snapshot tests**: Update snapshots after migration (keys instead of English text)

### 15.2 Backend Tests

- Test `locale` field on user model
- Test `PATCH /users/{id}` with `locale` parameter
- Test locale validation (reject unsupported locales)
- Test `/auth/me` returns `locale` field

### 15.3 Manual Testing Checklist

For each locale:
- [ ] Login page renders correctly
- [ ] Navigation labels are translated
- [ ] Dashboard metrics and charts are translated
- [ ] Inventory page (table headers, filters, dialogs)
- [ ] Card detail (all sections and tabs)
- [ ] Reports (titles, controls, legends, tooltips)
- [ ] Admin pages (all tabs and dialogs)
- [ ] Notifications render from structured data
- [ ] Text doesn't overflow or break layouts (German/French text is ~30% longer than English)
- [ ] Pluralization works correctly
- [ ] Date formatting matches locale
- [ ] Currency formatting is correct
- [ ] Language switcher persists preference

### 15.4 Layout Testing Considerations

| Language | Text Length vs English | Key Risk |
|----------|-----------------------|----------|
| German | +20–35% longer | Button overflow, column width, compound words |
| French | +15–30% longer | Button overflow, column width |
| Spanish | +15–25% longer | Button overflow |
| Italian | +10–20% longer | Minor overflow |
| Portuguese | +15–25% longer | Button overflow |
| Chinese | ~20–40% shorter | Empty space, character rendering |

Test with German (longest) and Chinese (shortest) to cover both extremes.

---

## 16. Phase Plan & Milestones

### Phase 1: Infrastructure ✅

**Scope**: Backend locale field + frontend i18n setup

**Backend**:
- [x] User model: `locale` column
- [x] Migration `036_add_user_locale.py`
- [x] Auth schema: `locale` in `UserResponse`
- [x] Auth API: `/auth/me` returns `locale`
- [x] Users API: `locale` in `UserUpdate`, validation, self-update

**Frontend**:
- [x] `i18next`, `react-i18next`, `i18next-browser-languagedetector` installed
- [x] Create `src/i18n/index.ts` configuration (7 locales incl. German)
- [x] Create all 12 English namespace JSON files (skeleton with initial keys)
- [x] Create skeleton files for DE, FR, ES, IT, PT, ZH
- [x] Update `src/main.tsx` to import i18n
- [x] Add `locale` to `User` type
- [x] Sync locale in `useAuth.ts`
- [x] Add language switcher in `AppLayout.tsx` (with German)

### Phase 2: Core Component Migration ✅

**Scope**: Migrate ~30 core files (layout, auth, dashboard, shared components)

- [x] `AppLayout.tsx` (nav items, user menu, search, language switcher)
- [x] Auth pages (`LoginPage`, `SetPasswordPage`, `SsoCallback`)
- [x] `Dashboard.tsx`
- [x] `CreateCardDialog.tsx`
- [x] `NotificationBell.tsx` + `NotificationPreferencesDialog.tsx`
- [x] `LifecycleBadge.tsx` + `ApprovalStatusBadge.tsx`
- [x] `EolLinkSection.tsx` (incl. `EolPicker`, `EolCycleDetails`, `EolLinkDialog`)
- [x] `VendorField.tsx`
- [x] `ColorPicker.tsx` + `KeyInput.tsx` + `TimelineSlider.tsx`
- [x] English translation JSONs populated (common, auth, cards, notifications, validation)

### Phase 3: Feature Migration ✅

**Scope**: Migrate ~80 feature files

- [x] Inventory (6 files) — 154 translation keys
- [x] Card Detail (11 files) — 126 translation keys
- [x] Reports (15 files) — 293 translation keys
- [x] Admin (18 files) — 658 translation keys
- [x] BPM (10 files) — 202 translation keys
- [x] Diagrams (7 files) — 66 translation keys
- [x] Other features (10 files) — 237 delivery + 155 common + 18 notification keys

### Phase 4: Notification Refactoring

**Scope**: Structured notification codes + client-side rendering

- [ ] Update `notification_service.py` to include structured `data`
- [ ] Update all notification callers to pass structured data
- [ ] Update `NotificationBell.tsx` to render from `data`
- [ ] Update `NotificationPreferencesDialog.tsx` labels

### Phase 5: Metamodel Translation Support

**Scope**: Translatable type/field/option labels

- [ ] Migration: add `translations` JSONB to `card_types`, `relation_types`, `stakeholder_role_definitions`
- [ ] Update seed with translations for all built-in types
- [ ] Update metamodel API to accept/return translations
- [ ] Update admin UI (TypeDetailDrawer, FieldEditorDialog) with translation inputs
- [ ] Create `resolveLabel()` helper for frontend
- [ ] Update all metamodel-driven components to use `resolveLabel()`

### Phase 6: MUI & AG Grid Locale

**Scope**: Framework-level localization

- [ ] MUI locale packs in theme
- [ ] AG Grid locale texts
- [ ] Date formatting standardization

### Phase 7: Translations

**Scope**: Create translation files for DE, FR, ES, IT, PT, ZH

- [ ] German translations (all 12 namespaces)
- [ ] French translations (all 12 namespaces)
- [ ] Spanish translations (all 12 namespaces)
- [ ] Italian translations (all 12 namespaces)
- [ ] Portuguese translations (all 12 namespaces)
- [ ] Chinese translations (all 12 namespaces)
- [ ] Seed data translations for all 14 card types (incl. German)

### Phase 8: QA & Polish

**Scope**: Testing and layout fixes

- [ ] Layout testing with all locales
- [ ] Fix text overflow issues
- [ ] Fix pluralization edge cases
- [ ] Update frontend tests
- [ ] Update backend tests

---

## 17. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Text overflow in non-English locales | Medium | High | Test with French (longest); use MUI `noWrap` + tooltips where needed |
| Translation quality issues | Medium | Medium | Manual review by native speakers; use professional translators |
| Missing translation keys at runtime | Low | Medium | i18next falls back to English; CI lint can check for missing keys |
| Performance impact of loading all locales | Low | Low | Bundle all locales (~200KB total); lazy-load if needed later |
| Breaking existing tests | Medium | High | Mock `react-i18next` globally in test setup; update assertions |
| Metamodel translations data migration | Low | Low | `translations` column defaults to `{}`; backwards compatible |
| Chinese character rendering | Low | Low | MUI + browser handle CJK natively; test fonts |
| DrawIO integration language | Low | Low | DrawIO has its own i18n; keep separate from Turbo EA |

---

## Appendix: String Counts by File

Comprehensive per-file string count extracted from the codebase analysis:

| File | Strings | Namespace |
|------|---------|-----------|
| `AppLayout.tsx` | ~55 | nav, common |
| `LoginPage.tsx` | ~12 | auth |
| `SetPasswordPage.tsx` | ~13 | auth |
| `SsoCallback.tsx` | ~4 | auth |
| `Dashboard.tsx` | ~30 | common |
| `InventoryPage.tsx` | ~80 | inventory |
| `InventoryFilterSidebar.tsx` | ~70 | inventory |
| `ImportDialog.tsx` | ~50 | inventory |
| `CardDetail.tsx` | ~35 | cards |
| `DescriptionSection.tsx` | ~8 | cards |
| `LifecycleSection.tsx` | ~8 | cards |
| `AttributeSection.tsx` | ~6 | cards |
| `HierarchySection.tsx` | ~25 | cards |
| `RelationsSection.tsx` | ~20 | cards |
| `StakeholdersTab.tsx` | ~12 | cards |
| `CommentsTab.tsx` | ~6 | cards |
| `TodosTab.tsx` | ~12 | cards |
| `HistoryTab.tsx` | ~20 | cards |
| `cardDetailUtils.tsx` | ~10 | cards |
| `PortfolioReport.tsx` | ~25 | reports |
| `CapabilityMapReport.tsx` | ~20 | reports |
| `LifecycleReport.tsx` | ~15 | reports |
| `DependencyReport.tsx` | ~20 | reports |
| `CostReport.tsx` | ~15 | reports |
| `MatrixReport.tsx` | ~20 | reports |
| `DataQualityReport.tsx` | ~20 | reports |
| `EolReport.tsx` | ~25 | reports |
| `ProcessMapReport.tsx` | ~20 | reports |
| `SavedReportsPage.tsx` | ~15 | reports |
| `ReportShell.tsx` | ~10 | reports |
| `SaveReportDialog.tsx` | ~12 | reports |
| `EditReportDialog.tsx` | ~10 | reports |
| `MetamodelAdmin.tsx` | ~50 | admin |
| `TypeDetailDrawer.tsx` | ~40 | admin |
| `FieldEditorDialog.tsx` | ~25 | admin |
| `StakeholderRolePanel.tsx` | ~30 | admin |
| `metamodel/constants.ts` | ~15 | admin |
| `RolesAdmin.tsx` | ~50 | admin |
| `UsersAdmin.tsx` | ~50 | admin |
| `SettingsAdmin.tsx` | ~80 | admin |
| `CalculationsAdmin.tsx` | ~60 | admin |
| `TagsAdmin.tsx` | ~15 | admin |
| `CardLayoutEditor.tsx` | ~20 | admin |
| `BpmDashboard.tsx` | ~20 | bpm |
| `ProcessFlowEditorPage.tsx` | ~15 | bpm |
| `ProcessFlowTab.tsx` | ~60 | bpm |
| `ProcessAssessmentPanel.tsx` | ~20 | bpm |
| `BpmnTemplateChooser.tsx` | ~6 | bpm |
| `ElementLinker.tsx` | ~8 | bpm |
| `BpmReportPage.tsx` | ~30 | bpm |
| `DiagramsPage.tsx` | ~25 | diagrams |
| `DiagramEditor.tsx` | ~20 | diagrams |
| `DiagramSyncPanel.tsx` | ~15 | diagrams |
| `EADeliveryPage.tsx` | ~40 | delivery |
| `SoAWEditor.tsx` | ~30 | delivery |
| `SoAWPreview.tsx` | ~15 | delivery |
| `TodosPage.tsx` | ~15 | common |
| `SurveyRespond.tsx` | ~8 | admin |
| `MySurveys.tsx` | ~8 | admin |
| `CreateCardDialog.tsx` | ~40 | cards |
| `NotificationBell.tsx` | ~15 | notifications |
| `NotificationPreferencesDialog.tsx` | ~20 | notifications |
| `EolLinkSection.tsx` | ~20 | cards |
| `api/client.ts` | ~5 | validation |
| **Total** | **~2,000+** | |

*Note: Many strings are shared across files (e.g., "Save", "Cancel", "Delete") and will be deduplicated into the `common` namespace, reducing the total unique translation keys to ~2,000.*
