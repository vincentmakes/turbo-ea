/**
 * ProcessFlowTab regressions for the bugs a mutation pass surfaced: a stale
 * action error carried into the next confirm dialog, load failures rendered
 * as empty states, a failed elements re-read that hid the table, the empty
 * state flashing before a list's first load, the Organization column naming
 * the card type by its key, and an invalid Tabs value while permissions load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/features/bpm/BpmnViewer", () => ({
  default: ({ bpmnXml }: { bpmnXml: string }) => (
    <div data-testid="bpmn-viewer">{bpmnXml ? `BPMN:${bpmnXml}` : ""}</div>
  ),
}));
vi.mock("@/features/bpm/BpmnTemplateChooser", () => ({ default: () => null }));
vi.mock("@/features/bpm/MessageFlowsTable", () => ({ default: () => null }));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

import ProcessFlowTab from "./ProcessFlowTab";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import i18n from "@/i18n";

const BASE = "/bpm/processes/proc-1";

const PERMS = { can_view_drafts: true, can_edit_draft: true, can_approve: true, can_withdraw: true };

const PUBLISHED = {
  id: "v1",
  revision: 3,
  status: "published",
  bpmn_xml: "<xml>bpmn</xml>",
  approved_by_name: "Admin User",
  approved_at: "2025-06-01T10:00:00Z",
};

const ELEMENTS = [
  {
    id: "el1",
    bpmn_element_id: "task_1",
    name: "Create Order",
    element_type: "userTask",
    lane_name: "Sales",
    is_automated: false,
    sequence_order: 1,
    custom_fields: {},
    organizations: [],
  },
];

const DRAFTS = [
  { id: "d1", revision: 4, status: "draft", bpmn_xml: "", svg_thumbnail: "", created_by_name: "Dev" },
  { id: "d2", revision: 5, status: "pending", bpmn_xml: "", svg_thumbnail: "", created_by_name: "Dev" },
];

const ARCHIVED = [
  { id: "a1", revision: 2, status: "archived", approved_by_name: "Admin", approved_at: "2025-04-01T10:00:00Z" },
];

function script(s: { published?: unknown; drafts?: unknown[]; archived?: unknown[] } = {}) {
  mockApi.on("get", `${BASE}/flow/permissions`, PERMS);
  mockApi.on("get", `${BASE}/flow/published`, "published" in s ? s.published : PUBLISHED);
  mockApi.on("get", `${BASE}/elements`, ELEMENTS);
  mockApi.on("get", `${BASE}/flow/drafts`, s.drafts ?? DRAFTS);
  mockApi.on("get", `${BASE}/flow/archived`, s.archived ?? ARCHIVED);
  mockApi.on("get", /^\/cards\?/, { items: [{ id: "org-9", name: "Finance Org", type: "Organization" }], total: 1 });
  mockApi.on("put", /\/elements\//, { status: "updated" });
  mockApi.on("post", /.*/, {});
  mockApi.on("delete", /.*/, {});
}

function renderTab(props: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ProcessFlowTab processId="proc-1" processName="Order Process" {...props} />
    </MemoryRouter>,
  );
  return user;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([makeCardType({ key: "Organization", label: "Org Unit" })]);
  mockNavigate.mockReset();
  script();
});

describe("ProcessFlowTab confirm dialog error", () => {
  async function failSubmit() {
    mockApi.fail("post", `${BASE}/flow/versions/d1/submit`, 409, "conflict");
    const user = renderTab({ initialSubTab: 1 });
    await screen.findByText("Revision 4");
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Submit" }));
    expect(await dialog.findByText(/submit failed/i)).toBeInTheDocument();
    return user;
  }

  it("does not carry a failed action's error into the next dialog opened after Cancel", async () => {
    const user = await failSubmit();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Submit for Approval?")).toBeInTheDocument();
    expect(dialog.queryByText(/submit failed/i)).toBeNull();
  });

  it("does not carry a failed action's error into another version's dialog", async () => {
    const user = await failSubmit();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Approve and publish" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Approve and Publish?")).toBeInTheDocument();
    expect(dialog.queryByText(/submit failed/i)).toBeNull();
  });
});

