/**
 * The right-click menu inside a table (document variant only): the plugin
 * that decides, per event, whether a right-click opens the table actions menu
 * (`TableActionsMenu.tsx`, through the editor's `TableMenuStore`) or is left
 * to the browser.
 *
 * Left to the browser, with nothing prevented:
 * - a locked editor (it has no table actions);
 * - Shift held with a pointer: Shift+right-click is the way to the browser's
 *   own menu (spell-check, paste). Ctrl cannot be that key, because
 *   Ctrl+click is the right-click on macOS;
 * - a touch pointer, so a long-press keeps its native text selection;
 * - a target outside the cells of this editor's tables;
 * - a link or a picture, whose browser menu opens or copies them;
 * - a row / column handle (`tableHandles.ts`): a grip opens its own menu,
 *   and the other handles keep the browser's.
 *
 * Otherwise the selection follows the click (a cell selection holding the
 * clicked cell, or a text selection inside it, is kept; else the caret goes
 * into the clicked cell) and the menu opens at the pointer.
 *
 * A keyboard invocation (Shift+F10, the Menu key) opens it on the selection's
 * cell when the selection is in a table, and leaves it to the browser
 * otherwise. It is recognised by the key: Chromium gives a keyboard
 * `contextmenu` the caret's coordinates and the editor's root as target, so
 * neither tells it from a pointer. A `keydown` of `ContextMenu`, or of `F10`
 * with Shift, marks a keyboard invocation as pending, and the next
 * `contextmenu` takes the keyboard path while it is. It stops being pending
 * when a `contextmenu` takes it, at any `pointerdown` or `mousedown` (so a
 * macOS Ctrl+click is a pointer), at the `keydown` of any other key except a
 * bare modifier, and `KEY_INVOCATION_MS` after the key went down (each
 * auto-repeat of a held key renews it). The `keyup` does not end it: on
 * Windows the menu key's `contextmenu` follows its release. A `contextmenu`
 * at zero coordinates is a keyboard invocation too (what other browsers and
 * assistive tools synthesise). On the keyboard path Shift, a link or a
 * picture at the caret change nothing: they are about what is under a
 * pointer, and there is none.
 *
 * The right button's `mousedown` is prevented under the same conditions as
 * the pointer case, so the press neither moves the browser's caret (a cell
 * selection survives), nor reaches ProseMirror's own mouse-down (which has
 * no button check and on release puts the caret where the button went down),
 * nor `columnResizing` (no resize drag). A prevented `mousedown` does not
 * cancel the `contextmenu` that follows it.
 *
 * Every event here is listened to on the editor's root in the capture
 * phase, not through `handleDOMEvents`. ProseMirror's own listeners on that
 * root run in the bubble phase, after these, and ignore an event already
 * prevented, so none of its handlers or plugins' handlers (`columnResizing`
 * included) sees a press this plugin took. A prop would not do: ProseMirror
 * runs props only for events that "belong" to the view, and a mention chip's
 * node view claims both `mousedown` and `contextmenu` on itself (TipTap's
 * `stopEvent` for a node that cannot be selected), so a right-click on a chip
 * would reach no prop.
 */
import { Plugin, Selection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { CellSelection, isInTable } from "@tiptap/pm/tables";
import type { TableMenuStore } from "./tableMenuStore";

/** The `td` / `th` around `target` inside `view`, if any. */
function domCellAround(view: EditorView, target: EventTarget | null): HTMLElement | null {
  for (let node = target as Node | null; node && node !== view.dom; node = node.parentNode) {
    if (node.nodeName === "TD" || node.nodeName === "TH") return node as HTMLElement;
  }
  return null;
}

/**
 * Whether the target (inside a cell of the editor, so any link around it is
 * in the editor too) is a link or a picture: the browser's menu acts on those.
 */
function onLinkOrPicture(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : (target as Node | null)?.parentElement;
  return Boolean(element?.closest("a[href], img"));
}

/** Whether the target is one of the row / column handles drawn in a cell. */
function onHandle(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : (target as Node | null)?.parentElement;
  return Boolean(element?.closest("[data-table-handle]"));
}

/** The document position of the cell node a `td` / `th` renders, or null. */
export function cellPosOf(view: EditorView, cell: HTMLElement): number | null {
  // The cell is rendered by this view (`domCellAround`), so it has a position.
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return $pos.before(depth);
  }
  return null;
}

/**
 * The position of the cell holding the selection's head (a cell selection's
 * head cell), the innermost one in a nested table.
 */
export function selectionCellPos(state: EditorState): number | null {
  const { selection } = state;
  if (selection instanceof CellSelection) return selection.$headCell.pos;
  const { $head } = selection;
  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const role = $head.node(depth).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return $head.before(depth);
  }
  return null;
}

/**
 * Makes the selection follow a right-click on the cell at `cellPos`: kept
 * when it already covers that cell (a cell selection holding it, or a text
 * selection inside it), else a caret in the cell, where the pointer is when
 * that lands inside the cell, at the start of its content otherwise.
 */
