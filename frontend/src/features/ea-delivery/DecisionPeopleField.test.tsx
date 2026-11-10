import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import DecisionPeopleField, {
  entryUserId,
  normalizePeople,
  peoplePayload,
  resolveTypedName,
} from "./DecisionPeopleField";
import {
  cachedUserOptions,
  fetchUserOptions,
  invalidateUserOptions,
  type UserOption,
} from "@/components/UserMultiSelect";
import type { DecisionPerson } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/api/client";

const USERS: UserOption[] = [
  { id: "u1", display_name: "Jane Doe", email: "jane@acme.com" },
  { id: "u2", display_name: "John Roe", email: "john@acme.com" },
  { id: "u3", display_name: "Sam Lee", email: "sam1@acme.com" },
  { id: "u4", display_name: "Sam Lee", email: "sam2@acme.com" },
];

function Harness({
  initial = [],
  onValue,
}: {
  initial?: DecisionPerson[];
  onValue?: (v: DecisionPerson[]) => void;
}) {
  const [value, setValue] = useState<DecisionPerson[]>(initial);
  return (
    <DecisionPeopleField
      part="decision_makers"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

describe("resolveTypedName", () => {
  it("turns an exact, case-insensitive display name into the user", () => {
    expect(resolveTypedName("  jane DOE ", USERS)).toEqual({ user_id: "u1", display_name: "Jane Doe" });
  });

  it("keeps an unknown or ambiguous name as free text, trimmed", () => {
    expect(resolveTypedName(" Ann Board ", USERS)).toEqual({ user_id: null, display_name: "Ann Board" });
    expect(resolveTypedName("sam lee", USERS)).toEqual({ user_id: null, display_name: "sam lee" });
    expect(resolveTypedName("Jane", USERS)).toEqual({ user_id: null, display_name: "Jane" });
  });

  it("drops a blank name", () => {
    expect(resolveTypedName("   ", USERS)).toBeNull();
  });
});

describe("normalizePeople", () => {
  it("resolves strings, maps users and collapses duplicates in order", () => {
    expect(
      normalizePeople(
        [
          USERS[1],
          "jane doe",
          { user_id: "u1", display_name: "Jane Doe" },
          "Board",
          "board ",
          "",
          { user_id: null, display_name: "Jane Doe" },
          { user_id: "u2", display_name: "John Roe" },
        ],
        USERS,
      ),
    ).toEqual([
      { user_id: "u2", display_name: "John Roe" },
      { user_id: "u1", display_name: "Jane Doe" },
      { user_id: null, display_name: "Board" },
    ]);
  });

  it("keeps a free-text person whose name matches no user", () => {
    expect(normalizePeople([{ user_id: null, display_name: "Ext" }], USERS)).toEqual([
      { user_id: null, display_name: "Ext" },
    ]);
  });
});

describe("entryUserId", () => {
  it("reads the user id of a user option or a person, null for text", () => {
    expect(entryUserId(USERS[0])).toBe("u1");
    expect(entryUserId({ user_id: "u9", display_name: "X" })).toBe("u9");
    expect(entryUserId({ user_id: null, display_name: "X" })).toBeNull();
    expect(entryUserId("Jane Doe")).toBeNull();
  });
});

describe("peoplePayload", () => {
  it("writes users by id and others by name", () => {
    expect(
      peoplePayload([
        { user_id: "u1", display_name: "Jane Doe" },
        { user_id: null, display_name: "Board" },
      ]),
    ).toEqual([{ user_id: "u1" }, { name: "Board" }]);
  });
});

describe("DecisionPeopleField", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    invalidateUserOptions();
  });

  it("uses the part's label and the hint placeholder", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Decision makers")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Pick a user, or type a name and press Enter"),
    ).toBeInTheDocument();
  });

  it("picks a user from the shared cached list", async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await userEvent.click(screen.getByLabelText("Decision makers"));
    await waitFor(() => expect(screen.getByText("John Roe")).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledWith("/users");
    expect(cachedUserOptions()).toEqual(USERS);

    await userEvent.click(screen.getByText("John Roe"));
    expect(onValue).toHaveBeenLastCalledWith([{ user_id: "u2", display_name: "John Roe" }]);
  });

  it("adds a typed name as free text and a typed user name as the user", async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByLabelText("Decision makers");
    await userEvent.click(input);
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());

    await userEvent.type(input, "Architecture Board{Enter}");
    expect(onValue).toHaveBeenLastCalledWith([{ user_id: null, display_name: "Architecture Board" }]);

    await userEvent.type(input, "Jane Doe{Enter}");
    expect(onValue).toHaveBeenLastCalledWith([
      { user_id: null, display_name: "Architecture Board" },
      { user_id: "u1", display_name: "Jane Doe" },
    ]);
  });

  it("hides users already chosen and ranks the rest by the typed text", async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);
    render(<Harness initial={[{ user_id: "u1", display_name: "Jane Doe" }]} />);
    const input = screen.getByLabelText("Decision makers");
    await userEvent.click(input);
    const listbox = await screen.findByRole("listbox");
    const names = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["John Roejohn@acme.com","Sam Leesam1@acme.com", "Sam Leesam2@acme.com"]);

    await userEvent.type(input, "sam2");
    const ranked = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(ranked.map((o) => o.textContent)).toEqual(["Sam Leesam2@acme.com"]);
  });

  it("reuses the cache filled by another picker without a second request", async () => {
    vi.mocked(api.get).mockResolvedValue(USERS);
    await fetchUserOptions();
    render(<Harness />);
    await userEvent.click(screen.getByLabelText("Decision makers"));
    await waitFor(() => expect(screen.getByText("Jane Doe")).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("renders chips only when read-only, marking free-text people", () => {
    render(
      <DecisionPeopleField
        part="participants"
        readOnly
        value={[
          { user_id: "u1", display_name: "Jane Doe" },
          { user_id: null, display_name: "Board" },
        ]}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Participants")).toBeInTheDocument();
    const jane = screen.getByText("Jane Doe").closest(".MuiChip-root")!;
    const board = screen.getByText("Board").closest(".MuiChip-root")!;
    expect(jane.className).toContain("MuiChip-filled");
    expect(board.className).toContain("MuiChip-outlined");
    expect(board.getAttribute("aria-label")).toBe("Not a Turbo EA user");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("says None when read-only and empty, with a custom label", () => {
    render(<DecisionPeopleField part="participants" readOnly value={[]} label="Who" />);
    expect(screen.getByText("Who")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });
});