describe("ProcessFlowTab load failures", () => {
  it("says the flow could not be loaded when the permissions fail, not that nothing is published", async () => {
    mockApi.fail("get", `${BASE}/flow/permissions`);
    renderTab();
    expect(await screen.findByText(`GET ${BASE}/flow/permissions failed`)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("MuiAlert-standardError");
    expect(screen.queryByText("No published process flow yet")).toBeNull();
    expect(screen.queryByText("Loading published flow...")).toBeNull();
  });

  it("shows the error, not the empty state, when the drafts cannot be loaded", async () => {
    mockApi.fail("get", `${BASE}/flow/drafts`);
    renderTab({ initialSubTab: 1 });
    expect(await screen.findByText(`GET ${BASE}/flow/drafts failed`)).toBeInTheDocument();
    expect(screen.queryByText("No draft process flows.")).toBeNull();
    expect(screen.queryByText("Loading drafts...")).toBeNull();
  });

  it("shows the error, not the empty state, when the archive cannot be loaded", async () => {
    mockApi.fail("get", `${BASE}/flow/archived`);
    renderTab({ initialSubTab: 2 });
    expect(await screen.findByText(`GET ${BASE}/flow/archived failed`)).toBeInTheDocument();
    expect(screen.queryByText("No archived process flows.")).toBeNull();
    expect(screen.queryByText("Loading archived flows...")).toBeNull();
  });

  it("keeps the elements table when the re-read after a save fails, and says the refresh failed", async () => {
    const user = renderTab();
    await screen.findByText("Create Order");
    mockApi.fail("get", `${BASE}/elements`);
    await user.click(screen.getByText("Add"));
    await user.type(screen.getByPlaceholderText("e.g. SE16"), "SE16{Enter}");
    expect(
      await screen.findByText("Element updated, but the list could not be refreshed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Create Order")).toBeInTheDocument();
    expect(screen.getByText("Process Steps & Elements")).toBeInTheDocument();
    expect(screen.queryByText("Element updated")).toBeNull();
  });
});

describe("ProcessFlowTab first load of a list", () => {
  it("never shows the archive's empty state before the archive has been asked for", async () => {
    const seen: string[] = [];
    const archive = deferred<unknown[]>();
    mockApi.on("get", `${BASE}/flow/archived`, () => {
      seen.push(document.body.textContent ?? "");
      return archive.promise;
    });
    renderTab({ initialSubTab: 2 });
    expect(await screen.findByText("Loading archived flows...")).toBeInTheDocument();
    // The loading text can paint before the effect has issued the GET: wait
    // for the request itself, then check what the page showed at that moment.
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).not.toContain("No archived process flows.");
    await act(async () => {
      archive.resolve([]);
    });
    expect(await screen.findByText("No archived process flows.")).toBeInTheDocument();
  });

  it("never shows the drafts' empty state before the drafts tab has asked for them", async () => {
    script({ drafts: [] });
    const user = renderTab();
    await screen.findByText("Create Order");
    const seen: string[] = [];
    const drafts = deferred<unknown[]>();
    mockApi.on("get", `${BASE}/flow/drafts`, () => {
      seen.push(document.body.textContent ?? "");
      return drafts.promise;
    });
    await user.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(await screen.findByText("Loading drafts...")).toBeInTheDocument();
    // As above: wait for the request, not for the text that precedes it.
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).not.toContain("No draft process flows.");
    await act(async () => {
      drafts.resolve([]);
    });
    expect(await screen.findByText("No draft process flows.")).toBeInTheDocument();
  });
});

describe("ProcessFlowTab Organization column", () => {
  it("names the Organization card type by its metamodel label", async () => {
    const user = renderTab();
    await screen.findByText("Create Order");
    expect(screen.getByText("Link Org Unit")).toBeInTheDocument();
    expect(screen.queryByText("Link Organization")).toBeNull();
    await user.click(screen.getByText("Link Org Unit"));
    expect(screen.getByPlaceholderText("Search Org Unit...")).toBeInTheDocument();
  });
});

