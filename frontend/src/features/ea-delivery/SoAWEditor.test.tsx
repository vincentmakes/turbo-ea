import { beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { SoAW, SoAWSectionData } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("./soawExport", () => ({ exportToDocx: vi.fn(async () => {}), exportToPdf: vi.fn() }));
// TipTap has no place in jsdom; a textarea carries the same content/onChange
// contract, and keeps the placeholder + readOnly so a test can find and
// inspect each section's editor.
vi.mock("./RichTextEditor", () => ({
  default: ({
    content,
    onChange,
    placeholder,
    readOnly,
  }: {
    content: string;
    onChange: (v: string) => void;
    placeholder?: string;
    readOnly?: boolean;
  }) => (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
    />
  ),
}));
// The user picker is its own component with its own tests; here the dialog
// only needs to hand the editor a list of ids.
vi.mock("./SignatureRequestDialog", () => ({
  default: ({
    open,
    onClose,
    onRequest,
    title,
    requesting,
  }: {
    open: boolean;
    onClose: () => void;
    onRequest: (ids: string[]) => Promise<void>;
    title: string;
    requesting: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button disabled={requesting} onClick={() => void onRequest(["u2"])}>
          stub-request
        </button>
        <button onClick={onClose}>stub-close</button>
      </div>
    ) : null,
}));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { ADMIN_USER, makeCard } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";

import SoAWEditor from "./SoAWEditor";
import { exportToDocx, exportToPdf } from "./soawExport";
import { getTemplateSections, getTogafPhases } from "./soawTemplate";

const t = (key: string, opts?: Record<string, unknown>) => String(i18n.t(`delivery:${key}`, opts as never));
const tc = (key: string) => String(i18n.t(`common:${key}`));

// Every state change re-renders the page's 18 sections (~250ms in jsdom, more
// under coverage on a loaded runner), and a revision swaps the whole page out
// for a spinner and back. Testing Library's 1s default for `findBy*` /
// `waitFor` is tight for that; a found element still resolves at once.
configure({ asyncUtilTimeout: 5000 });

type CustomSection = SoAWSectionData & { title: string; insertAfter: string };

const INITIATIVE = makeCard({ id: "ca4d0000-0000-4000-8000-0000000000aa", type: "Initiative", name: "Billing 2.0" });

const SOAW: SoAW = {
  id: "s1",
  name: "Billing Modernisation SoAW",
  initiative_id: INITIATIVE.id,
  status: "draft",
  document_info: { prepared_by: "Ada Lovelace", reviewed_by: "Grace Hopper", review_date: "2026-05-01" },
  version_history: [{ version: "0.1", date: "2026-04-20", revised_by: "Ada", description: "First draft" }],
  sections: {
    "1.1": { content: "<p>Background</p>", hidden: false },
    "2.2": { content: "", hidden: true },
    custom_7: { content: "<p>Appendix body</p>", hidden: false, title: "Appendix A", insertAfter: "1.2" } as CustomSection,
  },
  revision_number: 1,
  parent_id: null,
  signatories: [],
  signed_at: null,
};

const PENDING_U2 = {
  user_id: "u2",
  display_name: "Grace Hopper",
  email: "grace@example.com",
  status: "pending" as const,
  signed_at: null,
};
const SIGNED_U2 = { ...PENDING_U2, status: "signed" as const, signed_at: "2026-06-02T09:30:00Z" };

const SECTION_1_1 = getTemplateSections().find((s) => s.id === "1.1")!;
const SECTION_1_2 = getTemplateSections().find((s) => s.id === "1.2")!;
const SECTION_2_1 = getTemplateSections().find((s) => s.id === "2.1")!;
const SECTION_2_2 = getTemplateSections().find((s) => s.id === "2.2")!;

function renderEditor(route: string) {
  return renderWithProviders(<SoAWEditor />, {
    route,
    routes: [
      { path: "/ea-delivery/soaw/new" },
      { path: "/ea-delivery/soaw/:id" },
      { path: "/ea-delivery/soaw/:id/preview", element: <div>preview page</div> },
      { path: "/ea-delivery", element: <div>delivery home</div> },
    ],
  });
}

const renderNew = () => renderEditor("/ea-delivery/soaw/new");
const renderEdit = (query = "") => renderEditor(`/ea-delivery/soaw/s1${query}`);

// The page renders ~60 buttons across its 18 sections, and a whole-document
// `getByRole("button", { name })` computes an accessible name and runs the
// visibility check (`getComputedStyle` up the tree) for every one of them —
// about 250ms per query in jsdom. These lookups go straight to the node.

/** A text button: its label is the button's own text node (the icon glyph sits in a child span). */
const button = (text: string) => screen.getByText(text, { selector: "button" });
const queryButton = (text: string) => screen.queryByText(text, { selector: "button" });
/** An icon button wrapped in a Tooltip carries the tooltip title as its aria-label. */
const iconButton = (title: string) => screen.getByLabelText(title, { selector: "button" });
/** The top-bar Save button (a second one sits at the bottom of the page). */
const saveButton = () => screen.getAllByText(t("editor.save"), { selector: "button" })[0];
/** The open MUI Dialog containing `title`. */
async function dialogTitled(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector: "h2" });
  return heading.closest('[role="dialog"]') as HTMLElement;
}
/** The listbox a MUI Select just opened. */
async function openListbox(): Promise<HTMLElement> {
  return waitFor(() => {
    const lb = document.querySelector('[role="listbox"]');
    if (!lb) throw new Error("no open listbox");
    return lb as HTMLElement;
  });
}
/** The "Document Information" paper, home of the initiative select. */
const docInfoPaper = () => screen.getByText(t("editor.documentInfo")).closest(".MuiPaper-root") as HTMLElement;

