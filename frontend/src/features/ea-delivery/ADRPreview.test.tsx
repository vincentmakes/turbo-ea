import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ArchitectureDecision } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
// The signed-in user's permissions gate extension panels and slots; `null`
// (the default) is the signed-out shape the export test was written against.
const authState = vi.hoisted(() => ({
  user: null as { id: string; permissions: Record<string, boolean> } | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({
    user: authState.user ?? { id: "u1", permissions: {} },
    refreshUser: async () => {},
  }),
}));
vi.mock("./adrPrint", () => ({ printAdr: vi.fn() }));

import { api } from "@/api/client";
import { printAdr } from "./adrPrint";
import ADRPreview from "./ADRPreview";
import { installClipboard } from "@/test/dom";
import { setViewportWidth } from "@/test/matchMedia";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";

const adr: ArchitectureDecision = {
  id: "adr-1",
  reference_number: "ADR-0001",
  title: "Adopt event bus",
  status: "draft",
  context: "<p>ctx</p>",
  decision: "<p>do it</p>",
  consequences: null,
  alternatives_considered: null,
  related_decisions: [],
  attributes: {},
  created_by: "u1",
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  linked_cards: [],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/adr/")) return adr as never;
    if (path === "/settings/date-format") return { date_format: "YYYY-MM-DD" } as never;
    return {} as never;
  });
  vi.mocked(printAdr).mockReset();
});

function renderPreview() {
  return render(
    <MemoryRouter initialEntries={["/ea-delivery/adr/adr-1/preview"]}>
      <Routes>
        <Route path="/ea-delivery/adr/:id/preview" element={<ADRPreview />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ADRPreview — export buttons", () => {
  it("offers PDF like the SoAW preview (and no Word there), and PDF prints the loaded decision", async () => {
    renderPreview();
    const pdf = await screen.findByRole("button", { name: /PDF$/ });
    expect(screen.queryByRole("button", { name: /Word$/ })).not.toBeInTheDocument();
    await userEvent.click(pdf);
    expect(printAdr).toHaveBeenCalledTimes(1);
    expect(printAdr).toHaveBeenCalledWith(expect.objectContaining({ id: "adr-1" }));
  });
});

// ---------------------------------------------------------------------------
// Load states, content, navigation, extension points
// ---------------------------------------------------------------------------

const SIGNED_ADR: ArchitectureDecision = {
  ...adr,
  id: "adr-2",
  reference_number: "ADR-0002",
  title: "Retire the mainframe",
  status: "signed",
  revision_number: 3,
  consequences: "<p>Cheaper</p>",
  alternatives_considered: null,
  linked_cards: [{ id: "card-9", name: "Mainframe", type: "ITComponent" }],
  signatories: [
    {
      user_id: "u1",
      display_name: "Alice",
      email: "alice@example.com",
      status: "signed",
      signed_at: "2026-06-02T10:00:00Z",
    },
    { user_id: "u2", display_name: "Bob", email: "", status: "signed", signed_at: null },
    { user_id: "u3", display_name: "Carol", email: "carol@example.com", status: "pending", signed_at: null },
    { user_id: "u4", display_name: "Dan", email: "", status: "pending", signed_at: null },
  ],
};

function serve(data: unknown) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/adr/")) return data as never;
    return {} as never;
  });
}

/** The preview under a router that can show where it navigated to. */
function renderNavigable() {
  return render(
    <MemoryRouter initialEntries={["/previous", "/ea-delivery/adr/adr-1/preview"]} initialIndex={1}>
      <Routes>
        <Route path="/previous" element={<div data-testid="previous-page" />} />
        <Route path="/ea-delivery/adr/:id/preview" element={<ADRPreview />} />
        <Route path="/ea-delivery/adr/:id" element={<div data-testid="editor-page" />} />
        <Route path="/cards/:id" element={<div data-testid="card-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ADRPreview — load states", () => {
  it("shows the load error", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("Server exploded"));
    renderPreview();
    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    vi.mocked(api.get).mockRejectedValue("nope");
    renderPreview();
    expect(await screen.findByText("Failed to load")).toBeInTheDocument();
  });

  it("shows the not-found alert when the decision comes back empty", async () => {
    serve(null);
    renderPreview();
    expect(await screen.findByRole("alert")).toHaveTextContent(/not found/i);
  });
});

