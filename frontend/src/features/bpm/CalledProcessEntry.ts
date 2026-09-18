/**
 * The "Called process" entry rendered inside the bpmn.io properties panel for
 * a `bpmn:CallActivity`.
 *
 * The panel is a Preact tree (a Preact vendored under
 * `@bpmn-io/properties-panel/preact`), so this component is authored with
 * `h()` from that very instance — never React, and never a `.tsx` file:
 * `@vitejs/plugin-react` wraps every `*x` module in the React Fast Refresh
 * runtime, and a JSX pragma pointing at Preact would still leave the file
 * unable to hold any MUI markup. Plain `h()` calls sidestep both.
 *
 * It renders one of three states — a linked card (name, **Open**, **Clear**),
 * nothing linked (**Choose process…**), or a foreign reference left by another
 * tool (the reference as a hint, and the same **Choose process…**) — and
 * writes through `modeling.updateProperties`, so a pick is undoable and trips
 * the modeler's autosave like any other edit. The dialog that does the picking
 * lives on the React side and is reached through the `bridge` the didi module
 * injects (see `calledProcessModule.ts`).
 */
import { h } from "@bpmn-io/properties-panel/preact";
import type { VNode } from "@bpmn-io/properties-panel/preact";

// Preact's `VNode<P>` is invariant in its props, so a `div` node and a `button`
// node share no common `VNode<P>` — the widest honest type is `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = VNode<any>;
import { useService } from "bpmn-js-properties-panel";

import { calledElementOf, isCardUuid } from "./calledProcess";
import type { CalledProcessBridge } from "./calledProcessModule";

export interface CalledProcessEntryProps {
  id: string;
  element: unknown;
  bridge: CalledProcessBridge;
}

/** Test id / class hooks shared with the render test. */
export const ENTRY_CLASS = "turboea-called-process";

export default function CalledProcessEntry(props: CalledProcessEntryProps) {
  const { id, element, bridge } = props;
  const modeling = useService("modeling") as {
    updateProperties: (element: unknown, properties: Record<string, unknown>) => void;
  };
  const { labels } = bridge;

  const ref = calledElementOf(element as Parameters<typeof calledElementOf>[0]);
  const linked = isCardUuid(ref);
  const name = linked ? bridge.names[ref] : undefined;

  const button = (
    text: string,
    onClick: () => void,
    extraClass = "",
  ) =>
    h(
      "button",
      {
        type: "button",
        class: `${ENTRY_CLASS}-button ${extraClass}`.trim(),
        onClick,
      },
      text,
    );

  const choose = button(labels.choose, () => bridge.open(element), `${ENTRY_CLASS}-choose`);

  let value: AnyNode;
  let actions: AnyNode[];
  if (linked) {
    // A card uuid that did not resolve (archived, deleted, from another
    // instance) is still shown as the id so the modeller sees *something* is
    // set and can replace it.
    value = h("div", { class: `${ENTRY_CLASS}-value` }, name ?? ref);
    actions = [
      button(labels.open, () => bridge.openProcess(ref), `${ENTRY_CLASS}-open`),
      choose,
      button(
        labels.clear,
        () => modeling.updateProperties(element, { calledElement: undefined }),
        `${ENTRY_CLASS}-clear`,
      ),
    ];
  } else if (ref) {
    value = h(
      "div",
      { class: `${ENTRY_CLASS}-value ${ENTRY_CLASS}-foreign` },
      labels.references(ref),
    );
    actions = [choose];
  } else {
    value = h("div", { class: `${ENTRY_CLASS}-value ${ENTRY_CLASS}-empty` }, labels.noProcess);
    actions = [choose];
  }

  return h(
    "div",
    { class: `bio-properties-panel-entry ${ENTRY_CLASS}`, "data-entry-id": id },
    // No entry label: the group header already reads "Called process".
    [value, h("div", { class: `${ENTRY_CLASS}-actions` }, actions)],
  );
}
