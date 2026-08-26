import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "@/hooks/AuthContext";
import { setViewportWidth } from "@/test/matchMedia";
import PpmTaskDialog from "./PpmTaskDialog";
import PpmOverviewTab from "./PpmOverviewTab";
import PpmTaskBoard from "./PpmTaskBoard";
import type { Card } from "@/types";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({
    currency: "CHF",
    fmt: { format: (v: number) => `CHF ${v.toLocaleString("en-US")}` },
    fmtShort: (v: number) => `CHF${v}`,
    symbol: "CHF",
  }),
}));

const PHONE = 390;
const DESKTOP = 1280;

/** MUI reads matchMedia during render, so the width must be set before mount. */
function renderAt(width: number, ui: React.ReactElement) {
  act(() => setViewportWidth(width));
  return render(ui);
}

describe("PPM dialogs on mobile", () => {
  beforeEach(() => vi.clearAllMocks());

  const dialog = (
    <PpmTaskDialog initiativeId="i1" onClose={() => {}} onSaved={() => {}} />
  );

  it("renders full-screen on a phone", () => {
    const { baseElement } = renderAt(PHONE, dialog);
    expect(
      baseElement.querySelector(".MuiDialog-paperFullScreen"),
    ).not.toBeNull();
  });

  it("does not render full-screen on desktop", () => {
    const { baseElement } = renderAt(DESKTOP, dialog);
    expect(baseElement.querySelector(".MuiDialog-paperFullScreen")).toBeNull();
  });

  it("skips autofocus on a phone so the keyboard does not open on mount", () => {
    renderAt(PHONE, dialog);
    // The title field autofocuses on desktop; full-screen it must not, or iOS
    // throws up the keyboard the instant the dialog appears.
    const title = screen.getByRole("textbox", { name: "Title" });
    expect(title).not.toHaveFocus();
  });

  it("still autofocuses the title on desktop", () => {
    renderAt(DESKTOP, dialog);
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
  });
});

describe("PpmOverviewTab financials", () => {
  const card = {
    id: "c1",
    type: "Initiative",
    name: "SAP S/4HANA Migration",
    description: null,
    subtype: null,
    attributes: {},
  } as unknown as Card;

  it("labels the total budget once, not twice", () => {
    renderAt(
      PHONE,
      <PpmOverviewTab
        card={card}
        latestReport={null}
        costLines={[]}
        budgetLines={[]}
      />,
    );
    // The KPI caption said "Total Budget" and the first BudgetBar repeated it
    // 40px below; the bar now reads "Total" so the pair is Total/CapEx/OpEx.
    expect(screen.getAllByText("Total Budget")).toHaveLength(1);
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});

describe("Task board kanban on mobile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps all four status columns, swipeable rather than squashed", async () => {
    renderAt(
      PHONE,
      <MemoryRouter>
        <AuthProvider user={null} refreshUser={async () => {}}>
          <PpmTaskBoard initiativeId="i1" />
        </AuthProvider>
      </MemoryRouter>,
    );
    // The board used to be repeat(4, 1fr) with no breakpoint, squashing each
    // column to ~85px. The mobile fix must widen them into a scroll strip, not
    // drop or collapse any column — every status stays a visible drop target.
    await waitFor(() => {
      expect(screen.getByText("To Do")).toBeInTheDocument();
    });
    for (const label of ["To Do", "In Progress", "Done", "Blocked"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