/** Set a text input's value in one change event: the page re-renders every
 *  section on each keystroke, so typing character by character is slow. Clicks
 *  are `fireEvent.click` for the same reason — one event, one commit; a MUI
 *  Select opens on `mouseDown`. */
const setValue = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

/** The Paper wrapping one template or custom section, found by its title. */
function sectionPaper(title: string): HTMLElement {
  const paper = screen.getByText(title).closest(".MuiPaper-root");
  if (!paper) throw new Error(`no section paper for ${title}`);
  return paper as HTMLElement;
}

/** The data rows of the version-history table (header excluded). */
function versionRows(): HTMLElement[] {
  const paper = screen.getByText(t("editor.versionHistory")).closest(".MuiPaper-root") as HTMLElement;
  return within(paper).getAllByRole("row").slice(1);
}

async function waitForLoaded() {
  await screen.findByDisplayValue(SOAW.name);
}

interface SavePayload {
  name: string;
  initiative_id: string | null;
  document_info: SoAW["document_info"];
  version_history: SoAW["version_history"];
  sections: Record<string, CustomSection | SoAWSectionData>;
}

function lastBody(method: "post" | "patch", path: string): SavePayload {
  const calls = mockApi.callsOf(method, path);
  return calls[calls.length - 1].body as SavePayload;
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  vi.mocked(exportToDocx).mockClear();
  vi.mocked(exportToPdf).mockClear();
  mockApi.on("get", "/cards?type=Initiative&page_size=500", { items: [INITIATIVE] });
  mockApi.on("get", "/auth/me", { id: ADMIN_USER.id });
  mockApi.on("get", "/soaw/s1", SOAW);
  mockApi.on("patch", "/soaw/s1", (_p, body) => ({ ...SOAW, ...(body as object) }));
  mockApi.on("post", "/soaw", (_p, body) => ({ ...SOAW, ...(body as object), id: "s-new" }));
});

