import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import CardPicker, { type CardOption } from "./CardPicker";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) => ({ key, color: "#123456" }),
  }),
}));

import { api } from "@/api/client";

function page(items: CardOption[], total: number) {
  return { items, total, page: 1, page_size: 50 };
}

function Harness(props: Partial<React.ComponentProps<typeof CardPicker>>) {
  const [value, setValue] = useState<CardOption | null>(null);
  return (
    <CardPicker
      types="Application"
      value={value}
      onChange={setValue}
      placeholder="Search Application"
      {...props}
    />
  );
}

describe("CardPicker", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("browses on open with an empty input (no typing required)", async () => {
    vi.mocked(api.get).mockResolvedValue(
      page(
        [
          { id: "1", name: "Alpha App", type: "Application" },
          { id: "2", name: "Beta App", type: "Application" },
        ],
        2,
      ),
    );

    render(<Harness />);
    await userEvent.click(screen.getByPlaceholderText("Search Application"));

    // The list appears without any search text being typed.
    await waitFor(() => expect(screen.getByText("Alpha App")).toBeInTheDocument());
    expect(screen.getByText("Beta App")).toBeInTheDocument();

    // The browse fetch carries no `search` param.
    const url = vi.mocked(api.get).mock.calls[0][0] as string;
    expect(url).toContain("type=Application");
    expect(url).not.toContain("search=");
  });

  it("refetches with a search param as the user types", async () => {
    vi.mocked(api.get).mockResolvedValue(page([], 0));

    render(<Harness />);
    const input = screen.getByPlaceholderText("Search Application");
    await userEvent.click(input);
    await userEvent.type(input, "beta");

    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes("search=beta"))).toBe(true);
    });
  });

  it("filters the visible list from the first character typed", async () => {
    // The server returns the full set regardless of query; the picker must
    // still narrow the dropdown client-side as soon as a character is typed.
    vi.mocked(api.get).mockResolvedValue(
      page(
        [
          { id: "1", name: "Alpha App", type: "Application" },
          { id: "2", name: "Beta App", type: "Application" },
        ],
        2,
      ),
    );

    render(<Harness />);
    const input = screen.getByPlaceholderText("Search Application");
    await userEvent.click(input);
    await waitFor(() => expect(screen.getByText("Beta App")).toBeInTheDocument());

    await userEvent.type(input, "alph");
    // "Beta App" no longer matches and is hidden even though the server still
    // returned it; "Alpha App" stays.
    await waitFor(() => expect(screen.queryByText("Beta App")).not.toBeInTheDocument());
    expect(screen.getByText("Alpha App")).toBeInTheDocument();
  });

  it("hides excluded ids from the options", async () => {
    vi.mocked(api.get).mockResolvedValue(
      page(
        [
          { id: "1", name: "Alpha App", type: "Application" },
          { id: "2", name: "Beta App", type: "Application" },
        ],
        2,
      ),
    );

    render(<Harness excludeIds={["2"]} />);
    await userEvent.click(screen.getByPlaceholderText("Search Application"));

    await waitFor(() => expect(screen.getByText("Alpha App")).toBeInTheDocument());
    expect(screen.queryByText("Beta App")).not.toBeInTheDocument();
  });

  it("does not fetch when disabled via enabled=false", async () => {
    render(<Harness enabled={false} />);
    await userEvent.click(screen.getByPlaceholderText("Search Application"));
    // Give any debounce/effects a chance to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(api.get).not.toHaveBeenCalled();
  });

  it("orders options by search relevance, not by the server's page order", async () => {
    // The picker re-ranks the loaded page during the debounce window so the
    // list never disagrees with the server's ordering mid-keystroke (#918).
    vi.mocked(api.get).mockResolvedValue(
      page(
        [
          { id: "1", name: "Network Monitor", type: "Application" },
          { id: "2", name: "Cloud Work Hub", type: "Application" },
          { id: "3", name: "Workday", type: "Application" },
        ],
        3,
      ),
    );

    render(<Harness />);
    const input = screen.getByPlaceholderText("Search Application");
    await userEvent.click(input);
    await waitFor(() => expect(screen.getByText("Workday")).toBeInTheDocument());

    await userEvent.type(input, "work");
    await waitFor(() => {
      const rendered = screen.getAllByRole("option").map((el) => el.textContent);
      expect(rendered).toEqual(["Workday", "Cloud Work Hub", "Network Monitor"]);
    });
  });

  it("keeps paging while exclusions leave the list too short to be usable", async () => {
    // Exclusion happens after paging, so a card already linked to almost every
    // candidate can pull back a full page and show nothing (#918). No scroll
    // event is dispatched here — the picker must page on its own.
    const pageOne = Array.from({ length: 3 }, (_, i) => ({
      id: `x${i}`,
      name: `Excluded ${i}`,
      type: "Application",
    }));
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if ((url as string).includes("page=1")) return page(pageOne, 4);
      return { items: [{ id: "keep", name: "Visible App", type: "Application" }], total: 4, page: 2, page_size: 3 };
    });

    render(<Harness pageSize={3} excludeIds={pageOne.map((c) => c.id)} />);
    await userEvent.click(screen.getByPlaceholderText("Search Application"));

    await waitFor(() => expect(screen.getByText("Visible App")).toBeInTheDocument());
    const urls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("page=2"))).toBe(true);
  });

  it("does not auto-page when nothing is excluded", async () => {
    // Regression guard: every other CardPicker call site passes no
    // `excludeIds` and must keep its single-page-then-scroll behaviour.
    vi.mocked(api.get).mockResolvedValue(
      page(
        [
          { id: "1", name: "Alpha App", type: "Application" },
          { id: "2", name: "Beta App", type: "Application" },
        ],
        99,
      ),
    );

    render(<Harness pageSize={2} />);
    await userEvent.click(screen.getByPlaceholderText("Search Application"));
    await waitFor(() => expect(screen.getByText("Alpha App")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 100));

    const urls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
    expect(urls.every((u) => u.includes("page=1"))).toBe(true);
  });

  it("shows the caller's noOptionsText when everything is filtered out", async () => {
    vi.mocked(api.get).mockResolvedValue(
      page([{ id: "1", name: "Alpha App", type: "Application" }], 1),
    );

    render(<Harness excludeIds={["1"]} noOptionsText="Every Organization is already linked" />);
    await userEvent.click(screen.getByPlaceholderText("Search Application"));

    await waitFor(() =>
      expect(screen.getByText("Every Organization is already linked")).toBeInTheDocument(),
    );
  });
});
