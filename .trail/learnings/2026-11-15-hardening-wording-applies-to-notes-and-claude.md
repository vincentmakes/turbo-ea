---
title: Hardening wording applies to notes and comments too; a branch that broke it is rebuilt as a few commits by area and force-pushed
author: Claude
date: 2026-11-15
branch: claude/ecstatic-heisenberg-261dmo
cost: { minutes: 115, tokens: 1005185 }
id: l-b8a58039
scope: repo
status: active
src: agent
touches:
  - docs/admin/resources.ar.md
  - docs/admin/resources.da.md
  - docs/admin/resources.de.md
  - docs/admin/resources.es.md
  - docs/admin/resources.fr.md
  - docs/admin/resources.it.md
  - docs/admin/resources.pt.md
  - docs/admin/resources.ru.md
  - docs/admin/resources.zh.md
  - docs/admin/workspace-transfer.ar.md
---

## Decided
- The rule that public text says what the product now does, and nothing about what was possible before, covers every hardening, not only stored secrets. It also covers the notes in the learnings folder, code comments, test titles and contributor rules, because they all live in the public repository.
- When a pushed branch has broken the rule, the owner wants the history rewritten, not only corrected going forward. The clean way: fix the text in the working tree first, then rebuild the branch as a small number of commits by area with clean messages and force-push it with a lease on the known remote tip. A squash by area leaves no old wording in any reachable commit, and the pull request would be squash-merged anyway.
- A force-push needs the owner's explicit go-ahead in the conversation.

## Tried and ruled out
- Rewording going forward only: the old commit message and the old note text stay in the branch's history.
- Rewriting single commit messages with a filter: the old wording was also in file contents across several commits, so every one of those commits would have needed a content rewrite as well.

## Watch out
- The intermediate commits of a branch rebuilt by area are not each green on their own (a backend test reads a frontend constant, locale parity needs the translations); only the tip is.
- The old commits stay fetchable by SHA on the hosting side until it garbage-collects them.
- Check before pushing a hardening: read the added lines of the whole branch for clauses that explain harm or what a text "would otherwise" do, and read the commit messages the same way. A keyword search alone misses them.

In the code:
- Rebuild: back up the tip on a local branch, `git reset --soft <merge-base>`, `git reset`, then `git add <area paths>` and commit per area; verify `git diff <backup> HEAD` is empty; `git push --force-with-lease=<branch>:<remote tip> origin <branch>`; delete the local backup.
- Areas used: backend + docs/api/openapi.json; mcp-server; frontend without the non-English locales; manual + .claude/rules + CHANGELOG + VERSION + README; non-English locales and manual siblings; .trail/learnings.
