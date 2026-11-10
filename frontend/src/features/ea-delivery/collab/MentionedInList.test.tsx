import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import MentionedInList from "./MentionedInList";

beforeEach(() => mockApi.reset());

describe("MentionedInList", () => {
  it("lists the decisions and SoAWs that mention a card, linked to their previews", async () => {
    mockApi.on("get", "/mentions/cards/c1", {
      decisions: [
        {
          id: "a2",
          reference_number: "ADR-012",
          revision_number: 2,
          title: "Use Kafka",
          status: "signed",
          standing: "in_force",
          via: "text",
        },
        {
          id: "a5",
          reference_number: "ADR-015",
          revision_number: 1,
          title: "Retire FTP",
          status: "draft",
          standing: null,
          via: "comment",
        },
      ],
      soaws: [
        { id: "s1", name: "Billing SoAW", revision_number: 1, status: "draft" },
        { id: "s2", name: "CRM SoAW", revision_number: 3, status: "signed", via: "comment" },
      ],
    });
    renderWithProviders(<MentionedInList target={{ kind: "card", id: "c1" }} />);
    const block = await screen.findByTestId("mentioned-in");
    expect(within(block).getByText("Mentioned in")).toBeInTheDocument();
    const links = within(block).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["ADR-012 · Rev 2 Use Kafka", "/ea-delivery/adr/a2/preview"],
      ["ADR-015 Retire FTP", "/ea-delivery/adr/a5/preview"],
      ["Billing SoAW", "/ea-delivery/soaw/s1/preview"],
      ["CRM SoAW (Rev 3)", "/ea-delivery/soaw/s2/preview"],
    ]);
    const items = within(block).getAllByRole("listitem");
    expect(within(items[0]).queryByText("in the discussion")).toBeNull();
    expect(within(items[0]).getByText("In force")).toBeInTheDocument();
    expect(within(items[1]).getByText("in the discussion")).toBeInTheDocument();
    expect(within(items[2]).queryByText("in the discussion")).toBeNull();
    expect(within(items[3]).getByText("in the discussion")).toBeInTheDocument();
  });

  it("asks about a decision on its own route", async () => {
    mockApi.on("get", "/mentions/decisions/a1", {
      decisions: [],
      soaws: [{ id: "s1", name: "Billing SoAW", revision_number: 1, status: "draft" }],
    });
    renderWithProviders(<MentionedInList target={{ kind: "decision", id: "a1" }} />);
    expect(await screen.findByText("Billing SoAW")).toBeInTheDocument();
  });

  it("renders nothing when nothing mentions it, or when the reader may not ask", async () => {
    mockApi.on("get", "/mentions/cards/c1", { decisions: [], soaws: [] });
    const { container } = renderWithProviders(<MentionedInList target={{ kind: "card", id: "c1" }} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/mentions/cards/c1")).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();

    mockApi.fail("get", "/mentions/cards/c2", 404, "Card not found");
    const other = renderWithProviders(<MentionedInList target={{ kind: "card", id: "c2" }} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/mentions/cards/c2")).toHaveLength(1));
    expect(other.container).toBeEmptyDOMElement();
  });
});
