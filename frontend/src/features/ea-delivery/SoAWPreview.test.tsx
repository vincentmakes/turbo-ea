import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useNavigate } from "react-router";
import type { SoAW, SoAWSectionData } from "@/types";

// The discussion and history side panel has its own tests: here the page
// renders alone, and the props it hands the panel are recorded.
// It provides the section markers' data the test sets (`sidePanel.sections`).
const sidePanel = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
  sections: null as null | {
    counts: Record<string, { open: number; total: number }>;
    canComment: boolean;
    openSection: (section: string) => void;
  },
}));
vi.mock("./collab/DocumentSidePanel", async () => {
  const { SectionDiscussionContext } = await import("./collab/sectionDiscussionContext");
  return {
    default: (props: { children: React.ReactNode }) => {
      sidePanel.props.push(props);
      return (
        <SectionDiscussionContext.Provider value={sidePanel.sections}>{props.children}</SectionDiscussionContext.Provider>
      );
    },
  };
});
// The History view has its own tests: here it records what the page hands
// it, and hands back the document a restore returns.
const historyView = vi.hoisted(() => ({ props: [] as Record<string, unknown>[], restored: null as unknown }));
vi.mock("./collab/DocumentHistoryDialog", () => ({
  default: (props: { onRestored?: (d: unknown) => void }) => {
    historyView.props.push(props);
    return (
      <div role="dialog" aria-label="history-view">
        <button type="button" onClick={() => props.onRestored?.(historyView.restored)}>
          restore-it
        </button>
      </div>
    );
  },
}));
vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
// The preview builds its body with the real `buildPreviewBody`; the print
// path (which opens a window) is stubbed, and the page's `<style>` is blanked
// because jsdom's CSS parser rejects part of it and logs a stack trace per
// render straight to the process console (browsers parse it fine, and the
// stylesheet is not what these tests are about).
vi.mock("./soawExport", async () => {
  const actual = await vi.importActual<typeof import("./soawExport")>("./soawExport");
  return { ...actual, exportToPdf: vi.fn(), PREVIEW_CSS: "" };
});

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { setViewportWidth } from "@/test/matchMedia";
import { renderWithProviders } from "@/test/render";

import { DELIVERABLE_COLORS, RAG_COLORS, WARNING_STRONG_COLOR } from "@/theme/tokens";

import { exportToPdf } from "./soawExport";
import SoAWPreview from "./SoAWPreview";

const t = (key: string, opts?: Record<string, unknown>) => String(i18n.t(`delivery:${key}`, opts as never));
const tc = (key: string) => String(i18n.t(`common:${key}`));

type CustomSection = SoAWSectionData & { title: string; insertAfter: string };

const SOAW: SoAW = {
  id: "s1",
  name: "Billing Modernisation SoAW",
  initiative_id: null,
  status: "draft",
  document_info: { prepared_by: "Ada Lovelace", reviewed_by: "Grace Hopper", review_date: "2026-05-01" },
  version_history: [{ version: "0.1", date: "2026-04-20", revised_by: "Ada", description: "First draft" }],
  sections: {
    "1.1": { content: "<p>Replace the legacy billing engine.</p>", hidden: false },
    "1.2": { content: "<p>This text is hidden from the preview.</p>", hidden: true },
    "2.1": {
      content: "",
      hidden: false,
      table_data: { columns: ["Business Objective", "Notes"], rows: [["Cut invoice latency", "Target Q4"]] },
    },
    custom_7: { content: "<p>Appendix body</p>", hidden: false, title: "Appendix A", insertAfter: "1.1" } as CustomSection,
  },
  revision_number: 1,
  parent_id: null,
  signatories: [],
  signed_at: null,
};

const PENDING_SIGNATORY = {
  user_id: "u2",
  display_name: "Grace Hopper",
  email: "grace@example.com",
  status: "pending" as const,
  signed_at: null,
};
const SIGNED_SIGNATORY = { ...PENDING_SIGNATORY, status: "signed" as const, signed_at: "2026-06-02T09:30:00Z" };

function renderPreview(id = "s1") {
  return renderWithProviders(<SoAWPreview />, {
    route: `/ea-delivery/soaw/${id}/preview`,
    routes: [
      { path: "/ea-delivery/soaw/:id/preview" },
      { path: "/ea-delivery/soaw/:id", element: <div>editor page</div> },
      { path: "/ea-delivery", element: <div>delivery home</div> },
    ],
  });
}

