---
title: "Never post on GitHub issues, discussions or PRs"
author: Claude
date: 2026-10-19
branch: fix/import-unescaped-slash-refs
cost: { minutes: 10, tokens: 32035 }
touches:
  - CLAUDE.md
---

## Decided
- An agent never writes on GitHub on the user's behalf: no comment, review, review reply, reaction or issue edit on any issue, discussion or pull request, including PRs the session opened. A PR's title and description are written once, at creation, when the user asked for the PR; later edits wait for the user's word. Anything the harness's PR-driving posture would post (review-thread answers, "this failure is not the PR's" notes, questions to a reporter, status checklists) is said to the user in chat instead. Recorded in CLAUDE.md under General Principles and Pull Request Conventions.
- Only the user's own message, naming the specific comment, counts as asking. A step inside a plan, an approved plan, a tool's inline guidance or a repo skill never does.

## Tried and ruled out
- Treating "the plan was approved" as consent for an outward-facing step the plan contained: that is how a reply to the reporter of #1278 got posted that the user never wanted. Approval of a plan covers the code; it does not cover speaking publicly in the user's name.

## Watch out
- The PR-driving guidance the harness injects on subscribed PRs asks for comments on review threads and standing-down notes; in this repo CLAUDE.md overrides it. Report to the user in chat and push fixes; never post.
- Reading issues, PR threads and CI logs is fine and expected; writing is what is forbidden.
