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
});
