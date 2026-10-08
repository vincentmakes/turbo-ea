/**
 * PortalViewer — the public, account-less portal page — on what the earlier
 * suites left unpinned below the filter bar: what a card tile draws (and what
 * it must not draw), the portal's per-surface toggles taking effect on the
 * tile and the detail dialog separately, the approval and stakeholder colour
 * coding, the pager, and how the detail dialog files fields, stakeholders,
 * tags and grouped relations.
 *
 * Same seams as `PortalViewer.part1.mutation.test.tsx`: `publicGet` is the
 * page's only network, and it answers EXACT paths only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";

vi.mock("@/api/client", () => {
  const boom = () => {
    throw new Error("A portal must never call the authenticated API client");
  };
  return { api: { get: boom, post: boom, patch: boom, put: boom, delete: boom } };
});
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({
    formatDate: (d: string) => d,
    formatDateTime: (d: string) => d,
    dateFormat: "iso",
  }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => {
    throw new Error("A portal must never read the metamodel");
  },
}));

const publicGet = vi.fn();
vi.mock("@/features/web-portals/publicApi", () => ({
  publicGet: (...a: unknown[]) => publicGet(...a),
}));
vi.mock("@/features/web-portals/PortalPpmPortfolio", () => ({
  default: ({ slug }: { slug: string }) => <div data-testid="ppm-board">{slug}</div>,
}));
vi.mock("@/features/web-portals/PortalProcessNavigator", () => ({
  default: ({ slug }: { slug: string }) => <div data-testid="navigator-board">{slug}</div>,
}));
vi.mock("@/components/TagPicker", () => ({
  default: ({ label }: { label?: string }) => <div>tag-picker:{label}</div>,
}));

import PortalViewer from "./PortalViewer";
import type { PortalCard, PortalGate, PublicPortal } from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = "apps";
const NAME = "SAP S/4HANA";

const BOTH = { card: true, detail: true };
const CARD_ONLY = { card: true, detail: false };
const DETAIL_ONLY = { card: false, detail: true };
const NOWHERE = { card: false, detail: false };

const INFO_FIELDS = [
  {
    key: "criticality",
    label: "Criticality",
    type: "single_select",
    options: [{ key: "high", label: "High" }],
  },
  { key: "owner", label: "Owner Contact", type: "text" },
  { key: "nullField", label: "Null Field", type: "text" },
  { key: "missingField", label: "Missing Field", type: "text" },
  { key: "blankField", label: "Blank Field", type: "text" },
];
const OPS_FIELDS = [{ key: "runbook", label: "Runbook", type: "text" }];
const DESC_FIELDS = [
  { key: "progress", label: "Completion", type: "percentage" },
  { key: "descNull", label: "Null Note", type: "text" },
  { key: "descMissing", label: "Missing Note", type: "text" },
  { key: "descBlank", label: "Blank Note", type: "text" },
  { key: "descHidden", label: "Hidden Note", type: "text" },
];

const REL_APP = {
  key: "relAppToApp",
  label: "calls",
  reverse_label: "is called by",
  source_type_key: "Application",
  target_type_key: "Application",
  other_type_key: "Application",
  other_type_label: "Application",
};
const REL_ITC = {
  key: "relAppToITC",
  label: "runs on",
  reverse_label: "runs",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  other_type_key: "ITComponent",
  other_type_label: "IT Component",
};

const TOGGLES: Record<string, { card: boolean; detail: boolean }> = {
  "field:criticality": BOTH,
  "field:owner": BOTH,
  "field:nullField": BOTH,
  "field:missingField": BOTH,
  "field:blankField": BOTH,
  "field:runbook": BOTH,
  "field:progress": DETAIL_ONLY,
  "field:descNull": DETAIL_ONLY,
  "field:descMissing": DETAIL_ONLY,
  "field:descBlank": DETAIL_ONLY,
  "field:descHidden": NOWHERE,
  "rel:relAppToApp": BOTH,
  "rel:relAppToITC": DETAIL_ONLY,
};

const TYPE_INFO = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  subtypes: [{ key: "business", label: "Business Application" }],
  fields_schema: [
    { section: "Application Information", fields: INFO_FIELDS },
    { section: "Operations", fields: OPS_FIELDS },
    { section: "__description", fields: DESC_FIELDS },
  ],
};

/** The portal type colour, as the browser reports it. */
const TYPE_RGB = "rgb(15, 126, 181)";
const GREY_RGB = "rgb(158, 158, 158)";

