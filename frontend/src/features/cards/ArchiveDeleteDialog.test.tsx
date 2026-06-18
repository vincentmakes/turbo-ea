import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArchiveDeleteDialog from "./ArchiveDeleteDialog";
import type { ArchiveImpact } from "@/types";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    detail: unknown;
    constructor(message: string, status: number, detail: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  },
}));

import { api } from "@/api/client";
import { invalidateArchiveRetentionDays } from "@/hooks/useArchiveRetentionDays";

const baseImpact: ArchiveImpact = {
  child_count: 0,
  descendant_count: 0,
  approved_descendant_count: 0,
  grandparent: null,
  children: [],
  related_cards: [],
};

describe("ArchiveDeleteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Prime the archived-card retention singleton so the dialog's hook never
    // fires its own (mocked) GET and stays out of the per-test api.get queue.
    invalidateArchiveRetentionDays(30);
  });

  it("renders without children/relations sections when impact is empty", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(baseImpact);
    vi.mocked(api.post).mockResolvedValueOnce({});
    render(
      <ArchiveDeleteDialog
        open
        mode="archive"
        scope="single"
        cardId="card-1"
        cardName="Test Card"
        onClose={() => {}}
        onConfirmed={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to archive/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/what should happen to its children/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cards linked via relationships/i)).not.toBeInTheDocument();
  });

  it("hides reparent option when grandparent is null", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...baseImpact,
      child_count: 1,
      descendant_count: 1,
      grandparent: null,
      children: [
        {
          id: "c-1",
          name: "Child 1",
          type: "Application",
          subtype: null,
          descendants_count: 0,
          approval_status: "DRAFT",
        },
      ],
    });
    render(
      <ArchiveDeleteDialog
        open
        mode="archive"
        scope="single"
        cardId="card-1"
        cardName="Parent"
        onClose={() => {}}
        onConfirmed={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/archive all descendants/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/keep children, clear their parent/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/move children under/i)).not.toBeInTheDocument();
  });

  it("shows reparent option with parent name when grandparent exists", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...baseImpact,
      child_count: 1,
      descendant_count: 1,
      grandparent: { id: "gp-1", name: "Grandparent", type: "Application" },
      children: [
        {
          id: "c-1",
          name: "Child",
          type: "Application",
          subtype: null,
          descendants_count: 0,
          approval_status: "DRAFT",
        },
      ],
    });
    render(
      <ArchiveDeleteDialog
        open
        mode="archive"
        scope="single"
        cardId="card-1"
        cardName="Parent"
        onClose={() => {}}
        onConfirmed={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/move children under grandparent/i)).toBeInTheDocument();
    });
  });

  it("renders related cards grouped by relation type", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...baseImpact,
      related_cards: [
        {
          id: "r-1",
          name: "ITC Alpha",
          type: "ITComponent",
          subtype: null,
          relation_id: "rel-1",
          relation_type_key: "app_to_itc",
          relation_label: "uses",
          direction: "outgoing",
        },
        {
          id: "r-2",
          name: "ITC Beta",
          type: "ITComponent",
          subtype: null,
          relation_id: "rel-2",
          relation_type_key: "app_to_itc",
          relation_label: "uses",
          direction: "outgoing",
        },
      ],
    });
    render(
      <ArchiveDeleteDialog
        open
        mode="archive"
        scope="single"
        cardId="card-1"
        cardName="App"
        onClose={() => {}}
        onConfirmed={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("uses")).toBeInTheDocument();
    });
    expect(screen.getByText("ITC Alpha")).toBeInTheDocument();
    expect(screen.getByText("ITC Beta")).toBeInTheDocument();
  });

  it("submits archive with strategy + ticked related card ids", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValueOnce({
      ...baseImpact,
      child_count: 1,
      descendant_count: 1,
      children: [
        {
          id: "c-1",
          name: "Child",
          type: "Application",
          subtype: null,
          descendants_count: 0,
          approval_status: "DRAFT",
        },
      ],
      related_cards: [
        {
          id: "r-1",
          name: "ITC Alpha",
          type: "ITComponent",
          subtype: null,
          relation_id: "rel-1",
          relation_type_key: "app_to_itc",
          relation_label: "uses",
          direction: "outgoing",
        },
      ],
    });
    vi.mocked(api.post).mockResolvedValueOnce({});
    const onConfirmed = vi.fn();
    render(
      <ArchiveDeleteDialog
        open
        mode="archive"
        scope="single"
        cardId="card-1"
        cardName="App"
        onClose={() => {}}
        onConfirmed={onConfirmed}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(/keep children/i)).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText(/keep children/i));
    await user.click(screen.getByLabelText(/itc alpha/i, { selector: "input" }));
    await user.click(screen.getByRole("button", { name: /^archive$/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/cards/card-1/archive", {
        child_strategy: "disconnect",
        related_card_ids: ["r-1"],
      });
    });
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("bulk mode skips impact fetch and offers cascade-related toggle", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({});
    render(
      <ArchiveDeleteDialog
        open
        mode="archive"
        scope="bulk"
        cardIds={["a", "b", "c"]}
        onClose={() => {}}
        onConfirmed={() => {}}
      />,
    );
    expect(api.get).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByLabelText(/also archive cards linked via relationships/i),
      ).toBeInTheDocument();
    });
    // Pick a strategy first (children section is always shown in bulk).
    await user.click(screen.getByLabelText(/keep children/i));
    await user.click(screen.getByLabelText(/also archive cards linked via relationships/i));
    await user.click(screen.getByRole("button", { name: /^archive$/i }));
    // Bulk now goes through one server-side transaction: a single
    // POST /cards/bulk-archive with the full card_ids list.
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledTimes(1);
    });
    expect(api.post).toHaveBeenCalledWith("/cards/bulk-archive", {
      card_ids: ["a", "b", "c"],
      child_strategy: "disconnect",
      cascade_all_related: true,
    });
  });
});
