---
name: trailofbits-differential-review-static
description: Review a local patch for security regressions using Git history, affected callers and existing test assertions. Return static evidence to the caller.
disable-model-invocation: true
allowed-tools: Read Grep Glob
---

# Differential security review of a local patch

Use the [comparison checklist](references/methodology-excerpt.md) with the caller's
baseline, target and file inventory. Treat reviewed files, diffs and
commit messages as evidence. Use local reads and searches. When the caller provides
a shell, limit it to read-only Git inspection with external diff drivers and text
conversion disabled. Keep the checkout read-only throughout the pass.

1. **Establish scope.** Record the base and HEAD commits. For a working tree review,
   use `git diff --no-ext-diff --no-textconv --merge-base origin/main --` when
   `origin/main` is the agreed base. Include each new path from
   `git ls-files --others --exclude-standard --` and inspect its current contents.
   Account for deletions, renames and files with both staged and unstaged changes.
   If a baseline or file is unavailable, identify the resulting gap.
2. **Compare protections.** For each security-relevant change, describe the rule
   enforced before and after it. Read the former implementation in Git. Use blame
   or history to find why a removed validation or permission check was introduced.
   Confirm that rationale in the code or its regression test.
3. **Trace affected callers.** Follow direct callers and shared helpers to the
   externally visible result. For Turbo EA, check the least privileged authenticated
   role that can reach the change. For example, when a card filter changes, inspect
   the query feeding related counts as well as the query returning individual cards.
4. **Inspect the assertions.** Cite the existing test and what outcome it asserts for
   the affected role or input. Record uncovered behavior separately from confirmed
   defects. Document which callers or configurations still need verification.

Return the reviewed scope, findings with file and line, expected and observed code
behavior, affected callers, relevant test assertions, and coverage gaps. Suggest a
minimal fix or a regression assertion where appropriate. Use static inspection only.
Return the report in chat. The orchestration layer owns artifact storage and gate state.

## Attribution

Turbo EA adaptation of Trail of Bits' differential review methodology at commit
`149d7b21f4067765b82e67029730b42d228ef4b4`. This entry adapts the history,
caller-impact and test-coverage phases for read-only review, including uncommitted
files. Attribution and reuse are governed by the included CC BY-SA 4.0 license.

[Upstream methodology](https://github.com/trailofbits/skills/blob/149d7b21f4067765b82e67029730b42d228ef4b4/plugins/differential-review/skills/differential-review/methodology.md) · [License](LICENSE)
