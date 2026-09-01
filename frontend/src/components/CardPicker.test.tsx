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
    // Only `BusinessCapability` is hierarchical. Every other test in this file
    // browses `Application`, so they stay on the flat path whatever the
    // hierarchy code does — which is the point.
    getType: (key: string) => ({
      key,
      color: "#123456",
      has_hierarchy: key === "BusinessCapability",
    }),
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

function MultiHarness({
  initial = [],
  ...props
}: { initial?: CardOption[] } & Partial<React.ComponentProps<typeof CardPicker>>) {
  const [value, setValue] = useState<CardOption[]>(initial);
  return (
    <CardPicker
      multiple
      types="Application"
      value={value}
      onChange={setValue}
      placeholder="Search Application"
      {...(props as object)}
    />
  );
}

describe("CardPicker — multi-select", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("accumulates picks as chips instead of replacing the selection", async () => {
    vi.mocked(api.get).mockResolvedValue(
      page(
        [
          { id: "1", name: "Alpha App", type: "Application" },
          { id: "2", name: "Beta App", type: "Application" },
        ],
        2,
      ),
    );
    const user = userEvent.setup();
    render(<MultiHarness />);

    await user.click(screen.getByPlaceholderText("Search Application"));
    await user.click(await screen.findByText("Alpha App"));
    // The dropdown stays open (disableCloseOnSelect), so the second pick is
    // one click rather than a re-open.
    await user.click(await screen.findByText("Beta App"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /alpha app/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /beta app/i })).toBeInTheDocument();
    });
  });

  it("keeps a chip for a selected card that is not on the current page", async () => {
    // The server only ever returns Alpha; Zulu was picked in an earlier session.
    vi.mocked(api.get).mockResolvedValue(
      page([{ id: "1", name: "Alpha App", type: "Application" }], 1),
    );
    render(
      <MultiHarness initial={[{ id: "99", name: "Zulu App", type: "Application" }]} />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /zulu app/i })).toBeInTheDocument(),
    );
  });

  it("removes a card when its chip is deleted", async () => {
    vi.mocked(api.get).mockResolvedValue(
      page([{ id: "1", name: "Alpha App", type: "Application" }], 1),
    );
    const user = userEvent.setup();
    render(
      <MultiHarness initial={[{ id: "1", name: "Alpha App", type: "Application" }]} />,
    );

    const chip = await screen.findByRole("button", { name: /alpha app/i });
    await user.click(chip);
    await user.keyboard("{Backspace}");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /alpha app/i })).not.toBeInTheDocument(),
    );
  });
});

/**
 *  Sales
 *    ├─ Lead Management
 *    │    └─ Lead Scoring
 *    └─ Quoting
 *  Finance
 */
const CAPS = [
  { id: "sales", name: "Sales", type: "BusinessCapability", parent_id: null },
  { id: "leads", name: "Lead Management", type: "BusinessCapability", parent_id: "sales" },
  { id: "scoring", name: "Lead Scoring", type: "BusinessCapability", parent_id: "leads" },
  { id: "quoting", name: "Quoting", type: "BusinessCapability", parent_id: "sales" },
  { id: "finance", name: "Finance", type: "BusinessCapability", parent_id: null },
];

const optionNames = () => screen.getAllByRole("option").map((el) => el.textContent ?? "");

describe("CardPicker hierarchy mode (#1050)", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    // `total === items.length` ⇒ the type is provably complete, the only state
    // that renders a tree.
    vi.mocked(api.get).mockResolvedValue({
      items: CAPS,
      total: CAPS.length,
      page: 1,
      page_size: 1000,
    } as never);
  });

  it("stays flat by default, even on a hierarchical type", async () => {
    // Regression guard for the 15 call sites that pass no `hierarchy`: a
    // hierarchical type must not silently start loading itself whole.
    render(<Harness types="BusinessCapability" placeholder="Search caps" />);
    await userEvent.click(screen.getByPlaceholderText("Search caps"));
    await waitFor(() => expect(screen.getByText("Sales")).toBeInTheDocument());

    const url = vi.mocked(api.get).mock.calls[0][0] as string;
    expect(url).toContain("page_size=50");
    expect(url).not.toContain("page_size=1000");
    // The server's own order, untouched — not re-nested depth-first.
    expect(optionNames()).toEqual(CAPS.map((c) => c.name));
  });

  it("renders an indented, depth-first tree when asked", async () => {
    render(<Harness types="BusinessCapability" hierarchy placeholder="Search caps" />);
    await userEvent.click(screen.getByPlaceholderText("Search caps"));
    await waitFor(() => expect(screen.getByText("Lead Scoring")).toBeInTheDocument());

    expect(optionNames()).toEqual([
      "Finance",
      "Sales",
      "Lead Management",
      "Lead Scoring",
      "Quoting",
    ]);
    const urls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
    for (const url of urls) expect(url).toContain("page_size=1000");
  });

  it("keeps a match's ancestors while typing, without querying the server", async () => {
    const user = userEvent.setup();
    render(<Harness types="BusinessCapability" hierarchy placeholder="Search caps" />);
    await user.click(screen.getByPlaceholderText("Search caps"));
    await waitFor(() => expect(screen.getByText("Lead Scoring")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search caps"), "Scoring");

    const names = optionNames();
    expect(names).toContain("Lead Scoring");
    // Kept for context, though neither matches on its own name.
    expect(names).toContain("Lead Management");
    expect(names).toContain("Sales");
    expect(names).not.toContain("Finance");
    const urls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
    for (const url of urls) expect(url).not.toContain("search=");
  });

  it("shows excluded cards as unpickable context instead of hiding them", async () => {
    // Hiding "Lead Management" would file "Lead Scoring" under `null` — i.e.
    // promote it to a root — rewriting the hierarchy the tree exists to show.
    render(
      <Harness
        types="BusinessCapability"
        hierarchy
        excludeIds={["leads"]}
        placeholder="Search caps"
      />,
    );
    await userEvent.click(screen.getByPlaceholderText("Search caps"));
    await waitFor(() => expect(screen.getByText("Lead Scoring")).toBeInTheDocument());

    const linked = screen.getByText("Lead Management").closest('[role="option"]');
    expect(linked).toHaveAttribute("aria-disabled", "true");
    expect(optionNames()).toEqual([
      "Finance",
      "Sales",
      "Lead Management",
      "Lead Scoring",
      "Quoting",
    ]);
  });
});
