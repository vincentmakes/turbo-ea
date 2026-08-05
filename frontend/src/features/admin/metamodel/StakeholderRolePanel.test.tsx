/**
 * Tests for the stakeholder-role panel's key handling and delete flow.
 *
 * Both behaviours come from discussion #907: an admin created a role with a
 * typo'd key, could not type the separator the API's error message advertised,
 * and then could neither rename nor remove the role.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StakeholderRolePanel from "./StakeholderRolePanel";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/api/client", () => ({ api: apiMock }));

vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({ enabledLocales: ["en"] }),
}));

const ROLES = [
  {
    id: "1",
    card_type_key: "Application",
    key: "responsible",
    label: "Responsible",
    color: "#1976d2",
    permissions: {},
    is_archived: false,
    sort_order: 0,
    stakeholder_count: 0,
  },
  {
    id: "2",
    card_type_key: "Application",
    key: "typoRole",
    label: "Typo Role",
    color: "#1976d2",
    permissions: {},
    is_archived: false,
    sort_order: 1,
    stakeholder_count: 0,
  },
];

/** Usage payload for a role nothing points at. */
const UNUSED = {
  role_key: "typoRole",
  stakeholder_count: 0,
  card_count: 0,
  survey_count: 0,
  is_last_active: false,
  can_delete: true,
  can_rekey: true,
};

/** Usage payload for a role held by two people on two cards. */
const IN_USE = {
  ...UNUSED,
  stakeholder_count: 2,
  card_count: 2,
  can_delete: false,
  can_rekey: false,
};

/**
 * A role nobody holds, but which a survey targets and which is its type's only
 * role. Both block a delete; neither blocks a rename.
 */
const DELETE_ONLY_BLOCKED = {
  ...UNUSED,
  survey_count: 1,
  is_last_active: true,
  can_delete: false,
  can_rekey: true,
};

function mockApi({ usage = UNUSED }: { usage?: typeof UNUSED } = {}) {
  apiMock.get.mockImplementation((path: string) => {
    if (path.includes("/usage")) return Promise.resolve(usage);
    if (path.includes("permissions-schema")) return Promise.resolve({ "card.view": "View card" });
    return Promise.resolve(ROLES);
  });
  apiMock.delete.mockResolvedValue(undefined);
  apiMock.post.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StakeholderRolePanel — key entry", () => {
  it("derives a valid camelCase key from the label so the admin never hand-authors one", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getByRole("button", { name: /add role/i }));

    const label = await screen.findByLabelText(/^Label/);
    await user.type(label, "Business Architect");

    const key = screen.getByLabelText(/^Key/) as HTMLInputElement;
    expect(key.value).toBe("businessArchitect");
  });

  it("stops auto-deriving once the admin edits the key by hand", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getByRole("button", { name: /add role/i }));

    const key = await screen.findByLabelText(/^Key/);
    await user.type(key, "myOwnKey");
    await user.type(screen.getByLabelText(/^Label/), "Business Architect");

    expect((key as HTMLInputElement).value).toBe("myOwnKey");
  });

  it("keeps Create disabled for a key shorter than the API's 3-character minimum", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getByRole("button", { name: /add role/i }));

    await user.type(await screen.findByLabelText(/^Label/), "Ab");
    const create = screen.getByRole("button", { name: /^create$/i });
    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText(/^Label/), "c");
    await waitFor(() => expect(create).toBeEnabled());
  });
});

describe("StakeholderRolePanel — delete", () => {
  it("deletes an unused role after confirmation", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    // Second role's delete button (first belongs to `responsible`).
    await user.click(screen.getAllByRole("button", { name: /delete/i })[1]);

    expect(await screen.findByText(/can be safely deleted/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^delete role$/i }));

    await waitFor(() =>
      expect(apiMock.delete).toHaveBeenCalledWith(
        "/metamodel/types/Application/stakeholder-roles/typoRole",
      ),
    );
  });

  it("blocks deletion of an in-use role and offers archive instead", async () => {
    mockApi({ usage: IN_USE });
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getAllByRole("button", { name: /delete/i })[1]);

    // The count is surfaced, and the primary action becomes Archive.
    expect(await screen.findByText(/2 stakeholder/i)).toBeInTheDocument();
    const archiveInstead = screen.getByRole("button", { name: /archive instead/i });
    expect(archiveInstead).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^delete role$/i })).not.toBeInTheDocument();

    await user.click(archiveInstead);
    await user.click(await screen.findByRole("button", { name: /^archive role$/i }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        "/metamodel/types/Application/stakeholder-roles/typoRole/archive",
      ),
    );
    expect(apiMock.delete).not.toHaveBeenCalled();
  });

  it("keeps the destructive button disabled until the usage check returns", async () => {
    let resolveUsage: (v: unknown) => void = () => {};
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes("/usage")) return new Promise((r) => (resolveUsage = r));
      if (path.includes("permissions-schema")) return Promise.resolve({});
      return Promise.resolve(ROLES);
    });
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getAllByRole("button", { name: /delete/i })[1]);

    expect(await screen.findByText(/checking where this role is used/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete role$/i })).toBeDisabled();

    resolveUsage(UNUSED);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^delete role$/i })).toBeEnabled(),
    );
  });
});

describe("StakeholderRolePanel — key is editable when only a delete is blocked", () => {
  it("leaves the key unlocked for a role that a survey targets and that is the type's only role", async () => {
    // Neither reason blocks a rename: the role survives it, so the survey's
    // target follows and the active-role count is unchanged. Gating the key
    // field on `can_delete` locked built-in roles for no good reason, while
    // telling the admin the key was editable when nobody held the role.
    mockApi({ usage: DELETE_ONLY_BLOCKED });
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[1]);

    const key = await screen.findByDisplayValue("typoRole");
    await waitFor(() => expect(key).toBeEnabled());

    // ...and deleting it is still refused, with the survey named as the reason.
    await user.click(screen.getAllByRole("button", { name: /delete/i })[1]);
    expect(await screen.findByText(/1 survey/i)).toBeInTheDocument();
  });
});

describe("StakeholderRolePanel — legacy snake_case keys", () => {
  const LEGACY = [
    ROLES[0],
    {
      ...ROLES[1],
      key: "data_steward",
      label: "Data Steward",
    },
  ];

  it("still allows editing the label of a role whose key predates camelCase", async () => {
    // Roles created via the API, a workspace import, or an older release can
    // carry a snake_case key. They are grandfathered — the key only has to
    // satisfy the current grammar when it is actually being changed.
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes("/usage")) return Promise.resolve({ ...UNUSED, role_key: "data_steward" });
      if (path.includes("permissions-schema")) return Promise.resolve({});
      return Promise.resolve(LEGACY);
    });
    apiMock.patch.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Data Steward");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[1]);

    const label = await screen.findByDisplayValue("Data Steward");
    await user.clear(label);
    await user.type(label, "Data Custodian");

    const save = screen.getByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    // The key is left out of the payload entirely, so nothing re-validates it.
    const [, body] = apiMock.patch.mock.calls[0];
    expect(body.key).toBeUndefined();
    expect(body.label).toBe("Data Custodian");
  });
});

describe("StakeholderRolePanel — archived roles", () => {
  it("requests archived roles so the Show archived toggle has something to reveal", async () => {
    mockApi();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await waitFor(() =>
      expect(apiMock.get).toHaveBeenCalledWith(
        "/metamodel/types/Application/stakeholder-roles?include_archived=true",
      ),
    );
  });
});
