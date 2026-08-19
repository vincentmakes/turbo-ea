/**
 * The Inventory page's half of the drag-fill contract: which columns offer a
 * handle, and what the fill actually writes.
 *
 * The gesture itself is covered against a real grid in
 * `components/grid/useDragFill.integration.test.tsx`. Here the hook is stubbed
 * so the page's `onFill` can be invoked directly — the request shape is a
 * stable seam, and driving a pointer drag through the page's own stubbed grid
 * would test the stub, not the writes.
 *
 * AG Grid itself is stubbed too, so **there is no grid DOM to assert on here**
 * — add a case that needs one to `useDragFill.integration.test.tsx` instead.
 * That is not just tidiness: `handleGridFill` fires `loadData()` without
 * awaiting it (one reload per fill, by design), so every test below ends with
 * a re-render in flight. React's scheduler runs on Node's `setImmediate`,
 * which jsdom's teardown does not cancel — so with a real grid mounted, a
 * continuation could commit after `window` was deleted and reach AG Grid's
 * `dispatchAsync`, throwing `ReferenceError: window is not defined` as an
 * unhandled error and failing CI with every test passing. With no grid there
 * is no `RowRenderer`, so that cannot happen rather than merely being
 * unlikely. `InventoryPage.test.tsx` stubs AG Grid for the same reason.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type {
  FillOutcome,
  FillRequest,
  UseDragFillOptions,
} from "@/components/grid/useDragFill";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("./InventoryFilterSidebar", async () => {
  const actual =
    await vi.importActual<typeof import("./InventoryFilterSidebar")>("./InventoryFilterSidebar");
  return { ...actual, default: () => <div data-testid="filter-sidebar" /> };
});
vi.mock("@/components/CreateCardDialog", () => ({ default: () => null }));
vi.mock("./ImportDialog", () => ({ default: () => null }));
vi.mock("./RelationCellPopover", () => ({ default: () => null }));
// Nothing here reads grid DOM or the grid api — see the header. `AgGridReact`
// is the page's only value import from this module (the rest are types), and
// every `gridRef.current?.api` call site is optional-chained, so the page
// mounts fine without it.
vi.mock("ag-grid-react", () => ({
  AgGridReact: () => <div data-testid="ag-grid" />,
}));

// Capture the options the page hands the hook so `onFill` can be driven
// directly; render nothing.
let dragFillOptions: UseDragFillOptions<never> | null = null;
vi.mock("@/components/grid/useDragFill", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/grid/useDragFill")>(
      "@/components/grid/useDragFill",
    );
  return {
    ...actual,
    useDragFill: (_ref: unknown, options: UseDragFillOptions<never>) => {
      dragFillOptions = options;
      return { gridProps: {}, sx: {}, overlay: null, dialog: null };
    },
  };
});

import InventoryPage, { isInventoryFillable, currentFieldValue } from "./InventoryPage";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";
import type { Card } from "@/types";

const TYPES = [
  {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    has_hierarchy: true,
    subtypes: [],
    fields_schema: [
      {
        section: "General",
        fields: [
          { key: "owner", label: "Owner", type: "text" },
          { key: "computed", label: "Computed", type: "text", readonly: true },
        ],
      },
    ],
    is_hidden: false,
  },
];

/**
 * Two cards carrying *different* pre-existing attributes. Filling `owner` must
 * leave each card's other attributes alone — the regression that a
 * `PATCH /cards/bulk` implementation would silently cause, because that
 * endpoint replaces the whole `attributes` blob per card.
 */
const CARD_A = {
  id: "c1",
  name: "SAP ERP",
  type: "Application",
  status: "ACTIVE",
  approval_status: "APPROVED",
  data_quality: 85,
  lifecycle: {},
  attributes: { owner: "old-a", criticality: "high" },
  tags: [],
} as unknown as Card;

