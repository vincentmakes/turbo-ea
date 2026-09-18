/**
 * One properties-panel row for a card link a step carries: Application, Data
 * Object, IT Component or Organizations.
 *
 * Unlike the Business Process row, these four have no BPMN slot to live in, so
 * they are not read from or written to the diagram at all: they are the
 * **draft's element links**, the very rows the pre-link table edits, reached
 * through `PUT …/draft-elements/{bpmn_element_id}`. The React side owns the
 * calls; this component only renders `bridge.links` and asks the bridge to act.
 * That is what makes the editor and the table one set of links rather than two
 * that drift.
 *
 * Authored with `h()` from the panel's vendored Preact — see `linkEntryDom.ts`.
 */
import { h } from "@bpmn-io/properties-panel/preact";

import type { CardLinkKind } from "./calledProcess";
import { ENTRY_CLASS, button, entryRow } from "./linkEntryDom";
import type { AnyNode } from "./linkEntryDom";
import { elementIdOf, emptyLinks, singleLinkOf } from "./calledProcess";
import type { LinkBridge } from "./calledProcessModule";

export interface CardLinkEntryProps {
  id: string;
  element: unknown;
  bridge: LinkBridge;
  kind: CardLinkKind;
}

export default function CardLinkEntry(props: CardLinkEntryProps) {
  const { id, element, bridge, kind } = props;
  const labels = bridge.labels.kinds[kind];
  // Read at render time, so mutating the map and firing
  // `propertiesPanel.providersChanged` re-renders the row — the same contract
  // the process row has always used.
  const links = bridge.links[elementIdOf(element as never)] ?? emptyLinks();

  const choose = button(
    labels.choose,
    () => bridge.openPicker(element, kind),
    `${ENTRY_CLASS}-choose`,
  );
  const clear = button(
    bridge.labels.clear,
    () => bridge.clearLink(element, kind),
    `${ENTRY_CLASS}-clear`,
  );

  let value: AnyNode;
  let actions: AnyNode[];

  if (kind === "organization") {
    const orgs = links.organizations;
    value = orgs.length
      ? h(
          "div",
          { class: `${ENTRY_CLASS}-list` },
          orgs.map((o) => h("span", { class: `${ENTRY_CLASS}-chip`, key: o.id }, o.name)),
        )
      : h("div", { class: `${ENTRY_CLASS}-value ${ENTRY_CLASS}-empty` }, labels.none);
    actions = orgs.length ? [choose, clear] : [choose];
  } else {
    const card = singleLinkOf(links, kind);
    if (card) {
      value = h("div", { class: `${ENTRY_CLASS}-value` }, card.name);
      actions = [
        button(bridge.labels.open, () => bridge.openCard(card.id, kind), `${ENTRY_CLASS}-open`),
        choose,
        clear,
      ];
    } else {
      value = h("div", { class: `${ENTRY_CLASS}-value ${ENTRY_CLASS}-empty` }, labels.none);
      actions = [choose];
    }
  }

  return entryRow(id, labels.label, value, actions);
}
