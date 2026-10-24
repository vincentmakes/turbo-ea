/**
 * Page test for Admin → Settings → Web Portals.
 *
 * The first block is the original process-navigator coverage; the blocks
 * after it walk the portal list's actions, the edit / delete / publish
 * round-trips, the cards-portal display table, SSO domain gating and the
 * PPM board, which is where the page's branches live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import i18n from "@/i18n";
import type { WebPortal } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useBpmEnabled", () => import("@/test/hooks").then((m) => m.useBpmEnabledModule()));
vi.mock("@/hooks/usePpmEnabled", () => import("@/test/hooks").then((m) => m.usePpmEnabledModule()));
// The tag picker is a search-as-you-type Autocomplete with its own tests; here
// it is a button that picks one tag, which is all the page needs from it.
vi.mock("@/components/TagPicker", () => ({
  default: ({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) => (
    <button type="button" data-testid="tag-picker" aria-label={label} onClick={() => onChange([...value, "tag-1"])} />
  ),
}));

import { mockApi } from "@/test/apiMock";
import {
  APPLICATION_TYPE,
  BUSINESS_CAPABILITY_TYPE,
  HOSTING_GROUP,
  RISK_GROUP,
  IT_COMPONENT_TYPE,
  RELATION_TYPES,
  TAG_GROUPS,
  makeCardType,
  makeSubtype,
} from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";

import WebPortalsAdmin from "./WebPortalsAdmin";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;
const tr = (key: string) => i18n.t(`reports:${key}`) as string;

/** A card-list portal's preset with `picks` set, the shape a save sends. */
const cardFilters = (picks: Record<string, unknown> = {}) => ({
  attrFilters: {},
  relationFilters: {},
  relSubtypeFilters: {},
  subtypeFilters: [],
  tagFilterIds: [],
  includeDescendants: false,
  ...picks,
});

/** What `/web-portals/filter-options` offers: one Organization to filter by. */
const FILTER_OPTIONS = {
  relation_types: [
    {
      key: "relOrgToApp",
      label: "owns",
      reverse_label: "is owned by",
      source_type_key: "Organization",
      target_type_key: "Application",
      other_type_key: "Organization",
      attributes_schema: [],
    },
  ],
  groupable_types: { Organization: [{ id: "org-1", name: "Finance Dept", parent_id: null }] },
  tag_groups: TAG_GROUPS,
};

const BUSINESS_PROCESS_TYPE = makeCardType({
  key: "BusinessProcess",
  label: "Business Process",
  icon: "route",
  color: "#028f00",
  category: "Business Architecture",
  subtypes: [makeSubtype({ key: "core", label: "Core" })],
});
const INITIATIVE_TYPE = makeCardType({
  key: "Initiative",
  label: "Initiative",
  icon: "rocket_launch",
  color: "#33cc58",
  category: "Strategy & Transformation",
  subtypes: [makeSubtype({ key: "project", label: "Project" }), makeSubtype({ key: "program", label: "Program" })],
});
const TYPES = [APPLICATION_TYPE, BUSINESS_CAPABILITY_TYPE, IT_COMPONENT_TYPE, BUSINESS_PROCESS_TYPE, INITIATIVE_TYPE];

const CARDS_PORTAL: WebPortal = {
  id: "p1",
  name: "App Catalog",
  slug: "app-catalog",
  description: "Browse apps at https://example.test/more",
  card_type: "Application",
  is_published: true,
  view: "cards",
  access_mode: "sso",
  allowed_email_domains: ["acme.com"],
  filters: { subtypes: ["microservice"], tag_ids: ["tag-9"] },
  card_config: {
    show_logo: false,
    toggles: { description: { card: false, detail: true }, "field:alias": { card: true, detail: false } },
  },
};

const PPM_PORTAL: WebPortal = {
  id: "p2",
  name: "Roadmap",
  slug: "roadmap",
  card_type: "Initiative",
  is_published: false,
  view: "ppm_portfolio",
  access_mode: "public",
  card_config: {
    ppm: {
      show_costs: false,
      show_people: true,
      show_report_narrative: false,
      default_group_by: "BusinessCapability",
      default_subtype: "program",
    },
  },
};