/** The rendered document body (the sanitised HTML the export shares). */
function previewBody(): HTMLElement {
  const body = document.querySelector(".soaw-preview");
  if (!body) throw new Error("no preview body");
  return body as HTMLElement;
}

/** The React signature block under the level-6 "Signatures" heading. */
function signatureBlock(): HTMLElement {
  const heading = screen.getByRole("heading", { level: 6, name: t("editor.signatures") });
  return heading.closest(".MuiBox-root")!.parentElement as HTMLElement;
}

/** A button whose accessible name includes `text` (icon glyphs join the name). */
const button = (text: string) => screen.getByRole("button", { name: (n) => n.includes(text) });

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  vi.mocked(exportToPdf).mockReset();
  mockApi.on("get", "/soaw/s1", SOAW);
});

afterEach(() => {
  setViewportWidth(1280);
});

describe("SoAWPreview — loading", () => {
  it("renders the document name, status and the export body", async () => {
    renderPreview();

    expect(await screen.findByRole("heading", { name: SOAW.name })).toBeInTheDocument();
    expect(screen.getByText(t("status.draft"))).toBeInTheDocument();

    const body = previewBody();
    expect(within(body).getByRole("heading", { level: 1 })).toHaveTextContent(t("export.soawTitle"));
    expect(body).toHaveTextContent("Replace the legacy billing engine.");
    // Document info and version history tables.
    expect(body).toHaveTextContent("Ada Lovelace");
    expect(body).toHaveTextContent("First draft");
    // Table sections render their rows.
    expect(body).toHaveTextContent("Cut invoice latency");
  });

  it("omits hidden sections and keeps custom sections where they were anchored", async () => {
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    const body = previewBody();
    expect(body).not.toHaveTextContent("This text is hidden from the preview.");
    expect(body).toHaveTextContent("Appendix A");
    expect(body).toHaveTextContent("Appendix body");
    const headings = within(body).getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    const idx11 = headings.findIndex((h) => h.includes(t("template.section_1_1.title")));
    const idxAppendix = headings.findIndex((h) => h.includes("Appendix A"));
    expect(idx11).toBeGreaterThanOrEqual(0);
    expect(idxAppendix).toBe(idx11 + 1);
  });

  it("names a later revision in the title line", async () => {
    mockApi.on("get", "/soaw/s1", { ...SOAW, revision_number: 3 });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(previewBody()).toHaveTextContent(t("export.revision", { number: 3 }).trim());
  });

  it("shows the server's error when the document cannot be loaded", async () => {
    mockApi.fail("get", "/soaw/missing", 404, "Not found");
    renderPreview("missing");

    expect(await screen.findByRole("alert")).toHaveTextContent("GET /soaw/missing failed");
    expect(screen.queryByRole("button", { name: (n) => n.includes(t("editor.pdf")) })).not.toBeInTheDocument();
  });

  it("shows the not-found copy when the server returns nothing", async () => {
    mockApi.on("get", "/soaw/s1", null);
    renderPreview();

    expect(await screen.findByRole("alert")).toHaveTextContent(t("preview.notFound"));
  });
});

describe("SoAWPreview — revisions", () => {
  it("points an earlier revision to the current one's preview, with the chain strip", async () => {
    mockApi.on("get", "/soaw/s1", {
      ...SOAW,
      status: "signed",
      is_current: false,
      is_earlier_revision: true,
      superseded_by: { id: "s2", name: SOAW.name, revision_number: 2 },
      revisions: [
        { id: "s1", name: SOAW.name, revision_number: 1, status: "signed" },
        { id: "s2", name: SOAW.name, revision_number: 2, status: "signed" },
      ],
    });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(screen.getByText(t("adr.banner.earlierRevision", { current: "Rev 2" }))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("adr.banner.openCurrent") })).toHaveAttribute(
      "href",
      "/ea-delivery/soaw/s2/preview",
    );
    expect(screen.getByTestId("revision-s1")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("revision-s2")).toHaveAttribute("href", "/ea-delivery/soaw/s2/preview");
    // History sits beside the strip, once.
    const strip = screen.getByRole("navigation", { name: t("adr.revision.strip") });
    expect(within(strip.parentElement as HTMLElement).getByRole("button", { name: /History$/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /History$/ })).toHaveLength(1);
  });

  it("shows no review-lock hint in the preview and no strip for a single revision", async () => {
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", revisions: [] });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(screen.queryByText(t("adr.banner.inReviewLock"))).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: t("adr.revision.strip") })).not.toBeInTheDocument();
  });
});

