/**
 * The global card search (⌘K). Guards the one-character minimum: it used to
 * require two before searching at all, so a single letter silently did
 * nothing while every picker in the app answered on the first keystroke.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ getType: (key: string) => ({ key, label: key, color: "#123456" }) }),
}));

import { api } from "@/api/client";
import SearchDialog from "./SearchDialog";

function open() {
  render(
    <MemoryRouter>
      <SearchDialog open onClose={() => {}} />
    </MemoryRouter>,
  );
  return screen.getByRole("textbox");
}

describe("SearchDialog", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({
      items: [{ id: "1", name: "Workday", type: "Application" }],
    } as never);
  });

  it("searches on a single character", async () => {
    const input = open();
    await userEvent.type(input, "w");

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const url = vi.mocked(api.get).mock.calls[0][0] as string;
    expect(url).toContain("search=w");
    await waitFor(() => expect(screen.getByText("Workday")).toBeInTheDocument());
  });

  it("does not search on an empty box", async () => {
    const input = open();
    await userEvent.type(input, "w");
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    vi.mocked(api.get).mockClear();

    await userEvent.clear(input);
    await new Promise((r) => setTimeout(r, 400));
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByText("Workday")).not.toBeInTheDocument();
  });

  it("debounces so a burst of typing issues one request", async () => {
    const input = open();
    await userEvent.type(input, "work");

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.get).mock.calls[0][0]).toContain("search=work");
  });
});