describe("ADRPreview — content", () => {
  it("renders a draft with placeholders for its empty sections and no signature block", async () => {
    renderPreview();
    expect(await screen.findByText("ctx")).toBeInTheDocument();
    expect(screen.getByText("do it")).toBeInTheDocument();
    // Consequences + alternatives are empty.
    expect(screen.getAllByText("-")).toHaveLength(2);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText(/revision/i)).toBeNull();
    expect(screen.queryByText("Signatures")).toBeNull();
    expect(screen.queryByText("Linked Cards")).toBeNull();
  });

  it("renders a signed revision with signatories, linked cards and the fully-signed chip", async () => {
    serve(SIGNED_ADR);
    renderPreview();
    expect(await screen.findByText("Revision 3")).toBeInTheDocument();
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByText("Cheaper")).toBeInTheDocument();
    expect(screen.getByText("Fully Signed")).toBeInTheDocument();
    expect(screen.getByText("Mainframe")).toBeInTheDocument();
    // Two signed, two pending; emails only where present.
    expect(screen.getAllByText("Approved")).toHaveLength(2);
    expect(screen.getAllByText("Pending")).toHaveLength(2);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("carol@example.com")).toBeInTheDocument();
    expect(screen.getByText("Signed: N/A")).toBeInTheDocument();
    expect(screen.getAllByText(/^Signed: /)).toHaveLength(2);
  });

  it("shows an unknown status verbatim and an in-review signature block", async () => {
    serve({
      ...adr,
      status: "superseded",
      signatories: [{ user_id: "u3", display_name: "Carol", email: "", status: "pending", signed_at: null }],
    });
    renderPreview();
    expect(await screen.findByText("superseded")).toBeInTheDocument();
    expect(screen.getByText("Signatures")).toBeInTheDocument();
    expect(screen.queryByText("Fully Signed")).toBeNull();
  });
});

describe("ADRPreview — toolbar", () => {
  let restoreClipboard: (() => void) | null = null;
  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = null;
  });

  it("copies the page link and confirms it", async () => {
    const clipboard = installClipboard();
    restoreClipboard = clipboard;
    renderPreview();
    await userEvent.click(await screen.findByRole("button", { name: "Copy shareable link" }));
    expect(clipboard.writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText("Link copied to clipboard")).toBeInTheDocument();
  });

  it("reports a failed copy", async () => {
    const clipboard = installClipboard();
    restoreClipboard = clipboard;
    clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    renderPreview();
    await userEvent.click(await screen.findByRole("button", { name: "Copy shareable link" }));
    expect(await screen.findByText("Failed to copy link")).toBeInTheDocument();
  });

  it("opens the editor, a linked card, and goes back", async () => {
    serve(SIGNED_ADR);
    const { unmount } = renderNavigable();
    await userEvent.click(await screen.findByRole("button", { name: /^edit Edit$/ }));
    expect(screen.getByTestId("editor-page")).toBeInTheDocument();
    unmount();

    renderNavigable();
    await userEvent.click(await screen.findByText("Mainframe"));
    expect(screen.getByTestId("card-page")).toBeInTheDocument();
  });

  it("goes back to the previous page", async () => {
    renderNavigable();
    await userEvent.click(await screen.findByRole("button", { name: "Back to EA Delivery" }));
    expect(screen.getByTestId("previous-page")).toBeInTheDocument();
  });

  it("collapses PDF and Edit to icon buttons on a phone", async () => {
    setViewportWidth(375);
    renderNavigable();
    await userEvent.click(await screen.findByRole("button", { name: "Export PDF" }));
    expect(printAdr).toHaveBeenCalledWith(expect.objectContaining({ id: "adr-1" }));
    // The labelled desktop button is gone; only the icon button remains.
    expect(screen.queryByRole("button", { name: "picture_as_pdf PDF" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("editor-page")).toBeInTheDocument();
  });
});

describe("ADRPreview — extension points", () => {
  beforeEach(() => {
    resetExtensionHost();
    authState.user = null;
  });
  afterEach(() => {
    resetExtensionHost();
    authState.user = null;
  });

  function Panel(props: { adrId: string; status: string; signed: boolean; readOnly: boolean }) {
    return (
      <div data-testid="adr-panel">
        {props.adrId}|{props.status}|{String(props.signed)}|{String(props.readOnly)}
      </div>
    );
  }

  it("renders read-only ADR panels and the two slots with the decision's context", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [{ id: "savings", component: Panel }],
      slots: [
        {
          slot: "adr.header",
          id: "hdr",
          component: (ctx: Record<string, unknown>) => (
            <span data-testid="header-slot">{String(ctx.signed)}</span>
          ),
        },
        {
          slot: "adr.signature.footer",
          id: "ftr",
          component: (ctx: Record<string, unknown>) => (
            <span data-testid="footer-slot">{String(ctx.readOnly)}</span>
          ),
        },
      ],
    });
    serve(SIGNED_ADR);
    renderPreview();
    expect(await screen.findByTestId("adr-panel")).toHaveTextContent("adr-1|signed|true|true");
    expect(screen.getByTestId("header-slot")).toHaveTextContent("true");
    expect(screen.getByTestId("footer-slot")).toHaveTextContent("true");
  });

  it("hides a permission-gated panel from a user without the permission", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [
        { id: "open", component: Panel },
        { id: "gated", permission: "ext.vs.view", component: () => <div data-testid="gated" /> },
      ],
    });
    authState.user = { id: "u1", permissions: { "adr.view": true } };
    renderPreview();
    expect(await screen.findByTestId("adr-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("gated")).toBeNull();
  });

  it("shows a permission-gated panel to a user holding the permission", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [{ id: "gated", permission: "ext.vs.view", component: () => <div data-testid="gated" /> }],
    });
    authState.user = { id: "u1", permissions: { "ext.vs.view": true } };
    renderPreview();
    await waitFor(() => expect(screen.getByTestId("gated")).toBeInTheDocument());
  });
});
