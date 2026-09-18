/**
 * The DOM the two properties-panel link entries share.
 *
 * Both are authored with `h()` from the panel's own vendored Preact — never
 * React, and never a `.tsx` file: `@vitejs/plugin-react` wraps every `*x`
 * module in the React Fast Refresh runtime, which would break inside the
 * panel's tree. See `CalledProcessEntry.ts` for the full reasoning.
 *
 * A row is a stock `bio-properties-panel-entry` carrying a
 * `bio-properties-panel-label` — the panel's own class, so the five rows pick
 * up its typography and sit flush with the built-in groups rather than
 * approximating them.
 */
import { h } from "@bpmn-io/properties-panel/preact";
import type { VNode } from "@bpmn-io/properties-panel/preact";

// Preact's `VNode<P>` is invariant in its props, so a `div` node and a
// `button` node share no common `VNode<P>` — the widest honest type is `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNode = VNode<any>;

/** Class prefix for every link row. Kept from the process-only original so
 *  the panel stylesheet and the screenshot selector keep matching. */
export const ENTRY_CLASS = "turboea-called-process";

export function button(text: string, onClick: () => void, extraClass = ""): AnyNode {
  return h(
    "button",
    {
      type: "button",
      class: `${ENTRY_CLASS}-button ${extraClass}`.trim(),
      onClick,
    },
    text,
  );
}

/** A labelled row: the card type's name, the current value, the actions. */
export function entryRow(
  id: string,
  label: string,
  value: AnyNode,
  actions: AnyNode[],
): AnyNode {
  return h(
    "div",
    { class: `bio-properties-panel-entry ${ENTRY_CLASS}`, "data-entry-id": id },
    [
      h("label", { class: "bio-properties-panel-label" }, label),
      value,
      h("div", { class: `${ENTRY_CLASS}-actions` }, actions),
    ],
  );
}
