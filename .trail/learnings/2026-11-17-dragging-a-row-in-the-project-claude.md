---
title: Dragging a row in the project Gantt saves through one move endpoint; the chart library keeps rows draggable whatever canMoveTasks says
author: Claude
date: 2026-11-17
branch: claude/laughing-wright-enpswe
cost: { minutes: 24, tokens: 454544 }
id: l-b6b26af0
scope: repo
status: active
src: agent
touches:
  - docs/guide/ppm.ar.md
  - docs/guide/ppm.da.md
  - docs/guide/ppm.de.md
  - docs/guide/ppm.es.md
  - docs/guide/ppm.fr.md
  - docs/guide/ppm.it.md
  - docs/guide/ppm.pt.md
  - docs/guide/ppm.ru.md
  - docs/guide/ppm.zh.md
  - backend/app/api/v1/ppm.py
---

## Decided
The Gantt task-list drag did nothing because @wamra/gantt-task-react 0.6.17 makes every row `draggable` and draws drop targets, but its handleMoveTaskBefore/After/TasksInside return early unless the app passes onMoveTask* or onChangeTasks. The fix wires onMoveTaskBefore/After/Inside to one endpoint, POST /ppm/initiatives/{id}/gantt/move {kind, id, parent_wbs_id, position}. `position` counts among same-kind siblings with the moved row left out, because work packages always render above tasks under a parent and the two kinds keep separate sort_order sequences.
The server renumbers the whole target group 0..n-1, since rows created without an order all shared 0. A consequence is that new rows, and rows re-parented through a dialog, now default to max+1 of their group. If they kept the old default of 0, after any drag they would slot in second.
Drop mapping (resolveGanttMove): a drop "inside" a task is treated as "after" it, because most of a task row is the library's inside zone. "After" on an open work package that has children makes the row its first item, because the library draws that drop line above the first child. A milestone is refused only as a new parent, so rows already under one can still be reordered.

## Tried and ruled out
`canMoveTasks={false}` to stop drags while a column sort is on. In 0.6.17 that prop only reaches the column cells' data, and the row's `draggable: true` is hard-coded. So the drop handler checks the sort itself and shows a snackbar.

## Watch out
mutmut never mutates a decorated function, so the move logic lives in a plain service and the route only wires roll-ups and the commit.
Lists, and the move, order by (sort_order, created_at, id). Rows inserted in one transaction share created_at, so without id the client's index and the server's could disagree.

In the code: backend/app/services/ppm_gantt_move.py (apply_gantt_move, place_in_order, next_sort_order, assert_no_wbs_cycle); backend/app/api/v1/ppm.py (move_gantt_row, create_task/create_wbs/update_task/update_wbs sort_order defaults); frontend/src/features/ppm/ppmGanttModel.ts (resolveGanttMove); frontend/src/features/ppm/PpmGanttTab.tsx (handleRowDrop).
