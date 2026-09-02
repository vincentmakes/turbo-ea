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
/**
 * The only type here carrying `has_hierarchy`. Everything above uses
 * `Organization`, which does not — so the flat path stays exercised
 * unchanged by the two describes that came before the tree existed.
 */
const CAP_TYPE = {
  key: "BusinessCapability",
  label: "Business Capability",
  color: "#003399",
  subtypes: [],
  has_hierarchy: true,
};

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Organization"
        ? ORG_TYPE
        : key === "Application"
          ? APP_TYPE
          : key === "BusinessCapability"
            ? CAP_TYPE
            : undefined,
    types: [APP_TYPE, ORG_TYPE, CAP_TYPE],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";
import type { Relation, RelationType } from "@/types";
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
      isSource
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

describe("AddRelationsDialog candidate search", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({
      items: [
        { id: "org-a", name: "Legal Operations", type: "Organization" },
        { id: "org-b", name: "Legal", type: "Organization" },
        { id: "org-c", name: "Paralegal Services", type: "Organization" },
        { id: "org-d", name: "Finance", type: "Organization" },
      ],
      total: 4,
      page: 1,
      page_size: 50,
    } as never);
  });

  it("narrows on the first character, with no debounce to wait out", async () => {
    const user = userEvent.setup();
    mountDialog();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Finance");

    await user.type(within(dialog).getByPlaceholderText("Search Organization"), "Legal");

    // Asserted synchronously — no `waitFor`, no timer advance. The loaded page
    // is already in memory, so filtering it is instant; keying the filter off
    // the debounced value would leave "Finance" on screen for another 300ms.
    expect(within(dialog).queryByText("Finance")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Legal")).toBeInTheDocument();
  });

  it("ranks an exact match above starts-with, and both above mid-word", async () => {
    const user = userEvent.setup();
    mountDialog();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Finance");

    await user.type(within(dialog).getByPlaceholderText("Search Organization"), "Legal");

    const names = within(dialog)
      .getAllByRole("button")
      .map((el) => el.textContent ?? "");
    const at = (name: string) => names.findIndex((t) => t.includes(name));

    // Exact match, then starts-with, then the mid-word one. Alphabetically
    // "Legal Operations" would precede "Legal", and "Paralegal Services" would
    // come first of all.
    expect(at("Legal")).toBeGreaterThanOrEqual(0);
    expect(at("Legal")).toBeLessThan(at("Legal Operations"));
    expect(at("Legal Operations")).toBeLessThan(at("Paralegal Services"));
  });
});

/**
 *  Finance
 *  Sales
 *    ├─ Lead Management
 *    │    └─ Lead Scoring
 *    ├─ Quoting
 *    └─ Scoping
 *  Scorecard Tools
 *
 * Shaped like `CardScopeDialog.test.tsx`'s fixture so the ranking cases are
 * comparable: against "scor", "Sales" and "Lead Management" match nothing on
 * their own names but hold a matching descendant.
 */
const CAPS = [
  { id: "finance", name: "Finance", type: "BusinessCapability", parent_id: null },
  { id: "sales", name: "Sales", type: "BusinessCapability", parent_id: null },
  { id: "leads", name: "Lead Management", type: "BusinessCapability", parent_id: "sales" },
  { id: "scoring", name: "Lead Scoring", type: "BusinessCapability", parent_id: "leads" },
  { id: "quoting", name: "Quoting", type: "BusinessCapability", parent_id: "sales" },
  { id: "scoping", name: "Scoping", type: "BusinessCapability", parent_id: "sales" },
  { id: "scoretools", name: "Scorecard Tools", type: "BusinessCapability", parent_id: null },
];

const rtCapability = {
  key: "appToCapability",
  label: "supports",
  reverse_label: "is supported by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
  cardinality: "n:m",
  attributes_schema: [],
} as unknown as RelationType;

/** A hierarchical type related to itself — the case where `fsId` is a tree node. */
const rtSelf = {
  ...rtCapability,
  key: "capToCap",
  source_type_key: "BusinessCapability",
  target_type_key: "BusinessCapability",
} as unknown as RelationType;

/** The candidate rows, in render order. */
const rowNames = () =>
  Array.from(
    screen.getByTestId("relation-candidates").querySelectorAll('[role="button"]'),
  ).map((el) => el.textContent ?? "");

const rowFor = (name: string) =>
  within(screen.getByTestId("relation-candidates"))
    .getByText(name)
    .closest('[role="button"]') as HTMLElement;

