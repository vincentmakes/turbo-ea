---
title: "ruff format strands a mutmut pragma on the closing line of a call it splits, so the mutation gate sees unexplained survivors"
author: Claude
date: 2026-11-02
branch: claude/charming-wozniak-jamr5e
id: l-5aca3eb7
scope: repo
status: active
src: agent
touches:
  - mcp-server/turbo_ea_mcp/oauth.py
  - mcp-server/turbo_ea_mcp/server.py
  - backend/app/core/security.py
---

## Decided
- A trailing `# pragma: no mutate` suppresses only the nodes that START on the statement's first line (mutmut 3.8 `pragma_handling.py`). When ruff format splits a one-line call that carried the pragma, the arguments start on the line below and are mutated again, and the comment on the closing-paren line excuses nothing; the mutant on the literal is reported as a survivor. On a critical module with a 98 % floor two such survivors failed the MCP Mutation Tests job the first time ruff ran over mcp-server.
- The fix is a one-liner that fits the 100-column limit with the pragma on the mutable line: a short reason on the line, the full reason in a comment above. ruff format counts the trailing comment toward the line length, which is what split the line in the first place. A statement that cannot fit even with a bare pragma is fenced with standalone `# pragma: no mutate start` / `# pragma: no mutate end` lines, which mutmut 3.8 also honours.
- A source-scan guard (mcp-server and backend) fails any `pragma: no mutate` that sits on a line whose code is only closing punctuation, so a future reformat cannot strand one silently.

## Watch out
- Adding ruff to a package that already carries mutation pragmas is not format-only, even when every syntax tree is identical: check every pragma line after formatting, and compare mutmut survivors against the pragmas on `origin/main` before adding tests for them.

In the code:
- Sites repaired: mcp-server/turbo_ea_mcp/oauth.py `_read_token_body`, mcp-server/turbo_ea_mcp/server.py `RequireBearerForMcp.__call__` and `_challenge` calls, backend/app/core/security.py `_sign`.
- Guards: mcp-server/tests/test_mutation_pragmas.py, backend/tests/services/test_mutation_pragmas_guard.py.
- Find the shape: `grep -rn -E "^\s*\)[^#]*#\s*pragma: no mutate" backend/app mcp-server/turbo_ea_mcp`.
