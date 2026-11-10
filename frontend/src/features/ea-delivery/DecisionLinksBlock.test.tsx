import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import { invalidateDecisionOptions } from "@/components/DecisionPicker";
import type { ArchitectureDecision, DecisionLinkInput, DecisionLinks } from "@/types";
import DecisionLinksBlock, {
  MANUAL_LINK_KINDS,
  excludedFor,
  isClosedTarget,
  kindOptions,
} from "./DecisionLinksBlock";

const row = (id: string, ref: string, over: Partial<ArchitectureDecision> = {}): ArchitectureDecision => ({
  id,
  reference_number: ref,
  title: `Title ${id}`,
  status: "signed",
  standing: "in_force",
  context: null,
  decision: null,
  consequences: null,
  alternatives_considered: null,
  related_decisions: [],
  created_by: null,
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  created_at: null,
  updated_at: null,
  ...over,
});

const REGISTER = [
  row("self", "ADR-001"),
  row("d2", "ADR-002"),
  row("d3", "ADR-003", { standing: "revoked" }),
  row("d4", "ADR-004"),
];

const LINKS: DecisionLinks = {
  outgoing: [
    {
      id: "l1",
      kind: "replaces",
      note: "section 3 only",
      decision: {
        id: "d12",
        reference_number: "ADR-012",
        revision_number: 2,
        title: "Old messaging",
        status: "signed",
        standing: "superseded",
        current: { id: "d12c", reference_number: "ADR-012", revision_number: 3 },
      },
    },
    {
      id: "l2",
      kind: "relates",
      note: null,
      decision: {
        id: "d4",
        reference_number: "ADR-004",
        revision_number: 1,
        title: "Title d4",
        status: "signed",
        standing: "in_force",
        current: { id: "d4", reference_number: "ADR-004", revision_number: 1 },
      },
    },
  ],
  incoming: [
    {
      id: "l3",
      kind: "replaces",
      note: null,
      decision: {
        id: "d20",
        reference_number: "ADR-020",
        revision_number: 1,
        title: "New messaging",
        status: "draft",
        standing: null,
      },
    },
  ],
};

beforeEach(() => {
  invalidateDecisionOptions();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue(REGISTER as never);
});

describe("pure helpers", () => {
  it("offers the manual kinds, plus a row's own kind when it is not one", () => {
    expect(MANUAL_LINK_KINDS).toEqual(["replaces", "amends", "revokes", "relates"]);
    expect(kindOptions("amends")).toEqual(["replaces", "amends", "revokes", "relates"]);
    expect(kindOptions("consolidates")).toEqual(["replaces", "amends", "revokes", "relates", "consolidates"]);
  });

  it("hides the own chain and the other rows' targets from a row's picker", () => {
    const value: DecisionLinkInput[] = [
      { decision_id: "a", kind: "relates" },
      { decision_id: "", kind: "relates" },
      { decision_id: "b", kind: "amends" },
    ];
    expect(excludedFor(value, 0, ["self"])).toEqual(["self", "b"]);
    expect(excludedFor(value, 1, ["self", "rev1"])).toEqual(["self", "rev1", "a", "b"]);
  });

  it("calls a superseded or revoked target closed", () => {
    expect(isClosedTarget({ standing: "superseded" })).toBe(true);
    expect(isClosedTarget({ standing: "revoked" })).toBe(true);
    expect(isClosedTarget({ standing: "amended" })).toBe(false);
    expect(isClosedTarget({ standing: null })).toBe(false);
    expect(isClosedTarget(undefined)).toBe(false);
  });
});

