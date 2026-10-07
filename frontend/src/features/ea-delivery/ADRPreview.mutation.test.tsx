/**
 * Mutation-hardening tests for ADRPreview: the loading state, the section
 * headings, what the extension panel and the two slots receive, the signature
 * block's signed/pending rendering, decisions with no card links or
 * signatories at all, and the copy-link snackbar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import type { ArchitectureDecision } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
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
vi.mock("@/features/ea-delivery/adrPrint", () => ({ printAdr: vi.fn() }));

import { api } from "@/api/client";
import ADRPreview from "./ADRPreview";
import { installClipboard } from "@/test/dom";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";

const BASE: ArchitectureDecision = {
  id: "adr-1",
  reference_number: "ADR-0001",
  title: "Adopt event bus",
  status: "draft",
  context: "<p>ctx</p>",
  decision: "<p>do it</p>",
  consequences: "<p>cons</p>",
  alternatives_considered: "<p>alts</p>",
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

const PENDING_SIG = {
  user_id: "u3",
  display_name: "Carol",
  email: "carol@example.com",
  status: "pending" as const,
  signed_at: null,
};
const SIGNED_SIG = {
  user_id: "u1",
  display_name: "Alice",
  email: "alice@example.com",
  status: "signed" as const,
  signed_at: "2026-06-02T10:00:00Z",
};

/** Serve one ADR per id; anything else answers with an empty object. */
function serve(byId: Record<string, unknown>) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    const m = /^\/adr\/(.+)$/.exec(path);
    if (m) return byId[m[1]] as never;
    return {} as never;
  });
}

function NavButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go
    </button>
  );
}

function tree(path = "/ea-delivery/adr/adr-1/preview", routePath = "/ea-delivery/adr/:id/preview") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<ADRPreview />} />
      </Routes>
      <NavButton to="/ea-delivery/adr/adr-2/preview" />
    </MemoryRouter>
  );
}

function renderPreview(path?: string, routePath?: string) {
  return render(tree(path, routePath));
}

const adrCalls = () =>
  vi.mocked(api.get).mock.calls.filter(([p]) => String(p).startsWith("/adr/"));

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  serve({ "adr-1": BASE });
  resetExtensionHost();
  authState.user = null;
});

afterEach(() => {
  resetExtensionHost();
  authState.user = null;
});

describe("ADRPreview — loading", () => {
  it("paints a spinner, not an alert, before the decision is fetched", () => {
    const html = renderToStaticMarkup(tree());
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain('role="alert"');
  });

  it("keeps the spinner up while the request is in flight", async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}) as never);
    renderPreview();
    await waitFor(() => expect(adrCalls()).toHaveLength(1));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("requests nothing when the route carries no id", async () => {
    renderPreview("/preview", "/preview");
    await act(async () => {
      await Promise.resolve();
    });
    expect(adrCalls()).toHaveLength(0);
  });

  it("reloads (showing the spinner again) when the id in the URL changes", async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/adr/adr-1") return BASE as never;
      if (path === "/adr/adr-2")
        return new Promise((resolve) => {
          release = resolve;
        }) as never;
      return {} as never;
    });
    const user = userEvent.setup();
    renderPreview();
    expect(await screen.findByRole("heading", { name: "ADR-0001", level: 4 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(adrCalls().map(([p]) => p)).toContain("/adr/adr-2"));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Adopt event bus")).not.toBeInTheDocument();

    await act(async () => {
      release({ ...BASE, id: "adr-2", reference_number: "ADR-0002", title: "Second decision" });
    });
    expect(await screen.findByRole("heading", { name: "ADR-0002", level: 4 })).toBeInTheDocument();
    expect(screen.getAllByText("Second decision")).toHaveLength(2);
  });
});

