/**
 * The Business Process row of the "Linked cards" group — the process a step
 * hands over to, or, on a call activity, the one it invokes.
 *
 * This link is the odd one of the five: it lives in the diagram itself (a call
 * activity's `calledElement`, any other step's `turboea:processRef`) *and* in
 * the draft's element links, because BPMN has a construct for it and other
 * tools read it. So it is written to both, and **read from the server** —
 * `bridge.links[id].business_process` is what `GET …/draft-elements` resolved
 * after applying the precedence rule, which is how a process linked in a table
 * shows up here at all. The diagram's own reference is the fallback for a
 * shape the server has not seen yet, i.e. one placed since the last autosave.
 *
 * The panel is a Preact tree (a Preact vendored under
 * `@bpmn-io/properties-panel/preact`), so this component is authored with
 * `h()` from that very instance — never React, and never a `.tsx` file:
 * `@vitejs/plugin-react` wraps every `*x` module in the React Fast Refresh
 * runtime, and a JSX pragma pointing at Preact would still leave the file
 * unable to hold any MUI markup. Plain `h()` calls sidestep both.
 */
import { h } from "@bpmn-io/properties-panel/preact";

import { ENTRY_CLASS, button, entryRow } from "./linkEntryDom";
import type { AnyNode } from "./linkEntryDom";
import { elementIdOf, isCardUuid, processRefOf, singleLinkOf } from "./calledProcess";
import type { LinkBridge } from "./calledProcessModule";

export { ENTRY_CLASS };

export interface CalledProcessEntryProps {
  id: string;
  element: unknown;
  bridge: LinkBridge;
}

export default function CalledProcessEntry(props: CalledProcessEntryProps) {
  const { id, element, bridge } = props;
  const labels = bridge.labels.kinds.process;

  const bpmnId = elementIdOf(element as never);
  const known = Object.prototype.hasOwnProperty.call(bridge.links, bpmnId);
  const serverCard = known ? singleLinkOf(bridge.links[bpmnId], "process") : undefined;

  // The live diagram reference: the fallback for a shape the server has not
  // seen yet, and the source of the "References X" hint for a foreign id an
  // import brought in.
  const liveRef = processRefOf(element as never);

  const linkedId = serverCard?.id ?? (known ? undefined : isCardUuid(liveRef) ? liveRef : undefined);
  const linkedName = serverCard?.name ?? (linkedId ? bridge.names[linkedId] : undefined);

  const choose = button(
    labels.choose,
    () => bridge.openPicker(element, "process"),
    `${ENTRY_CLASS}-choose`,
  );

  let value: AnyNode;
  let actions: AnyNode[];
  if (linkedId) {
    // A card uuid that did not resolve (archived, deleted, from another
    // instance) is still shown as the id so the modeller sees *something* is
    // set and can replace it.
    value = h("div", { class: `${ENTRY_CLASS}-value` }, linkedName ?? linkedId);
    actions = [
      button(
        bridge.labels.open,
        () => bridge.openCard(linkedId, "process"),
        `${ENTRY_CLASS}-open`,
      ),
      choose,
      button(
        bridge.labels.clear,
        () => bridge.clearLink(element, "process"),
        `${ENTRY_CLASS}-clear`,
      ),
    ];
  } else if (liveRef && !isCardUuid(liveRef)) {
    // Only a *foreign* reference earns the hint. A card uuid that got this far
    // was cleared in this draft, and saying "References <uuid>" would offer
    // the user's own decision back as a curiosity.
    value = h(
      "div",
      { class: `${ENTRY_CLASS}-value ${ENTRY_CLASS}-foreign` },
      bridge.labels.references(liveRef),
    );
    actions = [choose];
  } else {
    value = h("div", { class: `${ENTRY_CLASS}-value ${ENTRY_CLASS}-empty` }, labels.none);
    actions = [choose];
  }

  return entryRow(id, labels.label, value, actions);
}