describe("SoAWEditor — a new document", () => {
  it("opens empty with the template, no preview, and refuses to save without a name", async () => {
    renderNew();

    expect(await screen.findByText(t("editor.newTitle"))).toBeInTheDocument();
    expect(queryButton(t("editor.preview"))).not.toBeInTheDocument();
    expect(queryButton(t("editor.requestSignatures"))).not.toBeInTheDocument();
    // Every template section is on the page, both parts labelled.
    expect(screen.getByText(t("editor.partI"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.partII"))).toBeInTheDocument();
    for (const def of getTemplateSections()) expect(screen.getByText(def.title)).toBeInTheDocument();

    fireEvent.click(saveButton());
    expect(await screen.findByText(t("editor.documentNameRequired"))).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/soaw")).toHaveLength(0);
  });

  it("creates the document with the default sections, routes to it, then patches it on the next save", async () => {
    mockApi.on("get", "/soaw/s-new", (_p) => ({ ...SOAW, id: "s-new", name: "Payments SoAW" }));
    mockApi.on("patch", "/soaw/s-new", (_p, body) => ({ ...SOAW, ...(body as object), id: "s-new" }));
    renderNew();
    await screen.findByText(t("editor.newTitle"));

    setValue(screen.getByLabelText(new RegExp(`^${t("editor.documentName")}`)), "Payments SoAW");
    fireEvent.click(saveButton());

    expect(await screen.findByText(t("editor.savedSuccessfully"))).toBeInTheDocument();
    const body = lastBody("post", "/soaw");
    expect(body.name).toBe("Payments SoAW");
    expect(body.initiative_id).toBeNull();
    expect(body.document_info).toEqual({ prepared_by: "", reviewed_by: "", review_date: "" });
    expect(body.version_history).toEqual([{ version: "", date: "", revised_by: "", description: "" }]);
    expect(Object.keys(body.sections).sort()).toEqual(getTemplateSections().map((d) => d.id).sort());
    expect(body.sections["2.1"]).toEqual({
      content: "",
      hidden: false,
      table_data: { columns: SECTION_2_1.columns, rows: [["", ""]] },
    });
    expect(body.sections["3.1"].togaf_data).toEqual(Object.fromEntries(getTogafPhases().map((p) => [p.key, ""])));
    // The editor routes to the created record (2.157.0): the header drops
    // the "new document" title and the Preview button appears without a
    // reload, because `id` now resolves. A bare `history.replaceState` left
    // it in the new-document shape.
    await waitFor(() => expect(mockApi.callsOf("get", "/soaw/s-new")).toHaveLength(1));
    expect(await screen.findByText("Payments SoAW", { selector: "h5, h6, h4" })).toBeInTheDocument();
    expect(screen.queryByText(t("editor.newTitle"))).not.toBeInTheDocument();

    // The second save knows the id and patches.
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", "/soaw/s-new")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/soaw")).toHaveLength(1);
  });
});

describe("SoAWEditor — loading an existing document", () => {
  it("fills the metadata, the version history and the sections from the record", async () => {
    renderEdit();
    await waitForLoaded();

    expect(screen.getByText(SOAW.name, { selector: "h5" })).toBeInTheDocument();
    expect(screen.getByText(t("status.draft"))).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-05-01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0.1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-04-20")).toBeInTheDocument();
    expect(screen.getByDisplayValue("First draft")).toBeInTheDocument();
    // The initiative select resolved the id to its name.
    expect(within(docInfoPaper()).getByRole("combobox")).toHaveTextContent("Billing 2.0");
    // Persisted content lands in the section editor; untouched sections stay empty.
    expect(screen.getByDisplayValue("<p>Background</p>")).toBeInTheDocument();
    expect(within(sectionPaper(SECTION_1_2.title)).getByPlaceholderText(SECTION_1_2.hint!)).toHaveValue("");
    expect(button(t("editor.preview"))).toBeInTheDocument();
    expect(button(t("editor.requestSignatures"))).toBeInTheDocument();
    expect(screen.queryByText(t("editor.revisionLabel", { number: 1 }))).not.toBeInTheDocument();
  });

  it("re-hydrates a custom section in its anchored place and marks a hidden section", async () => {
    renderEdit();
    await waitForLoaded();

    const custom = sectionPaper("Appendix A");
    expect(within(custom).getByText(t("editor.customLabel"))).toBeInTheDocument();
    expect(within(custom).getByDisplayValue("<p>Appendix body</p>")).toBeInTheDocument();
    // Anchored after 1.2: the custom paper is the very next sibling.
    expect(sectionPaper(SECTION_1_2.title).nextElementSibling).toBe(custom);

    const hidden = sectionPaper(SECTION_2_2.title);
    expect(within(hidden).getByText(t("editor.hiddenNote"))).toBeInTheDocument();
    expect(within(hidden).getByLabelText(t("editor.showSection"))).toBeInTheDocument();
  });

  it("shows the load error and lets it be dismissed", async () => {
    mockApi.fail("get", "/soaw/s1", 500, "boom");
    renderEdit();

    const message = await screen.findByText("GET /soaw/s1 failed");
    const alert = message.closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(alert).getByLabelText(/close/i));
    await waitFor(() => expect(screen.queryByText("GET /soaw/s1 failed")).not.toBeInTheDocument());
  });

  it("navigates to the preview", async () => {
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.preview")));
    expect(await screen.findByText("preview page")).toBeInTheDocument();
  });

  it("the back arrow leaves for EA Delivery", async () => {
    renderEdit();
    await waitForLoaded();

    fireEvent.click(iconButton(t("editor.backTooltip")));
    expect(await screen.findByText("delivery home")).toBeInTheDocument();
  });
});

