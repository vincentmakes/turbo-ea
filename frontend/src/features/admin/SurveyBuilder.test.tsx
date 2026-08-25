import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({}),
}));
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (d: Date) => (d as Date).toISOString().slice(0, 10) }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      {
        key: "Application",
        label: "Application",
        icon: "apps",
        color: "#0f7eb5",
        is_hidden: false,
        fields_schema: [],
        translations: {},
      },
    ],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";

import SurveyBuilder from "./SurveyBuilder";

const mockPost = api.post as ReturnType<typeof vi.fn>;

/** Walk the wizard to the Target step, which is where the filter lives, and
 *  pick a target type — Save Draft only appears once a name and type exist. */
async function gotoTargetStep(user: ReturnType<typeof userEvent.setup>) {
  render(<SurveyBuilder />);
  await waitFor(() => expect(screen.getByLabelText(/survey name/i)).toBeInTheDocument());
  await user.type(screen.getByLabelText(/survey name/i), "Annual refresh");
  await user.click(screen.getByRole("button", { name: /next/i }));
  await waitFor(() => expect(screen.getByText(/filter by last update/i)).toBeInTheDocument());

  await user.click(screen.getByRole("combobox", { name: /^type$/i }));
  await user.click(await screen.findByRole("option", { name: /application/i }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /save draft/i })).toBeInTheDocument(),
  );
}

/** The target_filters of the most recent create call. */
function lastSavedFilters() {
  const [, body] = mockPost.mock.calls.at(-1)!;
  return (body as { target_filters: Record<string, unknown> }).target_filters;
}

describe("SurveyBuilder — last-update (staleness) filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The builder fans out over several endpoints on mount; only the card
    // searches are paged, and handing them a bare array blows up the merge.
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/cards") ? { items: [] } : []),
    );
    mockPost.mockResolvedValue({ id: "survey-1" });
    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("defaults to Any and saves no window", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    expect(screen.getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toBeUndefined();
  });

  it("saves the window behind a preset", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    await user.click(screen.getByRole("button", { name: "6 months" }));
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toEqual({ value: 6, unit: "months" });
  });

  it("shows the cutoff date the window resolves to", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    expect(screen.queryByText(/cards last changed before/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "90 days" }));

    const expected = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`cards last changed before ${expected}`, "i"))).toBeInTheDocument(),
    );
  });

  it("reveals a number + unit row for a custom window and saves it", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    expect(screen.queryByLabelText(/not updated for/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /custom/i }));

    const value = screen.getByLabelText(/not updated for/i);
    await user.clear(value);
    await user.type(value, "45");
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toEqual({ value: 45, unit: "days" });
  });

  it("saves nothing while the custom value is out of range", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    await user.click(screen.getByRole("button", { name: /custom/i }));
    const value = screen.getByLabelText(/not updated for/i);
    await user.clear(value);
    await user.type(value, "99999");

    // Flagged inline, and the unsaveable value never reaches the payload.
    await waitFor(() => expect(screen.getByText(/enter a whole number/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(lastSavedFilters().not_updated_for).toBeUndefined();
  });

  it("keeps the other target filters intact", async () => {
    const user = userEvent.setup();
    await gotoTargetStep(user);

    await user.click(screen.getByRole("button", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const filters = lastSavedFilters();
    expect(filters.not_updated_for).toEqual({ value: 30, unit: "days" });
    // The shared builder must still emit every other key, absent-as-undefined.
    expect(filters).toHaveProperty("card_ids");
    expect(filters).toHaveProperty("tag_ids");
    expect(filters).toHaveProperty("related_ids");
    expect(filters).toHaveProperty("attribute_filters");
  });
});
