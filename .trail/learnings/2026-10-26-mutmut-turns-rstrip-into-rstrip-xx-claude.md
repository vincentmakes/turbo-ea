---
title: "mutmut turns rstrip(\"/\") into rstrip(\"XX/XX\"): a test needs an input ending in X to kill it"
author: Claude
date: 2026-10-26
branch: claude/gallant-goodall-z68jul
cost: { minutes: 4, tokens: 31279 }
id: l-3d207e43
scope: repo
status: active
src: agent
touches:
  - mcp-server/tests/test_config.py
---

## Decided
A test of any `strip`/`rstrip`/`lstrip` call with a string argument needs an input that ends (or starts) in an uppercase `X` before any `.lower()`. mutmut mutates the literal `"/"` to `"XX/XX"`, which strips `X` as well as `/`, so `"box/"` cannot tell the two apart but `"BOX/"` can. `TestParseOrigins` and `TestParseHosts` in `mcp-server/tests/test_config.py` both use `BOX` for this reason.

## Tried and ruled out
Testing `parse_hosts` with ordinary host names plus a trailing slash (`box:8443/`, `https://Box.example/mcp/`). The `MCP Mutation Tests` job on vincentmakes/turbo-ea#1324 reported the `rstrip("XX/XX")` mutant as surviving, which put `config.py` at 85.7% on changed lines, under its floor.

## Watch out
The MCP mutation job finishes in about a minute, because it only mutates changed lines. Its log ends with a "Surviving mutants on changed lines" diff, so `get_job_logs` with a small tail is enough to see what to kill. Don't run mutmut locally.
