import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ArchitectureDecision } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1", permissions: {} } }) }));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: {} }, refreshUser: async () => {} }),
}));
vi.mock("./adrPrint", () => ({ printAdr: vi.fn() }));
// TipTap has no place in jsdom; a textarea carries the same value/onChange contract.
vi.mock("./RichTextEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("./SignatureRequestDialog", () => ({ default: () => null }));

import { api } from "@/api/client";
import { printAdr } from "./adrPrint";
import ADREditor from "./ADREditor";

const base: ArchitectureDecision = {
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
  creator_name: "Ada Lovelace",
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  linked_cards: [],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

function mockLoad(adr: ArchitectureDecision) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/adr/")) return adr as never;
    if (path === "/settings/date-format") return { date_format: "YYYY-MM-DD" } as never;
    if (path.startsWith("/cards")) return { items: [] } as never;
    return {} as never;
  });
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/ea-delivery/adr/adr-1"]}>
      <Routes>
        <Route path="/ea-delivery/adr/:id" element={<ADREditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(printAdr).mockReset();
});

describe("ADREditor — export trio in the title bar", () => {
  it("a draft offers Preview, PDF and Word, and PDF prints the live editor state", async () => {
    mockLoad(base);
    renderEditor();
    const pdf = await screen.findByRole("button", { name: /PDF$/ });
    expect(screen.getByRole("button", { name: /Preview$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Word$/ })).toBeInTheDocument();

    // Edit the title, then print: the unsaved edit is what gets exported (SoAW behaviour).
    const title = await screen.findByDisplayValue("Adopt event bus");
    await userEvent.clear(title);
    await userEvent.type(title, "Adopt a message bus");
    await userEvent.click(pdf);

    expect(printAdr).toHaveBeenCalledTimes(1);
    const printed = vi.mocked(printAdr).mock.calls[0][0];
    expect(printed.title).toBe("Adopt a message bus");
    expect(printed.reference_number).toBe("ADR-0001");
    // Audit fields the editor has no state for come from the loaded record.
    expect(printed.creator_name).toBe("Ada Lovelace");
    expect(printed.created_at).toBe("2026-06-01T00:00:00Z");
  });

  it("a signed decision keeps PDF but hides Word, like the SoAW editor", async () => {
    mockLoad({
      ...base,
      status: "signed",
      signed_at: "2026-06-02T09:30:00Z",
      signatories: [{ user_id: "u2", display_name: "Grace", status: "signed", signed_at: "2026-06-02T09:30:00Z" }],
    });
    renderEditor();
    await screen.findByRole("button", { name: /PDF$/ });
    expect(screen.queryByRole("button", { name: /Word$/ })).not.toBeInTheDocument();
  });
});