describe("ADRPreview — content", () => {
  it("heads each of the four sections with its translated label", async () => {
    renderPreview();
    for (const name of ["Context", "Decision", "Alternatives Considered", "Consequences"]) {
      expect(await screen.findByRole("heading", { name, level: 6 })).toBeInTheDocument();
    }
    expect(screen.getByText("alts")).toBeInTheDocument();
    expect(screen.getByText("cons")).toBeInTheDocument();
  });

  it("labels an in-review decision", async () => {
    serve({ "adr-1": { ...BASE, status: "in_review" } });
    renderPreview();
    expect(await screen.findByText("In Review")).toBeInTheDocument();
  });

  it("heads the linked cards", async () => {
    serve({
      "adr-1": { ...BASE, linked_cards: [{ id: "c1", name: "Mainframe", type: "ITComponent" }] },
    });
    renderPreview();
    expect(await screen.findByRole("heading", { name: "Linked Cards" })).toBeInTheDocument();
    expect(screen.getByText("Mainframe")).toBeInTheDocument();
  });

  it("renders a decision whose card links and signatories are missing altogether", async () => {
    serve({ "adr-1": { ...BASE, linked_cards: undefined, signatories: undefined } });
    renderPreview();
    expect(await screen.findByRole("heading", { name: "ADR-0001", level: 4 })).toBeInTheDocument();
    expect(screen.queryByText("Linked Cards")).not.toBeInTheDocument();
    expect(screen.queryByText("Signatures")).not.toBeInTheDocument();
  });

  it("shows no snackbar once loaded", async () => {
    renderPreview();
    expect(await screen.findByRole("heading", { name: "ADR-0001", level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ADRPreview — signature block", () => {
  it("marks a decision still collecting signatures with the draw icon in orange", async () => {
    serve({ "adr-1": { ...BASE, status: "in_review", signatories: [PENDING_SIG] } });
    renderPreview();
    const heading = await screen.findByRole("heading", { name: "Signatures" });
    const icon = heading.previousElementSibling as HTMLElement;
    expect(icon).toHaveTextContent("draw");
    expect(icon).toHaveStyle({ color: "#ed6c02" });
    expect(screen.queryByText("verified")).not.toBeInTheDocument();
  });

  it("marks a signed decision with the verified icon in green", async () => {
    serve({ "adr-1": { ...BASE, status: "signed", signatories: [SIGNED_SIG] } });
    renderPreview();
    const heading = await screen.findByRole("heading", { name: "Signatures" });
    const icon = heading.previousElementSibling as HTMLElement;
    expect(icon).toHaveTextContent("verified");
    expect(icon).toHaveStyle({ color: "#2e7d32" });
    expect(screen.queryByText("draw")).not.toBeInTheDocument();
  });

  it("shows each signatory's email as a caption under the name", async () => {
    serve({ "adr-1": { ...BASE, status: "in_review", signatories: [SIGNED_SIG, PENDING_SIG] } });
    renderPreview();
    const alice = await screen.findByText("alice@example.com");
    const carol = screen.getByText("carol@example.com");
    expect(alice.tagName).toBe("SPAN");
    expect(carol.tagName).toBe("SPAN");
  });

  it("renders no empty caption for a signatory without an email", async () => {
    serve({
      "adr-1": {
        ...BASE,
        status: "in_review",
        signatories: [
          { ...SIGNED_SIG, email: "" },
          { ...PENDING_SIG, email: "" },
        ],
      },
    });
    renderPreview();
    const aliceName = await screen.findByText("Alice");
    const carolName = screen.getByText("Carol");
    // Signed: name, then the signed-at line; pending: the name is the last line.
    expect(aliceName.nextElementSibling).toHaveTextContent("Signed: ");
    expect(carolName.nextElementSibling).toBeNull();
  });

  it("highlights the signed signatory's card and greys the pending one", async () => {
    serve({ "adr-1": { ...BASE, status: "in_review", signatories: [SIGNED_SIG, PENDING_SIG] } });
    renderPreview();
    const signedCard = (await screen.findByText("Alice")).parentElement as HTMLElement;
    const pendingCard = screen.getByText("Carol").parentElement as HTMLElement;
    expect(signedCard).toHaveStyle({ borderColor: "#4caf50" });
    expect(pendingCard).toHaveStyle({ borderColor: "rgba(0, 0, 0, 0.12)" });
    expect(pendingCard).toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0.04)" });
    expect(signedCard).not.toHaveStyle({ backgroundColor: "rgba(0, 0, 0, 0.04)" });
  });
});

describe("ADRPreview — extension points", () => {
  function Panel(props: { adrId: string; status: string; signed: boolean; readOnly: boolean }) {
    return <div data-testid="adr-panel">{`${props.status}|${String(props.signed)}`}</div>;
  }

  function registerAll() {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [{ id: "savings", component: Panel }],
      slots: [
        {
          slot: "adr.header",
          id: "hdr",
          component: (ctx: Record<string, unknown>) => (
            <span data-testid="header-slot">
              {`${String(ctx.signed)}|${JSON.stringify(ctx.attributes)}`}
            </span>
          ),
        },
        {
          slot: "adr.signature.footer",
          id: "ftr",
          component: (ctx: Record<string, unknown>) => (
            <span data-testid="footer-slot">
              {`${String(ctx.signed)}|${JSON.stringify(ctx.attributes)}`}
            </span>
          ),
        },
      ],
    });
  }

  it("tells a draft's panel and slots it is not signed, and passes its attributes", async () => {
    registerAll();
    serve({ "adr-1": { ...BASE, attributes: { "ext.vs.savings": 5 } } });
    renderPreview();
    expect(await screen.findByTestId("adr-panel")).toHaveTextContent("draft|false");
    expect(screen.getByTestId("header-slot")).toHaveTextContent('false|{"ext.vs.savings":5}');
    expect(screen.getByTestId("footer-slot")).toHaveTextContent('false|{"ext.vs.savings":5}');
  });

  it("tells a signed decision's slots it is signed", async () => {
    registerAll();
    serve({ "adr-1": { ...BASE, status: "signed" } });
    renderPreview();
    expect(await screen.findByTestId("footer-slot")).toHaveTextContent("true|{}");
    expect(screen.getByTestId("header-slot")).toHaveTextContent("true|{}");
    expect(screen.getByTestId("adr-panel")).toHaveTextContent("signed|true");
  });

  it("hands the slots an empty object when the decision has no attributes", async () => {
    registerAll();
    serve({ "adr-1": { ...BASE, attributes: null } });
    renderPreview();
    expect(await screen.findByTestId("footer-slot")).toHaveTextContent("false|{}");
    expect(screen.getByTestId("header-slot")).toHaveTextContent("false|{}");
  });

  it("hides a permission-gated panel when nobody is signed in", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [
        { id: "open", component: Panel },
        { id: "gated", permission: "ext.vs.view", component: () => <div data-testid="gated" /> },
      ],
    });
    renderPreview();
    expect(await screen.findByTestId("adr-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("gated")).not.toBeInTheDocument();
  });
});

describe("ADRPreview — copy-link snackbar", () => {
  let restoreClipboard: (() => void) | null = null;
  afterEach(() => {
    restoreClipboard?.();
    restoreClipboard = null;
  });

  it("closes the confirmation on Escape", async () => {
    restoreClipboard = installClipboard();
    const user = userEvent.setup();
    renderPreview();
    await user.click(await screen.findByRole("button", { name: "Copy shareable link" }));
    const snack = await screen.findByRole("alert");
    expect(within(snack).getByText("Link copied to clipboard")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
