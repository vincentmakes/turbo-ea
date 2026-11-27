---
title: "PPM through the AI assistant (MCP): everything readable, work packages, tasks, reports, risks and comments writable, and the only delete is a dependency link"
author: Claude
date: 2026-11-27
branch: claude/gracious-ritchie-51s8qg
cost: { minutes: 9, tokens: 114206 }
id: l-ba1e48f4
scope: repo
status: active
src: agent
touches:
  - mcp-server/turbo_ea_mcp/server.py
  - backend/app/services/rollback_service.py
  - backend/app/api/v1/ppm.py
  - frontend/src/features/ppm/PpmTaskDialog.tsx
---

## Decided
The owner decided (2026-11-27, discussion 1457) how far the MCP server reaches into PPM:
- Readable: work packages and milestones, tasks, dependencies, status reports, project risks, task comments.
- Writable (create and update): work packages and milestones, tasks, status reports, project risks; a task comment can be added; a dependency link can be added.
- The only delete an assistant gets is removing a dependency link. It is restored by adding it again, the same reasoning that allows clearing a card logo.
- PPM is a built-in module, so the tools call the ordinary PPM REST routes with the user's token; the extension-tool mechanism cannot carry it.

## Tried and ruled out
- Read-only status reports, risks and comments: the owner wanted all three writable.
- No deletes at all: an assistant that adds a wrong dependency would have no remedy.
- Deletes for every PPM row behind an opt-in flag: PPM rows have no archive, a work package delete cascades to its sub-packages, and the MCP rules keep irreversible removal in the web app.
- Budget and cost lines: not asked for, and cost visibility has its own redaction rules; left out on purpose, not forgotten.

## Watch out
- PPM rows publish no event of their own, so a batch rollback cannot undo a PPM write. The initiative's calculated fields do publish a card event when PPM rows change; rollback must decline those, or it resets the calculated fields while the rows stay.
- The PPM routes do not check whether the module is switched on; only the web app does. The tools check it themselves.
- A PPM preview is built by the MCP server, not verified by the backend: the routes have no dry-run flag.

In the code:
- Tools: get_ppm_plan, list_ppm_status_reports, list_ppm_risks, get_ppm_task_comments, save_ppm_work_packages, save_ppm_tasks, save_ppm_status_reports, save_ppm_risks, add_ppm_task_comment, set_ppm_dependencies (mcp-server/turbo_ea_mcp/server.py, helpers in turbo_ea_mcp/ppm.py).
- Card events declined by rollback: card.updated with source ppm_rollup / ppm_cost_rollup (backend/app/services/rollback_service.py).
- Module switch: GET /settings/ppm-enabled. Cap: MCP_MAX_PPM_ROWS_PER_CALL (default 200).
