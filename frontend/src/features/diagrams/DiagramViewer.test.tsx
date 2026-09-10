import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

/* ── mocks ─────────────────────────────────────────────────────── */

// Keep `isAbortError` / `ApiError` real: `useAbortableEffect` imports the
// former from this module, and these tests exercise the error path.
vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  api: { get: vi.fn() },
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "Application", label: "Application", icon: "apps", color: "#0f7eb5" }],
    relationTypes: [],
    loading: false,
  }),
}));
// Drags in the whole cards feature; the viewer only mounts it closed.
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));
// jsdom never fires `Image.onload`, so the real composer would hang. Partial:
// `drawio-shapes` reads the module's pure helpers when it paints the style.
vi.mock("./cardLogoImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cardLogoImage")>()),
  composeCardLogoImage: vi.fn(async () => "data:image/png;base64,AAA"),
}));

import { api, ApiError } from "@/api/client";
import { AuthProvider } from "@/hooks/AuthContext";
import { CARD_IDS_CHUNK } from "@/api/cardsByIds";
import type { User } from "@/types";
import DiagramViewer from "./DiagramViewer";

const mockGet = vi.mocked(api.get);

const admin = { id: "u1", email: "a@x", display_name: "Admin", permissions: { "*": true } } as unknown as User;

function cardCell(cardId: string): string {
  return (
    `<object label="${cardId}" cardId="${cardId}" cardType="Application" id="c-${cardId}">` +
    `<mxCell style="rounded=1;fillColor=#0f7eb5" vertex="1" parent="1">` +
    `<mxGeometry x="0" y="0" width="180" height="50" as="geometry"/>` +
    `</mxCell></object>`
  );
}

function diagramXml(cardIds: string[]): string {
  return (
    `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    cardIds.map(cardCell).join("") +
    `</root></mxGraphModel>`
  );
}

function diagram(cardIds: string[]) {
  return { id: "d1", name: "Big Landscape", type: "free", data: { xml: diagramXml(cardIds) } };
}

function idsOf(path: string): string[] {
  return decodeURIComponent(path.slice("/cards?ids=".length)).split(",");
}

function renderViewer() {
  return render(
    <AuthProvider user={admin} refreshUser={async () => {}}>
      <MemoryRouter initialEntries={["/diagrams/d1"]}>
        <Routes>
          <Route path="/diagrams/:id" element={<DiagramViewer />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

const iframe = () => document.querySelector("iframe");

/* ── tests ─────────────────────────────────────────────────────── */

describe("DiagramViewer", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("still renders the diagram when the card lookup fails (#1093)", async () => {
    // The lookup only decorates the canvas with logos. A 414 from the proxy on
    // a big diagram used to be reported as a missing diagram.
    const d = diagram(["card-1"]);
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/diagrams/d1") return d;
      if (path.startsWith("/cards?ids=")) throw new ApiError("HTTP 414", 414, null);
      throw new Error(`unexpected path ${path}`);
    });
    renderViewer();
    await waitFor(() => expect(iframe()).not.toBeNull());
    expect(screen.getByText("Big Landscape")).toBeInTheDocument();
    expect(screen.queryByText("Diagram not found")).not.toBeInTheDocument();
    // Exactly the stored document, logos and all left as they were.
    expect(iframe()!.getAttribute("src")).toContain(encodeURIComponent(d.data.xml));
  });

  it("shows not-found only when the diagram itself cannot be loaded", async () => {
    mockGet.mockImplementation(async () => {
      throw new ApiError("HTTP 404", 404, null);
    });
    renderViewer();
    await waitFor(() =>
      expect(screen.getByText("Diagram not found")).toBeInTheDocument(),
    );
    expect(iframe()).toBeNull();
  });

  it("looks the cards up in batches that fit one request line", async () => {
    const ids = Array.from({ length: CARD_IDS_CHUNK + 50 }, (_, i) => `card-${i}`);
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/diagrams/d1") return diagram(ids);
      if (path.startsWith("/cards?ids=")) {
        return { items: idsOf(path).map((id) => ({ id, name: id, type: "Application" })) };
      }
      throw new Error(`unexpected path ${path}`);
    });
    renderViewer();
    await waitFor(() => expect(iframe()).not.toBeNull());
    const cardCalls = mockGet.mock.calls.filter((c) =>
      (c[0] as string).startsWith("/cards?ids="),
    );
    expect(cardCalls).toHaveLength(2);
    for (const c of cardCalls) {
      expect(idsOf(c[0] as string).length).toBeLessThanOrEqual(CARD_IDS_CHUNK);
      expect(c[1]).toHaveProperty("signal");
    }
  });

  it("paints a card's logo into the document it hands DrawIO", async () => {
    const d = diagram(["card-1"]);
    mockGet.mockImplementation(async (path: string) => {
      if (path === "/diagrams/d1") return d;
      if (path.startsWith("/cards?ids=")) {
        return {
          items: [
            { id: "card-1", name: "card-1", type: "Application", logo_updated_at: "2026-01-01" },
          ],
        };
      }
      throw new Error(`unexpected path ${path}`);
    });
    renderViewer();
    await waitFor(() => expect(iframe()).not.toBeNull());
    const src = decodeURIComponent(iframe()!.getAttribute("src")!.split("#R")[1]);
    expect(src).toContain("data:image/png;base64,AAA");
    expect(src).not.toBe(d.data.xml);
  });
});
