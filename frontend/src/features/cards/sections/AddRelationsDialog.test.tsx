/**
 * Tests for the add-relations dialog (discussion #918), focused on the parts
 * the Relations-section tests can't reach: relation attributes set once and
 * applied to every card added afterwards.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

const APP_TYPE = { key: "Application", label: "Application", color: "#0f7eb5", subtypes: [] };
const ORG_TYPE = { key: "Organization", label: "Organization", color: "#2889ff", subtypes: [] };

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Organization" ? ORG_TYPE : key === "Application" ? APP_TYPE : undefined,
    types: [APP_TYPE, ORG_TYPE],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";
import type { RelationType } from "@/types";
import AddRelationsDialog from "./AddRelationsDialog";

const FS = "app-1";

/** A relation type carrying a single-select attribute, like `usageType`. */
const rtWithAttrs = {
  key: "orgToApp",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
  cardinality: "n:m",
  attributes_schema: [
    {
      key: "usageType",
      label: "Usage Type",
      type: "single_select",
      options: [
        { key: "user", label: "User" },
        { key: "owner", label: "Owner" },
      ],
    },
  ],
} as unknown as RelationType;

function mountDialog(props: Partial<React.ComponentProps<typeof AddRelationsDialog>> = {}) {
  const onAdded = vi.fn();
  render(
    <AddRelationsDialog
      open
      onClose={vi.fn()}
      fsId={FS}
      cardTypeKey="Application"
      relationType={rtWithAttrs}
      relations={[]}
      onAdded={onAdded}
      onRemoved={vi.fn()}
      onUpdated={vi.fn()}
      {...props}
    />,
  );
  return { onAdded };
}

describe("AddRelationsDialog relation attributes", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.get).mockResolvedValue({
      items: [
        { id: "org-a", name: "Finance", type: "Organization" },
        { id: "org-b", name: "Legal", type: "Organization" },
      ],
      total: 2,
      page: 1,
      page_size: 50,
    } as never);
    vi.mocked(api.post).mockImplementation(
      async (_url: string, body: unknown) =>
        ({
          id: `rel-${(body as { target_id: string }).target_id}`,
          ...(body as object),
        }) as never,
    );
  });

  it("sends the chosen attribute with the relation", async () => {
    mountDialog();
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("combobox", { name: /Usage Type/i }));
    await userEvent.click(await screen.findByRole("option", { name: "User" }));

    await userEvent.click(await within(dialog).findByText("Finance"));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(
      "/relations",
      expect.objectContaining({ attributes: { usageType: "user" } }),
    );
  });

  it("keeps the attribute for every card added afterwards", async () => {
    mountDialog();
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(within(dialog).getByRole("combobox", { name: /Usage Type/i }));
    await userEvent.click(await screen.findByRole("option", { name: "User" }));

    await userEvent.click(await within(dialog).findByText("Finance"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());
    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/2 added/i)).toBeInTheDocument());

    for (const call of vi.mocked(api.post).mock.calls) {
      expect(call[1]).toMatchObject({ attributes: { usageType: "user" } });
    }
  });

  it("applies an attribute chosen after the fact to everything already added", async () => {
    // The control sits above the chips, so it reads as a property of the
    // batch. Setting it after adding the cards previously did nothing at all,
    // which looked exactly like the value failing to save.
    const onUpdated = vi.fn();
    vi.mocked(api.patch).mockImplementation(
      async (url: string, body: unknown) =>
        ({ id: url.split("/").pop(), ...(body as object) }) as never,
    );
    mountDialog({ onUpdated });
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(await within(dialog).findByText("Finance"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());
    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/2 added/i)).toBeInTheDocument());
    // Added with no attribute set.
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("attributes");

    await userEvent.click(within(dialog).getByRole("combobox", { name: /Usage Type/i }));
    await userEvent.click(await screen.findByRole("option", { name: "User" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    for (const call of vi.mocked(api.patch).mock.calls) {
      expect(call[0]).toMatch(/^\/relations\//);
      expect(call[1]).toEqual({ attributes: { usageType: "user" } });
    }
    // The rows behind the dialog are told, so their badges refresh.
    expect(onUpdated).toHaveBeenCalledTimes(2);
  });

  it("omits attributes entirely when none were chosen", async () => {
    mountDialog();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByText("Finance"));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("attributes");
  });
});