describe("SoAWPreview — signatures", () => {
  it("renders no signature block without signatories", async () => {
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(screen.queryByRole("heading", { level: 6, name: t("editor.signatures") })).not.toBeInTheDocument();
  });

  it("lists a pending signatory as pending, with no signed stamp", async () => {
    mockApi.on("get", "/soaw/s1", { ...SOAW, status: "in_review", signatories: [PENDING_SIGNATORY] });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    expect(screen.getByText(t("status.inReview"))).toBeInTheDocument();
    const block = signatureBlock();
    expect(within(block).getByText(t("editor.sigPending"))).toBeInTheDocument();
    expect(within(block).getByText("Grace Hopper")).toBeInTheDocument();
    expect(within(block).getByText("grace@example.com")).toBeInTheDocument();
    expect(within(block).queryByText(t("editor.fullySigned"))).not.toBeInTheDocument();
    expect(within(block).queryByText(/^Signed:/)).not.toBeInTheDocument();
  });

  it("marks a signed document fully signed and stamps each signature", async () => {
    mockApi.on("get", "/soaw/s1", {
      ...SOAW,
      status: "signed",
      signed_at: "2026-06-02T09:30:00Z",
      signatories: [SIGNED_SIGNATORY, { ...SIGNED_SIGNATORY, user_id: "u3", display_name: "Linus", email: undefined }],
    });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    expect(screen.getByText(t("status.signed"))).toBeInTheDocument();
    const block = signatureBlock();
    expect(within(block).getByText(t("editor.fullySigned"))).toBeInTheDocument();
    expect(within(block).getAllByText(t("editor.sigApproved"))).toHaveLength(2);
    expect(within(block).getAllByText(/^Signed: 2026-06-02/)).toHaveLength(2);
    expect(within(block).queryByText(t("editor.sigPending"))).not.toBeInTheDocument();
    // The second signatory carries no email, so only one address is listed.
    expect(within(block).getAllByText(/@example\.com$/)).toHaveLength(1);
  });

  it("tints a signed signatory's card with the theme's success colour and greys a pending one", async () => {
    mockApi.on("get", "/soaw/s1", {
      ...SOAW,
      status: "in_review",
      signatories: [SIGNED_SIGNATORY, { ...PENDING_SIGNATORY, user_id: "u3", display_name: "Linus" }],
    });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    const block = signatureBlock();
    const signedCard = within(block).getByText("Grace Hopper").parentElement as HTMLElement;
    const pendingCard = within(block).getByText("Linus").parentElement as HTMLElement;
    expect(signedCard).toHaveStyle({ backgroundColor: "rgba(46, 125, 50, 0.08)" });
    expect(pendingCard).toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0.04)" });
  });

  it("falls back to N/A for a signed row without a timestamp", async () => {
    mockApi.on("get", "/soaw/s1", {
      ...SOAW,
      status: "signed",
      signatories: [{ ...SIGNED_SIGNATORY, signed_at: null }],
    });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(within(signatureBlock()).getByText(t("editor.sigSignedAt", { date: "N/A" }))).toBeInTheDocument();
  });
});