function mountTree(props: Partial<React.ComponentProps<typeof AddRelationsDialog>> = {}) {
  return render(
    <AddRelationsDialog
      open
      onClose={vi.fn()}
      fsId={FS}
      cardTypeKey="Application"
      relationType={rtCapability}
      isSource
      relations={[]}
      onAdded={vi.fn()}
      onRemoved={vi.fn()}
      onUpdated={vi.fn()}
      {...props}
    />,
  );
}

describe("AddRelationsDialog hierarchy (#1050)", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    // `total === items.length` ⇒ nothing more to page ⇒ the tree is provably
    // complete, which is the only state that renders one.
    vi.mocked(api.get).mockResolvedValue({
      items: CAPS,
      total: CAPS.length,
      page: 1,
      page_size: 1000,
    } as never);
  });

  it("renders the type as a tree, in depth-first order rather than alphabetically", async () => {
    mountTree();
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    // Alphabetically "Lead Management" and "Lead Scoring" would sit between
    // "Finance" and "Quoting"; here each sits under its own parent.
    expect(rowNames()).toEqual([
      "Finance",
      "Sales",
      "Lead Management",
      "Lead Scoring",
      "Quoting",
      "Scoping",
      "Scorecard Tools",
    ]);
  });

  it("indents each level", async () => {
    mountTree();
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    const pad = (name: string) =>
      parseFloat(window.getComputedStyle(rowFor(name)).paddingLeft || "0");
    expect(pad("Sales")).toBeLessThan(pad("Lead Management"));
    expect(pad("Lead Management")).toBeLessThan(pad("Lead Scoring"));
  });

  it("browses the whole type unfiltered — the search never reaches the server", async () => {
    const user = userEvent.setup();
    mountTree();
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    await user.type(screen.getByPlaceholderText("Search Business Capability"), "Scoring");
    // Long enough for the 300ms debounce to have fired, had anything been
    // listening to it.
    await new Promise((r) => setTimeout(r, 400));

    const urls = vi.mocked(api.get).mock.calls.map((c) => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toContain("search=");
      expect(url).toContain("page_size=1000");
    }
  });

  it("keeps an already-linked card in place, greyed, so its children keep their level", async () => {
    mountTree({
      relations: [
        {
          id: "r1",
          type: "appToCapability",
          source_id: FS,
          target_id: "leads",
          source: { id: FS, type: "Application", name: "App" },
          target: { id: "leads", type: "BusinessCapability", name: "Lead Management" },
        } as never,
      ],
    });
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    // Hiding it would file "Lead Scoring" under `null` — i.e. promote it to a
    // root — which is exactly the structure this dialog exists to show.
    const linked = rowFor("Lead Management");
    expect(linked).toHaveAttribute("aria-disabled", "true");
    expect(linked.textContent).toContain("already linked");
    expect(rowNames()).toEqual([
      "Finance",
      "Sales",
      "Lead Managementalready linked",
      "Lead Scoring",
      "Quoting",
      "Scoping",
      "Scorecard Tools",
    ]);
  });

  it("leaves a picked card in place as an added row instead of dropping it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({
      id: "rel-1",
      type: "appToCapability",
      source_id: FS,
      target_id: "quoting",
    } as never);
    mountTree();
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    await user.click(within(screen.getByTestId("relation-candidates")).getByText("Quoting"));
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    // Still there, at its own level, marked — not vanished from under the
    // cursor taking its branch's layout with it.
    expect(rowNames().length).toBe(CAPS.length);
    const row = rowFor("Quoting");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row.textContent).toContain("added");
  });

  it("keeps a descendant of a just-added card pickable", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({
      id: "rel-1",
      type: "appToCapability",
      source_id: FS,
      target_id: "leads",
    } as never);
    mountTree();
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    await user.click(within(screen.getByTestId("relation-candidates")).getByText("Lead Management"));
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    // Each pick is its own relation, so a child is never "implied" by its
    // parent the way it is in the scope pickers (`impliedRows: false`).
    expect(rowFor("Lead Scoring")).not.toHaveAttribute("aria-disabled", "true");
  });

  it("keeps ancestors visible when a deep child matches, and ranks the branch by it", async () => {
    const user = userEvent.setup();
    mountTree();
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    await user.type(screen.getByPlaceholderText("Search Business Capability"), "scor");

    // Asserted synchronously: the whole type is in memory, so filtering runs on
    // the raw input. Keying it off the debounced value would leave the full
    // list on screen for another 300ms and fail here.
    const names = rowNames();
    expect(names).not.toContain("Finance");
    // The match plus its whole parent chain — never orphaned.
    expect(names).toContain("Lead Scoring");
    expect(names).toContain("Lead Management");
    expect(names).toContain("Sales");
    // "Scorecard Tools" starts with the term; "Sales" matches nothing itself
    // and is ranked only through "Lead Scoring" two levels down.
    expect(names.indexOf("Scorecard Tools")).toBeLessThan(names.indexOf("Sales"));
  });

  it("falls back to the flat, server-searched list past the page budget", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: CAPS,
      total: 999_999,
      page: 1,
      page_size: 1000,
    } as never);
    const user = userEvent.setup();
    mountTree();

    await screen.findByText(/Too many cards to show the hierarchy/i);

    await user.type(screen.getByPlaceholderText("Search Business Capability"), "Scoring");
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some((c) => String(c[0]).includes("search="))).toBe(
        true,
      ),
    );
  });

  it("shows the card itself as an inert row on a self-referential relation", async () => {
    mountTree({ fsId: "leads", cardTypeKey: "BusinessCapability", relationType: rtSelf });
    await waitFor(() => expect(rowNames().length).toBe(CAPS.length));

    const self = rowFor("Lead Management");
    expect(self).toHaveAttribute("aria-disabled", "true");
    expect(self.textContent).toContain("this card");
    // Its children are still offered — only the card itself is out.
    expect(rowFor("Lead Scoring")).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("AddRelationsDialog side (self-referencing relation types)", () => {
  // Organization → Organization "has site" / "is site of": the reported bug.
  // "Am I the source" cannot be read off the type here — it is true at both
  // ends — so the group that opened the dialog says which side it serves.
  const orgToOrg = {
    key: "orgToOrg",
    label: "has site",
    reverse_label: "is site of",
    source_type_key: "Organization",
    target_type_key: "Organization",
    cardinality: "n:m",
    attributes_schema: [],
  } as unknown as RelationType;
  const ORG = "org-hq";

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockResolvedValue({
      items: [{ id: "org-site", name: "INCHN", type: "Organization" }],
      total: 1,
      page: 1,
      page_size: 50,
    } as never);
    vi.mocked(api.post).mockImplementation(
      async (_url: string, body: unknown) => ({ id: "rel-new", ...(body as object) }) as never,
    );
  });

  it("puts the card on the TARGET side when opened from the incoming group", async () => {
    mountDialog({
      fsId: ORG,
      cardTypeKey: "Organization",
      relationType: orgToOrg,
      isSource: false,
    });
    const dialog = await screen.findByRole("dialog");
    // The title carries the side's verb, not the forward one.
    expect(within(dialog).getByText(/is site of/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/· has site/)).not.toBeInTheDocument();

    await userEvent.click(await within(dialog).findByText("INCHN"));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = vi.mocked(api.post).mock.calls[0][1] as { source_id: string; target_id: string };
    expect(body.source_id).toBe("org-site");
    expect(body.target_id).toBe(ORG);
  });

  it("still offers a card linked only the OTHER way round", async () => {
    // "INCHN has site HQ" exists; the "HQ has site …" group is a different
    // edge, so INCHN is pickable there and the linked-count hint stays quiet.
    const incoming: Relation = {
      id: "r-in",
      type: "orgToOrg",
      source_id: "org-site",
      target_id: ORG,
      source: { id: "org-site", type: "Organization", name: "INCHN" },
      target: { id: ORG, type: "Organization", name: "HQ" },
    };
    mountDialog({
      fsId: ORG,
      cardTypeKey: "Organization",
      relationType: orgToOrg,
      isSource: true,
      relations: [incoming],
    });
    const dialog = await screen.findByRole("dialog");
    const row = (await within(dialog).findByText("INCHN")).closest('[role="button"]');
    expect(row).not.toHaveAttribute("aria-disabled", "true");
    // Neither the caption nor a greyed row: nothing on this side is linked.
    expect(within(dialog).queryAllByText(/already linked/i)).toHaveLength(0);
  });

  it("hides a card already linked on THIS side", async () => {
    const outgoing: Relation = {
      id: "r-out",
      type: "orgToOrg",
      source_id: ORG,
      target_id: "org-site",
      source: { id: ORG, type: "Organization", name: "HQ" },
      target: { id: "org-site", type: "Organization", name: "INCHN" },
    };
    mountDialog({
      fsId: ORG,
      cardTypeKey: "Organization",
      relationType: orgToOrg,
      isSource: true,
      relations: [outgoing],
    });
    const dialog = await screen.findByRole("dialog");
    // The caption above the list and the greyed row both say so.
    await waitFor(() =>
      expect(within(dialog).getAllByText(/already linked/i).length).toBeGreaterThan(0),
    );
  });
});