describe("read-only", () => {
  it("renders nothing without links", () => {
    const { container } = render(
      <MemoryRouter>
        <DecisionLinksBlock readOnly links={{ outgoing: [], incoming: [] }} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the decision carries no links at all", () => {
    const { container } = render(
      <MemoryRouter>
        <DecisionLinksBlock readOnly />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reads outgoing links by their verb, then incoming ones by the inverse", () => {
    render(
      <MemoryRouter>
        <DecisionLinksBlock readOnly links={LINKS} />
      </MemoryRouter>,
    );
    const out = within(screen.getByTestId("link-outgoing-d12"));
    expect(out.getByRole("link", { name: "Replaces ADR-012 · Rev 2" })).toHaveAttribute(
      "href",
      "/ea-delivery/adr/d12",
    );
    expect(out.getByText("— Old messaging")).toBeInTheDocument();
    expect(out.getByText("Superseded")).toBeInTheDocument();
    expect(out.getByText("— section 3 only")).toBeInTheDocument();
    expect(out.getByRole("link", { name: "→ current revision ADR-012 · Rev 3" })).toHaveAttribute(
      "href",
      "/ea-delivery/adr/d12c",
    );

    // Its own current revision: no pointer, no note.
    const same = screen.getByTestId("link-outgoing-d4");
    expect(within(same).queryByText(/current revision/)).toBeNull();
    expect(same).not.toHaveTextContent("— null");
    expect(within(same).getByRole("link", { name: "Relates to ADR-004" })).toBeInTheDocument();

    const inc = within(screen.getByTestId("link-incoming-d20"));
    expect(inc.getByRole("link", { name: "Replaced by ADR-020" })).toHaveAttribute(
      "href",
      "/ea-delivery/adr/d20",
    );
    expect(inc.getByText("Draft")).toBeInTheDocument();
  });
});

function Harness({
  initial,
  links,
  onValue,
}: {
  initial: DecisionLinkInput[];
  links?: DecisionLinks;
  onValue: (v: DecisionLinkInput[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MemoryRouter>
      <DecisionLinksBlock
        links={links}
        value={value}
        ownIds={["self"]}
        onChange={(v) => {
          setValue(v);
          onValue(v);
        }}
      />
    </MemoryRouter>
  );
}

describe("editable", () => {
  it("adds a row, picks a target outside its own chain, sets the kind and a note, and removes it", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial={[]} onValue={onValue} />);

    await user.click(screen.getByRole("button", { name: /Add a link/ }));
    expect(onValue).toHaveBeenLastCalledWith([{ decision_id: "", kind: "relates", note: null }]);

    await user.click(screen.getByLabelText("Decision"));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr?include_earlier=false"));
    const listbox = await screen.findByRole("listbox");
    // The decision itself is never offered.
    expect(within(listbox).queryByText("Title self")).toBeNull();
    await user.click(within(listbox).getByText("Title d2"));
    expect(onValue).toHaveBeenLastCalledWith([{ decision_id: "d2", kind: "relates", note: null }]);

    await user.click(screen.getByLabelText("Link"));
    const kinds = within(await screen.findByRole("listbox"));
    expect(kinds.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Replaces",
      "Amends",
      "Revokes",
      "Relates to",
    ]);
    await user.click(kinds.getByRole("option", { name: "Amends" }));
    expect(onValue).toHaveBeenLastCalledWith([{ decision_id: "d2", kind: "amends", note: null }]);

    await user.type(screen.getByLabelText("Note"), "§3");
    expect(onValue).toHaveBeenLastCalledWith([{ decision_id: "d2", kind: "amends", note: "§3" }]);

    await user.click(screen.getByRole("button", { name: "Remove link" }));
    expect(onValue).toHaveBeenLastCalledWith([]);
  });

  it("warns when the picked target is already revoked", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ decision_id: "", kind: "relates", note: null }]} onValue={vi.fn()} />);
    expect(screen.queryByText("This decision has already been superseded or revoked.")).toBeNull();
    await user.click(screen.getByLabelText("Decision"));
    await user.click(await screen.findByText("Title d3"));
    expect(screen.getByText("This decision has already been superseded or revoked.")).toBeInTheDocument();
  });

  it("names the targets it already holds, shows a consolidation it cannot offer, and lists incoming links", () => {
    render(
      <Harness
        initial={[{ decision_id: "d12", kind: "consolidates", note: "x".repeat(1001) }]}
        links={LINKS}
        onValue={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("ADR-012 · Rev 2 — Old messaging")).toBeInTheDocument();
    expect(screen.getByText("Consolidates the amendment of")).toBeInTheDocument();
    expect(screen.getByText("At most 1000 characters")).toBeInTheDocument();
    // A superseded target already held is flagged too.
    expect(screen.getByText("This decision has already been superseded or revoked.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Replaced by ADR-020" })).toBeInTheDocument();
  });

  it("does not flag a note of exactly 1000 characters", () => {
    render(<Harness initial={[{ decision_id: "", kind: "relates", note: "x".repeat(1000) }]} onValue={vi.fn()} />);
    expect(screen.queryByText("At most 1000 characters")).toBeNull();
  });

  it("hides another row's target from a row's picker", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { decision_id: "d2", kind: "relates", note: null },
          { decision_id: "", kind: "relates", note: null },
        ]}
        onValue={vi.fn()}
      />,
    );
    const second = within(screen.getByTestId("link-row-1"));
    await user.click(second.getByLabelText("Decision"));
    const listbox = within(await screen.findByRole("listbox"));
    expect(listbox.queryByText("Title d2")).toBeNull();
    expect(listbox.getByText("Title d4")).toBeInTheDocument();
  });
});
