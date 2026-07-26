import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import CardMultiSelect from "./CardMultiSelect";
import type { CardOption } from "./CardPicker";

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

type HarnessProps = Omit<
  Partial<React.ComponentProps<typeof CardMultiSelect>>,
  "onChange"
>;

/** Owns the selection state so chips reflect real user interaction. */
function Harness({ value: initial, ...props }: HarnessProps) {
  const [value, setValue] = useState<CardOption[]>(initial ?? []);
  return (
    <CardMultiSelect
      placeholder="Search cards"
      {...props}
      value={value}
      onChange={setValue}
    />
  );
}

const TWO_APPS = [
  { id: "1", name: "Alpha App", type: "Application" },
  { id: "2", name: "Beta App", type: "Application" },
];

describe("CardMultiSelect", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("browses on open with an empty input (no typing required)", async () => {
    vi.mocked(api.get).mockResolvedValue(page(TWO_APPS, 2));

    render(<Harness />);
    await userEvent.click(screen.getByPlaceholderText("Search cards"));

    await waitFor(() => expect(screen.getByText("Alpha App")).toBeInTheDocument());
    expect(screen.getByText("Beta App")).toBeInTheDocument();

    const url = vi.mocked(api.get).mock.calls[0][0] as string;
    expect(url).not.toContain("search=");
  });

  it("keeps the dropdown open and accumulates chips across selections", async () => {
    vi.mocked(api.get).mockResolvedValue(page(TWO_APPS, 2));

    const { container } = render(<Harness />);
    await userEvent.click(screen.getByPlaceholderText("Search cards"));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());

    const optionText = (name: string) =>
      screen.getAllByRole("option").find((el) => el.textContent === name)!;

    await userEvent.click(optionText("Alpha App"));
    // disableCloseOnSelect keeps the list up so a second card can be added.
    await userEvent.click(optionText("Beta App"));

    // Both selections survive as chips.
    await waitFor(() => {
      const chips = Array.from(container.querySelectorAll(".MuiChip-label")).map(
        (el) => el.textContent,
      );
      expect(chips).toEqual(["Alpha App", "Beta App"]);
    });
  });

  it("refetches with a search param as the user types", async () => {
    vi.mocked(api.get).mockResolvedValue(page([], 0));

    render(<Harness />);
    const input = screen.getByPlaceholderText("Search cards");
    await userEvent.click(input);
    await userEvent.type(input, "beta");

    await waitFor(() => {
      const urls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes("search=beta"))).toBe(true);
    });
  });

  it("hides excluded ids from the options", async () => {
    vi.mocked(api.get).mockResolvedValue(page(TWO_APPS, 2));

    render(<Harness excludeIds={["2"]} />);
    await userEvent.click(screen.getByPlaceholderText("Search cards"));

    await waitFor(() => expect(screen.getByText("Alpha App")).toBeInTheDocument());
    expect(screen.queryByText("Beta App")).not.toBeInTheDocument();
  });

  it("renders a chip for a selected card the server page does not contain", async () => {
    // The picker must keep pre-selected values resolvable — otherwise MUI
    // blanks the chip whenever the card falls off the current result page.
    vi.mocked(api.get).mockResolvedValue(page([], 0));

    render(<Harness value={[{ id: "99", name: "Off-page App", type: "Application" }]} />);

    await waitFor(() => expect(screen.getByText("Off-page App")).toBeInTheDocument());
  });

  it("does not fetch when disabled via enabled=false", async () => {
    render(<Harness enabled={false} />);
    await userEvent.click(screen.getByPlaceholderText("Search cards"));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.get).not.toHaveBeenCalled();
  });
});
