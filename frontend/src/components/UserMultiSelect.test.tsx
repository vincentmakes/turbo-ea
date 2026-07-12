import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import UserMultiSelect, { invalidateUserOptions, type UserOption } from "./UserMultiSelect";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/api/client";

const USERS: UserOption[] = [
  { id: "u1", display_name: "Jane Doe", email: "jane@acme.com" },
  { id: "u2", display_name: "John Roe", email: "john@acme.com" },
];

function Harness(props: Partial<React.ComponentProps<typeof UserMultiSelect>>) {
  const [value, setValue] = useState<UserOption[]>([]);
  return <UserMultiSelect value={value} onChange={setValue} label="People" {...props} />;
}

describe("UserMultiSelect", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    invalidateUserOptions();
  });

  it("browses on open and selects multiple users as chips", async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);

    const { container } = render(<Harness />);
    await userEvent.click(screen.getByLabelText("People"));

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(vi.mocked(api.get)).toHaveBeenCalledWith("/users");

    await userEvent.click(screen.getByText("Jane Doe"));
    await userEvent.click(screen.getByLabelText("People"));
    await userEvent.click(screen.getByText("John Roe"));

    // Both selections render as chips.
    await waitFor(() =>
      expect(container.querySelectorAll(".MuiChip-root")).toHaveLength(2),
    );
  });

  it("excludes ids passed via excludeIds", async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);

    render(<Harness excludeIds={["u2"]} />);
    await userEvent.click(screen.getByLabelText("People"));

    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(screen.queryByText("John Roe")).not.toBeInTheDocument();
  });

  it("shares one request across pickers via the module cache", async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);

    render(
      <>
        <Harness label="People" />
      </>,
    );
    await userEvent.click(screen.getByLabelText("People"));
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    await userEvent.keyboard("{Escape}");

    // Re-open: cache hit, no second request.
    await userEvent.click(screen.getByLabelText("People"));
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });
});
