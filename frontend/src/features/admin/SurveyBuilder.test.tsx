import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
// Mutable so a single test can mount the builder in edit mode (hydrating a
// saved draft); reset it in that test's finally.
let routeParams: Record<string, string> = {};
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => routeParams,
}));
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (d: Date) => (d as Date).toISOString().slice(0, 10) }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      {
        key: "Application",
        label: "Application",
        icon: "apps",
        color: "#0f7eb5",
        is_hidden: false,
        fields_schema: [
          {
            section: "General",
            fields: [{ key: "costTotalAnnual", label: "Annual Cost", type: "cost" }],
          },
          {
            section: "Assessment",
            fields: [
              // `required` drives the mandatory marker via isEnforcedRequiredField.
              { key: "businessCriticality", label: "Business Criticality", type: "single_select", required: true },
              { key: "timeModel", label: "TIME Model", type: "single_select" },
            ],
          },
        ],
        translations: {},
      },
    ],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";

import SurveyBuilder from "./SurveyBuilder";

const mockPost = api.post as ReturnType<typeof vi.fn>;

/** Walk the wizard to the Target step, which is where the filter lives, and
 *  pick a target type — Save Draft only appears once a name and type exist. */
async function gotoTargetStep(user: ReturnType<typeof userEvent.setup>) {
  render(<SurveyBuilder />);
  await waitFor(() => expect(screen.getByLabelText(/survey name/i)).toBeInTheDocument());
  await user.type(screen.getByLabelText(/survey name/i), "Annual refresh");
  await user.click(screen.getByRole("button", { name: /next/i }));
  await waitFor(() =>
    expect(screen.getByText(/filter by last update/i)).toBeInTheDocument(),
  );

  await user.click(screen.getByRole("combobox", { name: /^type$/i }));
  await user.click(await screen.findByRole("option", { name: /application/i }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /save draft/i })).toBeInTheDocument(),
  );
}

/** The target_filters of the most recent create call. */
function lastSavedFilters() {
  const [, body] = mockPost.mock.calls.at(-1)!;
  return (body as { target_filters: Record<string, unknown> }).target_filters;
}

