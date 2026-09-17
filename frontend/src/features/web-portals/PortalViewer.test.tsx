/**
 * The card-list portal, on the three things #1111's follow-up found wrong:
 * a ticked field beyond the first three never reached the card row, the
 * data-quality bar had no visible wording, and the reserved `__description`
 * section printed its raw name as a heading in the detail dialog.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";

vi.mock("@/api/client", () => {
  const boom = () => {
    throw new Error("A portal must never call the authenticated API client");
  };
  return { api: { get: boom, post: boom, patch: boom, put: boom, delete: boom } };
});
// The workspace date format is behind the login; the viewer falls back to ISO
// when the fetch 401s, which is what this stub reproduces.
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({
    formatDate: (d: string) => d,
    formatDateTime: (d: string) => d,
    dateFormat: "iso",
  }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => {
    throw new Error("A portal must never read the metamodel");
  },
}));

const publicGet = vi.fn();
vi.mock("./publicApi", () => ({ publicGet: (...a: unknown[]) => publicGet(...a) }));

import PortalViewer from "./PortalViewer";
import type { PortalCard, PublicPortal } from "@/types";

const FIELDS = [
  { key: "status", label: "Status", type: "text" },
  { key: "value", label: "Business Value", type: "text" },
  { key: "level", label: "Hierarchy Level", type: "number" },
];

function portal(overrides: Partial<PublicPortal> = {}): PublicPortal {
  return {
    id: "p1",
    name: "Initiatives",
    slug: "init",
    card_type: "Initiative",
    view: "cards",
    card_config: {
      toggles: {
        "field:status": { card: true, detail: true },
        "field:value": { card: true, detail: true },
        "field:level": { card: true, detail: true },
        "field:progress": { card: true, detail: true },
      },
    },
    type_info: {
      key: "Initiative",
      label: "Initiative",
      icon: "rocket_launch",
      color: "#33cc58",
      subtypes: [],
      fields_schema: [
        { section: "Initiative Information", fields: FIELDS },
        {
          section: "__description",
          fields: [{ key: "progress", label: "Completion", type: "percentage" }],
        },
      ],
    },
    relation_types: [],
    tag_groups: [],
    ...overrides,
  } as PublicPortal;
}

const CARD: PortalCard = {
  id: "c1",
  name: "SAP S/4HANA Migration",
  type: "Initiative",
  description: "Move the ERP to S/4HANA.",
  attributes: { status: "On Track", value: "High", level: 2, progress: 69 },
  approval_status: "APPROVED",
  data_quality: 82,
  tags: [],
  relations: [],
  stakeholders: [],
} as unknown as PortalCard;

function renderPortal() {
  return render(
    <MemoryRouter initialEntries={["/portal/init"]}>
      <Routes>
        <Route path="/portal/:slug" element={<PortalViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  publicGet.mockReset();
  publicGet.mockImplementation((path: string) => {
    if (path.endsWith("/gate")) return Promise.resolve({ access_mode: "public", name: "Initiatives" });
    if (path.includes("/cards")) return Promise.resolve({ items: [CARD], total: 1, page: 1, page_size: 24 });
    return Promise.resolve(portal());
  });
});

describe("PortalViewer card row", () => {
  it("shows every ticked field, not only the first three", async () => {
    renderPortal();
    await waitFor(() => expect(screen.getByText("SAP S/4HANA Migration")).toBeInTheDocument());
    // The fourth ticked field is the one the old `slice(0, 3)` dropped.
    expect(screen.getByText("Completion")).toBeInTheDocument();
    expect(screen.getByText("69%")).toBeInTheDocument();
  });

  it("labels the data-quality bar in words", async () => {
    renderPortal();
    await waitFor(() => expect(screen.getByText("SAP S/4HANA Migration")).toBeInTheDocument());
    expect(screen.getByText("82% data quality")).toBeInTheDocument();
  });
});

describe("PortalViewer detail dialog", () => {
  it("folds __description fields under the Description heading", async () => {
    const user = userEvent.setup();
    renderPortal();
    await waitFor(() => expect(screen.getByText("SAP S/4HANA Migration")).toBeInTheDocument());
    await user.click(screen.getByText("SAP S/4HANA Migration"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Description")).toBeInTheDocument();
    expect(within(dialog).getByText("Completion")).toBeInTheDocument();
    expect(within(dialog).queryByText(/__description/i)).not.toBeInTheDocument();
    // The ordinary section keeps its own heading.
    expect(within(dialog).getByText("Initiative Information")).toBeInTheDocument();
  });

  it("links a bare address in the description and opens it in a new tab", async () => {
    publicGet.mockImplementation((path: string) => {
      if (path.endsWith("/gate")) return Promise.resolve({ access_mode: "public", name: "Initiatives" });
      if (path.includes("/cards"))
        return Promise.resolve({
          items: [{ ...CARD, description: "<p>Plan: https://wiki.example.com/erp.</p>" }],
          total: 1,
          page: 1,
          page_size: 24,
        });
      return Promise.resolve(portal());
    });
    const user = userEvent.setup();
    renderPortal();
    await waitFor(() => expect(screen.getByText("SAP S/4HANA Migration")).toBeInTheDocument());
    await user.click(screen.getByText("SAP S/4HANA Migration"));
    const dialog = await screen.findByRole("dialog");
    const link = within(dialog).getByRole("link", { name: "https://wiki.example.com/erp" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
