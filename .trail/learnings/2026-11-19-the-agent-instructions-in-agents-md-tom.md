---
title: "The agent instructions in AGENTS.md drifted from CLAUDE.md, so every rule change is now made in both files in one commit"
author: Tom
date: 2026-11-19
branch: notes/agents-mirror
cost: { minutes: 121, tokens: 1015372 }
id: l-cb3c9336
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - AGENTS.md
---

## Decided
AGENTS.md is a mirror of CLAUDE.md. Every change to CLAUDE.md is made identically in AGENTS.md in the same commit, because Codex reads AGENTS.md.

## Tried and ruled out
Keeping the two as independent files: they drifted apart without anyone noticing, and Codex worked from rules the project had already replaced.

## Watch out
No test checks that the two match. Run diff CLAUDE.md AGENTS.md before the commit and expect no output.

In the code: CLAUDE.md, AGENTS.md.