describe("SurveyBuilder — last-update (staleness) filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The builder fans out over several endpoints on mount; only the card
    // searches are paged, and handing them a bare array blows up the merge.
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/cards") ? { items: [] } : []),
    );
    mockPost.mockResolvedValue({ id: "survey-1" });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("defaults to Any and saves no window", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    expect(screen.getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toBeUndefined();
  });

  it("saves the window behind a preset", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    await user.click(screen.getByRole("button", { name: "6 months" }));
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toEqual({ value: 6, unit: "months" });
  });

  it("shows the cutoff date the window resolves to", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    expect(screen.queryByText(/cards last changed before/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "90 days" }));

    const expected = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`cards last changed before ${expected}`, "i"))).toBeInTheDocument(),
    );
  });

  it("reveals a number + unit row for a custom window and saves it", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    expect(screen.queryByLabelText(/not updated for/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /custom/i }));

    const value = screen.getByLabelText(/not updated for/i);
    await user.clear(value);
    await user.type(value, "45");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toEqual({ value: 45, unit: "days" });
  });

  it("saves nothing while the custom value is out of range", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    await user.click(screen.getByRole("button", { name: /custom/i }));
    const value = screen.getByLabelText(/not updated for/i);
    await user.clear(value);
    await user.type(value, "99999");

    // Flagged inline, and the unsaveable value never reaches the payload.
    await waitFor(() => expect(screen.getByText(/enter a whole number/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toBeUndefined();
  });

  it("keeps the other target filters intact", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    await user.click(screen.getByRole("button", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const filters = lastSavedFilters();
    expect(filters.not_updated_for).toEqual({ value: 30, unit: "days" });
    // The shared builder must still emit every other key, absent-as-undefined.
    expect(filters).toHaveProperty("card_ids");
    expect(filters).toHaveProperty("tag_ids");
    expect(filters).toHaveProperty("related_ids");
    expect(filters).toHaveProperty("attribute_filters");
  });
});

const ROLE_DEFS = [
  { key: "responsible", label: "Business Owner", allowed_types: null, translations: {} },
  { key: "technicalApplicationOwner", label: "Technical Owner", allowed_types: null, translations: {} },
];

/** Walk all the way to step 4, where the resolved preview is rendered. */
async function gotoPreviewStep(user: ReturnType<typeof userEvent.setup>) {
  await gotoTargetStep(user);
  // Step 2 needs at least one stakeholder role ticked.
  await user.click(screen.getByRole("checkbox", { name: /business owner/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  // Step 3 needs at least one field selected.
  await waitFor(() => expect(screen.getByText(/annual cost/i)).toBeInTheDocument());
  await user.click(screen.getByText(/annual cost/i));
  await user.click(screen.getByRole("button", { name: /next/i }));

  // Anchor on a tile that renders for every preview — the breakdown table
  // only appears when there is at least one target.
  await waitFor(() => expect(screen.getByText("Users to Notify")).toBeInTheDocument());
}

describe("SurveyBuilder — preview & send step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve({ items: [] });
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve(ROLE_DEFS);
      return Promise.resolve([]);
    });
    mockPost.mockImplementation((path: string) => {
      if (path.endsWith("/preview")) {
        return Promise.resolve({
          total_cards: 2,
          total_matched: 2,
          skipped: [],
          total_users: 1,
          total_requests: 2,
          targets: [
            {
              card_id: "c1",
              card_name: "NexaCore ERP",
              card_type: "Application",
              users: [
                {
                  user_id: "u1",
                  display_name: "Ada Lovelace",
                  email: "ada@test.com",
                  // Role KEYS, as the backend sends them.
                  roles: ["responsible", "technicalApplicationOwner"],
                },
              ],
            },
          ],
        });
      }
      return Promise.resolve({ id: "survey-1" });
    });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("renders stakeholder role labels, not their keys", async () => {
    const user = userEvent.setup();
    await gotoPreviewStep(user);

    expect(screen.getByText("Ada Lovelace (Business Owner, Technical Owner)")).toBeInTheDocument();
    expect(screen.queryByText(/technicalApplicationOwner/)).not.toBeInTheDocument();
  });

  it("counts distinct people, and shows the requests they generate separately", async () => {
    const user = userEvent.setup();
    await gotoPreviewStep(user);

    // One person across two cards: one user, two survey requests.
    expect(screen.getByText("Users to Notify")).toBeInTheDocument();
    expect(screen.getByText("2 survey requests")).toBeInTheDocument();
  });

  it("falls back to the key when a role is no longer defined", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve({ items: [] });
      // 'technicalApplicationOwner' has been archived since the draft was written.
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve([ROLE_DEFS[0]]);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    await gotoPreviewStep(user);

    expect(
      screen.getByText("Ada Lovelace (Business Owner, technicalApplicationOwner)"),
    ).toBeInTheDocument();
  });
});

describe("SurveyBuilder — cards with nobody to ask", () => {
  function previewWith(extra: Record<string, unknown>) {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve({ items: [] });
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve(ROLE_DEFS);
      return Promise.resolve([]);
    });
    mockPost.mockImplementation((path: string) => {
      if (path.endsWith("/preview")) {
        return Promise.resolve({
          total_cards: 5,
          total_matched: 5,
          skipped: [],
          total_users: 3,
          total_requests: 5,
          targets: [],
          ...extra,
        });
      }
      return Promise.resolve({ id: "survey-1" });
    });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains that matching cards were dropped for want of a recipient", async () => {
    previewWith({
      total_matched: 212,
      skipped: [
        { card_id: "s1", card_name: "Orphan One" },
        { card_id: "s2", card_name: "Orphan Two" },
      ],
    });
    const user = userEvent.setup();
    await gotoPreviewStep(user);

    // 5 of 212 — the 207 are the answer to "why so few?"
    expect(screen.getByText("of 212 matching")).toBeInTheDocument();
    expect(screen.getByText(/207 matching cards have nobody to ask/i)).toBeInTheDocument();
    // The count and the reason carry it; the cards themselves are not listed.
    expect(screen.queryByText("Orphan One")).not.toBeInTheDocument();
  });

  it("stays quiet when every matching card has a recipient", async () => {
    previewWith({ total_matched: 5, skipped: [] });
    const user = userEvent.setup();
    await gotoPreviewStep(user);

    expect(screen.queryByText(/nobody to ask/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/of 5 matching/i)).not.toBeInTheDocument();
  });

  it("creates exactly one draft when previewing an unsaved survey", async () => {
    previewWith({});
    const user = userEvent.setup();
    await gotoPreviewStep(user);

    const creates = mockPost.mock.calls.filter(([path]) => path === "/surveys");
    expect(creates).toHaveLength(1);
  });
});

