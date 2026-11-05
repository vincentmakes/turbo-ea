---
title: "Help text is read as an info-icon tooltip and edited as a collapsible; lifecycle phase help is one global setting, roles translate their description in the sam…"
author: Claude
date: 2026-11-04
branch: feat/help-tooltips-roles-lifecycle
cost: { minutes: 15, tokens: 244283 }
id: l-538d3ffb
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/cards/sections/cardDetailUtils.tsx
  - backend/app/api/v1/settings.py
  - backend/app/services/stakeholder_service.py
  - frontend/src/hooks/useResolveLabel.ts
  - CHANGELOG.md
  - frontend/src/features/cards/sections/AttributeSection.tsx
  - frontend/src/features/cards/sections/StakeholdersTab.tsx
  - frontend/src/features/cards/sections/LifecycleSection.tsx
  - frontend/src/api/bootstrap.ts
  - frontend/src/hooks/useFiscalYearStart.ts
---

## Decided
- Discussion #1351 asked for a stakeholder role's description on hover. The existing field help (#1297) was edit-mode only: a collapsible "Help" link under the control, nothing in read mode. The user chose one shared read-mode presentation: a small help icon beside the label that shows the text on hover and keyboard focus. Edit mode keeps the collapsible. Fields, stakeholder roles and lifecycle phases all use the same two shapes.
- Lifecycle phases are five fixed keys with no stored config, so their help text is a global setting: one text per phase, per locale, in the app settings blob, served by the bootstrap endpoint, edited under Admin → Metamodel in its own tab (appended last so existing tab indices keep working). The user chose global over per card type: the meaning of "Phase out" is an organisation-wide definition.
- A stakeholder role's description already existed on the role row but was dropped from every end-user payload; it is now carried through and translated under the role's per-property translations JSONB (`translations.description[locale]`), no migration.
- Select options get no help of their own (user's call): the field's help text is where an admin lists the options and what they mean.
- Card-type and relation-type descriptions stay out of scope for this change.

## Tried and ruled out
- Collapsible help everywhere in read mode: rejected, the discussion asked for hover, and a collapsible under every read-only value is noise.
- Per card type lifecycle help stored on the type's lifecycle section config: rejected, an admin would fill the same five texts on every type.
- Per-option help on select fields: rejected by the user, the field help covers it.

## Watch out
- Three role renderers (My roles, the stakeholder hover card, the admin stakeholder directory) passed the whole `{label: {...}}` map to the flat resolver, so role names never localised there; use `useTypeLabel()` with the whole role entity.
- A relation *instance* description UI (#1284) was built and dropped by the maintainer; this change does not touch relation descriptions.

In the code:
- Plan: /root/.claude/plans/magical-zooming-boot.md (session-local). Branch `feat/help-tooltips-roles-lifecycle`.
- Shared component `frontend/src/components/HelpTip.tsx`; edit-mode collapsible stays `FieldHelp` in `frontend/src/features/cards/sections/cardDetailUtils.tsx`.
- Lifecycle help: `backend/app/services/lifecycle_phase_help.py`, `GET/PATCH /settings/lifecycle-phase-help` in `backend/app/api/v1/settings.py` (gated `admin.metamodel`), `lifecycle_phase_help` in `/settings/bootstrap`, hook `frontend/src/hooks/useLifecyclePhaseHelp.ts`, panel `frontend/src/features/admin/metamodel/LifecyclePhaseHelpPanel.tsx`.
- Role description: `roles_for_type` in `backend/app/services/stakeholder_service.py`, `GET /stakeholder-roles`, `GET /cards/my-stakeholder`, stakeholder directory report; resolver `typeDescription` / `useTypeDescription` in `frontend/src/hooks/useResolveLabel.ts`.
