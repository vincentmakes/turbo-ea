---
title: "Taking a user's role from the identity provider's groups is a free core feature for native SSO too, with the same rules as reverse-proxy sign-in plus two safet…"
author: Claude
date: 2026-11-26
branch: claude/clever-darwin-1ukcos
cost: { minutes: 15, tokens: 296086 }
id: l-12578955
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - Dockerfile
  - VERSION
  - backend/tests/services/test_nginx_headers.py
  - docs/admin/kubernetes.ar.md
  - docs/admin/kubernetes.da.md
  - docs/admin/kubernetes.de.md
  - docs/admin/kubernetes.es.md
  - docs/admin/kubernetes.fr.md
  - docs/admin/kubernetes.it.md
---

## Decided
Discussion 1446 asked for group-to-role mapping on native OIDC sign-in. The owner decided on 26 November 2026:

- It ships in the free core, not as a paid extension. The same mapping was already free for reverse-proxy sign-in (#1006), anyone could get it by putting oauth2-proxy in front, extensions have no sign-in hook (opening one would let plugin code assign roles), and a lapsed licence on an access feature has no good behaviour.
- Same rules as proxy mode, on every SSO sign-in: first match in map order wins, case-insensitive; a value that matches nothing gives the default role (so removing a group demotes); an absent claim leaves the role alone (a mistyped claim name must not demote everyone); an unknown or archived target role gives the default role.
- A role map never demotes the last active admin. Proxy mode had only the bootstrap admin address as a way back in; native SSO had none.
- While a map is in force, the role of a federated (SSO) user cannot be edited in Users admin: the picker is locked with a hint and the API refuses the change. Before, a hand edit silently reverted at the next sign-in.
- Both safety rules cover reverse-proxy mode as well, so the two sign-in modes cannot drift.
- Extra OAuth scopes go to the app's own login only, not to portal or published-diagram sign-in.

## Tried and ruled out
- A paid "enterprise identity" extension for this: see above. A paid line could still sit on top later (SCIM, several IdPs, groups to stakeholder roles).
- "No match keeps the current role": safer to switch on, but removing someone from a group would no longer demote them and the two modes would differ.
- Role picker left editable with a warning: allows a temporary promotion, at the price of silent reverts.
- An allowed-groups list that refuses sign-in: left out. It is a sign-in gate, a separate access decision, and a second way to lock people out.
- Honouring the map for Microsoft with a multi-tenant tenant (organizations, common, consumers): a foreign tenant could assign itself the app's roles, so the map needs a specific tenant ID.

## Watch out
- A user whose token never carries the claim keeps their role and, while the map is on, nobody can edit it by hand. Entra drops the groups claim above 200 groups: map app roles instead. Way out: fix the claim or switch the account to local sign-in.
- An empty claim counts as absent: removing someone from every group does not demote them; removing their access to the app in the IdP does.
- A directory change lands at the user's next IdP sign-in, not during a running session (a session refresh re-reads the database role, never the IdP).
- The map overrides an invitation's role at first sign-in.
- Audit values must be flat: the role map is recorded as a list of "value → Role label" strings, not a list of objects.
- The owner wants nothing posted on the discussion by an agent.

In the code:
- backend/app/services/directory_roles.py (shared pure logic; native_role_map(sso) is the one answer to "is a native map in force")
- backend/app/api/v1/auth.py: _resolve_mapped_role, _apply_directory_role, used by sso_callback and proxy_session
- backend/app/api/v1/settings.py: general_settings["sso"] keys role_claim, role_map, extra_scopes
- backend/app/api/v1/users.py: role_managed_externally on the admin user payload