function followClick(view: EditorView, cellPos: number, event: MouseEvent): void {
  const { state } = view;
  const cell = state.doc.nodeAt(cellPos)!;
  const start = cellPos + 1;
  const end = cellPos + cell.nodeSize - 1;
  const { selection } = state;
  if (selection instanceof CellSelection) {
    let holds = false;
    selection.forEachCell((_node, pos) => {
      if (pos === cellPos) holds = true;
    });
    if (holds) return;
  } else if (selection.from >= start && selection.to <= end) {
    return;
  }
  let next: Selection | null = null;
  try {
    const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (found && found.pos >= start && found.pos <= end) {
      // The nearest text position inside the cell: forward first, then back
      // (from the cell's very end, forward would reach the next cell).
      const $at = state.doc.resolve(found.pos);
      next = [Selection.findFrom($at, 1, true), Selection.findFrom($at, -1, true)].find(
        (s) => s !== null && s.from >= start && s.to <= end,
      ) ?? null;
    }
  } catch {
    // No layout to measure against: the start of the cell.
  }
  view.dispatch(state.tr.setSelection(next ?? Selection.near(state.doc.resolve(start))));
}

/** Where a keyboard-invoked menu opens: just inside the bottom of the selection's cell. */
function cellAnchor(view: EditorView): { top: number; left: number } | null {
  const pos = selectionCellPos(view.state);
  const dom = pos === null ? null : view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  return { top: rect.bottom - 4, left: rect.left + Math.min(rect.width / 2, 120) };
}

/**
 * How long after its key a keyboard invocation stays pending: the browser
 * fires the `contextmenu` within the same key press (on the press, or on the
 * release on Windows), so a second covers any key press while keeping a flag
 * from a key press that brought no `contextmenu` from turning a later
 * right-click into a keyboard invocation.
 */
export const KEY_INVOCATION_MS = 1000;

/** Keys that alone end no pending keyboard invocation (Shift is part of Shift+F10). */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph"]);

/** Whether a key press invokes a context menu: the Menu key, or Shift+F10. */
function invokesMenu(event: KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/** The table actions right-click menu for an editor, talking to its store. */
export function tableContextMenu(store: TableMenuStore): Plugin {
  // The last pointer pressed in this editor ("mouse", "pen", "touch").
  let lastPointerType = "";
  // When the key of a pending keyboard invocation went down; null when none is.
  let keyInvokedAt: number | null = null;

  /** Takes the pending keyboard invocation: whether one was, and still is, valid. */
  const takeKeyInvocation = () => {
    const at = keyInvokedAt;
    keyInvokedAt = null;
    return at !== null && performance.now() - at <= KEY_INVOCATION_MS;
  };

  const pointerType = (event: MouseEvent) => {
    const own = (event as Partial<PointerEvent>).pointerType;
    return typeof own === "string" && own !== "" ? own : lastPointerType;
  };

  /** The pointer case's conditions: whether this event opens our menu, on which cell. */
  const pointerCell = (view: EditorView, event: MouseEvent): number | null => {
    if (!view.editable || event.shiftKey || pointerType(event) === "touch") return null;
    const cell = domCellAround(view, event.target);
    if (!cell || onLinkOrPicture(event.target) || onHandle(event.target)) return null;
    return cellPosOf(view, cell);
  };

  const onContextMenu = (view: EditorView, event: MouseEvent) => {
    const fromKey = takeKeyInvocation();
    if (!view.editable) return;
    if (fromKey || (event.clientX === 0 && event.clientY === 0)) {
      if (!isInTable(view.state)) return;
      const anchor = cellAnchor(view);
      if (!anchor) return;
      event.preventDefault();
      store.open({ set: "context", ...anchor });
      return;
    }
    const cellPos = pointerCell(view, event);
    if (cellPos === null) return;
    followClick(view, cellPos, event);
    event.preventDefault();
    store.open({ set: "context", top: event.clientY, left: event.clientX });
  };

  // Capture-phase listeners on the editor's root: they run before
  // ProseMirror's own (bubble-phase) ones, see the module comment.
  return new Plugin({
    view: (view) => {
      const listeners: [string, (event: Event) => void][] = [
        [
          "keydown",
          (event) => {
            const key = event as KeyboardEvent;
            if (invokesMenu(key)) keyInvokedAt = performance.now();
            else if (!MODIFIER_KEYS.has(key.key)) keyInvokedAt = null;
          },
        ],
        [
          "pointerdown",
          (event) => {
            keyInvokedAt = null;
            lastPointerType = (event as Partial<PointerEvent>).pointerType ?? "";
          },
        ],
        [
          "mousedown",
          (event) => {
            keyInvokedAt = null;
            const mouse = event as MouseEvent;
            if (mouse.button === 2 && pointerCell(view, mouse) !== null) mouse.preventDefault();
          },
        ],
        ["contextmenu", (event) => onContextMenu(view, event as MouseEvent)],
      ];
      for (const [type, listener] of listeners) {
        view.dom.addEventListener(type, listener, true);
      }
      return {
        destroy: () => {
          for (const [type, listener] of listeners) {
            view.dom.removeEventListener(type, listener, true);
          }
        },
      };
    },
  });
}