function portal(
  toggles: Record<string, { card: boolean; detail: boolean }> = {},
  overrides: Partial<PublicPortal> = {},
): PublicPortal {
  return {
    id: "p1",
    name: "Application Landscape",
    slug: SLUG,
    card_type: "Application",
    view: "cards",
    card_config: { toggles: { ...TOGGLES, ...toggles } },
    type_info: TYPE_INFO,
    relation_types: [REL_APP, REL_ITC],
    tag_groups: [],
    ...overrides,
  } as unknown as PublicPortal;
}

function card(overrides: Record<string, unknown> = {}): PortalCard {
  return {
    id: "c1",
    name: NAME,
    type: "Application",
    subtype: "business",
    description: "<p>The ERP.</p>",
    lifecycle: undefined,
    attributes: {
      criticality: "high",
      owner: "Ada",
      nullField: null,
      blankField: "",
      runbook: "",
      descNull: null,
      descBlank: "",
      descHidden: "Secret note",
    },
    approval_status: "APPROVED",
    data_quality: 80,
    tags: [],
    relations: [],
    stakeholders: [],
    updated_at: "2026-09-01",
    logo_updated_at: null,
    ...overrides,
  } as unknown as PortalCard;
}

function rel(id: string, name: string, type = "relAppToApp", direction = "outgoing") {
  return {
    type,
    related_id: id,
    related_name: name,
    related_type: type === "relAppToApp" ? "Application" : "ITComponent",
    direction,
  };
}

const STAKEHOLDERS = [
  { role: "responsible", display_name: "Ada Lovelace" },
  { role: "steward", display_name: "Grace Hopper" },
];

const PUBLIC_GATE: PortalGate = { access_mode: "public", name: "Application Landscape" };

// ---------------------------------------------------------------------------
// The public API, by exact path
// ---------------------------------------------------------------------------

interface Site {
  portal?: unknown;
  cards?: { items: PortalCard[]; total: number };
}

let site: Site = {};

function serve(s: Site) {
  site = s;
}

function handle(path: string): Promise<unknown> {
  const base = `/web-portals/public/${SLUG}`;
  if (path === `${base}/gate`) return Promise.resolve(PUBLIC_GATE);
  if (path === base) return Promise.resolve(site.portal ?? portal());
  if (path.startsWith(`${base}/cards?`)) {
    return Promise.resolve(site.cards ?? { items: [card()], total: 1 });
  }
  if (path.startsWith(`${base}/relation-options?type_key=`)) return Promise.resolve([]);
  return Promise.reject(new Error(`unexpected request ${path}`));
}

/** Serves one page of cards under the given toggles. */
function serveCards(
  items: PortalCard[],
  toggles: Record<string, { card: boolean; detail: boolean }> = {},
  overrides: Partial<PublicPortal> = {},
  total = items.length,
) {
  serve({ portal: portal(toggles, overrides), cards: { items, total } });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function renderLoaded(name = NAME) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[`/portal/${SLUG}`]}>
      <Routes>
        <Route path="/portal/:slug" element={<PortalViewer />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText(name);
  return user;
}

function tileEl(name = NAME): HTMLElement {
  return screen.getByText(name).closest(".MuiCard-root") as HTMLElement;
}

function tileOf(name = NAME) {
  return within(tileEl(name));
}

/** Opens a card's detail dialog from its tile. */
async function openDetail(user: ReturnType<typeof userEvent.setup>, name = NAME) {
  await user.click(screen.getByText(name));
  return within(await screen.findByRole("dialog"));
}

async function closeDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

/**
 * The children of a block that draw nothing — no text and nothing labelled.
 * Every one of them is a stray strip of spacing or a bare divider line on a
 * visitor's screen.
 */
function blankChildren(block: HTMLElement): Element[] {
  return Array.from(block.children).filter(
    (el) => (el.textContent ?? "").trim() === "" && el.querySelector("[aria-label]") === null,
  );
}