describe("SoAWEditor — editing and saving", () => {
  it("patches the document info, the initiative and the version history", async () => {
    renderEdit();
    await waitForLoaded();

    setValue(screen.getByDisplayValue("Ada Lovelace"), "Linus Torvalds");
    const reviewDate = screen.getByDisplayValue("2026-05-01");
    setValue(reviewDate, "2026-06-15");
    fireEvent.blur(reviewDate);

    fireEvent.mouseDown(within(docInfoPaper()).getByRole("combobox"));
    fireEvent.click(within(await openListbox()).getByText(tc("labels.none")));

    // A second version row, then the first one removed.
    fireEvent.click(iconButton(t("editor.addVersionEntry")));
    let rows = versionRows();
    expect(rows).toHaveLength(2);
    setValue(within(rows[1]).getAllByRole("textbox")[0], "0.2");
    setValue(within(rows[1]).getAllByRole("textbox")[2], "Second draft");
    fireEvent.click(within(rows[0]).getByRole("button"));
    rows = versionRows();
    expect(rows).toHaveLength(1);
    // The last row cannot be removed.
    expect(within(rows[0]).queryByRole("button")).not.toBeInTheDocument();

    fireEvent.click(saveButton());
    expect(await screen.findByText(t("editor.savedSuccessfully"))).toBeInTheDocument();

    const body = lastBody("patch", "/soaw/s1");
    expect(body.name).toBe(SOAW.name);
    expect(body.initiative_id).toBeNull();
    expect(body.document_info).toEqual({
      prepared_by: "Linus Torvalds",
      reviewed_by: "Grace Hopper",
      review_date: "2026-06-15",
    });
    expect(body.version_history).toEqual([{ version: "0.2", date: "", revised_by: "", description: "Second draft" }]);
  });

  it("patches edited section content, a table row and a TOGAF phase", async () => {
    renderEdit();
    await waitForLoaded();

    setValue(within(sectionPaper(SECTION_1_1.title)).getByPlaceholderText(SECTION_1_1.hint!), "<p>New background</p>");

    // The objectives table: first cell of the first row.
    const table21 = sectionPaper(SECTION_2_1.title);
    expect(within(table21).getByText(SECTION_2_1.preamble!)).toBeInTheDocument();
    setValue(within(table21).getAllByRole("textbox")[0], "Cut invoice latency");

    // The first TOGAF phase's artefacts.
    const phaseA = getTogafPhases()[0];
    const phaseRow = screen.getByText(phaseA.label).closest("tr")!;
    setValue(within(phaseRow).getByPlaceholderText(t("editor.togafPlaceholder")), "Vision deck");

    fireEvent.click(saveButton());
    await screen.findByText(t("editor.savedSuccessfully"));

    const body = lastBody("patch", "/soaw/s1");
    expect(body.sections["1.1"]).toEqual({ content: "<p>New background</p>", hidden: false });
    expect(body.sections["2.1"].table_data).toEqual({
      columns: SECTION_2_1.columns,
      rows: [["Cut invoice latency", ""]],
    });
    expect(body.sections["3.1"].togaf_data?.[phaseA.key]).toBe("Vision deck");
  });

  it("hides and shows sections, and collapses one", async () => {
    renderEdit();
    await waitForLoaded();

    const paper11 = sectionPaper(SECTION_1_1.title);
    fireEvent.click(within(paper11).getByLabelText(t("editor.hideSection")));
    expect(within(paper11).getByText(t("editor.hiddenNote"))).toBeInTheDocument();
    expect(within(paper11).getByLabelText(t("editor.showSection"))).toBeInTheDocument();

    const paper22 = sectionPaper(SECTION_2_2.title);
    fireEvent.click(within(paper22).getByLabelText(t("editor.showSection")));
    expect(within(paper22).queryByText(t("editor.hiddenNote"))).not.toBeInTheDocument();

    // The chevron collapses the body; the header stays.
    const paper12 = sectionPaper(SECTION_1_2.title);
    const chevron = paper12.querySelector("button") as HTMLElement;
    expect(chevron).toHaveTextContent("expand_more");
    fireEvent.click(chevron);
    expect(chevron).toHaveTextContent("chevron_right");

    fireEvent.click(saveButton());
    await screen.findByText(t("editor.savedSuccessfully"));
    const body = lastBody("patch", "/soaw/s1");
    expect(body.sections["1.1"].hidden).toBe(true);
    expect(body.sections["2.2"].hidden).toBe(false);
  });

  it("shows the save error and keeps editing", async () => {
    mockApi.fail("patch", "/soaw/s1", 409, "stale");
    renderEdit();
    await waitForLoaded();

    fireEvent.click(saveButton());

    expect(await screen.findByText("PATCH /soaw/s1 failed")).toBeInTheDocument();
    expect(screen.queryByText(t("editor.savedSuccessfully"))).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(SOAW.name)).toBeEnabled();
  });
});