describe("SoAWPreview — actions", () => {
  it("exports the loaded document to PDF", async () => {
    const { user } = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    await user.click(button(t("editor.pdf")));

    expect(exportToPdf).toHaveBeenCalledTimes(1);
    const [name, docInfo, versionHistory, sections, customSections, revision, signatories, signedAt] =
      vi.mocked(exportToPdf).mock.calls[0];
    expect(name).toBe(SOAW.name);
    expect(docInfo).toEqual(SOAW.document_info);
    expect(versionHistory).toEqual(SOAW.version_history);
    // Template sections and custom sections are split before the export.
    expect(Object.keys(sections)).toEqual(["1.1", "1.2", "2.1"]);
    expect(customSections).toEqual([
      { id: "custom_7", title: "Appendix A", content: "<p>Appendix body</p>", insertAfter: "1.1" },
    ]);
    expect(revision).toBe(1);
    expect(signatories).toEqual([]);
    expect(signedAt).toBeNull();
  });

  it("offers no Word export (the editor owns it)", async () => {
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(screen.queryByRole("button", { name: (n) => n.includes(t("editor.word")) })).not.toBeInTheDocument();
  });

  it("navigates to the editor", async () => {
    const { user } = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    await user.click(button(tc("actions.edit")));
    expect(await screen.findByText("editor page")).toBeInTheDocument();
  });

  it("the back arrow returns to EA Delivery", async () => {
    const { user } = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    await user.click(screen.getByRole("button", { name: t("preview.backTooltip") }));
    expect(await screen.findByText("delivery home")).toBeInTheDocument();
  });

  it("copies the shareable link and confirms in a snackbar", async () => {
    const { user } = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    // `userEvent.setup()` (inside renderWithProviders) installs its own
    // clipboard stub, so the spy goes on after rendering.
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    await user.click(screen.getByRole("button", { name: t("preview.copyLink") }));

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText(t("preview.linkCopied"))).toBeInTheDocument();
    writeText.mockRestore();
  });

  it("reports a clipboard failure", async () => {
    const { user } = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));

    await user.click(screen.getByRole("button", { name: t("preview.copyLink") }));

    expect(await screen.findByText(t("preview.linkCopyFailed"))).toBeInTheDocument();
    writeText.mockRestore();
  });

  it("collapses the toolbar to icon buttons on a phone", async () => {
    setViewportWidth(500);
    const { user } = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });

    // Icon buttons carry the tooltip text as their name; the text buttons are gone.
    expect(
      screen.queryByRole("button", {
        name: (n) => n.includes(t("editor.pdf")) && !n.includes(t("editor.exportPdf")),
      }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("editor.exportPdf") }));
    expect(exportToPdf).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: tc("actions.edit") }));
    await waitFor(() => expect(screen.getByText("editor page")).toBeInTheDocument());
  });
});

describe("SoAWPreview — colours", () => {
  /** The Material Symbols glyph spelled `icon`, if one is rendered. */
  const glyph = (icon: string) =>
    [...document.querySelectorAll(".material-symbols-outlined")].find((el) => el.textContent === icon);

  it("shows the document glyph in the SoAW colour on a wide screen only", async () => {
    const first = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(glyph("description")).toHaveStyle({ color: DELIVERABLE_COLORS.soaw });
    first.unmount();

    setViewportWidth(500);
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(glyph("description")).toBeUndefined();
  });

  it.each([
    ["signed", SIGNED_SIGNATORY, "verified", RAG_COLORS.green],
    ["in_review", PENDING_SIGNATORY, "draw", WARNING_STRONG_COLOR],
  ] as const)("colours the signature heading's glyph of a %s document", async (status, signatory, icon, color) => {
    mockApi.on("get", "/soaw/s1", { ...SOAW, status, signatories: [signatory] });
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    // The heading glyph comes first; a signed signatory repeats "verified" below it.
    expect(within(signatureBlock()).getAllByText(icon)[0]).toHaveStyle({ color });
  });
});

describe("SoAWPreview — revision navigation race", () => {
  function GoTo() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate("/ea-delivery/soaw/s2/preview")}>
        go
      </button>
    );
  }

  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function renderRace(first: Promise<SoAW>, second: Promise<SoAW>) {
    mockApi.on("get", "/soaw/s1", () => first);
    mockApi.on("get", "/soaw/s2", () => second);
    return renderWithProviders(
      <>
        <SoAWPreview />
        <GoTo />
      </>,
      {
        route: "/ea-delivery/soaw/s1/preview",
        routes: [{ path: "/ea-delivery/soaw/:id/preview" }],
      },
    );
  }

  it("a late reply for the revision just left is ignored", async () => {
    const first = deferred<SoAW>();
    const second = deferred<SoAW>();
    const { user } = renderRace(first.promise, second.promise);
    await user.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(mockApi.callsOf("get", "/soaw/s2")).toHaveLength(1));
    second.resolve({ ...SOAW, id: "s2", name: "Revision two" });
    expect((await screen.findAllByText("Revision two")).length).toBeGreaterThan(0);
    first.resolve({ ...SOAW, name: "Revision one (late)" });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getAllByText("Revision two").length).toBeGreaterThan(0);
    expect(screen.queryByText("Revision one (late)")).toBeNull();
  });

  it("a late failure for the revision just left shows no error", async () => {
    const first = deferred<SoAW>();
    const { user } = renderRace(first.promise, Promise.resolve({ ...SOAW, id: "s2", name: "Revision two" }));
    await user.click(screen.getByRole("button", { name: "go" }));
    expect((await screen.findAllByText("Revision two")).length).toBeGreaterThan(0);
    first.reject(new Error("gone"));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("gone")).toBeNull();
    expect(screen.getAllByText("Revision two").length).toBeGreaterThan(0);
  });
});

