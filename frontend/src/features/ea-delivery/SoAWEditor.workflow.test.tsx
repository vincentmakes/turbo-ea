/**
 * SoAWEditor — review findings F1–F3: pending edits are saved before the
 * document is sent for signatures, every action reply refreshes the page
 * through one path, and only the latest load may fill it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useNavigate } from "react-router";
import type { SoAW } from "@/types";

// The discussion and history side panel has its own tests: here the page
// renders alone, and the props it hands the panel are recorded.
const sidePanel = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./collab/DocumentSidePanel", () => ({
  default: (props: { children: unknown }) => {
    sidePanel.props.push(props);
    return props.children;
  },
}));
vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("./soawExport", () => ({ exportToDocx: vi.fn(async () => {}), exportToPdf: vi.fn() }));
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
vi.mock("./SignatureRequestDialog", () => ({
  default: ({
    open,
    onRequest,
    title,
  }: {
    open: boolean;
    onRequest: (ids: string[]) => Promise<void>;
    title: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button onClick={() => void onRequest(["u2"])}>stub-request</button>
      </div>
    ) : null,
}));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { ADMIN_USER } from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import SoAWEditor from "./SoAWEditor";

const t = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`delivery:${key}`, opts as never));

configure({ asyncUtilTimeout: 5000 });

const SOAW: SoAW = {
  id: "s1",
  name: "Billing Modernisation SoAW",
  initiative_id: null,
  status: "draft",
  document_info: { prepared_by: "Ada Lovelace", reviewed_by: "", review_date: "" },
  version_history: [{ version: "0.1", date: "2026-04-20", revised_by: "Ada", description: "First" }],
  sections: { "1.1": { content: "<p>Background</p>", hidden: false } },
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

function GoTo() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/ea-delivery/soaw/s2")}>go-s2</button>;
}

function renderEdit() {
  return renderWithProviders(
    <>
      <SoAWEditor />
      <GoTo />
    </>,
    { route: "/ea-delivery/soaw/s1", routes: [{ path: "/ea-delivery/soaw/:id" }] },
  );
}

const button = (text: string) => screen.getByText(text, { selector: "button" });
const queryButton = (text: string) => screen.queryByText(text, { selector: "button" });
const requestButton = () => button(t("editor.requestSignatures"));
const signDialog = () => screen.queryByLabelText(t("editor.signDialog.title"));
const setValue = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loaded(name = SOAW.name) {
  await screen.findByDisplayValue(name);
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  mockApi.on("get", "/cards?type=Initiative&page_size=500", { items: [] });
  mockApi.on("get", "/auth/me", { id: ADMIN_USER.id });
  mockApi.on("get", "/soaw/s1", SOAW);
  mockApi.on("patch", "/soaw/s1", (_p, body) => ({ ...SOAW, ...(body as object) }));
  mockApi.on("post", "/soaw/s1/request-signatures", (_p) => ({
    ...SOAW,
    name: "Renamed SoAW",
    status: "in_review",
    signatories: [PENDING_U2],
  }));
});

describe("SoAWEditor — requesting signatures saves pending edits first", () => {
  it("edits + request: PATCHes the edited content, then opens the dialog, then requests", async () => {
    renderEdit();
    await loaded();
    setValue(screen.getByDisplayValue(SOAW.name), "Renamed SoAW");

    fireEvent.click(requestButton());
    await waitFor(() => expect(signDialog()).toBeInTheDocument());
    const patches = mockApi.callsOf("patch", "/soaw/s1");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({
      name: "Renamed SoAW",
      initiative_id: null,
      document_info: SOAW.document_info,
      version_history: SOAW.version_history,
    });
    expect(mockApi.callsOf("post", "/soaw/s1/request-signatures")).toHaveLength(0);

    fireEvent.click(within(signDialog() as HTMLElement).getByText("stub-request"));
    expect(await screen.findByText(t("editor.signatureRequestsSent"))).toBeInTheDocument();
    const calls = mockApi.calls.filter((c) => c.method !== "get").map((c) => `${c.method} ${c.path}`);
    expect(calls).toEqual(["patch /soaw/s1", "post /soaw/s1/request-signatures"]);
    expect(screen.queryByText(t("editor.savedSuccessfully"))).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Renamed SoAW")).toBeDisabled();
  });

  it("a failed save shows its error and neither opens the dialog nor requests", async () => {
    mockApi.fail("patch", "/soaw/s1", 500, "boom");
    renderEdit();
    await loaded();
    setValue(screen.getByDisplayValue(SOAW.name), "Renamed SoAW");

    fireEvent.click(requestButton());
    expect(await screen.findByText("PATCH /soaw/s1 failed")).toBeInTheDocument();
    expect(mockApi.callsOf("patch", "/soaw/s1")).toHaveLength(1);
    expect(signDialog()).not.toBeInTheDocument();
    expect(mockApi.callsOf("post", "/soaw/s1/request-signatures")).toHaveLength(0);
    expect(screen.getByDisplayValue("Renamed SoAW")).toBeEnabled();
  });

  it("an emptied name is refused before anything is sent", async () => {
    renderEdit();
    await loaded();
    setValue(screen.getByDisplayValue(SOAW.name), "  ");
    fireEvent.click(requestButton());
    expect(await screen.findByText(t("editor.documentNameRequired"))).toBeInTheDocument();
    expect(mockApi.callsOf("patch", "/soaw/s1")).toHaveLength(0);
    expect(signDialog()).not.toBeInTheDocument();
  });

  it("no edits: the dialog opens with no redundant PATCH", async () => {
    renderEdit();
    await loaded();
    fireEvent.click(requestButton());
    await waitFor(() => expect(signDialog()).toBeInTheDocument());
    fireEvent.click(within(signDialog() as HTMLElement).getByText("stub-request"));
    expect(await screen.findByText(t("editor.signatureRequestsSent"))).toBeInTheDocument();
    expect(mockApi.callsOf("patch", "/soaw/s1")).toHaveLength(0);
  });

  it("a section edit counts too, and goes out with the save", async () => {
    renderEdit();
    await loaded();
    setValue(screen.getByDisplayValue("<p>Background</p>"), "<p>Changed</p>");
    fireEvent.click(requestButton());
    await waitFor(() => expect(signDialog()).toBeInTheDocument());
    const body = mockApi.callsOf("patch", "/soaw/s1")[0].body as { sections: Record<string, { content: string }> };
    expect(body.sections["1.1"].content).toBe("<p>Changed</p>");
  });

  it("after a save, the saved content is the baseline: no second PATCH on request", async () => {
    renderEdit();
    await loaded();
    setValue(screen.getByDisplayValue(SOAW.name), "Renamed SoAW");
    fireEvent.click(screen.getAllByText(t("editor.save"), { selector: "button" })[0]);
    expect(await screen.findByText(t("editor.savedSuccessfully"))).toBeInTheDocument();
    fireEvent.click(requestButton());
    await waitFor(() => expect(signDialog()).toBeInTheDocument());
    expect(mockApi.callsOf("patch", "/soaw/s1")).toHaveLength(1);
  });
});

describe("SoAWEditor — action replies refresh the page", () => {
  it("request signatures: the reply's status, signatories and content show", async () => {
    renderEdit();
    await loaded();
    fireEvent.click(requestButton());
    await waitFor(() => expect(signDialog()).toBeInTheDocument());
    fireEvent.click(within(signDialog() as HTMLElement).getByText("stub-request"));
    expect(await screen.findByDisplayValue("Renamed SoAW")).toBeDisabled();
    expect(screen.getByText(t("adr.banner.inReviewLock"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.signaturesProgress", { signed: 0, total: 1 }))).toBeInTheDocument();
  });

  it("sign: the reply's revision chain and signing date show", async () => {
    mockApi.on("get", "/auth/me", { id: "u2" });
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2] });
    mockApi.on("post", "/soaw/s1/sign", {
      ...SOAW,
      status: "signed",
      signed_at: "2026-06-02T09:30:00Z",
      signatories: [{ ...PENDING_U2, status: "signed", signed_at: "2026-06-02T09:30:00Z" }],
      revision_number: 2,
      is_current: true,
      is_earlier_revision: false,
    });
    renderEdit();
    await loaded();
    fireEvent.click(button(t("editor.sign")));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByText(t("collab.sign.confirm"), { selector: "button" }),
    );
    expect(await screen.findByText(t("editor.documentFullySigned"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.revisionLabel", { number: 2 }))).toBeInTheDocument();
    // A signed current revision offers a new revision: the reply's chain facts were applied.
    expect(screen.getAllByText(t("editor.newRevision"), { selector: "button" })).toHaveLength(2);
  });

  it("recall: the reply's content fills the draft again", async () => {
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_U2] });
    mockApi.on("post", "/soaw/s1/recall-signatures", {
      ...SOAW,
      document_info: { prepared_by: "As stored", reviewed_by: "", review_date: "" },
    });
    renderEdit();
    await loaded();
    fireEvent.click(button(t("editor.recallSignatures")));
    expect(await screen.findByText(t("editor.signaturesRecalled"))).toBeInTheDocument();
    expect(screen.getByDisplayValue("As stored")).toBeEnabled();
    expect(queryButton(t("editor.requestSignatures"))).toBeInTheDocument();
  });
});

describe("SoAWEditor — revision navigation race", () => {
  it("a late reply for the revision just left is ignored, and Save writes the open one", async () => {
    const first = deferred<SoAW>();
    const second = deferred<SoAW>();
    mockApi.on("get", "/soaw/s1", () => first.promise);
    mockApi.on("get", "/soaw/s2", () => second.promise);
    mockApi.on("patch", "/soaw/s2", (_p, body) => ({ ...SOAW, id: "s2", ...(body as object) }));
    renderEdit();
    fireEvent.click(button("go-s2"));
    await waitFor(() => expect(mockApi.callsOf("get", "/soaw/s2")).toHaveLength(1));

    second.resolve({
      ...SOAW,
      id: "s2",
      name: "Revision two",
      sections: { custom_2: { content: "<p>Two</p>", hidden: false, title: "Only in two", insertAfter: "" } as never },
    });
    await loaded("Revision two");
    first.resolve({
      ...SOAW,
      name: "Revision one (late)",
      sections: { custom_1: { content: "<p>One</p>", hidden: false, title: "Only in one", insertAfter: "" } as never },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByDisplayValue("Revision two")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Revision one (late)")).not.toBeInTheDocument();
    expect(screen.queryByText("Only in one")).not.toBeInTheDocument();
    expect(screen.getByText("Only in two")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText(t("editor.save"), { selector: "button" })[0]);
    await waitFor(() => expect(mockApi.callsOf("patch", "/soaw/s2")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/soaw/s1")).toHaveLength(0);
    expect(mockApi.callsOf("patch", "/soaw/s2")[0].body).toMatchObject({ name: "Revision two" });
  });

  it("a late failure for the revision just left shows no error", async () => {
    const first = deferred<SoAW>();
    mockApi.on("get", "/soaw/s1", () => first.promise);
    mockApi.on("get", "/soaw/s2", { ...SOAW, id: "s2", name: "Revision two" });
    renderEdit();
    fireEvent.click(button("go-s2"));
    await loaded("Revision two");
    first.reject(new Error("gone"));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("gone")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Revision two")).toBeInTheDocument();
  });
});
