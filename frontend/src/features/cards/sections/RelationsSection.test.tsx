/**
 * Tests for the Relations section's add + ordering behaviour (discussion #918).
 *
 * Three things are worth guarding, because each was a reported friction:
 *  - related cards render alphabetically, whatever order the API returned;
 *  - the picker never offers a card that is already linked (picking one was a
 *    silent no-op);
 *  - the picker stays open so several relations can be added in a row, and
 *    that batch costs one reconcile fetch, not one per add.
 *
 * Plus, since several relation types may share one card-type pair: the groups
 * for one pair render next to each other, and a card reached through more than
 * one of them says so on every one of its rows.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// These components read the signed-in user to apply per-card-type create
// permissions (discussion #1068). They render deep in the tree, always inside
// an AuthProvider in the app; the tests mount them directly, so the context is
// stubbed with an admin (whose wildcard grants every type).
vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({
    user: { id: "u1", email: "a@test.com", display_name: "Admin", permissions: { "*": true } },
    refreshUser: vi.fn(),
  }),
}));

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

/** Mutable so a test can put a second relation type on the same pair. */
const mm = vi.hoisted(() => ({ relationTypes: [] as Record<string, unknown>[] }));

const ORG_TYPE = { key: "Organization", label: "Organization", color: "#2889ff", subtypes: [] };
const OBJ_TYPE = { key: "Objective", label: "Objective", color: "#c7527d", subtypes: [] };
const APP_TYPE = { key: "Application", label: "Application", color: "#0f7eb5", subtypes: [] };

const appToOrg = {
  key: "appToOrg",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
  source_visible: true,
  target_visible: true,
  source_mandatory: false,
  target_mandatory: false,
  cardinality: "n:m",
  attributes_schema: [],
};

/** Same shape as `appToOrg`, differing only in key + verbs. */
function relType(key: string, label: string, targetTypeKey = "Organization") {
  return { ...appToOrg, key, label, reverse_label: `reverse ${label}`, target_type_key: targetTypeKey };
}

const appToOrgOwns = relType("appToOrgOwns", "owns");
const appToObj = relType("appToObj", "supports", "Objective");

/** The reported case: Organization → Organization, "has site" / "is site of". */
const orgToOrg = {
  ...appToOrg,
  key: "orgToOrg",
  label: "has site",
  reverse_label: "is site of",
  source_type_key: "Organization",
  target_type_key: "Organization",
};

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Organization"
        ? ORG_TYPE
        : key === "Application"
          ? APP_TYPE
          : key === "Objective"
            ? OBJ_TYPE
            : undefined,
    types: [APP_TYPE, ORG_TYPE, OBJ_TYPE],
    relationTypes: mm.relationTypes,
  }),
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

beforeEach(() => {
  mm.relationTypes = [appToOrg];
});

import { api } from "@/api/client";
import type { Relation } from "@/types";
import RelationsSection from "./RelationsSection";

const FS = "app-1";

function relation(id: string, name: string, type = "appToOrg", orgId = `org-${id}`): Relation {
  return {
    id,
    type,
    source_id: FS,
    target_id: orgId,
    source: { id: FS, type: "Application", name: "NexaCore ERP" },
    target: { id: orgId, type: "Organization", name },
  };
}

/** `GET /cards` page payload for the picker. */
function cardsPage(items: { id: string; name: string }[]) {
  return {
    items: items.map((c) => ({ ...c, type: "Organization" })),
    total: items.length,
    page: 1,
    page_size: 50,
  };
}

/**
 * Wire `api.get` so `/relations` serves the given rows and `/cards` serves the
 * picker catalogue. Returns a counter of the `/relations` fetches so a test can
 * assert how many reconciles a batch of adds cost.
 */