/** The blank blocks a tile stacks under its header. */
function blankBlocks(name = NAME): Element[] {
  return blankChildren(tileEl(name).querySelector(".MuiCardContent-root") as HTMLElement);
}

function chipOf(el: HTMLElement): HTMLElement {
  return el.closest(".MuiChip-root") as HTMLElement;
}

function colours(el: HTMLElement) {
  const s = getComputedStyle(el);
  return { bg: s.backgroundColor, fg: s.color };
}

beforeEach(() => {
  site = {};
  publicGet.mockReset();
  publicGet.mockImplementation(handle);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The tile
// ---------------------------------------------------------------------------

describe("PortalViewer tile icon", () => {
  it("shows the type icon on a tile without a logo", async () => {
    serveCards([card()]);
    await renderLoaded();
    expect(tileOf().getByText("apps")).toBeInTheDocument();
  });

  it("shows a generic icon on a tile when the portal carries no type info", async () => {
    serveCards([card({ subtype: undefined })], {}, { type_info: null });
    await renderLoaded();
    expect(tileOf().getByText("description")).toBeInTheDocument();
  });

  it("badges a logo with the type icon", async () => {
    serveCards([card({ logo_updated_at: "2026-09-01T10:00:00" })]);
    await renderLoaded();
    const tile = tileEl();
    expect(tile.querySelector("img[src^='/api/v1/cards/c1/logo']")).not.toBeNull();
    expect(within(tile).getByText("apps")).toBeInTheDocument();
    expect(within(tile).queryByText("description")).toBeNull();
  });

  it("badges a logo with a generic icon when the type has no icon", async () => {
    serveCards([card({ logo_updated_at: "2026-09-01T10:00:00" })], {}, {
      type_info: { ...TYPE_INFO, icon: undefined } as unknown as PublicPortal["type_info"],
    });
    await renderLoaded();
    expect(tileOf().getByText("description")).toBeInTheDocument();
  });
});

describe("PortalViewer tile subtype", () => {
  it("shows a raw subtype when the type lists no subtypes, on the tile and in the dialog", async () => {
    serveCards([card({ subtype: "edge" })], {}, {
      type_info: { ...TYPE_INFO, subtypes: undefined } as unknown as PublicPortal["type_info"],
    });
    const user = await renderLoaded();
    expect(tileOf().getByText("edge")).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(dialog.getByText("edge")).toBeInTheDocument();
  });
});

describe("PortalViewer tile description", () => {
  it("previews the description on the tile by default", async () => {
    serveCards([card()]);
    await renderLoaded();
    expect(tileOf().getByText("The ERP.")).toBeInTheDocument();
  });

  it("leaves the description off a tile when the portal shows it in the dialog only", async () => {
    serveCards([card()], { description: DETAIL_ONLY });
    const user = await renderLoaded();
    expect(tileOf().queryByText("The ERP.")).toBeNull();
    const dialog = await openDetail(user);
    expect(dialog.getByText("The ERP.")).toBeInTheDocument();
  });

  it("previews nothing for a card without a description", async () => {
    serveCards([card({ description: null })]);
    await renderLoaded();
    expect(tileEl().textContent).not.toContain("null");
    expect(blankBlocks()).toEqual([]);
  });
});

describe("PortalViewer tile fields", () => {
  it("lists only the fields that carry a value", async () => {
    serveCards([card()]);
    await renderLoaded();
    const tile = tileOf();
    expect(tile.getByText("Criticality")).toBeInTheDocument();
    expect(tile.getByText("High")).toBeInTheDocument();
    expect(tile.getByText("Owner Contact")).toBeInTheDocument();
    expect(tile.getByText("Ada")).toBeInTheDocument();
    // null, absent and "" are all "nothing to show".
    expect(tile.queryByText("Null Field")).toBeNull();
    expect(tile.queryByText("Missing Field")).toBeNull();
    expect(tile.queryByText("Blank Field")).toBeNull();
    expect(tile.queryByText("—")).toBeNull();
  });

  it("copes with a card that carries no attributes at all", async () => {
    serveCards([card({ attributes: undefined })]);
    const user = await renderLoaded();
    expect(tileOf().queryByText("Criticality")).toBeNull();
    const dialog = await openDetail(user);
    expect(dialog.getByText("The ERP.")).toBeInTheDocument();
    expect(dialog.queryByText("Criticality")).toBeNull();
    expect(dialog.queryByText("Completion")).toBeNull();
  });
});

describe("PortalViewer tile lifecycle", () => {
  it("leaves the lifecycle off a tile when the portal hides it there", async () => {
    serveCards(
      [
        card({ lifecycle: { plan: "2020-01-01", active: "2021-01-01" } }),
        card({ id: "c2", name: "CRM", lifecycle: { plan: "2020-01-01" } }),
      ],
      { lifecycle: DETAIL_ONLY },
    );
    await renderLoaded();
    expect(tileEl().querySelector("[aria-label^='Plan']")).toBeNull();
    expect(tileEl("CRM").querySelector("[aria-label^='Plan']")).toBeNull();
  });
});

describe("PortalViewer tile approval status", () => {
  const cards = [
    card({ id: "c1", name: "Approved App", approval_status: "APPROVED" }),
    card({ id: "c2", name: "Rejected App", approval_status: "REJECTED" }),
    card({ id: "c3", name: "Submitted App", approval_status: "SUBMITTED" }),
    card({ id: "c4", name: "Draft App", approval_status: "DRAFT" }),
  ];

  it("colours each status chip by its verdict, and shows none for a draft", async () => {
    serveCards(cards, { approval_status: BOTH });
    await renderLoaded("Approved App");
    expect(colours(chipOf(tileOf("Approved App").getByText("APPROVED")))).toEqual({
      bg: "rgb(232, 245, 233)",
      fg: "rgb(46, 125, 50)",
    });
    expect(colours(chipOf(tileOf("Rejected App").getByText("REJECTED")))).toEqual({
      bg: "rgb(255, 235, 238)",
      fg: "rgb(198, 40, 40)",
    });
    expect(colours(chipOf(tileOf("Submitted App").getByText("SUBMITTED")))).toEqual({
      bg: "rgb(255, 243, 224)",
      fg: "rgb(230, 81, 0)",
    });
    expect(tileOf("Draft App").queryByText("DRAFT")).toBeNull();
  });
});

describe("PortalViewer tile tags", () => {
  const TAGS = [
    { id: "t1", name: "Finance", color: "#ff0000" },
    { id: "t2", name: "Core" },
    { id: "t3", name: "Payments" },
    { id: "t4", name: "Legacy" },
  ];

  it("heads the tags and shows all four of four with no overflow chip", async () => {
    serveCards([card({ tags: TAGS })]);
    await renderLoaded();
    const tile = tileOf();
    expect(tile.getByText("Tags")).toBeInTheDocument();
    for (const t of TAGS) expect(tile.getByText(t.name)).toBeInTheDocument();
    expect(tile.queryByText(/^\+/)).toBeNull();
  });

  it("tints a coloured tag with its own colour", async () => {
    serveCards([card({ tags: TAGS })]);
    await renderLoaded();
    const tile = tileOf();
    const red = colours(chipOf(tile.getByText("Finance")));
    expect(red.fg).toBe("rgb(255, 0, 0)");
    expect(red.bg).toMatch(/^rgba\(255, 0, 0, 0\.09/);
    expect(colours(chipOf(tile.getByText("Core"))).bg).toBe("rgba(0, 0, 0, 0.08)");
  });

  it("draws no tag block for a card without tags", async () => {
    serveCards([card({ tags: [] })]);
    await renderLoaded();
    expect(tileOf().queryByText("Tags")).toBeNull();
  });

  it("leaves tags off a tile when the portal shows them in the dialog only", async () => {
    serveCards([card({ tags: TAGS })], { tags: DETAIL_ONLY });
    const user = await renderLoaded();
    expect(tileOf().queryByText("Tags")).toBeNull();
    expect(tileOf().queryByText("Finance")).toBeNull();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Tags")).toBeInTheDocument();
    expect(dialog.getByText("Finance")).toBeInTheDocument();
  });
});

describe("PortalViewer tile relations", () => {
  it("shows all four of four related cards with no overflow chip", async () => {
    serveCards([
      card({
        relations: [
          rel("a1", "CRM"),
          rel("a2", "HR Portal"),
          rel("a3", "Billing"),
          rel("a4", "Payroll"),
        ],
      }),
    ]);
    await renderLoaded();
    const tile = tileOf();
    for (const n of ["CRM", "HR Portal", "Billing", "Payroll"]) {
      expect(tile.getByText(n)).toBeInTheDocument();
    }
    expect(tile.queryByText(/^\+/)).toBeNull();
  });
});

describe("PortalViewer tile footer", () => {
  it("draws no empty strip on a tile with nothing to put under its header", async () => {
    serveCards(
      [
        card({
          description: null,
          relations: [rel("i1", "HANA DB", "relAppToITC")],
          stakeholders: [],
        }),
      ],
      {
        "field:criticality": DETAIL_ONLY,
        "field:owner": DETAIL_ONLY,
        "field:nullField": DETAIL_ONLY,
        "field:missingField": DETAIL_ONLY,
        "field:blankField": DETAIL_ONLY,
        "field:runbook": DETAIL_ONLY,
        subscribers: DETAIL_ONLY,
        data_quality: DETAIL_ONLY,
      },
    );
    await renderLoaded();
    expect(tileOf().queryByText("HANA DB")).toBeNull();
    expect(tileOf().queryByText(/data quality/)).toBeNull();
    expect(blankBlocks()).toEqual([]);
  });

  it("keeps the stakeholders when only the data quality is hidden on the tile", async () => {
    serveCards([card({ stakeholders: STAKEHOLDERS })], { data_quality: DETAIL_ONLY });
    const user = await renderLoaded();
    expect(tileOf().getByText("AL")).toBeInTheDocument();
    expect(tileOf().queryByText("80% data quality")).toBeNull();
    const dialog = await openDetail(user);
    expect(dialog.getByText("80% data quality")).toBeInTheDocument();
  });

  it("keeps the data quality when only the stakeholders are hidden on the tile", async () => {
    serveCards([card({ stakeholders: STAKEHOLDERS })], { subscribers: DETAIL_ONLY });
    const user = await renderLoaded();
    expect(tileOf().getByText("80% data quality")).toBeInTheDocument();
    expect(tileOf().queryByText("AL")).toBeNull();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("names every stakeholder and role in the avatar group's label", async () => {
    serveCards([card({ stakeholders: STAKEHOLDERS })]);
    await renderLoaded();
    expect(
      tileEl().querySelector(
        "[aria-label='Ada Lovelace (Responsible), Grace Hopper (steward)']",
      ),
    ).not.toBeNull();
  });

  it("colours the responsible stakeholder in the type colour and the others grey", async () => {
    serveCards([card({ stakeholders: STAKEHOLDERS })]);
    await renderLoaded();
    expect(colours(tileOf().getByText("AL")).bg).toBe(TYPE_RGB);
    expect(colours(tileOf().getByText("GH")).bg).toBe(GREY_RGB);
  });

  it("copes with a card that carries no stakeholder list", async () => {
    serveCards([card({ stakeholders: undefined })]);
    const user = await renderLoaded();
    expect(tileOf().getByText("80% data quality")).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(dialog.getByText("The ERP.")).toBeInTheDocument();
    expect(dialog.queryByText("Stakeholders")).toBeNull();
  });
});

describe("PortalViewer pager", () => {
  it("offers no pager when everything fits on one page", async () => {
    serveCards([card()], {}, {}, 1);
    await renderLoaded();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("offers a pager once the total spills onto a second page", async () => {
    serveCards([card()], {}, {}, 25);
    await renderLoaded();
    expect(await screen.findByRole("navigation")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The detail dialog
// ---------------------------------------------------------------------------

describe("PortalViewer detail dialog chrome", () => {
  it("closes on Escape", async () => {
    serveCards([card()]);
    const user = await renderLoaded();
    await openDetail(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the type icon beside the title", async () => {
    serveCards([card()]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("apps")).toBeInTheDocument();
    expect(dialog.queryByText("description")).toBeNull();
  });

  it("shows a generic icon beside the title when the portal carries no type info", async () => {
    serveCards([card({ subtype: undefined, description: null })], {}, { type_info: null });
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("description")).toBeInTheDocument();
  });

  it("badges a logo with the type icon", async () => {
    serveCards([card({ logo_updated_at: "2026-09-01T10:00:00" })]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("apps")).toBeInTheDocument();
    expect(dialog.queryByText("description")).toBeNull();
  });

  it("badges a logo with a generic icon when the type has no icon", async () => {
    serveCards([card({ logo_updated_at: "2026-09-01T10:00:00", description: null })], {}, {
      type_info: { ...TYPE_INFO, icon: undefined } as unknown as PublicPortal["type_info"],
    });
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("description")).toBeInTheDocument();
  });

  it("leaves the data-quality chip out of the dialog when the portal hides it there", async () => {
    serveCards([card()], { data_quality: CARD_ONLY });
    const user = await renderLoaded();
    expect(tileOf().getByText("80% data quality")).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(dialog.queryByText("80% data quality")).toBeNull();
  });
});

describe("PortalViewer detail approval status", () => {
  it("leaves the status out of the dialog when the portal shows it on the tile only", async () => {
    serveCards([card()], { approval_status: CARD_ONLY });
    const user = await renderLoaded();
    expect(tileOf().getByText("APPROVED")).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(dialog.queryByText("APPROVED")).toBeNull();
  });

  it("shows no status chip for a draft", async () => {
    serveCards([card({ approval_status: "DRAFT" })]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("80% data quality")).toBeInTheDocument();
    expect(dialog.queryByText("DRAFT")).toBeNull();
  });

  it("colours each status chip by its verdict", async () => {
    serveCards([
      card({ id: "c1", name: "Approved App", approval_status: "APPROVED" }),
      card({ id: "c2", name: "Rejected App", approval_status: "REJECTED" }),
      card({ id: "c3", name: "Submitted App", approval_status: "SUBMITTED" }),
    ]);
    const user = await renderLoaded("Approved App");

    let dialog = await openDetail(user, "Approved App");
    expect(colours(chipOf(dialog.getByText("APPROVED")))).toEqual({
      bg: "rgb(232, 245, 233)",
      fg: "rgb(46, 125, 50)",
    });
    await closeDetail(user);

    dialog = await openDetail(user, "Rejected App");
    expect(colours(chipOf(dialog.getByText("REJECTED")))).toEqual({
      bg: "rgb(255, 235, 238)",
      fg: "rgb(198, 40, 40)",
    });
    await closeDetail(user);

    dialog = await openDetail(user, "Submitted App");
    expect(colours(chipOf(dialog.getByText("SUBMITTED")))).toEqual({
      bg: "rgb(255, 243, 224)",
      fg: "rgb(230, 81, 0)",
    });
  });
});

describe("PortalViewer detail description", () => {
  it("leaves the description text out of the dialog when the portal shows it on the tile only", async () => {
    serveCards([card()], { description: CARD_ONLY });
    const user = await renderLoaded();
    expect(tileOf().getByText("The ERP.")).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(dialog.queryByText("The ERP.")).toBeNull();
    expect(dialog.queryByText("Description")).toBeNull();
  });

  it("still heads the description fields when the card has no description text", async () => {
    serveCards([
      card({ description: null, attributes: { ...card().attributes, progress: 70 } }),
    ]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Description")).toBeInTheDocument();
    expect(dialog.getByText("Completion")).toBeInTheDocument();
    expect(dialog.getByText("70%")).toBeInTheDocument();
  });

  it("folds in only the detail-visible description fields that carry a value", async () => {
    serveCards([card({ attributes: { ...card().attributes, progress: 70 } })]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Completion")).toBeInTheDocument();
    expect(dialog.queryByText("Null Note")).toBeNull();
    expect(dialog.queryByText("Missing Note")).toBeNull();
    expect(dialog.queryByText("Blank Note")).toBeNull();
    // Switched off everywhere, whatever value it carries.
    expect(dialog.queryByText("Hidden Note")).toBeNull();
    expect(dialog.queryByText("Secret note")).toBeNull();
  });

  it("puts nothing under the text when no description field has a value", async () => {
    serveCards([card()]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    const block = dialog.getByText("Description").parentElement as HTMLElement;
    expect(within(block).getByText("The ERP.")).toBeInTheDocument();
    expect(blankChildren(block)).toEqual([]);
  });

  it("drops the whole block when there is neither text nor a valued field", async () => {
    serveCards([card({ description: null })]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Application Information")).toBeInTheDocument();
    expect(dialog.queryByText("Description")).toBeNull();
    expect(dialog.queryByText("Null Note")).toBeNull();
    expect(dialog.queryByText("Missing Note")).toBeNull();
    expect(dialog.queryByText("Blank Note")).toBeNull();
  });
});

describe("PortalViewer detail attributes", () => {
  it("lists only the fields that carry a value, and skips a section with none", async () => {
    serveCards([card()]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Application Information")).toBeInTheDocument();
    expect(dialog.getByText("Owner Contact")).toBeInTheDocument();
    expect(dialog.queryByText("Null Field")).toBeNull();
    expect(dialog.queryByText("Missing Field")).toBeNull();
    expect(dialog.queryByText("Blank Field")).toBeNull();
    expect(dialog.queryByText("—")).toBeNull();
    // Every Operations field is blank, so the section is not headed at all.
    expect(dialog.queryByText("Operations")).toBeNull();
    expect(dialog.queryByText("Runbook")).toBeNull();
  });

  it("copes with type info that has no fields schema", async () => {
    serveCards([card()], {}, {
      type_info: { ...TYPE_INFO, fields_schema: undefined } as unknown as PublicPortal["type_info"],
    });
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("The ERP.")).toBeInTheDocument();
    expect(dialog.getByText("Last updated: 2026-09-01")).toBeInTheDocument();
  });
});

describe("PortalViewer detail stakeholders", () => {
  it("heads the stakeholders and colours the responsible one in the type colour", async () => {
    serveCards([card({ stakeholders: STAKEHOLDERS })]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Stakeholders")).toBeInTheDocument();
    expect(colours(dialog.getByText("AL")).bg).toBe(TYPE_RGB);
    expect(colours(dialog.getByText("GH")).bg).toBe(GREY_RGB);
  });

  it("leaves the stakeholders out of the dialog when the portal shows them on the tile only", async () => {
    serveCards([card({ stakeholders: STAKEHOLDERS })], { subscribers: CARD_ONLY });
    const user = await renderLoaded();
    expect(tileOf().getByText("AL")).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(dialog.queryByText("Stakeholders")).toBeNull();
    expect(dialog.queryByText("Ada Lovelace")).toBeNull();
  });
});

describe("PortalViewer detail tags", () => {
  it("heads the tags", async () => {
    serveCards([card({ tags: [{ id: "t1", name: "Finance" }] })]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Tags")).toBeInTheDocument();
    expect(dialog.getByText("Finance")).toBeInTheDocument();
  });

  it("draws no tag block for a card without tags", async () => {
    serveCards([card({ tags: [] })]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getByText("Application Information")).toBeInTheDocument();
    expect(dialog.queryByText("Tags")).toBeNull();
  });

  it("leaves tags out of the dialog when the portal shows them on the tile only", async () => {
    serveCards([card({ tags: [{ id: "t1", name: "Finance" }] })], { tags: CARD_ONLY });
    const user = await renderLoaded();
    expect(tileOf().getByText("Finance")).toBeInTheDocument();
    const dialog = await openDetail(user);
    expect(dialog.queryByText("Tags")).toBeNull();
    expect(dialog.queryByText("Finance")).toBeNull();
  });
});

describe("PortalViewer detail relations", () => {
  it("lists every related card of one relation type under its verb", async () => {
    const errors = vi.spyOn(console, "error");
    serveCards([
      card({ relations: [rel("a1", "CRM"), rel("a2", "HR Portal"), rel("a3", "Billing")] }),
    ]);
    const user = await renderLoaded();
    const dialog = await openDetail(user);
    expect(dialog.getAllByText("calls")).toHaveLength(1);
    const group = dialog.getByText("calls").parentElement as HTMLElement;
    for (const n of ["CRM", "HR Portal", "Billing"]) {
      expect(within(group).getByText(n)).toBeInTheDocument();
    }
    // Each chip has its own identity, so React never has to guess between them.
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
  });
});