const CARD_B = {
  id: "c2",
  name: "Salesforce",
  type: "Application",
  status: "ACTIVE",
  approval_status: "APPROVED",
  data_quality: 70,
  lifecycle: {},
  attributes: { owner: "old-b", costTotalAnnual: 1200 },
  tags: [],
} as unknown as Card;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  dragFillOptions = null;
  vi.mocked(useMetamodel).mockReturnValue({
    types: TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: "u1",
      email: "a@b.c",
      display_name: "A",
      role: "admin",
      permissions: { "*": true },
    },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/cards"))
      return Promise.resolve({
        items: [CARD_A, CARD_B],
        total: 2,
        page: 1,
        page_size: 500,
      });
    return Promise.resolve([]);
  });
  vi.mocked(api.patch).mockResolvedValue({});
  vi.mocked(api.post).mockResolvedValue({ failed: 0 });
  vi.mocked(api.delete).mockResolvedValue({});
});

/** Mount the page and hand back the `onFill` it registered. */
async function mountAndGetFill() {
  render(
    <MemoryRouter>
      <InventoryPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(dragFillOptions).not.toBeNull());
  return dragFillOptions!.onFill as unknown as (
    request: FillRequest<Card & { __group?: unknown }>,
    onProgress: (done: number, total: number) => void,
  ) => Promise<FillOutcome>;
}

function requestFor(
  field: string,
  value: unknown,
  targets: Card[],
): FillRequest<Card & { __group?: unknown }> {
  return {
    colId: field.startsWith("attr_") ? field : `core_${field}`,
    field,
    value,
    displayValue: String(value ?? ""),
    columnLabel: field,
    source: { rowId: "src", data: CARD_A as Card & { __group?: unknown } },
    targets: targets.map((card) => ({
      rowId: card.id,
      data: card as Card & { __group?: unknown },
    })),
  };
}

/** Every path the fill takes must PATCH per card, never the bulk endpoint. */
function bulkCalls() {
  return vi.mocked(api.patch).mock.calls.filter(([path]) => String(path).includes("/cards/bulk"));
}

// ---------------------------------------------------------------------------
// Which columns are fillable
// ---------------------------------------------------------------------------