describe("SoAWPreview — mentions", () => {
  const CARD = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";
  const WITH_MENTIONS: SoAW = {
    ...SOAW,
    sections: {
      "1.1": {
        content:
          `<p>scope: <span data-type="mention" data-kind="card" data-id="${CARD}">@SAP ERP</span> ` +
          '<span data-type="mention" data-kind="decision" data-restricted="true" data-token="ab12cd34"></span></p>',
        hidden: false,
      },
      custom_7: {
        content: `<p><span data-type="mention" data-kind="card" data-id="${CARD}" data-missing="true"></span></p>`,
        hidden: false,
        title: "Appendix A",
        insertAfter: "1.1",
      } as CustomSection,
    },
  };

  function renderRouted() {
    mockApi.on("get", "/soaw/s1", WITH_MENTIONS);
    return renderWithProviders(<SoAWPreview />, {
      route: "/ea-delivery/soaw/s1/preview",
      routes: [
        { path: "/ea-delivery/soaw/:id/preview" },
        { path: "/cards/:id", element: <div>card page</div> },
      ],
    });
  }

  it("fills the restricted and deleted labels, in template and custom sections", async () => {
    renderRouted();
    const card = await within(await waitFor(previewBody)).findByText("@SAP ERP");
    expect(card).toHaveAttribute("role", "link");
    const restricted = within(previewBody()).getByText("Restricted decision");
    expect(restricted).not.toHaveAttribute("role");
    const deleted = within(previewBody()).getByText("Deleted card");
    expect(deleted).toHaveAttribute("data-missing", "true");
    expect(deleted).not.toHaveAttribute("role");
  });

  it("navigates from a card chip, not from a restricted one", async () => {
    const { user } = renderRouted();
    await user.click(await screen.findByText("Restricted decision"));
    expect(screen.queryByText("card page")).not.toBeInTheDocument();
    await user.click(screen.getByText("@SAP ERP"));
    expect(await screen.findByText("card page")).toBeInTheDocument();
  });
});

describe("SoAWPreview — discussion", () => {
  it("mounts the side panel for the document with its sections", async () => {
    sidePanel.props.length = 0;
    mockApi.on("get", "/soaw/s1", {
      ...SOAW,
      open_thread_count: 1,
      signatories: [{ user_id: "s1", display_name: "S", status: "pending", signed_at: null }],
    });
    renderPreview();
    await waitFor(() => expect(sidePanel.props.length).toBeGreaterThan(0));
    const props = sidePanel.props[sidePanel.props.length - 1];
    expect(props.owner).toEqual({ kind: "soaw", id: "s1" });
    expect(props).not.toHaveProperty("status");
    expect(props).not.toHaveProperty("onRestored");
    expect(props.openThreadCount).toBe(1);
    // A comment's "@" lists the signatories first.
    expect(props.mentionContext).toEqual({ priorityUserIds: ["s1"] });
    expect((props.sections as { key: string }[])[0].key).toBe("general");
  });

  it("shows History in the header, opens it for the document and shows a restored version", async () => {
    historyView.props.length = 0;
    mockApi.on("get", "/soaw/s1", { ...SOAW, revisions: [] });
    const { user } = renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    await user.click(screen.getByRole("button", { name: /History$/ }));
    expect(screen.getByRole("dialog", { name: "history-view" })).toBeInTheDocument();
    expect(historyView.props[historyView.props.length - 1]).toMatchObject({
      owner: { kind: "soaw", id: "s1" },
      label: SOAW.name,
      status: SOAW.status,
    });
    historyView.restored = { ...SOAW, name: "Restored SoAW name" };
    await user.click(screen.getByRole("button", { name: "restore-it" }));
    expect(await screen.findByRole("heading", { name: "Restored SoAW name" })).toBeInTheDocument();
  });
});

