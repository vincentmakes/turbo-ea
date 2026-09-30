import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ArchitectureDecision } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: {} }, refreshUser: async () => {} }),
}));
vi.mock("./adrPrint", () => ({ printAdr: vi.fn() }));

import { api } from "@/api/client";
import { printAdr } from "./adrPrint";
import ADRPreview from "./ADRPreview";

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