describe("ProcessFlowTab sub-tab before permissions load", () => {
  it("never hands the Tabs a value it has no tab for", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const perms = deferred<unknown>();
    mockApi.on("get", `${BASE}/flow/permissions`, () => perms.promise);
    renderTab({ initialSubTab: 2 });
    await waitFor(() => expect(mockApi.callsOf("get", `${BASE}/flow/permissions`)).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByRole("tab", { selected: true })).toBeNull();
    await act(async () => {
      perms.resolve(PERMS);
    });
    expect(await screen.findByText("Revision 2")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Archived" })).toHaveAttribute("aria-selected", "true");
    const invalid = error.mock.calls.filter((c) =>
      c.some((a) => String(a).includes("The `value` provided to the Tabs component is invalid")),
    );
    error.mockRestore();
    expect(invalid).toHaveLength(0);
  });

  it("falls back to the Published tab when the permissions allow no drafts", async () => {
    mockApi.on("get", `${BASE}/flow/permissions`, {
      can_view_drafts: false,
      can_edit_draft: false,
      can_approve: false,
      can_withdraw: false,
    });
    renderTab({ initialSubTab: 1 });
    expect(await screen.findByText("Create Order")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Published" })).toHaveAttribute("aria-selected", "true");
    expect(mockApi.callsOf("get", `${BASE}/flow/drafts`)).toHaveLength(0);
  });
});

describe("ProcessFlowTab failures without a message", () => {
  it("says something went wrong when the permissions fail without a message", async () => {
    mockApi.on("get", `${BASE}/flow/permissions`, () => Promise.reject("offline"));
    renderTab();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("MuiAlert-standardError");
    expect(screen.queryByText("No published process flow yet")).toBeNull();
  });

  it("says something went wrong when the drafts fail without a message", async () => {
    mockApi.on("get", `${BASE}/flow/drafts`, () => Promise.reject("offline"));
    renderTab({ initialSubTab: 1 });
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("No draft process flows.")).toBeNull();
  });

  it("says something went wrong when the archive fails without a message", async () => {
    mockApi.on("get", `${BASE}/flow/archived`, () => Promise.reject("offline"));
    renderTab({ initialSubTab: 2 });
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("No archived process flows.")).toBeNull();
  });
});

describe("ProcessFlowTab Organization column without the type", () => {
  it("falls back to the column's own name when the metamodel has no Organization type", async () => {
    withMetamodel([]);
    const user = renderTab();
    await screen.findByText("Create Order");
    expect(screen.getByText("Link Organization")).toBeInTheDocument();
    await user.click(screen.getByText("Link Organization"));
    expect(screen.getByPlaceholderText("Search Organization...")).toBeInTheDocument();
  });
});

