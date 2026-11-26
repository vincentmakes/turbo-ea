---
title: "Taking a user's role from the identity provider's groups is a free core feature for native SSO too, with the same rules as reverse-proxy sign-in plus safety ru…"
author: Claude
date: 2026-11-26
branch: claude/clever-darwin-1ukcos
cost: { minutes: 31, tokens: 87072 }
id: l-3bb9c9e6
scope: repo
status: active
replaces: l-12578955
src: agent
touches:
  - docs/admin/sso.ar.md
  - docs/admin/sso.da.md
  - docs/admin/sso.de.md
  - docs/admin/sso.es.md
  - docs/admin/sso.fr.md
  - docs/admin/sso.it.md
  - docs/admin/sso.pt.md
  - docs/admin/sso.ru.md
  - docs/admin/sso.zh.md
  - frontend/src/i18n/locales/ar/admin.json
---

## Decided
Discussion 1446, owner's decisions of 26 November 2026:

- Free core, not a paid extension: the same mapping was already free for reverse-proxy sign-in (#1006), extensions have no sign-in hook, and a lapsed licence on an access feature has no good behaviour.
- Same rules as proxy mode at every SSO sign-in: first match in map order, case-insensitive; no match gives the default role (so removing a group demotes); an absent or empty claim leaves the role alone (a mistyped claim name must not demote everyone); an unknown or archived target gives the default role.
- A map never demotes the last active admin, and the role of a federated user is locked in Users admin (picker and API) while a map is in force. Both rules cover reverse-proxy mode too.
- Changing the claim or the map rows needs the right to manage users on top of the settings right: a map hands out roles, admin included.
- Extra OAuth scopes go to the app's own sign-in only, never to Google and never to portal or published-diagram sign-in.

## Tried and ruled out
- "No match keeps the current role": removing someone from a group would no longer demote them.
- An editable role picker with a warning: silent reverts at the next sign-in.
- An allowed-groups list that refuses sign-in: a separate access decision, left out.
- Honouring the map for a multi-tenant Microsoft tenant: another tenant could assign itself the app's roles.

## Watch out
- A user whose token never carries the claim keeps their role, and nobody can edit it while the map is on (Entra drops groups above 200: map app roles).
- A directory change lands at the next IdP sign-in, not in a running session.
- The map overrides an invitation's role at first sign-in.
- Audit values must be flat: the map is logged as "value → Role label" strings.
- The owner wants nothing posted on the discussion by an agent.

In the code:
- backend/app/services/directory_roles.py: native_role_map, login_scopes, role_mapping_changed
- backend/app/api/v1/auth.py: _resolve_mapped_role, _apply_directory_role (sso_callback, proxy_session)
- backend/app/api/v1/settings.py (general_settings["sso"]: role_claim, role_map, extra_scopes), backend/app/api/v1/users.py (role_managed_externally)
- frontend/src/features/admin/AuthAdmin.tsx, UsersAdmin.tsx; docs/admin/sso.md