/** Walk to the Fields step (step 3) and stop there. */
async function gotoFieldsStep(user: ReturnType<typeof userEvent.setup>) {
  await gotoTargetStep(user);
  await user.click(screen.getByRole("checkbox", { name: /business owner/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));
  await waitFor(() => expect(screen.getByText("Assessment")).toBeInTheDocument());
}

/** The action select on a row, found by the row's visible label. */
function actionSelectIn(label: string | RegExp) {
  const row = screen.getByText(label).closest("tr")!;
  return within(row).getByRole("combobox");
}

async function choose(user: ReturnType<typeof userEvent.setup>, combo: HTMLElement, option: string) {
  await user.click(combo);
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("SurveyBuilder — fields grouped by section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve({ items: [] });
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve(ROLE_DEFS);
      return Promise.resolve([]);
    });
    mockPost.mockResolvedValue({ id: "survey-1" });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("marks fields the metamodel requires, and leaves the others unmarked", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    const required = screen.getByText("Business Criticality").closest("td")!;
    expect(within(required).getByText("*")).toBeInTheDocument();

    const plain = screen.getByText("TIME Model").closest("td")!;
    expect(within(plain).queryByText("*")).not.toBeInTheDocument();
  });

  it("ticking a section header selects every field under it", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    const header = screen.getByText("Assessment").closest("tr")!;
    await user.click(within(header).getByRole("checkbox"));

    await waitFor(() => expect(screen.getByText(/2 field\(s\) selected/i)).toBeInTheDocument());
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("setting the section action flips the fields already in it", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    const header = screen.getByText("Assessment").closest("tr")!;
    await user.click(within(header).getByRole("checkbox"));
    await choose(user, within(header).getByRole("combobox"), "Confirm");

    await waitFor(() =>
      expect(screen.getByText(/0 maintain, 2 confirm/i)).toBeInTheDocument(),
    );
  });

  it("a field ticked after the section was set inherits the section's action", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    const header = screen.getByText("Assessment").closest("tr")!;
    // Select, switch the section to Confirm, then clear one field and re-tick it.
    await user.click(within(header).getByRole("checkbox"));
    await choose(user, within(header).getByRole("combobox"), "Confirm");
    await user.click(screen.getByText("TIME Model"));
    await waitFor(() => expect(screen.getByText(/1 field\(s\) selected/i)).toBeInTheDocument());
    await user.click(screen.getByText("TIME Model"));

    // Would be "1 maintain, 1 confirm" if the re-tick fell back to the default.
    await waitFor(() =>
      expect(screen.getByText(/0 maintain, 2 confirm/i)).toBeInTheDocument(),
    );
  });

  it("an individual override leaves the rest alone and shows the section as mixed", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    const header = screen.getByText("Assessment").closest("tr")!;
    await user.click(within(header).getByRole("checkbox"));
    await choose(user, within(header).getByRole("combobox"), "Confirm");
    await choose(user, actionSelectIn("TIME Model"), "Maintain");

    await waitFor(() =>
      expect(screen.getByText(/1 maintain, 1 confirm/i)).toBeInTheDocument(),
    );
    // The header must not keep claiming Confirm for a section that is now split.
    expect(within(header).getByRole("combobox")).toHaveTextContent(/mixed/i);
  });
});

