---
title: "Table actions in decision and SoAW text come from a right-click menu and row and column handles, all drawn from one list of actions"
author: Claude
date: 2026-11-15
branch: claude/ecstatic-heisenberg-261dmo
cost: { minutes: 73, tokens: 314025 }
id: l-9d88fdf4
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/ea-delivery/RichTextEditor.test.tsx
  - frontend/src/features/ea-delivery/tableContextMenu.ts
  - docs/guide/delivery.ar.md
  - docs/guide/delivery.da.md
  - docs/guide/delivery.de.md
  - docs/guide/delivery.es.md
  - docs/guide/delivery.fr.md
  - docs/guide/delivery.it.md
  - docs/guide/delivery.pt.md
  - docs/guide/delivery.ru.md
---

## Decided
- Every table menu (toolbar, right-click, row grip, column grip) is a set of one ordered action list, so an action is enabled by the same rule wherever it appears. The owner asked for a right-click menu and handles "like we see in some apps", with Move in the grip menus and a "+" between rows and columns; drag-to-reorder was not wanted.
- Enablement reads the selection's rectangle, not `editor.can()`: the table engine answers some checks only when it is asked to run, so `can()` says yes to deleting every row and the run then does nothing.
- The right-click menu listens on the editor's root in the capture phase. A handler registered through the editor's props runs after ProseMirror's own and never sees an event a node view claims (a mention chip in a cell), and it could not stop the column-resize plugin from starting a drag on a right press.
- A keyboard invocation (Shift+F10, the Menu key) is recognised by the key press that precedes the `contextmenu` event, with zero coordinates as a second sign. Chromium gives a keyboard `contextmenu` the caret's coordinates and the editor root as target, so neither tells it from a pointer.
- Handles are widget decorations placed by CSS into a gutter around the table, not a measured overlay: they follow column resizing, row height, scrolling and right-to-left with no measurement, and which cells carry one is a pure function that tests without a browser.
- Grips are not in the tab order. A focusable element inside the editable area takes the editor's focus, so the toolbar Table menu and Shift+F10 are the complete keyboard path, and an action added to a grip menu goes into the toolbar set too.
- The README says extensions are built and signed by the vendor only. The owner corrected a paragraph that invited readers to build their own.

## Tried and ruled out
- A measured overlay for the handles: needs layout on every resize, scroll and direction change, and jsdom has no layout to test it with.
- Hiding an action that does not apply: the menus keep a fixed order and show it disabled, so an item is always in the same place.
- Recognising the keyboard invocation by coordinates alone: only a real browser shows that Chromium fills them in; the unit tests, which fire the event at zero, pass either way.
- Drag-to-reorder rows and columns, cut / copy / paste items in our menu, a touch long-press menu, sticky row grips: out of scope by the owner's choice.

## Watch out
- jsdom has no layout and no `elementFromPoint`. A test that sends a left-button press into the editor reaches ProseMirror's own handler and raises an unhandled error unless the test stubs it; the run still reports every test as passed, so read the "Errors" line.
- A widget's DOM is built once and never changed afterwards: a change inside the editable content is read as an edit. Showing, moving or clicking a handle must leave `getHTML()` and `onChange` untouched.
- MUI's `MenuList` moves the focus over its direct children only, so the menu items are a flat array, not a wrapper component.
- Checked in Chromium only. Firefox and Safari right-click (macOS fires on press; Ctrl+click is a right-click there), the Windows Menu key's timing, touch long-press and screen readers on the grips were not checked.
- In Arabic the column-resize bar appears on the opposite edge from the pointer: the table engine works in physical left and right.
- Move is off in a table with merged cells in that direction, and a row's grip scrolls away with the first column when a wide table is scrolled sideways.

In the code: `frontend/src/features/ea-delivery/tableActions.ts`, `tableActionItems.tsx`, `tableContextMenu.ts` (`KEY_INVOCATION_MS`), `tableHandles.ts` (`handleTargets`), `tableMenuStore.ts`, `TableActionsMenu.tsx`, `documentTableExtension.ts`, `EDITOR_TABLE_SX` in `RichTextEditor.tsx`; rule text in `.claude/rules/uploads.md` (Tables); `README.md` (Extensions).