describe("SoAWEditor — custom sections", () => {
  it("adds a custom section after a chosen template section and saves it", async () => {
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.addCustomSection")));
    const dialog = await dialogTitled(t("editor.addCustomSection"));
    const add = within(dialog).getByText(tc("actions.add"), { selector: "button" });
    expect(add).toBeDisabled();

    setValue(within(dialog).getByLabelText(new RegExp(`^${t("editor.sectionTitle")}`)), "Glossary");
    fireEvent.mouseDown(within(dialog).getByRole("combobox"));
    fireEvent.click(within(await openListbox()).getByText(SECTION_1_1.title));
    fireEvent.click(add);

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const glossary = sectionPaper("Glossary");
    expect(sectionPaper(SECTION_1_1.title).nextElementSibling).toBe(glossary);
    setValue(within(glossary).getByPlaceholderText(t("editor.enterContent")), "<p>Terms</p>");

    fireEvent.click(saveButton());
    await screen.findByText(t("editor.savedSuccessfully"));

    const body = lastBody("patch", "/soaw/s1");
    const key = Object.keys(body.sections).find((k) => /^custom_\d+$/.test(k) && k !== "custom_7")!;
    expect(key).toBeDefined();
    expect(body.sections[key]).toEqual({ content: "<p>Terms</p>", hidden: false, title: "Glossary", insertAfter: "1.1" });
    expect(body.sections.custom_7).toEqual({
      content: "<p>Appendix body</p>",
      hidden: false,
      title: "Appendix A",
      insertAfter: "1.2",
    });
  });

  it("Enter in the title box adds the section at the end of the document", async () => {
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.addCustomSection")));
    const dialog = await dialogTitled(t("editor.addCustomSection"));
    const title = within(dialog).getByLabelText(new RegExp(`^${t("editor.sectionTitle")}`));
    setValue(title, "Epilogue");
    fireEvent.keyDown(title, { key: "Enter" });

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    const papers = Array.from(document.querySelectorAll(".MuiPaper-root"));
    const last = getTemplateSections()[getTemplateSections().length - 1];
    expect(papers.indexOf(sectionPaper("Epilogue"))).toBe(papers.indexOf(sectionPaper(last.title)) + 1);

    fireEvent.click(saveButton());
    await screen.findByText(t("editor.savedSuccessfully"));
    const body = lastBody("patch", "/soaw/s1");
    const added = Object.entries(body.sections).find(
      ([k, v]) => k !== "custom_7" && (v as CustomSection).title === "Epilogue",
    );
    expect((added![1] as CustomSection).insertAfter).toBe("");
  });

  it("ignores Enter on an empty title and cancels without adding anything", async () => {
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.addCustomSection")));
    const dialog = await dialogTitled(t("editor.addCustomSection"));
    const title = within(dialog).getByLabelText(new RegExp(`^${t("editor.sectionTitle")}`));
    setValue(title, "   ");
    fireEvent.keyDown(title, { key: "Enter" });
    expect(dialog).toBeInTheDocument();

    setValue(title, "Dropped");
    fireEvent.click(within(dialog).getByText(tc("actions.cancel"), { selector: "button" }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.queryByText("Dropped")).not.toBeInTheDocument();
  });

  it("removes a custom section and drops it from the next save", async () => {
    renderEdit();
    await waitForLoaded();

    fireEvent.click(within(sectionPaper("Appendix A")).getByLabelText(t("editor.removeCustomSection")));
    expect(screen.queryByText("Appendix A")).not.toBeInTheDocument();

    fireEvent.click(saveButton());
    await screen.findByText(t("editor.savedSuccessfully"));
    expect(lastBody("patch", "/soaw/s1").sections).not.toHaveProperty("custom_7");
  });
});

describe("SoAWEditor — signatures", () => {
  it("requests signatures, shows the progress and recalls them", async () => {
    mockApi.on("post", "/soaw/s1/request-signatures", (_p, body) => ({
      ...SOAW,
      status: "in_review",
      signatories: (body as { user_ids: string[] }).user_ids.map((id) => ({ ...PENDING_U2, user_id: id })),
    }));
    mockApi.on("post", "/soaw/s1/recall-signatures", { ...SOAW, status: "draft", signatories: [] });
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.requestSignatures")));
    const dialog = await screen.findByLabelText(t("editor.signDialog.title"));
    fireEvent.click(within(dialog).getByText("stub-request"));

    expect(await screen.findByText(t("editor.signatureRequestsSent"))).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/soaw/s1/request-signatures")[0].body).toEqual({ user_ids: ["u2"] });
    expect(screen.queryByLabelText(t("editor.signDialog.title"))).not.toBeInTheDocument();
    expect(screen.getByText(t("editor.signaturesProgress", { signed: 0, total: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("status.inReview"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.sigPending"))).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
    // In review: no new request, but a recall (named by its tooltip).
    expect(queryButton(t("editor.requestSignatures"))).not.toBeInTheDocument();

    fireEvent.click(iconButton(t("editor.recallSignaturesTooltip")));
    expect(await screen.findByText(t("editor.signaturesRecalled"))).toBeInTheDocument();
    expect(screen.getByText(t("status.draft"))).toBeInTheDocument();
    expect(screen.queryByText(t("editor.sigPending"))).not.toBeInTheDocument();
  });

  it("closes the request dialog without sending", async () => {
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.requestSignatures")));
    fireEvent.click(within(await screen.findByLabelText(t("editor.signDialog.title"))).getByText("stub-close"));
    await waitFor(() => expect(screen.queryByLabelText(t("editor.signDialog.title"))).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", "/soaw/s1/request-signatures")).toHaveLength(0);
  });

  it("shows the request error", async () => {
    mockApi.fail("post", "/soaw/s1/request-signatures", 500, "boom");
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.requestSignatures")));
    fireEvent.click(within(await screen.findByLabelText(t("editor.signDialog.title"))).getByText("stub-request"));

    expect(await screen.findByText("POST /soaw/s1/request-signatures failed")).toBeInTheDocument();
  });

  it("shows the recall error", async () => {
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2] });
    mockApi.fail("post", "/soaw/s1/recall-signatures", 500, "boom");
    renderEdit();
    await waitForLoaded();

    fireEvent.click(iconButton(t("editor.recallSignaturesTooltip")));
    expect(await screen.findByText("POST /soaw/s1/recall-signatures failed")).toBeInTheDocument();
  });

  it("lets a pending signatory sign, and reports a fully signed document", async () => {
    mockApi.on("get", "/auth/me", { id: "u2" });
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2] });
    mockApi.on("post", "/soaw/s1/sign", {
      ...SOAW,
      status: "signed",
      signed_at: "2026-06-02T09:30:00Z",
      signatories: [SIGNED_U2],
    });
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.sign")));

    expect(await screen.findByText(t("editor.documentFullySigned"))).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/soaw/s1/sign")).toHaveLength(1);
    expect(screen.getByText(t("editor.signedBanner", { date: "2026-06-02" }))).toBeInTheDocument();
    expect(screen.getByText(t("editor.fullySigned"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.sigApproved"))).toBeInTheDocument();
    expect(screen.getByText(/^Signed: 2026-06-02/)).toBeInTheDocument();
    // Signed: the sign/reject pair is gone and Word export with it.
    expect(queryButton(t("editor.sign"))).not.toBeInTheDocument();
    expect(queryButton(t("editor.word"))).not.toBeInTheDocument();
  });

  it("records one signature of several without closing the document", async () => {
    mockApi.on("get", "/auth/me", { id: "u2" });
    const other = { ...PENDING_U2, user_id: "u3", display_name: "Linus" };
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2, other] });
    mockApi.on("post", "/soaw/s1/sign", { ...SOAW, status: "in_review", signatories: [SIGNED_U2, other] });
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.sign")));

    expect(await screen.findByText(t("editor.signatureRecorded"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.signaturesProgress", { signed: 1, total: 2 }))).toBeInTheDocument();
  });

  it("tints a signed signatory's card with the theme's success colour and greys a pending one", async () => {
    const other = { ...PENDING_U2, user_id: "u3", display_name: "Linus" };
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [SIGNED_U2, other] });
    renderEdit();
    await waitForLoaded();

    const signedCard = (await screen.findByText(t("editor.sigApproved"))).closest(
      ".MuiBox-root",
    )?.parentElement as HTMLElement;
    const pendingCard = screen.getByText(t("editor.sigPending")).closest(".MuiBox-root")
      ?.parentElement as HTMLElement;
    expect(signedCard).toHaveTextContent("Grace Hopper");
    expect(pendingCard).toHaveTextContent("Linus");
    expect(signedCard).toHaveStyle({ backgroundColor: "rgba(46, 125, 50, 0.08)" });
    expect(pendingCard).toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0.04)" });
  });

  it("rejects with a comment and resets to a new draft revision", async () => {
    mockApi.on("get", "/auth/me", { id: "u2" });
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2] });
    mockApi.on("post", "/soaw/s1/reject", { ...SOAW, status: "draft", signatories: [], revision_number: 2 });
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.reject")));
    const dialog = await dialogTitled(t("editor.rejectDialog.title"));
    const confirm = within(dialog).getByText(t("editor.reject"), { selector: "button" });
    expect(confirm).toBeDisabled();
    setValue(within(dialog).getByLabelText(new RegExp(`^${t("editor.rejectDialog.commentLabel")}`)), "Scope unclear");
    fireEvent.click(confirm);

    expect(await screen.findByText(t("editor.documentRejected"))).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/soaw/s1/reject")[0].body).toEqual({ comment: "Scope unclear" });
    expect(screen.getByText(t("editor.revisionLabel", { number: 2 }))).toBeInTheDocument();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("shows the sign and reject errors", async () => {
    mockApi.on("get", "/auth/me", { id: "u2" });
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2] });
    mockApi.fail("post", "/soaw/s1/sign", 403, "not you");
    mockApi.fail("post", "/soaw/s1/reject", 500, "boom");
    renderEdit();
    await waitForLoaded();

    fireEvent.click(button(t("editor.sign")));
    expect(await screen.findByText("POST /soaw/s1/sign failed")).toBeInTheDocument();

    fireEvent.click(button(t("editor.reject")));
    const dialog = await dialogTitled(t("editor.rejectDialog.title"));
    setValue(within(dialog).getByLabelText(new RegExp(`^${t("editor.rejectDialog.commentLabel")}`)), "No");
    fireEvent.click(within(dialog).getByText(t("editor.reject"), { selector: "button" }));
    expect(await screen.findByText("POST /soaw/s1/reject failed")).toBeInTheDocument();
  });

  it("opens the reject dialog from a ?action=reject deep link", async () => {
    mockApi.on("get", "/auth/me", { id: "u2" });
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2] });
    renderEdit("?action=reject");
    await waitForLoaded();
    expect(await dialogTitled(t("editor.rejectDialog.title"))).toBeInTheDocument();
  });

  it("opens the signature request dialog from ?action=sign", async () => {
    renderEdit("?action=sign");
    await waitForLoaded();
    expect(await screen.findByLabelText(t("editor.signDialog.title"))).toBeInTheDocument();
  });
});