describe("ProcessFlowTab tab contents", () => {
  it("shows only the published flow under the Published tab, nothing of the Drafts tab", async () => {
    renderTab();
    await screen.findByText("Create Order");
    expect(screen.getByRole("tab", { name: "Published" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Loading drafts...")).toBeNull();
    expect(screen.queryByText("No draft process flows.")).toBeNull();
    expect(screen.queryByText("Revision 4")).toBeNull();
  });
});

describe("ProcessFlowTab failed element loads", () => {
  it("says the published flow's elements could not be loaded instead of dropping the table", async () => {
    mockApi.fail("get", `${BASE}/elements`);
    renderTab();
    const alert = (await screen.findByText(`GET ${BASE}/elements failed`)).closest(".MuiAlert-root");
    expect(alert).toHaveClass("MuiAlert-standardError");
    // Spaced off the flow above it, like the table it stands in for.
    expect(alert).toHaveStyle({ marginTop: "16px" });
    // The flow itself still shows; only the table is replaced by the error.
    expect(screen.getByTestId("bpmn-viewer")).toHaveTextContent("BPMN:<xml>bpmn</xml>");
    expect(screen.queryByText("Process Steps & Elements")).toBeNull();
  });

  it("says something went wrong when the elements fail without a message", async () => {
    mockApi.on("get", `${BASE}/elements`, () => Promise.reject("offline"));
    renderTab();
    const alert = (await screen.findByText("Something went wrong")).closest(".MuiAlert-root");
    expect(alert).toHaveClass("MuiAlert-standardError");
  });

  it("says a draft's elements could not be loaded, not that it has none, and retries on the next expand", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d1`, DRAFTS[0]);
    mockApi.fail("get", `${BASE}/flow/versions/d1/draft-elements`);
    const user = renderTab({ initialSubTab: 1 });
    await user.click(await screen.findByText("Revision 4"));
    const alert = (
      await screen.findByText(`GET ${BASE}/flow/versions/d1/draft-elements failed`)
    ).closest(".MuiAlert-root");
    expect(alert).toHaveClass("MuiAlert-standardError");
    // Spaced off the draft's preview above it.
    expect(alert).toHaveStyle({ marginTop: "16px" });
    expect(screen.queryByText("No named elements found in this draft.")).toBeNull();

    // Collapse and expand again: the failed load is asked for once more.
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, ELEMENTS);
    await user.click(screen.getByText("Revision 4"));
    await user.click(screen.getByText("Revision 4"));
    expect(await screen.findByText("Pre-link Elements")).toBeInTheDocument();
    expect(screen.getByText("Create Order")).toBeInTheDocument();
    expect(screen.queryByText(`GET ${BASE}/flow/versions/d1/draft-elements failed`)).toBeNull();
    expect(mockApi.callsOf("get", `${BASE}/flow/versions/d1/draft-elements`)).toHaveLength(2);
  });
});

describe("ProcessFlowTab draft elements failing without a message", () => {
  it("says something went wrong when a draft's elements fail without a message", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d1`, DRAFTS[0]);
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, () => Promise.reject("offline"));
    const user = renderTab({ initialSubTab: 1 });
    await user.click(await screen.findByText("Revision 4"));
    const alert = (await screen.findByText("Something went wrong")).closest(".MuiAlert-root");
    expect(alert).toHaveClass("MuiAlert-standardError");
    expect(screen.queryByText("No named elements found in this draft.")).toBeNull();
  });
});

describe("ProcessFlowTab draft link saved but not re-read", () => {
  it("keeps the draft's table and says the refresh failed, like the published table", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d1`, DRAFTS[0]);
    let loads = 0;
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, () => {
      loads += 1;
      return loads === 1
        ? Promise.resolve([{ ...ELEMENTS[0], application_id: "app-1", application_name: "SAP" }])
        : Promise.reject(new Error("re-read failed"));
    });
    mockApi.on("put", /\/draft-elements\//, { status: "updated" });
    const user = renderTab({ initialSubTab: 1 });
    await user.click(await screen.findByText("Revision 4"));
    const chip = (await screen.findByText("SAP")).closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);

    expect(
      await screen.findByText("Element updated, but the list could not be refreshed"),
    ).toBeInTheDocument();
    expect(mockApi.callsOf("put", `${BASE}/flow/versions/d1/draft-elements/task_1`)).toHaveLength(1);
    expect(screen.getByText("Pre-link Elements")).toBeInTheDocument();
    expect(screen.getByText("Create Order")).toBeInTheDocument();
    expect(screen.queryByText("re-read failed")).toBeNull();
    expect(screen.queryByText("Draft element link updated")).toBeNull();
  });
});

describe("ProcessFlowTab action failure without a message", () => {
  it("says the action failed in the user's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      mockApi.on("post", `${BASE}/flow/versions/d1/submit`, () => Promise.reject("nope"));
      const user = renderTab({ initialSubTab: 1 });
      await screen.findByText(i18n.t("bpm:flowTab.revisionLabel", { revision: 4 }));
      const [submit] = screen.getAllByRole("button", { name: i18n.t("bpm:flowTab.submitForApproval") });
      await user.click(submit);
      const dialog = within(await screen.findByRole("dialog"));
      await user.click(dialog.getByRole("button", { name: i18n.t("common:actions.submit") }));
      expect(await dialog.findByText("Aktion fehlgeschlagen")).toBeInTheDocument();
      expect(dialog.queryByText("Action failed")).toBeNull();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
