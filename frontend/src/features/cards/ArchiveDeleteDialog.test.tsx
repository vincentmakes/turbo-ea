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

  it.each(["archive", "delete"] as const)(
    "escapes HTML in the card name in the single-card %s confirm",
    async (mode) => {
      const name = '<img src="x" onerror="window.__xss=1">';
      vi.mocked(api.get).mockResolvedValueOnce(baseImpact);
      render(
        <ArchiveDeleteDialog
          open
          mode={mode}
          scope="single"
          cardId="card-1"
          cardName={name}
          onClose={() => {}}
          onConfirmed={() => {}}
        />,
      );
      await waitFor(() => {
        expect(screen.getByText(name)).toBeInTheDocument();
      });
      // Literal text inside the translation's <strong>, never live markup.
      expect(screen.getByText(name).tagName).toBe("STRONG");
      expect(document.body.querySelector("img")).toBeNull();
    },
  );

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

  it("offers the strategies when the server asks for one the impact did not announce", async () => {
    const user = userEvent.setup();
    // No children the dialog can list, yet the server finds some (#1382).
    vi.mocked(api.get).mockResolvedValueOnce(baseImpact);
    const { ApiError } = await import("@/api/client");
    // An earlier test queues a response it never consumes; start clean.
    vi.mocked(api.post)
      .mockReset()
      .mockRejectedValueOnce(
        new ApiError("Conflict", 409, { error: "children_present", child_count: 1 }),
      )
      .mockResolvedValueOnce({});
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
    const confirm = await screen.findByRole("button", { name: /^archive$/i });
    expect(screen.queryByLabelText(/keep children/i)).not.toBeInTheDocument();
    await user.click(confirm);

    expect(await screen.findByText(/please pick a strategy below/i)).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith("/cards/card-1/archive", {});
    expect(onConfirmed).not.toHaveBeenCalled();
    // The choice the message points at is now on screen, and required.
    expect(confirm).toBeDisabled();
    await user.click(screen.getByLabelText(/keep children/i));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(api.post).toHaveBeenLastCalledWith("/cards/card-1/archive", {
        child_strategy: "disconnect",
      });
    });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("does not offer strategies for an error that is not about children", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValueOnce(baseImpact);
    const { ApiError } = await import("@/api/client");
    vi.mocked(api.post).mockReset().mockRejectedValueOnce(new ApiError("Forbidden", 403, null));
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
    await user.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(screen.queryByLabelText(/keep children/i)).not.toBeInTheDocument();
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
