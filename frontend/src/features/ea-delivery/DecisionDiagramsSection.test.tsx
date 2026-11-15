import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  isAbortError: () => false,
}));
const authState = vi.hoisted(() => ({
  user: { id: "u1", permissions: { "diagrams.view": true } } as {
    id: string;
    permissions: Record<string, boolean>;
  } | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: authState.user }) }));

import { api } from "@/api/client";
import type { AdrLinkedDiagram, DiagramSummary } from "@/types";
import DecisionDiagramsSection, { diagramsPath } from "./DecisionDiagramsSection";

const LANDSCAPE: AdrLinkedDiagram = {
  id: "d1",
  name: "Landscape",
  thumbnail: "data:image/svg+xml;base64,PHN2Zy8+",
  updated_at: null,
};
const FLOWS: AdrLinkedDiagram = {
  id: "d2",
  name: "Data flows",
  thumbnail: "<svg><text>流</text></svg>",
  updated_at: null,
};
const BARE: AdrLinkedDiagram = { id: "d3", name: "No picture", thumbnail: null, updated_at: null };

const PICKABLE: DiagramSummary[] = [
  { id: "d1", name: "Landscape", card_ids: [], card_count: 0 },
  { id: "d9", name: "Target", card_ids: [], card_count: 2 },
];

beforeEach(() => {
  authState.user = { id: "u1", permissions: { "diagrams.view": true } };
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async () => PICKABLE as never);
  vi.mocked(api.post).mockReset();
  vi.mocked(api.delete).mockReset();
});

function renderSection(props: Partial<Parameters<typeof DecisionDiagramsSection>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <MemoryRouter>
      <DecisionDiagramsSection
        adrId="a1"
        diagrams={[LANDSCAPE, FLOWS]}
        editable
        onChange={onChange}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onChange };
}

describe("diagramsPath", () => {
  it("names the decision's diagram links", () => {
    expect(diagramsPath("a1")).toBe("/adr/a1/diagrams");
  });
});