const GROUP_OPTIONS = [
  { type_key: "Organization", type_label: "Organization" },
  { type_key: "BusinessCapability", type_label: "Business Capability" },
];

function scriptLoad(portals: WebPortal[] = [], ssoEnabled = false) {
  mockApi.on("get", "/web-portals", () => portals);
  mockApi.on("get", "/tag-groups", TAG_GROUPS);
  mockApi.on("get", "/reports/ppm/group-options", GROUP_OPTIONS);
  mockApi.on("get", "/auth/sso/config", { enabled: ssoEnabled });
  mockApi.on("get", /^\/web-portals\/filter-options/, FILTER_OPTIONS);
  mockApi.on("post", "/web-portals", { id: "new" });
  mockApi.on("patch", /^\/web-portals\/[^/]+$/, {});
  mockApi.on("delete", /^\/web-portals\/[^/]+$/, {});
}

type User = ReturnType<typeof renderWithProviders>["user"];

/**
 * An option that carries a Material Symbol has the ligature text in front of
 * its label ("apps" + "Application"), so a string option is matched on how
 * the accessible name ends.
 */
const endsWith = (label: string) => new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** Pick an option from a MUI select rendered as a combobox. */
async function selectOption(user: User, labelRe: RegExp | string, option: RegExp | string) {
  await user.click(screen.getByRole("combobox", { name: labelRe }));
  const name = typeof option === "string" ? endsWith(option) : option;
  await user.click(await screen.findByRole("option", { name }));
}

/** Opens the create form from the empty-state call to action. */
async function openNewPortalForm() {
  const result = renderWithProviders(<WebPortalsAdmin />);
  await waitFor(() => expect(mockApi.callsOf("get", "/web-portals")).toHaveLength(1));
  const cta = await screen.findAllByRole("button", { name: /create portal/i });
  await result.user.click(cta[0]);
  await screen.findByRole("combobox", { name: /portal type/i });
  return result;
}

/** The portal list once it has rendered `portals`. */
async function renderList(portals: WebPortal[], ssoEnabled = false) {
  scriptLoad(portals, ssoEnabled);
  const result = renderWithProviders(<WebPortalsAdmin />);
  await screen.findByText(portals[0].name);
  return result;
}

const dialog = () => within(screen.getByRole("dialog"));
const lastBody = (method: "post" | "patch") =>
  mockApi.callsOf(method, /^\/web-portals/).at(-1)!.body as Record<string, unknown>;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  vi.clearAllMocks();
  withMetamodel(TYPES, RELATION_TYPES);
  scriptLoad();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebPortalsAdmin — process navigator portal", () => {
  it("offers the process navigator portal type", async () => {
    const { user } = await openNewPortalForm();
    await user.click(screen.getByRole("combobox", { name: /portal type/i }));
    expect(await screen.findByRole("option", { name: /process navigator/i })).toBeInTheDocument();
  });

  it("disables the option when the BPM module is off", async () => {
    hookState.bpm = { bpmEnabled: false, bpmLoaded: true };
    const { user } = await openNewPortalForm();
    await user.click(screen.getByRole("combobox", { name: /portal type/i }));
    const opt = await screen.findByRole("option", { name: /process navigator/i });
    expect(opt).toHaveAttribute("aria-disabled", "true");
    expect(within(opt).getByText(t("webPortals.portalTypeBpmDisabled"))).toBeInTheDocument();
  });

  it("pins the card type and saves the bpm config block", async () => {
    /*
     * `card_config` collapses to null when there is nothing in it, so the bpm
     * block has to count towards "is there anything to save?" — otherwise the
     * switches silently vanish on save. That is the bug the PPM portal commit
     * called out in a comment; this pins it for the second board.
     */
    const { user } = await openNewPortalForm();

    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "House");
    await selectOption(user, /portal type/i, /process navigator/i);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    const body = lastBody("post");
    expect(body.view).toBe("process_navigator");
    expect(body.card_type).toBe("BusinessProcess");
    expect(body.card_config).toMatchObject({
      bpm: {
        show_element_links: false,
        default_level: 2,
        default_overlay: "processType",
      },
    });
  });

  it("saves the house's opening level, overlay and link exposure", async () => {
    const { user } = await openNewPortalForm();
    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "House");
    await selectOption(user, /portal type/i, /process navigator/i);
    // The card type is pinned, with the helper saying so.
    expect(screen.getByRole("combobox", { name: tc("labels.type") })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(t("webPortals.cardTypePinnedBpmHelper"))).toBeInTheDocument();

    await selectOption(user, t("webPortals.bpm.defaultLevel"), "4");
    await selectOption(user, t("webPortals.bpm.defaultOverlay"), t("webPortals.bpm.overlayMaturity"));
    await user.click(screen.getByRole("checkbox", { name: new RegExp(t("webPortals.bpm.showElementLinks")) }));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    expect(lastBody("post").card_config).toMatchObject({
      bpm: { show_element_links: true, default_level: 4, default_overlay: "maturity" },
      show_logo: true,
    });
  });
});