describe("SurveyBuilder — section action select stability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParams = {};
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve({ items: [] });
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve(ROLE_DEFS);
      return Promise.resolve([]);
    });
    mockPost.mockResolvedValue({ id: "survey-1" });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("shows the action just picked when the whole section shares it", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    const header = screen.getByText("Assessment").closest("tr")!;
    await user.click(within(header).getByRole("checkbox"));

    // Confirm, then back to Maintain — the closed control must state each
    // choice, never Mixed for a uniform section and never a blank.
    await choose(user, within(header).getByRole("combobox"), "Confirm");
    await waitFor(() =>
      expect(within(header).getByRole("combobox")).toHaveTextContent(/confirm/i),
    );

    await choose(user, within(header).getByRole("combobox"), "Maintain");
    await waitFor(() =>
      expect(within(header).getByRole("combobox")).toHaveTextContent(/maintain/i),
    );
  });

  it("does not toggle the section when the header text is clicked", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    await user.click(screen.getByText("Assessment"));
    expect(screen.getByText("0/2")).toBeInTheDocument();

    // The tickbox is the toggle — and clicking the text afterwards must not
    // silently clear what it selected.
    const header = screen.getByText("Assessment").closest("tr")!;
    await user.click(within(header).getByRole("checkbox"));
    await waitFor(() => expect(screen.getByText("2/2")).toBeInTheDocument());
    await user.click(screen.getByText("Assessment"));
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("ignores a hydrated field the section no longer lists", async () => {
    // A draft saved against an older schema: two visible Assessment fields,
    // both confirm, plus a ghost whose key the metamodel no longer has. The
    // ghost used to be counted by the header (by section name) but never
    // updated by it (by key), pinning the select on Mixed.
    routeParams = { id: "survey-1" };
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === "/surveys/survey-1") {
        return Promise.resolve({
          id: "survey-1",
          name: "Hydrated",
          description: "",
          message: "",
          status: "draft",
          target_type_key: "Application",
          target_roles: ["responsible"],
          target_filters: {},
          fields: [
            { key: "businessCriticality", section: "Assessment", label: "Business Criticality", type: "single_select", action: "confirm" },
            { key: "timeModel", section: "Assessment", label: "TIME Model", type: "single_select", action: "confirm" },
            { key: "ghostField", section: "Assessment", label: "Ghost", type: "text", action: "maintain" },
          ],
        });
      }
      if (path.startsWith("/cards")) return Promise.resolve({ items: [] });
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve(ROLE_DEFS);
      return Promise.resolve([]);
    });

    try {
      const user = userEvent.setup();
      render(<SurveyBuilder />);
      await waitFor(() => expect(screen.getByLabelText(/survey name/i)).toHaveValue("Hydrated"));
      await user.click(screen.getByRole("button", { name: /next/i }));
      await user.click(screen.getByRole("button", { name: /next/i }));
      await waitFor(() => expect(screen.getByText("Assessment")).toBeInTheDocument());

      const header = screen.getByText("Assessment").closest("tr")!;
      expect(within(header).getByRole("combobox")).toHaveTextContent(/confirm/i);
    } finally {
      routeParams = {};
    }
  });
});

describe("SurveyBuilder — fields step layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeParams = {};
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) return Promise.resolve({ items: [] });
      if (path.startsWith("/stakeholder-roles")) return Promise.resolve(ROLE_DEFS);
      return Promise.resolve([]);
    });
    mockPost.mockResolvedValue({ id: "survey-1" });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("indents the field tickboxes inside their section's", async () => {
    const user = userEvent.setup();
    await gotoFieldsStep(user);

    const cellOf = (label: string | RegExp) =>
      screen.getByText(label).closest("tr")!.querySelector("td")!;
    const padLeft = (el: Element) => parseFloat(getComputedStyle(el).paddingLeft || "0");

    // Mechanical, not visual: the last attempt put the indent on a
    // padding="checkbox" cell, which silently swallowed it.
    expect(padLeft(cellOf("TIME Model"))).toBeGreaterThan(padLeft(cellOf("Assessment")));
  });
});
