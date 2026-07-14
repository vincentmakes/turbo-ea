import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ColDef } from "ag-grid-community";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({}), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/hooks/useThemeMode", () => ({
  useThemeMode: () => ({ mode: "light" }),
}));

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (v: string | null) => v ?? "" }),
}));

vi.mock("@/hooks/useIsRtl", () => ({
  useIsRtl: () => false,
}));

// AG Grid is complex in jsdom — capture the props AdrGrid feeds it instead.
let capturedColumnDefs: ColDef[] = [];
let capturedDefaultColDef: ColDef | undefined;
let capturedRowSelection: Record<string, unknown> | undefined;
vi.mock("ag-grid-react", () => ({
  AgGridReact: vi.fn(
    (props: {
      columnDefs: ColDef[];
      defaultColDef?: ColDef;
      rowSelection?: Record<string, unknown>;
    }) => {
      capturedColumnDefs = props.columnDefs;
      capturedDefaultColDef = props.defaultColDef;
      capturedRowSelection = props.rowSelection;
      return <div data-testid="ag-grid" />;
    },
  ),
}));

// Stub CSS imports
vi.mock("ag-grid-community/styles/ag-grid.css", () => ({}));
vi.mock("ag-grid-community/styles/ag-theme-quartz.css", () => ({}));

import AdrGrid from "./AdrGrid";
import { compareDateFilter } from "@/lib/dateColumnFilter";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { ArchitectureDecision } from "@/types";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ADR: ArchitectureDecision = {
  id: "adr-1",
  reference_number: "ADR-001",
  title: "Adopt the thing",
  status: "draft",
  context: null,
  decision: null,
  consequences: null,
  alternatives_considered: null,
  related_decisions: [],
  attributes: { "ext.vs.savings": { total: 125000 } },
  created_by: null,
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  linked_cards: [],
  created_at: null,
  updated_at: null,
};

function renderGrid(hiddenColumns: Set<string> = new Set()) {
  return render(
    <MemoryRouter>
      <AdrGrid
        adrs={[ADR]}
        metamodelTypes={[]}
        loading={false}
        onEdit={vi.fn()}
        onPreview={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        quickFilterText=""
        onQuickFilterChange={vi.fn()}
        hiddenColumns={hiddenColumns}
      />
    </MemoryRouter>,
  );
}

describe("AdrGrid extension columns (UI SDK 1.10)", () => {
  beforeEach(() => {
    resetExtensionHost();
    capturedColumnDefs = [];
  });

  it("renders no extension column when none is registered", () => {
    renderGrid();
    expect(capturedColumnDefs.some((c) => c.colId?.startsWith("ext-"))).toBe(false);
  });

  it("appends a native ColDef built from a registered contribution", () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [
        {
          id: "savings",
          label: "Savings",
          align: "right",
          value: (adr) => {
            const block = adr.attributes?.["ext.vs.savings"] as { total: number } | undefined;
            return block ? `€${block.total}` : null;
          },
          sortValue: (adr) =>
            (adr.attributes?.["ext.vs.savings"] as { total: number } | undefined)?.total ?? null,
        },
      ],
    });
    renderGrid();

    const col = capturedColumnDefs.find((c) => c.colId === "ext-vs-savings");
    expect(col).toBeDefined();
    expect(col?.headerName).toBe("Savings");
    expect(col?.type).toBe("rightAligned");
    // The ColDef is plain data + guarded callbacks — exercise them the way
    // AG Grid would: valueGetter drives sorting, valueFormatter the cell text.
    const getter = col?.valueGetter as (p: { data?: ArchitectureDecision }) => unknown;
    const formatter = col?.valueFormatter as (p: { data?: ArchitectureDecision }) => string;
    expect(getter({ data: ADR })).toBe(125000);
    expect(formatter({ data: ADR })).toBe("€125000");
    expect(getter({ data: undefined })).toBeNull();
    expect(formatter({ data: undefined })).toBe("");
  });

  it("applies width/minWidth hints, falling back to the defaults when omitted", () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [
        { id: "wide", label: "Wide", width: 220, minWidth: 180, value: () => "x" },
        { id: "plain", label: "Plain", value: () => "y" },
      ],
    });
    renderGrid();
    const wide = capturedColumnDefs.find((c) => c.colId === "ext-vs-wide");
    expect(wide?.width).toBe(220);
    expect(wide?.minWidth).toBe(180);
    const plain = capturedColumnDefs.find((c) => c.colId === "ext-vs-plain");
    expect(plain?.width).toBe(150);
    expect(plain?.minWidth).toBe(120);
  });

  it("a throwing value() degrades to an empty cell, never a crash", () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [
        {
          id: "boom",
          label: "Boom",
          value: () => {
            throw new Error("kaboom");
          },
        },
      ],
    });
    renderGrid();

    const col = capturedColumnDefs.find((c) => c.colId === "ext-vs-boom");
    expect(col).toBeDefined();
    const getter = col?.valueGetter as (p: { data?: ArchitectureDecision }) => unknown;
    const formatter = col?.valueFormatter as (p: { data?: ArchitectureDecision }) => string;
    expect(formatter({ data: ADR })).toBe("");
    expect(getter({ data: ADR })).toBeNull();
  });

  it("filters on the display text, not the numeric sort value", () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [
        {
          id: "savings",
          label: "Savings",
          value: (adr) => {
            const block = adr.attributes?.["ext.vs.savings"] as { total: number } | undefined;
            return block ? `€${block.total}` : null;
          },
          sortValue: (adr) =>
            (adr.attributes?.["ext.vs.savings"] as { total: number } | undefined)?.total ?? null,
        },
      ],
    });
    renderGrid();

    const col = capturedColumnDefs.find((c) => c.colId === "ext-vs-savings");
    const filterGetter = col?.filterValueGetter as (p: { data?: ArchitectureDecision }) => string;
    expect(filterGetter({ data: ADR })).toBe("€125000");
  });
});

