/**
 * The keyboard contract of the initiative tree, as pure functions: what a
 * key means on a given row, and which rows are visible in which order. The
 * sidebar maps the answers onto focus, selection, expansion and favourites.
 */
import type { InitiativeTreeNode } from "./useInitiativeData";

export type TreeKeyAction =
  | "select"
  | "next"
  | "prev"
  | "first"
  | "last"
  | "expand"
  | "collapse"
  | "parent"
  | "favourite";

/**
 * The action a key asks for on a tree item (WAI-ARIA tree pattern). Right on
 * an expanded parent moves to its first child, which is the next visible
 * row; Left on a leaf or a collapsed parent moves to the parent.
 */
export function treeKeyAction(
  e: { key: string; shiftKey: boolean },
  item: { hasChildren: boolean; expanded: boolean },
): TreeKeyAction | null {
  switch (e.key) {
    case "Enter":
    case " ":
      return "select";
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "ArrowRight":
      if (!item.hasChildren) return null;
      return item.expanded ? "next" : "expand";
    case "ArrowLeft":
      return item.hasChildren && item.expanded ? "collapse" : "parent";
    case "F":
    case "f":
      return e.shiftKey ? "favourite" : null;
    default:
      return null;
  }
}

export interface VisibleTreeRow {
  id: string;
  parentId: string | null;
}

/**
 * The rows on screen, top to bottom: the synthetic unlinked row first when it
 * is shown, then a depth-first walk that skips the children of a collapsed
 * branch. Parents come from the tree as rendered, not from `parent_id` — the
 * favourites filter lifts a child out from under a parent it hides.
 */
export function visibleTreeRows(
  tree: InitiativeTreeNode[],
  collapsed: ReadonlySet<string>,
  unlinkedId: string | null,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];
  if (unlinkedId) rows.push({ id: unlinkedId, parentId: null });
  const walk = (nodes: InitiativeTreeNode[], parentId: string | null) => {
    for (const node of nodes) {
      const id = node.initiative.id;
      rows.push({ id, parentId });
      if (!collapsed.has(id)) walk(node.children, id);
    }
  };
  walk(tree, null);
  return rows;
}
