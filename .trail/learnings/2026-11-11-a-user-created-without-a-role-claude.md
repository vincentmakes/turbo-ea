---
title: "A user created without a role gets the admin's default role, and a delegated inviter may hand out that role too"
author: Claude
date: 2026-11-11
branch: claude/fervent-knuth-f9u3hj
cost: { minutes: 14, tokens: 155640 }
id: l-fffa3d22
scope: repo
status: active
src: agent
touches:
  - backend/tests/api/test_users.py
  - frontend/src/features/admin/users/defaultRole.ts
  - frontend/src/features/admin/users/defaultRole.test.ts
  - backend/app/api/v1/users.py
  - backend/app/api/v1/auth.py
  - frontend/src/features/cards/sections/StakeholdersTab.tsx
  - backend/app/api/v1/roles.py
  - frontend/src/features/admin/UsersAdmin.tsx
---

## Decided
Issue #1388: the role flagged as default in Users & Roles was honoured by registration and SSO but not by the two in-app creation paths, which hardcoded Member. The server is now the one place that turns "no role given" into the default role. The Create user dialog pre-selects the default (the admin sees it and can change it); the stakeholder invite sends no role at all, because it has no role picker.

A holder of users.invite without admin.users could only create Member or Viewer accounts. The default role was added to that allowed set: it is the role every self-registered or SSO-provisioned account already receives, and a role with full administrative access can never be made the default, so this cannot reach admin. Without it, a custom default role would have made the stakeholder invite fail with 403. The user approved this in the plan.

## Tried and ruled out
Resolving the default only in the frontend: the stakeholder tab would need to load the roles list just to echo a key back, and any API caller omitting the role would still get Member.

## Watch out
The Excel user import still turns a blank role into Viewer, as its documentation says. That was left alone on purpose.

In the code: `create_user` in backend/app/api/v1/users.py (`role_key`, `delegated_roles`), reusing `_default_role_key` from auth.py; `defaultRoleKey` in frontend/src/features/admin/users/defaultRole.ts; tests in `TestCreateUserDefaultRole`.