describe("AdrGrid per-column filters", () => {
  beforeEach(() => {
    resetExtensionHost();
    localStorage.clear();
    capturedColumnDefs = [];
    capturedDefaultColDef = undefined;
  });

  it("enables the text filter with a per-filter Reset button by default", () => {
    renderGrid();
    expect(capturedDefaultColDef?.filter).toBe(true);
    expect(
      (capturedDefaultColDef?.filterParams as { buttons: string[] }).buttons,
    ).toContain("reset");
  });

  it("configures multi-row selection via the AG Grid v32 object API", () => {
    renderGrid();
    // The checkbox selection column is auto-generated by AG Grid v32 from the
    // rowSelection object — there is no hand-rolled "__select" colDef anymore.
    expect(capturedColumnDefs.find((c) => c.colId === "__select")).toBeUndefined();
    expect(capturedRowSelection).toMatchObject({
      mode: "multiRow",
      headerCheckbox: true,
      selectAll: "filtered",
      enableClickSelection: false,
    });
  });

  it("uses the date filter with the day-granularity comparator on date columns", () => {
    renderGrid();
    for (const colId of ["created", "lastModified", "signed"]) {
      const col = capturedColumnDefs.find((c) => c.colId === colId);
      expect(col?.filter).toBe("agDateColumnFilter");
      expect(
        (col?.filterParams as { comparator: unknown; buttons: string[] }).comparator,
      ).toBe(compareDateFilter);
      expect(
        (col?.filterParams as { comparator: unknown; buttons: string[] }).buttons,
      ).toContain("reset");
    }
  });

  it("filters the decision column on plain text, not raw HTML", () => {
    renderGrid();
    const col = capturedColumnDefs.find((c) => c.colId === "decision");
    const filterGetter = col?.filterValueGetter as (p: { data?: ArchitectureDecision }) => string;
    expect(
      filterGetter({ data: { ...ADR, decision: "<p>Use <b>PostgreSQL</b></p>" } }),
    ).toBe("Use PostgreSQL");
  });
});

describe("AdrGrid column visibility", () => {
  beforeEach(() => {
    resetExtensionHost();
    localStorage.clear();
    capturedColumnDefs = [];
  });

  it("shows a real Status column by default with a translated value", () => {
    renderGrid();
    const col = capturedColumnDefs.find((c) => c.colId === "status");
    expect(col).toBeDefined();
    expect(col?.hide).toBeFalsy();
    const getter = col?.valueGetter as (p: { data?: ArchitectureDecision }) => string;
    expect(getter({ data: { ...ADR, status: "in_review" } })).toBe("In Review");
  });

  it("hides columns listed in hiddenColumns, but never locked ones", () => {
    renderGrid(new Set(["decision", "reference", "title"]));
    const decision = capturedColumnDefs.find((c) => c.colId === "decision");
    expect(decision?.hide).toBe(true);
    // reference/title are locked — the colDefs never receive hide.
    const reference = capturedColumnDefs.find((c) => c.colId === "reference");
    const title = capturedColumnDefs.find((c) => c.colId === "title");
    expect(reference?.hide).toBeFalsy();
    expect(title?.hide).toBeFalsy();
  });

  it("hides extension columns via their colId", () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrGridColumns: [{ id: "savings", label: "Savings", value: () => null }],
    });
    renderGrid(new Set(["ext-vs-savings"]));
    const col = capturedColumnDefs.find((c) => c.colId === "ext-vs-savings");
    expect(col?.hide).toBe(true);
  });
});

describe("AdrGrid signed-by column", () => {
  beforeEach(() => {
    resetExtensionHost();
    localStorage.clear();
    capturedColumnDefs = [];
  });

  it("uses autoHeight so signer chips wrap instead of clipping", () => {
    renderGrid();
    const col = capturedColumnDefs.find((c) => c.colId === "signedBy");
    expect(col?.autoHeight).toBe(true);
  });
});