describe("isInventoryFillable", () => {
  it("excludes the Name column", () => {
    expect(isInventoryFillable("core_name", { field: "name" })).toBe(false);
  });

  it("excludes relation columns and AG Grid's own columns", () => {
    expect(isInventoryFillable("rel_relAppToInterface", { field: undefined })).toBe(false);
    expect(isInventoryFillable("ag-Grid-SelectionColumn", { field: undefined })).toBe(false);
  });

  it("excludes columns with nothing to persist through", () => {
    expect(isInventoryFillable("core_path", {})).toBe(false);
  });

  it("includes description, subtype, parent, tags, attributes and stakeholders", () => {
    expect(isInventoryFillable("core_description", { field: "description" })).toBe(true);
    expect(isInventoryFillable("core_subtype", { field: "subtype" })).toBe(true);
    expect(isInventoryFillable("core_parent", { field: "parent_id" })).toBe(true);
    expect(isInventoryFillable("core_tags", { field: "tags" })).toBe(true);
    expect(isInventoryFillable("attr_owner", { field: "attr_owner" })).toBe(true);
    expect(isInventoryFillable("stakeholder_owner", { field: "stakeholder_owner" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// currentFieldValue
// ---------------------------------------------------------------------------

describe("currentFieldValue", () => {
  it("reads a target's own attribute rather than the source's", () => {
    expect(currentFieldValue(CARD_B, "attr_owner")).toBe("old-b");
  });

  it("scopes stakeholders to the column's role", () => {
    const card = {
      ...CARD_A,
      stakeholders: [
        { user_id: "u1", role: "owner" },
        { user_id: "u2", role: "architect" },
      ],
    } as unknown as Card;
    expect(currentFieldValue(card, "stakeholder_owner")).toEqual([
      { user_id: "u1", role: "owner" },
    ]);
  });

  it("normalises a missing parent to null", () => {
    expect(currentFieldValue(CARD_A, "parent_id")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The fill executor
// ---------------------------------------------------------------------------

describe("handleGridFill", () => {
  it("PATCHes each card individually, merging onto its OWN attributes", async () => {
    const onFill = await mountAndGetFill();
    vi.mocked(api.get).mockClear();

    const outcome = await onFill(requestFor("attr_owner", "new", [CARD_A, CARD_B]), () => {});

    expect(outcome).toEqual({ succeeded: 2, failures: [] });
    // Never the bulk endpoint: it replaces `attributes` wholesale per card.
    expect(bulkCalls()).toHaveLength(0);
    expect(api.patch).toHaveBeenCalledWith("/cards/c1", {
      attributes: { owner: "new", criticality: "high" },
    });
    expect(api.patch).toHaveBeenCalledWith("/cards/c2", {
      attributes: { owner: "new", costTotalAnnual: 1200 },
    });
  });

  it("reloads once for the whole fill, not once per row", async () => {
    const onFill = await mountAndGetFill();
    vi.mocked(api.get).mockClear();

    await onFill(requestFor("attr_owner", "new", [CARD_A, CARD_B, CARD_A]), () => {});

    const reloads = vi.mocked(api.get).mock.calls.filter(([path]) =>
      String(path).startsWith("/cards?"),
    );
    expect(reloads).toHaveLength(1);
  });

  it("reports per-row failures without aborting the rest", async () => {
    const onFill = await mountAndGetFill();
    vi.mocked(api.patch).mockImplementation((path: string) =>
      path === "/cards/c2"
        ? Promise.reject(new Error("Name already taken"))
        : Promise.resolve({}),
    );

    const outcome = await onFill(requestFor("attr_owner", "new", [CARD_A, CARD_B]), () => {});

    expect(outcome.succeeded).toBe(1);
    expect(outcome.failures).toEqual([
      {
        rowId: "c2",
        label: "Salesforce",
        href: "/cards/c2",
        message: "Name already taken",
      },
    ]);
  });

  it("reports progress up to the target count", async () => {
    const onFill = await mountAndGetFill();
    const seen: number[] = [];
    await onFill(requestFor("attr_owner", "new", [CARD_A, CARD_B]), (done) => seen.push(done));
    expect(seen).toEqual([1, 2]);
  });

  it("gives each filled row its own copy of a multi-value payload", async () => {
    const onFill = await mountAndGetFill();
    await onFill(requestFor("attr_owner", ["a", "b"], [CARD_A, CARD_B]), () => {});

    const payloads = vi
      .mocked(api.patch)
      .mock.calls.filter(([path]) => String(path).startsWith("/cards/c"))
      .map(([, body]) => (body as { attributes: Record<string, unknown> }).attributes.owner);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual(["a", "b"]);
    // Two rows must never share an array: the value setters mutate in place.
    expect(payloads[0]).not.toBe(payloads[1]);
  });

  it("diffs tags against each target's own set, not the source's", async () => {
    const onFill = await mountAndGetFill();
    const already = { ...CARD_A, tags: [{ id: "t1", name: "Core" }] } as unknown as Card;
    const without = { ...CARD_B, tags: [] } as unknown as Card;

    await onFill(requestFor("tags", [{ id: "t1", name: "Core" }], [already, without]), () => {});

    // The card that already carries the tag issues nothing.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/cards/c2/tags", ["t1"]);
  });

  it("writes a subtype fill through, which the inline editor used to drop", async () => {
    const onFill = await mountAndGetFill();
    await onFill(requestFor("subtype", "microservice", [CARD_B]), () => {});
    expect(api.patch).toHaveBeenCalledWith("/cards/c2", { subtype: "microservice" });
  });

  it("skips group header rows", async () => {
    const onFill = await mountAndGetFill();
    const request = requestFor("attr_owner", "new", [CARD_A, CARD_B]);
    request.targets[1].data = {
      ...CARD_B,
      __group: { key: "g", count: 2 },
    } as unknown as Card & { __group?: unknown };

    const outcome = await onFill(request, () => {});

    expect(outcome.succeeded).toBe(1);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith("/cards/c1", expect.anything());
  });

  it("does nothing for a column with no field to write", async () => {
    const onFill = await mountAndGetFill();
    const request = requestFor("attr_owner", "new", [CARD_A]);
    request.field = undefined;
    expect(await onFill(request, () => {})).toEqual({ succeeded: 0, failures: [] });
    expect(api.patch).not.toHaveBeenCalled();
  });
});