describe("WebPortalsAdmin — the portal list", () => {
  it("renders each portal with its status, type and link, and the empty state otherwise", async () => {
    scriptLoad();
    renderWithProviders(<WebPortalsAdmin />);
    expect(await screen.findByText(t("webPortals.noPortals"))).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/reports/ppm/group-options")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/auth/sso/config")).toHaveLength(1);
  });

  it("lists portals with their chips, slug link and linkified description", async () => {
    await renderList([CARDS_PORTAL, PPM_PORTAL]);
    expect(screen.queryByText(t("webPortals.noPortals"))).toBeNull();

    expect(screen.getByText(tc("status.published"))).toBeInTheDocument();
    expect(screen.getByText(tc("status.draft"))).toBeInTheDocument();
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(screen.getByText("Initiative")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "/portal/app-catalog" })).toHaveAttribute("href", "/portal/app-catalog");
    // The description's URL became a new-tab link.
    expect(screen.getByRole("link", { name: "https://example.test/more" })).toHaveAttribute("target", "_blank");
    // The open-portal icon buttons are anchors to the public page.
    const opens = screen.getAllByRole("link", { name: t("webPortals.openPortal") });
    expect(opens[0]).toHaveAttribute("href", "/portal/app-catalog");
  });

  it("flips publication and reloads the list", async () => {
    const { user } = await renderList([CARDS_PORTAL]);
    await user.click(screen.getByRole("button", { name: t("webPortals.unpublish") }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/web-portals/p1")).toHaveLength(1));
    expect(lastBody("patch")).toEqual({ is_published: false });
    await waitFor(() => expect(mockApi.callsOf("get", "/web-portals")).toHaveLength(2));
  });

  it("copies the public URL to the clipboard", async () => {
    // `userEvent.setup()` (inside `renderWithProviders`) installs its own
    // clipboard stub over anything set beforehand, so the write is read back
    // from that stub rather than asserted on a spy.
    const { user } = await renderList([CARDS_PORTAL]);
    await user.click(screen.getByRole("button", { name: t("webPortals.copyUrl") }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/portal/app-catalog`);
  });

  it("deletes after confirmation and not on cancel", async () => {
    const { user } = await renderList([CARDS_PORTAL]);
    await user.click(screen.getByRole("button", { name: tc("actions.delete") }));
    expect(dialog().getByText(t("webPortals.deleteConfirm"))).toBeInTheDocument();
    await user.click(dialog().getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: tc("actions.delete") }));
    await user.click(dialog().getByRole("button", { name: tc("actions.delete") }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/web-portals/p1")).toHaveLength(1));
    await waitFor(() => expect(mockApi.callsOf("get", "/web-portals")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("WebPortalsAdmin — editing", () => {
  it("opens the dialog pre-filled from the stored portal and PATCHes the changes", async () => {
    const { user } = await renderList([CARDS_PORTAL], true);
    await user.click(screen.getByRole("button", { name: t("webPortals.editPortal") }));
    const d = dialog();
    expect(d.getByRole("heading", { name: t("webPortals.editPortal") })).toBeInTheDocument();
    expect(d.getByRole("textbox", { name: /^portal name/i })).toHaveValue("App Catalog");
    expect(d.getByRole("textbox", { name: t("webPortals.urlSlug") })).toHaveValue("app-catalog");
    expect(d.getByRole("textbox", { name: tc("labels.description") })).toHaveValue(CARDS_PORTAL.description);
    expect(d.getByRole("combobox", { name: t("webPortals.access.modeLabel") })).toHaveTextContent(
      t("webPortals.access.modeSso"),
    );
    expect(d.getByText("acme.com")).toBeInTheDocument();
    expect(d.getByRole("combobox", { name: tc("labels.type") })).toHaveTextContent("Application");
    // A portal saved before card filters keeps its subtypes, now in the shared section.
    expect(await d.findByText(t("webPortals.cardFilters"))).toBeInTheDocument();
    await waitFor(() =>
      expect(d.getByRole("combobox", { name: tr("portfolio.filters.subtype") })).toBeInTheDocument(),
    );
    expect(d.getByText("Microservice")).toBeInTheDocument();
    expect(d.getByRole("checkbox", { name: new RegExp(t("webPortals.published")) })).toBeChecked();
    expect(d.getByRole("checkbox", { name: new RegExp(t("webPortals.showLogo")) })).not.toBeChecked();

    // The stored toggles override the defaults, row by row.
    const rows = d.getAllByRole("row");
    const description = rows.find((r) => within(r).queryByText(t("webPortals.builtInProps.description")))!;
    const [descCard, descDetail] = within(description).getAllByRole("checkbox");
    expect(descCard).not.toBeChecked();
    expect(descDetail).toBeChecked();
    const alias = rows.find((r) => within(r).queryByText("Alias"))!;
    const [aliasCard, aliasDetail] = within(alias).getAllByRole("checkbox");
    expect(aliasCard).toBeChecked();
    expect(aliasDetail).not.toBeChecked();

    // Renaming an existing portal keeps its slug: the slug is manual once set.
    const name = d.getByRole("textbox", { name: /^portal name/i });
    await user.clear(name);
    await user.type(name, "Application Catalogue");
    expect(d.getByRole("textbox", { name: t("webPortals.urlSlug") })).toHaveValue("app-catalog");

    await user.click(d.getByRole("button", { name: t("webPortals.saveChanges") }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/web-portals/p1")).toHaveLength(1));
    expect(lastBody("patch")).toMatchObject({
      name: "Application Catalogue",
      slug: "app-catalog",
      card_type: "Application",
      view: "cards",
      is_published: true,
      access_mode: "sso",
      allowed_email_domains: ["acme.com"],
      filters: { card_filters: cardFilters({ subtypeFilters: ["microservice"], tagFilterIds: ["tag-9"] }) },
      card_config: {
        toggles: CARDS_PORTAL.card_config!.toggles,
        show_logo: false,
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("get", "/web-portals")).toHaveLength(2);
  });

  it("restores a PPM board's exposure switches and opening state", async () => {
    const { user } = await renderList([PPM_PORTAL]);
    await user.click(screen.getByRole("button", { name: t("webPortals.editPortal") }));
    const d = dialog();
    expect(d.getByRole("combobox", { name: /portal type/i })).toHaveTextContent(t("webPortals.portalTypePpm"));
    expect(d.getByRole("combobox", { name: t("webPortals.ppm.defaultGroupBy") })).toHaveTextContent(
      "Business Capability",
    );
    expect(d.getByRole("combobox", { name: t("webPortals.ppm.defaultSubtype") })).toHaveTextContent("Program");
    expect(d.getByRole("checkbox", { name: new RegExp(t("webPortals.ppm.showCosts")) })).not.toBeChecked();
    expect(d.getByRole("checkbox", { name: new RegExp(t("webPortals.ppm.showPeople")) })).toBeChecked();
    expect(d.getByRole("checkbox", { name: new RegExp(t("webPortals.ppm.showNarrative")) })).not.toBeChecked();
  });

  it("shows the save error inside the dialog and keeps it open", async () => {
    const { user } = await renderList([CARDS_PORTAL]);
    // Registered after the catch-all PATCH route so it wins (last registered first).
    mockApi.fail("patch", "/web-portals/p1", 409, "slug taken");
    await user.click(screen.getByRole("button", { name: t("webPortals.editPortal") }));
    await user.click(dialog().getByRole("button", { name: t("webPortals.saveChanges") }));
    expect(await dialog().findByRole("alert")).toHaveTextContent("PATCH /web-portals/p1 failed");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/web-portals")).toHaveLength(1);
  });
});

describe("WebPortalsAdmin — card filters", () => {
  it("restores stored card filters and keeps approval statuses it has no control for", async () => {
    const portal: WebPortal = {
      ...CARDS_PORTAL,
      access_mode: "public",
      allowed_email_domains: null,
      filters: {
        approval_statuses: ["APPROVED"],
        card_filters: cardFilters({ relationFilters: { Organization: ["org-1"] } }),
      },
    };
    const { user } = await renderList([portal]);
    await user.click(screen.getByRole("button", { name: t("webPortals.editPortal") }));
    const d = dialog();
    expect(await d.findByText("Finance Dept")).toBeInTheDocument();

    // Clear all keeps nothing but the approval statuses.
    const clearAll = d.getByText(tr("portfolio.clearAll")).closest(".MuiChip-root") as HTMLElement;
    await user.click(within(clearAll).getByTestId("CancelIcon"));
    expect(d.queryByText("Finance Dept")).toBeNull();
    await user.click(d.getByRole("button", { name: t("webPortals.saveChanges") }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/web-portals/p1")).toHaveLength(1));
    expect(lastBody("patch")).toMatchObject({ filters: { approval_statuses: ["APPROVED"] } });
  });

  it("warns before a resave changes how tags from several groups match", async () => {
    const portal: WebPortal = {
      ...CARDS_PORTAL,
      access_mode: "public",
      allowed_email_domains: null,
      filters: { tag_ids: [HOSTING_GROUP.tags[0].id, RISK_GROUP.tags[0].id] },
    };
    const { user } = await renderList([portal]);
    await user.click(screen.getByRole("button", { name: t("webPortals.editPortal") }));
    expect(await dialog().findByText(t("webPortals.legacyTagsWarning"))).toBeInTheDocument();

    // Another card type starts from scratch: nothing of the old preset is kept.
    await selectOption(user, tc("labels.type"), "IT Component");
    expect(dialog().queryByText(t("webPortals.legacyTagsWarning"))).toBeNull();
  });

  it("says the filters are loading until their options arrive", async () => {
    let release: (v: unknown) => void = () => {};
    scriptLoad([CARDS_PORTAL]);
    mockApi.on("get", /^\/web-portals\/filter-options/, () => new Promise((r) => (release = r)));
    const { user } = renderWithProviders(<WebPortalsAdmin />);
    await user.click(await screen.findByRole("button", { name: t("webPortals.editPortal") }));
    expect(await dialog().findByText(t("webPortals.cardFiltersLoading"))).toBeInTheDocument();
    release(FILTER_OPTIONS);
    await waitFor(() => expect(dialog().queryByText(t("webPortals.cardFiltersLoading"))).toBeNull());
  });

  it("keeps the subtype and tag pickers on a board portal and asks for no filter options", async () => {
    const { user } = await renderList([PPM_PORTAL]);
    await user.click(screen.getByRole("button", { name: t("webPortals.editPortal") }));
    const d = dialog();
    expect(d.getByRole("combobox", { name: t("webPortals.filterSubtypes") })).toBeInTheDocument();
    expect(d.queryByText(t("webPortals.cardFilters"))).toBeNull();
    expect(mockApi.callsOf("get", /^\/web-portals\/filter-options/)).toHaveLength(0);
  });
});

describe("WebPortalsAdmin — creating a cards portal", () => {
  it("derives the slug from the name until the slug is edited by hand", async () => {
    const { user } = await openNewPortalForm();
    const name = screen.getByRole("textbox", { name: /^portal name/i });
    const slug = screen.getByRole("textbox", { name: t("webPortals.urlSlug") });
    await user.type(name, "My Apps! 2026");
    expect(slug).toHaveValue("my-apps-2026");
    expect(screen.getByText("/portal/my-apps-2026")).toBeInTheDocument();

    await user.clear(slug);
    await user.type(slug, "apps");
    await user.type(name, " more");
    expect(slug).toHaveValue("apps");
  });

  it("keeps Create disabled until name, slug and type are set", async () => {
    const { user } = await openNewPortalForm();
    const create = screen.getByRole("button", { name: /^create$/i });
    expect(create).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "Apps");
    expect(create).toBeDisabled();
    await selectOption(user, tc("labels.type"), "Application");
    expect(create).toBeEnabled();
  });

  it("builds the display table for the chosen type and saves the toggles, filters and logo flag", async () => {
    const { user } = await openNewPortalForm();
    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "Apps");
    await user.type(screen.getByRole("textbox", { name: tc("labels.description") }), "All of them");
    expect(screen.queryByText(t("webPortals.section.displayConfig"))).toBeNull();

    await selectOption(user, tc("labels.type"), "Application");
    expect(screen.getByText(t("webPortals.cardTypeHelper"))).toBeInTheDocument();
    expect(screen.getByText(t("webPortals.section.displayConfig"))).toBeInTheDocument();

    const d = dialog();
    // Built-in rows carry their defaults: approval status is off the summary card.
    const rows = d.getAllByRole("row");
    const row = (label: string) => rows.find((r) => within(r).queryByText(label))!;
    const [approvalCard, approvalDetail] = within(row(t("webPortals.builtInProps.approval_status"))).getAllByRole(
      "checkbox",
    );
    expect(approvalCard).not.toBeChecked();
    expect(approvalDetail).toBeChecked();
    // Custom fields: the first three are on the card by default, the rest only in the detail.
    expect(d.getByText(t("webPortals.customFields"))).toBeInTheDocument();
    expect(within(row("Alias")).getAllByRole("checkbox")[0]).toBeChecked();
    expect(within(row("Go-Live Date")).getAllByRole("checkbox")[0]).not.toBeChecked();
    // Related items: one row per relation type, headed by the other end's type and the verb
    // read from this side — the self-pair included.
    expect(d.getByText(t("webPortals.relatedItems"))).toBeInTheDocument();
    expect(d.getByText("(uses)")).toBeInTheDocument();
    expect(d.getByText("(supports)")).toBeInTheDocument();
    expect(d.getByText("(sends data to)")).toBeInTheDocument();
    const itc = row("IT Component");
    const [relCard, relDetail] = within(itc).getAllByRole("checkbox");
    expect(relCard).not.toBeChecked();
    expect(relDetail).not.toBeChecked();

    await user.click(approvalCard);
    await user.click(within(row("Alias")).getAllByRole("checkbox")[1]);
    await user.click(relDetail);

    // The shared card filters: a subtype, a related card and a tag.
    expect(d.getByText(t("webPortals.cardFiltersHelper"))).toBeInTheDocument();
    await user.click(await d.findByRole("combobox", { name: tr("portfolio.filters.subtype") }));
    await user.click(await screen.findByRole("option", { name: "Microservice" }));
    await user.keyboard("{Escape}");
    await user.click(d.getByRole("combobox", { name: "Organization" }));
    await user.click(await screen.findByRole("option", { name: "Finance Dept" }));
    await user.keyboard("{Escape}");
    await user.click(d.getByTestId("tag-picker"));
    expect(mockApi.callsOf("get", "/web-portals/filter-options?type=Application")).toHaveLength(1);

    await user.click(d.getByRole("checkbox", { name: new RegExp(t("webPortals.showLogo")) }));
    await user.click(d.getByRole("checkbox", { name: new RegExp(t("webPortals.published")) }));
    await user.click(d.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    expect(lastBody("post")).toEqual({
      name: "Apps",
      slug: "apps",
      description: "All of them",
      card_type: "Application",
      view: "cards",
      is_published: true,
      access_mode: "public",
      allowed_email_domains: null,
      display_fields: null,
      filters: {
        card_filters: cardFilters({
          subtypeFilters: ["microservice"],
          relationFilters: { Organization: ["org-1"] },
          tagFilterIds: ["tag-1"],
        }),
      },
      card_config: {
        toggles: {
          approval_status: { card: true, detail: true },
          "field:alias": { card: true, detail: false },
          "rel:relAppToITC": { card: false, detail: true },
        },
        show_logo: false,
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends null for card_config and filters when nothing was configured", async () => {
    const { user } = await openNewPortalForm();
    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "Caps");
    await selectOption(user, tc("labels.type"), "Business Capability");
    // A type without subtypes shows no subtype filter.
    expect(await screen.findByText(t("webPortals.cardFilters"))).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: tr("portfolio.filters.subtype") })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    expect(lastBody("post")).toMatchObject({ card_type: "BusinessCapability", card_config: null, filters: null });
  });

  it("resets the per-type choices when the type changes", async () => {
    const { user } = await openNewPortalForm();
    await selectOption(user, tc("labels.type"), "Application");
    const d = dialog();
    await user.click(await d.findByRole("combobox", { name: tr("portfolio.filters.subtype") }));
    await user.click(await screen.findByRole("option", { name: "Microservice" }));
    await user.keyboard("{Escape}");
    expect(d.getByText("Microservice")).toBeInTheDocument();

    await selectOption(user, tc("labels.type"), "IT Component");
    expect(d.queryByText("Microservice")).toBeNull();
    await waitFor(() =>
      expect(mockApi.callsOf("get", "/web-portals/filter-options?type=ITComponent")).toHaveLength(1),
    );
    // IT Component's relations are read from the target side: the reverse verb.
    expect(d.getByText("(is used by)")).toBeInTheDocument();
    // A relation whose other end is not a type this metamodel carries (Provider is
    // left out of TYPES above) is not offered — the portal could never render it.
    expect(d.queryByText("(is provided by)")).toBeNull();
  });
});

describe("WebPortalsAdmin — access protection", () => {
  it("keeps SSO unavailable until single sign-on is configured", async () => {
    const { user } = await openNewPortalForm();
    expect(screen.getByText(t("webPortals.access.ssoNotConfigured"))).toBeInTheDocument();
    expect(screen.getByText(t("webPortals.access.publicHint"))).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: t("webPortals.access.modeLabel") }));
    expect(await screen.findByRole("option", { name: t("webPortals.access.modeSso") })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("collects allowed domains as chips and folds uncommitted text in on save", async () => {
    scriptLoad([], true);
    const { user } = await openNewPortalForm();
    expect(screen.queryByText(t("webPortals.access.ssoNotConfigured"))).toBeNull();
    await selectOption(user, t("webPortals.access.modeLabel"), t("webPortals.access.modeSso"));
    expect(screen.getByText(t("webPortals.access.ssoHint"))).toBeInTheDocument();

    const domains = screen.getByRole("textbox", { name: t("webPortals.access.domainsLabel") });
    await user.type(domains, "Acme.com, beta.org{Enter}");
    expect(screen.getByText("acme.com")).toBeInTheDocument();
    expect(screen.getByText("beta.org")).toBeInTheDocument();
    expect(domains).toHaveValue("");

    // A comma commits too, and a repeat is deduplicated.
    await user.type(domains, "acme.com,");
    expect(screen.getAllByText("acme.com")).toHaveLength(1);

    // Removing a chip.
    const betaChip = screen.getByText("beta.org").closest(".MuiChip-root")!;
    await user.click(within(betaChip as HTMLElement).getByTestId("CancelIcon"));
    expect(screen.queryByText("beta.org")).toBeNull();

    // Text left in the box when saving still counts.
    await user.type(domains, "gamma.io");
    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "Apps");
    await selectOption(user, tc("labels.type"), "Application");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    expect(lastBody("post")).toMatchObject({
      access_mode: "sso",
      allowed_email_domains: ["acme.com", "gamma.io"],
    });
  });

  it("commits the domain on blur and sends null when none are listed", async () => {
    scriptLoad([], true);
    const { user } = await openNewPortalForm();
    await selectOption(user, t("webPortals.access.modeLabel"), t("webPortals.access.modeSso"));
    const domains = screen.getByRole("textbox", { name: t("webPortals.access.domainsLabel") });
    await user.type(domains, "  ");
    await user.tab();
    expect(screen.queryByRole("button", { name: /acme/ })).toBeNull();

    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "Apps");
    await selectOption(user, tc("labels.type"), "Application");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    expect(lastBody("post")).toMatchObject({ access_mode: "sso", allowed_email_domains: null });
  });
});

describe("WebPortalsAdmin — PPM portfolio board", () => {
  it("is offered only while the PPM module is on", async () => {
    hookState.ppm = { ppmEnabled: false, ppmLoaded: true };
    const { user } = await openNewPortalForm();
    await user.click(screen.getByRole("combobox", { name: /portal type/i }));
    const opt = await screen.findByRole("option", { name: new RegExp(t("webPortals.portalTypePpm")) });
    expect(opt).toHaveAttribute("aria-disabled", "true");
    expect(within(opt).getByText(t("webPortals.portalTypePpmDisabled"))).toBeInTheDocument();
  });

  it("pins Initiative, offers the board's group-by options and saves the ppm block", async () => {
    const { user } = await openNewPortalForm();
    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "Roadmap");
    await selectOption(user, /portal type/i, t("webPortals.portalTypePpm"));
    expect(screen.getByText(t("webPortals.portalTypePpmHelper"))).toBeInTheDocument();
    expect(screen.getByText(t("webPortals.cardTypePinnedHelper"))).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: tc("labels.type") })).toHaveTextContent("Initiative");
    expect(screen.queryByText(t("webPortals.relatedItems"))).toBeNull();

    await selectOption(user, t("webPortals.ppm.defaultGroupBy"), "Business Capability");
    await selectOption(user, t("webPortals.ppm.defaultSubtype"), "Project");
    await user.click(screen.getByRole("checkbox", { name: new RegExp(t("webPortals.ppm.showCosts")) }));
    await user.click(screen.getByRole("checkbox", { name: new RegExp(t("webPortals.ppm.showPeople")) }));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    expect(lastBody("post")).toMatchObject({
      card_type: "Initiative",
      view: "ppm_portfolio",
      filters: null,
      card_config: {
        ppm: {
          show_costs: false,
          show_people: true,
          show_report_narrative: true,
          default_group_by: "BusinessCapability",
          default_subtype: "project",
        },
        show_logo: true,
      },
    });
    expect(lastBody("post").card_config).not.toHaveProperty("toggles");
  });

  it("offers the Initiative subtypes as a second section and saves a subtype grouping", async () => {
    const { user } = await openNewPortalForm();
    await user.type(screen.getByRole("textbox", { name: /^portal name/i }), "Programs");
    await selectOption(user, /portal type/i, t("webPortals.portalTypePpm"));

    await user.click(screen.getByRole("combobox", { name: t("webPortals.ppm.defaultGroupBy") }));
    const list = await screen.findByRole("listbox");
    const kind = (li: Element) =>
      li.classList.contains("MuiListSubheader-root") ? "section" : "item";
    expect(Array.from(list.children).map((li) => [kind(li), li.textContent])).toEqual([
      ["section", i18n.t("ppm:groupByRelatedTypes")],
      ["item", "Organization"],
      ["item", "Business Capability"],
      ["section", i18n.t("ppm:groupBySubtypes")],
      ["item", "Project"],
      ["item", "Program"],
    ]);
    await user.click(screen.getByRole("option", { name: "Program" }));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockApi.callsOf("post", "/web-portals")).toHaveLength(1));
    expect(lastBody("post")).toMatchObject({
      card_config: { ppm: { default_group_by: "subtype:program" } },
    });
  });

  it("does not offer a subtype grouping the portal's own subtype filter leaves out", async () => {
    const { user } = await openNewPortalForm();
    await selectOption(user, /portal type/i, t("webPortals.portalTypePpm"));
    await selectOption(user, t("webPortals.filterSubtypes"), "Project");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("combobox", { name: t("webPortals.ppm.defaultGroupBy") }));
    const program = await screen.findByRole("option", { name: "Program" });
    expect(program).toHaveAttribute("aria-disabled", "true");
    await user.hover(within(program).getByText("Program"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(t("webPortals.ppm.subtypeNotPublished"));
    const project = screen.getByRole("option", { name: "Project" });
    expect(project).not.toHaveAttribute("aria-disabled");

    // A click on the disabled label picks nothing, and leaves the menu open.
    await user.click(within(program).getByText("Program"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("combobox", { name: t("webPortals.ppm.defaultGroupBy") })).toHaveTextContent(
      "Organization",
    );
  });
});

