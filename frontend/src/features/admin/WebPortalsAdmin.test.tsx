import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

let bpmEnabled = true;
vi.mock("@/hooks/useBpmEnabled", () => ({ useBpmEnabled: () => ({ bpmEnabled }) }));
vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: () => ({ ppmEnabled: true }) }));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      { key: "Application", label: "Application", icon: "apps", color: "#0f7eb5", subtypes: [] },
      {
        key: "BusinessProcess",
        label: "Business Process",
        icon: "route",
        color: "#028f00",
        subtypes: [{ key: "core", label: "Core" }],
        fields_schema: [],
      },
      { key: "Initiative", label: "Initiative", icon: "rocket_launch", color: "#33cc58", subtypes: [] },
    ],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";
import WebPortalsAdmin from "./WebPortalsAdmin";

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = api.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  bpmEnabled = true;
  mockGet.mockImplementation((path: string) => {
    if (path === "/web-portals") return Promise.resolve([]);
    if (path === "/tag-groups") return Promise.resolve([]);
    if (path === "/reports/ppm/group-options") return Promise.resolve([]);
    if (path === "/auth/sso/config") return Promise.resolve({ enabled: false });
    return Promise.resolve([]);
  });
  mockPost.mockResolvedValue({ id: "new" });
});

/** Opens the create form from the empty-state call to action. */
async function openNewPortalForm(user: ReturnType<typeof userEvent.setup>) {
  render(<WebPortalsAdmin />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/web-portals"));
  const cta = await screen.findAllByRole("button", { name: /create portal/i });
  await user.click(cta[0]);
  await screen.findByRole("combobox", { name: /portal type/i });
}

/** Pick an option from a MUI select rendered as a combobox. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  labelRe: RegExp,
  optionRe: RegExp,
) {
  await user.click(screen.getByRole("combobox", { name: labelRe }));
  await user.click(await screen.findByRole("option", { name: optionRe }));
}

describe("WebPortalsAdmin — process navigator portal", () => {
  it("offers the process navigator portal type", async () => {
    const user = userEvent.setup();
    await openNewPortalForm(user);
    await user.click(screen.getByRole("combobox", { name: /portal type/i }));
    expect(await screen.findByRole("option", { name: /process navigator/i })).toBeInTheDocument();
  });

  it("disables the option when the BPM module is off", async () => {
    bpmEnabled = false;
    const user = userEvent.setup();
    await openNewPortalForm(user);
    await user.click(screen.getByRole("combobox", { name: /portal type/i }));
    const opt = await screen.findByRole("option", { name: /process navigator/i });
    expect(opt).toHaveAttribute("aria-disabled", "true");
  });

  it("pins the card type and saves the bpm config block", async () => {
    /*
     * `card_config` collapses to null when there is nothing in it, so the bpm
     * block has to count towards "is there anything to save?" — otherwise the
     * switches silently vanish on save. That is the bug the PPM portal commit
     * called out in a comment; this pins it for the second board.
     */
    const user = userEvent.setup();
    await openNewPortalForm(user);

    await user.type(screen.getByRole("textbox", { name: /name/i }), "House");
    await selectOption(user, /portal type/i, /process navigator/i);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.view).toBe("process_navigator");
    expect(body.card_type).toBe("BusinessProcess");
    expect(body.card_config).toMatchObject({
      bpm: {
        show_element_links: false,
        default_level: 2,
        default_overlay: "processType",
      },
    });
  });
});