describe("DecisionDiagramsSection", () => {
  it("renders nothing without diagrams.view, even with diagrams and edit rights", () => {
    authState.user = { id: "u1", permissions: { "adr.manage": true } };
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no user", () => {
    authState.user = null;
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows for a wildcard permission", () => {
    authState.user = { id: "u1", permissions: { "*": true } };
    renderSection();
    expect(screen.getAllByTestId("decision-diagram")).toHaveLength(2);
  });

  it("shows each diagram's thumbnail and name, linking to the diagram", () => {
    renderSection();
    expect(screen.getByText("Diagrams")).toBeInTheDocument();
    const cards = screen.getAllByTestId("decision-diagram");
    expect(cards).toHaveLength(2);
    const first = within(cards[0]);
    expect(first.getByText("Landscape")).toBeInTheDocument();
    expect(first.getByRole("link")).toHaveAttribute("href", "/diagrams/d1");
    expect(cards[0].querySelector("img")).toHaveAttribute("src", LANDSCAPE.thumbnail);
    // A raw SVG becomes a data URI, never markup on the page.
    expect(cards[1].querySelector("img")?.getAttribute("src")).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FLOWS.thumbnail!)}`,
    );
    expect(cards[1].querySelector("svg")).toBeNull();
    expect(within(cards[1]).getByRole("link")).toHaveAttribute("href", "/diagrams/d2");
  });

  it("shows the diagram icon when there is no thumbnail", () => {
    renderSection({ diagrams: [BARE] });
    const card = screen.getByTestId("decision-diagram");
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByText("schema")).toBeInTheDocument();
    expect(within(card).getByText("No picture")).toBeInTheDocument();
  });

  it("offers no controls when not editable", () => {
    renderSection({ editable: false });
    expect(screen.getAllByTestId("decision-diagram")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Attach diagram/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove diagram/ })).toBeNull();
  });

  it("renders nothing when read-only and empty", () => {
    const { container } = renderSection({ editable: false, diagrams: [] });
    expect(container).toBeEmptyDOMElement();
    const again = renderSection({ editable: false, diagrams: undefined });
    expect(again.container).toBeEmptyDOMElement();
  });

  it("says there are none when editable and empty", () => {
    renderSection({ diagrams: [] });
    expect(screen.getByText("No diagrams attached.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add Attach diagram$/ })).toBeInTheDocument();
  });

  it("renders the preview variant without a frame but with the same content", () => {
    renderSection({ editable: false, variant: "plain" });
    const section = screen.getByTestId("decision-diagrams");
    expect(section.className).not.toMatch(/MuiPaper/);
    expect(within(section).getAllByTestId("decision-diagram")).toHaveLength(2);
  });

  it("frames the editor variant in a paper", () => {
    renderSection();
    expect(screen.getByTestId("decision-diagrams").className).toMatch(/MuiPaper/);
  });

  it("attaches a picked diagram through POST and shows the returned list", async () => {
    const target: AdrLinkedDiagram = { id: "d9", name: "Target", thumbnail: null, updated_at: null };
    vi.mocked(api.post).mockResolvedValue({ diagrams: [LANDSCAPE, target] } as never);
    const { onChange } = renderSection({ diagrams: [LANDSCAPE] });
    fireEvent.click(screen.getByRole("button", { name: /^add Attach diagram$/ }));
    expect(await screen.findByText("Attach a diagram")).toBeInTheDocument();
    // Already linked: listed as attached.
    const linked = await screen.findByTestId("diagram-option-d1");
    expect(within(linked).getByText("Attached")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("diagram-option-d9"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([LANDSCAPE, target]));
    expect(api.post).toHaveBeenCalledWith("/adr/a1/diagrams", { diagram_id: "d9" });
    await waitFor(() => expect(screen.queryByText("Attach a diagram")).toBeNull());
  });

  it("reports an empty list when the reply carries none", async () => {
    vi.mocked(api.post).mockResolvedValue({} as never);
    const { onChange } = renderSection({ diagrams: [] });
    fireEvent.click(screen.getByRole("button", { name: /^add Attach diagram$/ }));
    fireEvent.click(await screen.findByTestId("diagram-option-d9"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  });

  it("shows the API's refusal when attaching fails", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("The diagram is already linked"));
    const { onChange } = renderSection({ diagrams: [] });
    fireEvent.click(screen.getByRole("button", { name: /^add Attach diagram$/ }));
    fireEvent.click(await screen.findByTestId("diagram-option-d9"));
    expect(await screen.findByText("The diagram is already linked")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to its own message when a refusal has none", async () => {
    vi.mocked(api.post).mockRejectedValue("nope");
    renderSection({ diagrams: [] });
    fireEvent.click(screen.getByRole("button", { name: /^add Attach diagram$/ }));
    fireEvent.click(await screen.findByTestId("diagram-option-d9"));
    expect(await screen.findByText("Failed to attach the diagram")).toBeInTheDocument();
    // The message can be dismissed.
    // Once the picker has gone, the page is no longer hidden behind it.
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(screen.queryByText("Failed to attach the diagram")).toBeNull();
  });

  it("removes a diagram through DELETE after confirming and drops it", async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined as never);
    const { onChange } = renderSection();
    const remove = screen.getAllByRole("button", { name: /^Remove diagram$/ });
    expect(remove).toHaveLength(2);
    fireEvent.click(remove[1]);
    expect(
      screen.getByText("Remove Data flows from this decision? The diagram itself is kept."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([LANDSCAPE]));
    expect(api.delete).toHaveBeenCalledWith("/adr/a1/diagrams/d2");
  });

  it("does not remove when the confirmation is cancelled", async () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove diagram$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText(/from this decision\? The diagram itself is kept\./)).toBeNull(),
    );
    expect(api.delete).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the API's refusal when removing fails and keeps the diagram", async () => {
    vi.mocked(api.delete).mockRejectedValue(new Error("Link not found"));
    const { onChange } = renderSection();
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove diagram$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Link not found")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("falls back to its own message when a removal fails without one", async () => {
    vi.mocked(api.delete).mockRejectedValue(new Error(""));
    renderSection();
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove diagram$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Failed to remove the diagram")).toBeInTheDocument();
  });

  it("clears an earlier refusal after a later success", async () => {
    vi.mocked(api.delete)
      .mockRejectedValueOnce(new Error("Link not found"))
      .mockResolvedValueOnce(undefined as never);
    renderSection();
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove diagram$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Link not found")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^Remove diagram$/ })[0],
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove diagram$/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("Link not found")).toBeNull());
  });
});
