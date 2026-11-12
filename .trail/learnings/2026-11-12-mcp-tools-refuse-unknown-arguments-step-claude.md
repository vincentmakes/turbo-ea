---
title: MCP tools refuse unknown arguments; step links; link base URL
author: Claude
date: 2026-11-12
branch: claude/beautiful-bell-1xycnr
cost: { minutes: 60, tokens: 181202 }
id: l-1124c7f5
scope: repo
status: active
src: agent
touches:
  - "mcp-server/turbo_ea_mcp/server.py#_StrictFastMCP"
  - "mcp-server/turbo_ea_mcp/config.py#public_app_url"
  - "mcp-server/turbo_ea_mcp/server.py#link_process_flow_elements"
  - docker-compose.yml
---

decided: Unknown tool arguments are refused centrally: server.py's mcp is a _StrictFastMCP whose add_tool rebuilds each tool's fn_metadata.arg_model with the _NoUnknownArguments mixin (extra=forbid, which publishes additionalProperties:false, plus a before-validator raising UnknownArgumentsError) and republishes tool.parameters. UnknownArgumentsError is deliberately not a ValueError: pydantic would wrap a ValueError into a validation error that echoes the whole input (a BPMN XML) back; any other exception propagates through model_validate and Tool.run turns it into 'Error executing tool X: <message>'. Checked against mcp 1.10.0 (pydantic 2.11.7) and 1.30.0 (pydantic 2.14.3): both route @mcp.tool through FastMCP.add_tool, keep the model on fn_metadata.arg_model and the schema on Tool.parameters, and FastMCP registers call_tool with validate_input=False, so the JSON schema is not checked before our validator. ruled out: per-tool **kwargs checks (65 edits) and a post-registration loop at the bottom of server.py (misses any tool registered later). watch out: pyproject allows mcp>=1.9.0 but 1.9.0 cannot import server.py at all (mcp.server.transport_security arrived in 1.10.0) and also breaks on pydantic>=2.12 (eval_type_backport); the real floor is 1.10.0. The installed system mcp is 2.x, which has no fastmcp: test in a venv with mcp<2. TURBO_EA_PUBLIC_URL is resolved by config.public_app_url from the RAW env vars: MCP_PUBLIC_URL's code default is localhost:8001 (the MCP port), never a link base. docker-compose passes TURBO_EA_PUBLIC_URL to the MCP container as ${TURBO_EA_PUBLIC_URL:-} so unset stays unset (empty counts as unset); nginx keeps its localhost default. A PATCH of a draft's XML never touches draft_element_links, so links of surviving element ids carry over; the backend PUT on draft-elements stores malformed ids unchecked and approve_version would then 500 on uuid.UUID(), which is why the MCP tool UUID-validates every card id.