describe("SoAWEditor — export", () => {
  it("exports the live editor state to PDF and Word", async () => {
    renderEdit();
    await waitForLoaded();

    setValue(screen.getByDisplayValue(SOAW.name), "Renamed SoAW");

    fireEvent.click(button(t("editor.pdf")));
    expect(exportToPdf).toHaveBeenCalledTimes(1);
    const pdfArgs = vi.mocked(exportToPdf).mock.calls[0];
    expect(pdfArgs[0]).toBe("Renamed SoAW");
    expect(pdfArgs[1]).toEqual(SOAW.document_info);
    expect(pdfArgs[2]).toEqual(SOAW.version_history);
    expect(pdfArgs[3]["1.1"]).toEqual({ content: "<p>Background</p>", hidden: false });
    expect(pdfArgs[3]["2.2"].hidden).toBe(true);
    expect(pdfArgs[4]).toEqual([
      { id: "custom_7", title: "Appendix A", content: "<p>Appendix body</p>", insertAfter: "1.2" },
    ]);
    expect(pdfArgs.slice(5)).toEqual([1, [], null]);

    fireEvent.click(button(t("editor.word")));
    expect(exportToDocx).toHaveBeenCalledTimes(1);
    const docxArgs = vi.mocked(exportToDocx).mock.calls[0];
    expect(docxArgs).toHaveLength(5);
    expect(docxArgs[0]).toBe("Renamed SoAW");
    expect(docxArgs[4]).toEqual(pdfArgs[4]);
  });
});

