---
title: "A red test phase written by an agent in one pass with the code is not proof, and test paths for the runner start under backend/"
author: Tom
date: 2026-11-19
branch: notes/agent-process
cost: { minutes: 117, tokens: 1005404 }
id: l-a90cb407
scope: repo
status: active
src: agent
touches:
  - scripts/test.sh
  - ".claude/agents/backend-dev.md"
---

## Decided
The red phase of a test is proved by a separate run before the fix, started by the session that owns the task. An agent that writes the test and the code in one pass never shows it, so its report alone is not proof.
Test paths given to ./scripts/test.sh are relative to backend/, without the backend/ prefix.

## Tried and ruled out
Trusting the agent's report that the test failed first: nothing in the output shows it.
Having the agent revert the fix to show the failure: the permission classifier blocks runs that sabotage the code on purpose.

## Watch out
With a backend/ prefix on the path, ./scripts/test.sh collects 0 tests and prints no error, so a green run can mean nothing ran. Check the collected count.

In the code: scripts/test.sh, .claude/agents/backend-dev.md.