describe("SoAWPreview — section markers", () => {
  it("marks the section headings that have threads, custom ones included, and opens the discussion on one", async () => {
    const openSection = vi.fn();
    sidePanel.sections = {
      counts: { "1.1": { open: 2, total: 2 }, custom_7: { open: 0, total: 1 }, "1.2": { open: 1, total: 1 } },
      canComment: false,
      openSection,
    };
    try {
      const { user } = renderPreview();
      await screen.findByRole("heading", { name: SOAW.name });
      const open = await screen.findByRole("button", { name: "2 open threads on this section" });
      expect(open.closest("[data-section]")).toHaveAttribute("data-section", "1.1");
      expect(open.closest(".soaw-preview")).toBe(previewBody());
      expect(open.parentElement).toHaveClass("no-print");
      const done = screen.getByRole("button", { name: "Resolved discussion on this section" });
      expect(done.closest("[data-section]")).toHaveAttribute("data-section", "custom_7");
      // 1.2 is hidden from the preview: no heading, so no marker.
      expect(screen.getAllByTestId(/^section-marker-/)).toHaveLength(2);
      await user.click(done);
      expect(openSection).toHaveBeenCalledWith("custom_7");
    } finally {
      sidePanel.sections = null;
    }
  });

  it("keeps the body and its markers when the page re-renders (Copy link)", async () => {
    sidePanel.sections = { counts: { "1.1": { open: 1, total: 1 } }, canComment: false, openSection: vi.fn() };
    try {
      const { user } = renderPreview();
      await screen.findByRole("heading", { name: SOAW.name });
      const heading = previewBody().querySelector('[data-section="1.1"]');
      expect(await screen.findByTestId("section-marker-1.1")).toBeInTheDocument();
      const writeText = vi.spyOn(navigator.clipboard, "writeText");
      await user.click(screen.getByRole("button", { name: t("preview.copyLink") }));
      expect(await screen.findByText(t("preview.linkCopied"))).toBeInTheDocument();
      writeText.mockRestore();
      // The body was not rebuilt: the same heading node, still in the page.
      expect(heading?.isConnected).toBe(true);
      expect(previewBody().querySelector('[data-section="1.1"]')).toBe(heading);
      expect(screen.getByTestId("section-marker-1.1").closest("[data-section]")).toBe(heading);
      expect(screen.getAllByTestId(/^section-marker-/)).toHaveLength(1);
      expect(previewBody().querySelectorAll("span.no-print")).toHaveLength(1);
    } finally {
      sidePanel.sections = null;
    }
  });

  it("marks every anchored heading for a reader who may comment, a quiet one included", async () => {
    const openSection = vi.fn();
    sidePanel.sections = { counts: { "1.1": { open: 1, total: 1 } }, canComment: true, openSection };
    try {
      const { user } = renderPreview();
      await screen.findByRole("heading", { name: SOAW.name });
      await screen.findByTestId("section-marker-1.1");
      const anchored = Array.from(previewBody().querySelectorAll("[data-section]")).map((h) =>
        h.getAttribute("data-section"),
      );
      expect(anchored).toContain("custom_7");
      const marked = screen.getAllByTestId(/^section-marker-/).map((m) => m.closest("[data-section]")?.getAttribute("data-section"));
      expect(marked).toEqual(anchored);
      const add = screen.getByTestId("section-marker-custom_7");
      expect(add).toHaveAccessibleName("Comment on this section");
      await user.click(add);
      expect(openSection).toHaveBeenCalledWith("custom_7");
    } finally {
      sidePanel.sections = null;
    }
  });

  it("anchors the on-screen headings by section and shows no marker without threads", async () => {
    renderPreview();
    await screen.findByRole("heading", { name: SOAW.name });
    expect(previewBody().querySelector('[data-section="1.1"]')).not.toBeNull();
    expect(previewBody().querySelector('[data-section="custom_7"]')).not.toBeNull();
    expect(screen.queryAllByTestId(/^section-marker-/)).toHaveLength(0);
  });
});
