import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import type { DiagramSummary } from "@/types";
import DiagramPickerDialog, { diagramListPath } from "./DiagramPickerDialog";

const diagram = (over: Partial<DiagramSummary>): DiagramSummary => ({
  id: "d1",
  name: "Landscape",
  card_ids: [],
  card_count: 0,
  ...over,
});

const LANDSCAPE = diagram({
  id: "d1",
  name: "Landscape",
  thumbnail: "data:image/svg+xml;base64,PHN2Zy8+",
  card_count: 3,
  created_by_name: "Ada",
});
const FLOWS = diagram({ id: "d2", name: "Data flows", card_count: 1 });
const ARCH = diagram({ id: "d3", name: "Target land", card_count: 0 });

let served: DiagramSummary[] = [LANDSCAPE, FLOWS];

beforeEach(() => {
  served = [LANDSCAPE, FLOWS];
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async () => served as never);
});

describe("diagramListPath", () => {
  it("asks for the whole list by name, and adds a trimmed search", () => {
    expect(diagramListPath("")).toBe("/diagrams?sort_by=name&sort_dir=asc");
    expect(diagramListPath("   ")).toBe("/diagrams?sort_by=name&sort_dir=asc");
    expect(diagramListPath(" flow & co ")).toBe(
      "/diagrams?sort_by=name&sort_dir=asc&search=flow+%26+co",
    );
  });
});

describe("DiagramPickerDialog", () => {
  it("loads nothing while closed", () => {
    render(<DiagramPickerDialog open={false} onClose={vi.fn()} onPick={vi.fn()} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("lists the diagrams with a thumbnail or an icon, name and a summary line", async () => {
    render(<DiagramPickerDialog open onClose={vi.fn()} onPick={vi.fn()} />);
    expect(screen.getByText("Choose a diagram")).toBeInTheDocument();
    const first = await screen.findByTestId("diagram-option-d1");
    expect(api.get).toHaveBeenCalledWith("/diagrams?sort_by=name&sort_dir=asc", expect.anything());
    expect(within(first).getByText("Landscape")).toBeInTheDocument();
    expect(within(first).getByText("3 cards · Ada")).toBeInTheDocument();
    expect(first.querySelector("img")).toHaveAttribute("src", LANDSCAPE.thumbnail);
    const second = screen.getByTestId("diagram-option-d2");
    expect(within(second).getByText("1 card")).toBeInTheDocument();
    expect(second.querySelector("img")).toBeNull();
    expect(within(second).getByText("schema")).toBeInTheDocument();
    // Ranked by name with no query: "Data flows" before "Landscape".
    const rows = screen.getAllByTestId(/^diagram-option-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual(["diagram-option-d2", "diagram-option-d1"]);
  });

  it("uses the title it is given", async () => {
    render(<DiagramPickerDialog open onClose={vi.fn()} onPick={vi.fn()} title="Attach it" />);
    expect(screen.getByText("Attach it")).toBeInTheDocument();
    expect(screen.queryByText("Choose a diagram")).toBeNull();
    await screen.findByTestId("diagram-option-d1");
  });

  it("picks a diagram on click and clears the search", async () => {
    const onPick = vi.fn();
    render(<DiagramPickerDialog open onClose={vi.fn()} onPick={onPick} />);
    const box = screen.getByRole("textbox", { name: "Search diagrams…" });
    fireEvent.change(box, { target: { value: "lan" } });
    fireEvent.click(await screen.findByTestId("diagram-option-d1"));
    expect(onPick).toHaveBeenCalledWith(LANDSCAPE);
    expect(box).toHaveValue("");
  });

  it("shows an excluded diagram as attached and inert", async () => {
    const onPick = vi.fn();
    render(<DiagramPickerDialog open onClose={vi.fn()} onPick={onPick} excludeIds={["d1"]} />);
    const row = await screen.findByTestId("diagram-option-d1");
    expect(within(row).getByText("Attached")).toBeInTheDocument();
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(within(screen.getByTestId("diagram-option-d2")).queryByText("Attached")).toBeNull();
    expect(screen.getByTestId("diagram-option-d2")).not.toHaveAttribute("aria-disabled");
  });

  it("debounces the search to the server and ranks the rows on the raw input", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      served = [LANDSCAPE, FLOWS, ARCH];
      render(<DiagramPickerDialog open onClose={vi.fn()} onPick={vi.fn()} />);
      await screen.findByTestId("diagram-option-d1");
      vi.mocked(api.get).mockClear();
      fireEvent.change(screen.getByRole("textbox", { name: "Search diagrams…" }), {
        target: { value: "land" },
      });
      // Re-ranked at once: starts-with "land" first, then the word match.
      const order = () =>
        screen.getAllByTestId(/^diagram-option-/).map((r) => r.dataset.testid);
      expect(order()).toEqual(["diagram-option-d1", "diagram-option-d3", "diagram-option-d2"]);
      expect(screen.getByTestId("diagram-picker-loading")).toBeInTheDocument();
      expect(api.get).not.toHaveBeenCalled();
      served = [ARCH];
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith(
          "/diagrams?sort_by=name&sort_dir=asc&search=land",
          expect.anything(),
        ),
      );
      await waitFor(() => expect(order()).toEqual(["diagram-option-d3"]));
      await waitFor(() => expect(screen.queryByTestId("diagram-picker-loading")).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when a search matches nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<DiagramPickerDialog open onClose={vi.fn()} onPick={vi.fn()} />);
      await screen.findByTestId("diagram-option-d1");
      served = [];
      fireEvent.change(screen.getByRole("textbox", { name: "Search diagrams…" }), {
        target: { value: "zzz" },
      });
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(await screen.findByText("No diagram matches your search.")).toBeInTheDocument();
      expect(screen.queryByText("There are no diagrams yet.")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when there are no diagrams at all", async () => {
    served = [];
    render(<DiagramPickerDialog open onClose={vi.fn()} onPick={vi.fn()} />);
    expect(await screen.findByText("There are no diagrams yet.")).toBeInTheDocument();
    expect(screen.queryByText("No diagram matches your search.")).toBeNull();
  });

  it("shows a load failure and retries", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    render(<DiagramPickerDialog open onClose={vi.fn()} onPick={vi.fn()} />);
    expect(await screen.findByText("The diagrams could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByTestId("diagram-option-d1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("diagram-option-d1")).toBeInTheDocument();
    expect(screen.queryByText("The diagrams could not be loaded.")).toBeNull();
  });

  it("closes from Cancel", async () => {
    const onClose = vi.fn();
    render(<DiagramPickerDialog open onClose={onClose} onPick={vi.fn()} />);
    await screen.findByTestId("diagram-option-d1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
