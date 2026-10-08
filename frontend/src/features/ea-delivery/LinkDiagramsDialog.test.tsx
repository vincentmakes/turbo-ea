import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeCard } from "@/test/fixtures/metamodel";
import type { Card, DiagramSummary } from "@/types";
import LinkDiagramsDialog from "./LinkDiagramsDialog";

const CLOUD: Card = makeCard({ id: "init-1", type: "Initiative", name: "Cloud Migration" });
const ERP: Card = makeCard({ id: "init-2", type: "Initiative", name: "ERP Replacement" });
const INITIATIVES = [CLOUD, ERP];

function diagram(over: Partial<DiagramSummary> & { id: string; name: string }): DiagramSummary {
  return { card_ids: [], card_count: 0, ...over };
}

const DIAGRAMS: DiagramSummary[] = [
  diagram({ id: "d1", name: "Target landscape", card_ids: ["init-1", "init-2", "other"] }),
  diagram({ id: "d2", name: "Integration map", card_ids: [] }),
  diagram({ id: "d3", name: "Data flows", card_ids: ["init-1"] }),
];

function renderDialog(props: Partial<React.ComponentProps<typeof LinkDiagramsDialog>> = {}) {
  const onClose = vi.fn();
  const onToggle = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <LinkDiagramsDialog
      open
      onClose={onClose}
      diagrams={DIAGRAMS}
      initiatives={INITIATIVES}
      linkInitiativeId="init-1"
      linkSelected={["d1"]}
      linking={false}
      onToggle={onToggle}
      onSave={onSave}
      {...props}
    />,
  );
  return { ...utils, onClose, onToggle, onSave };
}

describe("LinkDiagramsDialog", () => {
  it("names the initiative, lists every diagram with its linked-card chips and checks the selected ones", () => {
    renderDialog();
    expect(screen.getByText("Link Diagrams to Initiative")).toBeInTheDocument();
    // The description interpolates the initiative name into a <strong>.
    expect(screen.getByText("Cloud Migration", { selector: "strong" })).toBeInTheDocument();

    const rows = screen.getAllByRole("button").filter((b) => b.closest("li"));
    expect(rows).toHaveLength(3);

    const landscape = screen.getByText("Target landscape").closest("li") as HTMLElement;
    expect(within(landscape).getByRole("checkbox")).toBeChecked();
    // Other linked initiatives are named; the current one and unknown ids are not.
    expect(within(landscape).getByText("ERP Replacement")).toBeInTheDocument();
    expect(within(landscape).queryByText("Cloud Migration")).not.toBeInTheDocument();

    const integration = screen.getByText("Integration map").closest("li") as HTMLElement;
    expect(within(integration).getByRole("checkbox")).not.toBeChecked();
    expect(within(integration).getByText("Not linked")).toBeInTheDocument();

    // Linked only to the current initiative: no chip and nothing else to name.
    const flows = screen.getByText("Data flows").closest("li") as HTMLElement;
    expect(within(flows).getByText("Not linked")).toBeInTheDocument();
  });

  it("renders the linked-card chips without nesting them inside a paragraph", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderDialog();
      const chip = screen.getByText("ERP Replacement").closest(".MuiChip-root") as HTMLElement;
      // A chip is a <div>: inside the secondary text's <p> it is invalid DOM nesting.
      expect(chip.closest("p")).toBeNull();
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(/cannot be a descendant of <p>|validateDOMNesting/);
    } finally {
      errors.mockRestore();
    }
  });

  it("toggles a diagram on click and saves through the callback", async () => {
    const user = userEvent.setup();
    const { onToggle, onSave } = renderDialog();

    await user.click(screen.getByText("Integration map"));
    expect(onToggle).toHaveBeenCalledWith("d2");

    await user.click(screen.getByRole("button", { name: "Save Links" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("filters the list by search, reports no matches and resets the search on cancel", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    const search = screen.getByPlaceholderText("Search diagrams...");
    await user.type(search, "map");
    expect(screen.getByText("Integration map")).toBeInTheDocument();
    expect(screen.queryByText("Target landscape")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "nothing here");
    expect(screen.getByText("No diagrams match your search.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The parent keeps the dialog mounted; the search field is already cleared.
    expect(search).toHaveValue("");
  });

  it("shows the empty hint when there are no diagrams at all", () => {
    renderDialog({ diagrams: [] });
    expect(
      screen.getByText("No diagrams available. Create one from the Diagrams page first."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("disables Save and shows Saving… while linking, and tolerates an unknown initiative id", () => {
    renderDialog({ linking: true, linkInitiativeId: "ghost" });
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    // No initiative name to interpolate: the <strong> is empty rather than broken.
    expect(screen.queryByText("Cloud Migration", { selector: "strong" })).not.toBeInTheDocument();
    const strong = screen.getByRole("dialog").querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong).toHaveTextContent(/^$/);
  });

  it("escapes HTML in the initiative name instead of injecting it", () => {
    const risky = makeCard({ id: "init-x", type: "Initiative", name: "R&D <i>pilot</i>" });
    renderDialog({ initiatives: [risky], linkInitiativeId: "init-x" });

    const strong = screen.getByRole("dialog").querySelector("strong");
    expect(strong).toHaveTextContent("R&D <i>pilot</i>");
    expect(strong?.querySelector("i")).toBeNull();
  });

  it("keeps the whole list for a whitespace-only search", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("Search diagrams..."), "  ");
    expect(screen.getByText("Target landscape")).toBeInTheDocument();
    expect(screen.getByText("Integration map")).toBeInTheDocument();
    expect(screen.getByText("Data flows")).toBeInTheDocument();
    expect(screen.queryByText("No diagrams match your search.")).not.toBeInTheDocument();
  });

  it("names linked initiatives from the latest initiatives prop", () => {
    const { rerender } = renderDialog();
    const flows = () => screen.getByText("Data flows").closest("li") as HTMLElement;
    expect(within(flows()).getByText("Not linked")).toBeInTheDocument();

    // Data flows is linked to init-1; seen from ERP Replacement, Cloud Migration is the other link.
    rerender(
      <LinkDiagramsDialog
        open
        onClose={vi.fn()}
        diagrams={DIAGRAMS}
        initiatives={[{ ...CLOUD, name: "Cloud Migration v2" }, ERP]}
        linkInitiativeId="init-2"
        linkSelected={[]}
        linking={false}
        onToggle={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(within(flows()).getByText("Cloud Migration v2")).toBeInTheDocument();
  });

  it("puts a search icon in the search field and keeps row checkboxes out of the tab order", () => {
    renderDialog();
    const field = screen.getByPlaceholderText("Search diagrams...").closest(
      ".MuiInputBase-root",
    ) as HTMLElement;
    expect(within(field).getByText("search")).toBeInTheDocument();

    const landscape = screen.getByText("Target landscape").closest("li") as HTMLElement;
    expect(within(landscape).getByRole("checkbox")).toHaveAttribute("tabindex", "-1");
  });
});
