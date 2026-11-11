---
title: "Decision and SoAW pages: History is a header button with one two-pane view, discussion threads are tagged with section chips, and sections show a marker"
author: Claude
date: 2026-11-11
branch: claude/decision-history-mention-picker
id: l-26dfc315
scope: repo
status: active
src: agent
touches:
  - docs/guide/grc.ar.md
  - docs/guide/grc.da.md
  - docs/guide/grc.de.md
  - docs/guide/grc.es.md
  - docs/guide/grc.fr.md
  - docs/guide/grc.it.md
  - docs/guide/grc.md
  - docs/guide/grc.pt.md
  - docs/guide/grc.ru.md
  - docs/guide/grc.zh.md
---

## Decided
- The owner tried the first build and moved History out of the chat side panel: a History button beside the revision strip opens one wide view (timeline left, version or changes right, Restore there). The side panel is the discussion only.
- A thread's section is picked with chips, not a dropdown ("a dropdown buries things"); the same chips, with counts, filter the discussion from a row at its top. Sections only, one per thread: free-typed tags were offered and declined.
- A section heading that has threads shows a chat marker (open count; muted when all resolved) that opens the discussion filtered to it, with resolved threads unfolded when none is open.
- The discussion is read once per saved document, in the side panel wrapper, whether the panel is open or not: the markers, the badge and the sign / request-signatures warnings all come from that one read.
- The "@" list ranks exactly like the server; a linked card or one of the document's people may lead only within the same rank tier. Browse and the toolbar button open the standard pickers instead of a second search UI.

## Tried and ruled out
- Page tabs "Document · History": switching tabs leaves the text being edited.
- Tracking the "@" highlight by row index: rows arriving late moved the highlight onto another entry, so Enter inserted the wrong mention. It is tracked by the row's identity.
- Showing card rows before the linked cards have answered: they were prepended afterwards and shifted the list under the cursor.
- Comparing a version with "the one before it" among the loaded rows only: on a long timeline the oldest loaded version was compared with a newer one. Changes asks to load earlier rows instead.

## Watch out
- React 19 reassigns innerHTML whenever the `dangerouslySetInnerHTML` object is new, even with the same HTML, which wipes anything portalled into that DOM. The SoAW preview body is a memoised child and the marker placer re-places hosts that are no longer connected.
- An always-open MUI Autocomplete inside a Popover swallows Escape; close it from the Autocomplete's onClose (reason "escape") and return focus by hand.
- After a squash merge of the branch you stacked on, `git merge -X ours main` can bring back files your branch deleted; check the tree hash before and after, or rebase with `--onto main <old base>` and skip the squash commit.

In the code: frontend/src/features/ea-delivery/collab/ (DocumentHistoryDialog, useDiscussionView, SectionDiscussionMarker, HtmlSectionMarkers, discussionModel, historyModel) and mentions/ (mentionModel, MentionPopup, MentionBrowseDialog).