describe("SoAWEditor — a signed document", () => {
  const SIGNED: SoAW = {
    ...SOAW,
    status: "signed",
    signed_at: "2026-06-02T09:30:00Z",
    signatories: [SIGNED_U2],
    revision_number: 2,
  };

  it("is read-only: no save, no Word, no structure edits, fields disabled", async () => {
    mockApi.on("get", "/soaw/s1", SIGNED);
    renderEdit();
    await waitForLoaded();

    expect(
      screen.getByText(
        t("editor.signedBanner", { date: "2026-06-02" }) + t("editor.signedBannerRevision", { number: 2 }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("editor.revisionLabel", { number: 2 }))).toBeInTheDocument();
    expect(screen.getByDisplayValue(SOAW.name)).toBeDisabled();
    expect(screen.getByDisplayValue("Ada Lovelace")).toBeDisabled();
    expect(screen.getByDisplayValue("0.1")).toBeDisabled();
    expect(screen.getByDisplayValue("<p>Background</p>")).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("<p>Appendix body</p>")).toHaveAttribute("readonly");
    expect(queryButton(t("editor.save"))).not.toBeInTheDocument();
    expect(queryButton(t("editor.word"))).not.toBeInTheDocument();
    expect(queryButton(t("editor.requestSignatures"))).not.toBeInTheDocument();
    expect(queryButton(t("editor.addCustomSection"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("editor.hideSection"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("editor.removeCustomSection"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("editor.addVersionEntry"))).not.toBeInTheDocument();
    // PDF stays, and so does the signature block.
    expect(button(t("editor.pdf"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.fullySigned"))).toBeInTheDocument();
  });

  it("starts a new revision and moves to it", async () => {
    mockApi.on("get", "/soaw/s1", SIGNED);
    const revised = { ...SOAW, id: "s2", name: "Billing Modernisation SoAW (rev 3)", revision_number: 3 };
    mockApi.on("post", "/soaw/s1/revise", revised);
    mockApi.on("get", "/soaw/s2", revised);
    renderEdit();
    await waitForLoaded();

    fireEvent.click(screen.getAllByText(t("editor.newRevision"), { selector: "button" })[0]);

    expect(await screen.findByDisplayValue("Billing Modernisation SoAW (rev 3)")).toBeInTheDocument();
    expect(screen.getByText(t("editor.revisionLabel", { number: 3 }))).toBeInTheDocument();
    expect(screen.getByText(t("status.draft"))).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/soaw/s2")).toHaveLength(1);
  });

  it("shows the revise error", async () => {
    mockApi.on("get", "/soaw/s1", SIGNED);
    mockApi.fail("post", "/soaw/s1/revise", 500, "boom");
    renderEdit();
    await waitForLoaded();

    fireEvent.click(screen.getAllByText(t("editor.newRevision"), { selector: "button" })[0]);
    expect(await screen.findByText("POST /soaw/s1/revise failed")).toBeInTheDocument();
  });
});
