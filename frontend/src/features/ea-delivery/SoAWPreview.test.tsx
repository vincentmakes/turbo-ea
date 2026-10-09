import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { SoAW, SoAWSectionData } from "@/types";

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