function mockApi(rows: Relation[], catalogue: { id: string; name: string }[]) {
  const state = { relationFetches: 0, rows };
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith("/relations")) {
      state.relationFetches += 1;
      return state.rows as never;
    }
    if (url.startsWith("/cards")) return cardsPage(catalogue) as never;
    return [] as never;
  });
  return state;
}

async function openSection(cardTypeKey = "Application", fsId = FS) {
  render(<RelationsSection fsId={fsId} cardTypeKey={cardTypeKey} initialExpanded />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
}

describe("RelationsSection ordering", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("lists related cards alphabetically whatever order the API returned", async () => {
    mockApi([relation("1", "Public Works"), relation("2", "Finance"), relation("3", "Legal")], []);

    await openSection();

    await waitFor(() => expect(screen.getByText("Finance")).toBeInTheDocument());
    const names = ["Public Works", "Finance", "Legal"];
    const rendered = screen
      .getAllByRole("listitem")
      .map((el) => names.find((n) => el.textContent?.includes(n)))
      .filter((n): n is string => Boolean(n));
    expect(rendered).toEqual(["Finance", "Legal", "Public Works"]);
  });
});

describe("RelationsSection add dialog", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  /** Open the section, then the add dialog from the group's + button. */
  async function openAddDialog() {
    await openSection();
    await userEvent.click(await screen.findByRole("button", { name: /Add Organization/i }));
    return screen.findByRole("dialog");
  }

  it("lists candidates in the dialog body, not in a floating dropdown", async () => {
    // The list must live in normal flow inside the dialog: a popper is what
    // flipped above the field, clipped inside the accordion and repositioned
    // mid-batch, and it is unusable on a phone (#918).
    mockApi(
      [],
      [
        { id: "org-a", name: "Legal" },
        { id: "org-b", name: "Public Works" },
      ],
    );

    const dialog = await openAddDialog();
    await waitFor(() =>
      expect(within(dialog).getByText("Public Works")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // The `+` already says which relation is being added, so the dialog
    // carries no type selector — it was pure clutter at the top.
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    // …and the title names what is being added, since nothing else does.
    expect(within(dialog).getByText(/Add Organization/i)).toBeInTheDocument();
  });

  it("hides already-linked cards and says how many are hidden", async () => {
    mockApi(
      [relation("1", "Finance")],
      [
        { id: "org-1", name: "Finance" },
        { id: "org-9", name: "Parks & Recreation" },
      ],
    );

    const dialog = await openAddDialog();
    await waitFor(() =>
      expect(within(dialog).getByText("Parks & Recreation")).toBeInTheDocument(),
    );
    // Already linked, so not on offer — picking it would have been a no-op.
    expect(within(dialog).queryByText("Finance")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/1 already linked/i)).toBeInTheDocument();
  });

  it("adds several in a row, chipped and undoable, reconciling once on close", async () => {
    const state = mockApi(
      [],
      [
        { id: "org-a", name: "Legal" },
        { id: "org-b", name: "Public Works" },
      ],
    );
    vi.mocked(api.post).mockImplementation(async (_url: string, body: unknown) => {
      const target = (body as { target_id: string }).target_id;
      const name = target === "org-a" ? "Legal" : "Public Works";
      return {
        id: `rel-${target}`,
        type: "appToOrg",
        source_id: FS,
        target_id: target,
        source: { id: FS, type: "Application", name: "NexaCore ERP" },
        target: { id: target, type: "Organization", name },
      } as never;
    });

    const dialog = await openAddDialog();
    const fetchesAfterOpen = state.relationFetches;

    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());
    // The picked card leaves the candidate list and becomes a chip.
    expect(within(dialog).getAllByText("Legal")).toHaveLength(1);

    await userEvent.click(await within(dialog).findByText("Public Works"));
    await waitFor(() => expect(within(dialog).getByText(/2 added/i)).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(2);
    // No refetch per add — the POST response is appended directly.
    expect(state.relationFetches).toBe(fetchesAfterOpen);

    state.rows = [relation("a", "Legal"), relation("b", "Public Works")];
    await userEvent.click(within(dialog).getByRole("button", { name: /Done/i }));
    await waitFor(() => expect(state.relationFetches).toBe(fetchesAfterOpen + 1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("undoes an add from its chip without reloading", async () => {
    const state = mockApi([], [{ id: "org-a", name: "Legal" }]);
    vi.mocked(api.post).mockResolvedValue({
      id: "rel-a",
      type: "appToOrg",
      source_id: FS,
      target_id: "org-a",
      source: { id: FS, type: "Application", name: "NexaCore ERP" },
      target: { id: "org-a", type: "Organization", name: "Legal" },
    } as never);
    vi.mocked(api.delete).mockResolvedValue(undefined as never);

    const dialog = await openAddDialog();
    const fetchesAfterOpen = state.relationFetches;
    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());

    await userEvent.click(dialog.querySelector(".MuiChip-deleteIcon") as Element);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/relations/rel-a"));
    await waitFor(() =>
      expect(within(dialog).queryByText(/1 added/i)).not.toBeInTheDocument(),
    );
    expect(state.relationFetches).toBe(fetchesAfterOpen);
    // Back on offer, so it can be re-added.
    await waitFor(() => expect(within(dialog).getByText("Legal")).toBeInTheDocument());
  });

  it("names a new row from the picked card even if the response omits its refs", async () => {
    // Regression guard for the reported "Unknown" rows: the row must never
    // depend on the create response carrying `source`/`target`, because the
    // card that was picked is already known locally.
    mockApi([], [{ id: "org-a", name: "Legal" }]);
    vi.mocked(api.post).mockResolvedValue({
      id: "rel-a",
      type: "appToOrg",
      source_id: FS,
      target_id: "org-a",
    } as never);

    const dialog = await openAddDialog();
    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());

    // The row lands in the section list behind the dialog, named — not
    // "Unknown". Asserted before Done, since the reconcile fetch on close
    // legitimately replaces the optimistic row with the server's. Queried by
    // text rather than role: an open dialog aria-hides everything behind it.
    await waitFor(() => expect(screen.getAllByText("Legal")).toHaveLength(2));
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });
});

describe("RelationsSection with several relation types on one pair", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("puts the two groups for one card-type pair next to each other", async () => {
    // `sort_order` is flat and knows nothing about pairs, so the metamodel can
    // hand back the two Organization types with an unrelated one between them.
    mm.relationTypes = [appToOrg, appToObj, appToOrgOwns];
    mockApi([], []);

    await openSection();

    await waitFor(() => expect(screen.getByText("owns")).toBeInTheDocument());
    const text = document.body.textContent ?? "";
    expect(text.indexOf("is used by")).toBeLessThan(text.indexOf("owns"));
    expect(text.indexOf("owns")).toBeLessThan(text.indexOf("supports"));
  });

  it("tells each row that the same card is also linked by the other type", async () => {
    mm.relationTypes = [appToOrg, appToOrgOwns];
    // One Organization reached twice, plus one reached once — only the first
    // should carry the caption.
    mockApi(
      [
        relation("1", "Finance", "appToOrg", "org-shared"),
        relation("2", "Finance", "appToOrgOwns", "org-shared"),
        relation("3", "Legal"),
      ],
      [],
    );

    await openSection();

    await waitFor(() => expect(screen.getByText("Legal")).toBeInTheDocument());
    // The verb named is the OTHER type's, once per row, and never its own.
    expect(screen.getByText("Also owns")).toBeInTheDocument();
    expect(screen.getByText("Also is used by")).toBeInTheDocument();
    const legalRow = screen.getAllByRole("listitem").find((el) => el.textContent?.includes("Legal"));
    expect(legalRow?.textContent).not.toContain("Also");
  });
});

describe("RelationsSection with a self-referencing relation type", () => {
  const HQ = "org-hq";
  const orgRef = (id: string, name: string) => ({ id, type: "Organization", name });
  /** HQ → other: HQ "has site" other. */
  const outgoing = (id: string, name: string): Relation => ({
    id,
    type: "orgToOrg",
    source_id: HQ,
    target_id: `org-${id}`,
    source: orgRef(HQ, "Palfinger India Pvt. Ltd"),
    target: orgRef(`org-${id}`, name),
  });
  /** other → HQ: HQ "is site of" other. */
  const incoming = (id: string, name: string): Relation => ({
    id,
    type: "orgToOrg",
    source_id: `org-${id}`,
    target_id: HQ,
    source: orgRef(`org-${id}`, name),
    target: orgRef(HQ, "INCHN"),
  });

  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    mm.relationTypes = [orgToOrg];
  });

  it("heads the group with the REVERSE verb when the card is the target", async () => {
    // The reported bug: "am I the source" was read off the type, which is
    // true at both ends of a self-referencing type — so INCHN's page said
    // "has site Palfinger" instead of "is site of Palfinger".
    mockApi([incoming("1", "Palfinger India Pvt. Ltd")], []);

    await openSection("Organization", HQ);

    await waitFor(() => expect(screen.getByText("Palfinger India Pvt. Ltd")).toBeInTheDocument());
    expect(screen.getByText("is site of")).toBeInTheDocument();
    // The outgoing group is visible too (its side is visible) but holds no row —
    // the row must not be listed under the forward verb.
    const text = document.body.textContent ?? "";
    expect(text.indexOf("is site of")).toBeLessThan(text.indexOf("Palfinger India Pvt. Ltd"));
    expect(text.indexOf("has site")).toBeGreaterThan(-1);
    expect(text.indexOf("Palfinger India Pvt. Ltd")).toBeLessThan(
      text.lastIndexOf("has site") === text.indexOf("has site")
        ? Infinity
        : text.lastIndexOf("has site"),
    );
  });

  it("renders one group per side, adjacent, each with its own rows", async () => {
    mockApi([outgoing("1", "INCHN"), incoming("2", "Palfinger Group")], []);

    await openSection("Organization", HQ);

    await waitFor(() => expect(screen.getByText("INCHN")).toBeInTheDocument());
    const text = document.body.textContent ?? "";
    // has site → INCHN, then is site of → Palfinger Group.
    expect(text.indexOf("has site")).toBeLessThan(text.indexOf("INCHN"));
    expect(text.indexOf("INCHN")).toBeLessThan(text.indexOf("is site of"));
    expect(text.indexOf("is site of")).toBeLessThan(text.indexOf("Palfinger Group"));
    // Each side has its own add button, named by its verb.
    expect(screen.getByRole("button", { name: /Add Organization · has site/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Organization · is site of/ })).toBeInTheDocument();
  });

  it("captions a mutual link with the other side's verb", async () => {
    // HQ has site X AND X has site HQ: same type, both sides.
    const mutual = incoming("2", "INCHN");
    mutual.source_id = "org-1";
    mutual.source = orgRef("org-1", "INCHN");
    mockApi([outgoing("1", "INCHN"), mutual], []);

    await openSection("Organization", HQ);

    await waitFor(() => expect(screen.getAllByText("INCHN")).toHaveLength(2));
    expect(screen.getByText("Also is site of")).toBeInTheDocument();
    expect(screen.getByText("Also has site")).toBeInTheDocument();
  });

  it("offers both verbs in the Add menu when neither side has a group", async () => {
    mm.relationTypes = [{ ...orgToOrg, source_visible: false, target_visible: false }];
    mockApi([], []);

    await openSection("Organization", HQ);

    // The Material Symbol ligature text prefixes the accessible name.
    await userEvent.click(await screen.findByRole("button", { name: /Add Relation/ }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Organization — has site",
      "Organization — is site of",
    ]);
  });
});
