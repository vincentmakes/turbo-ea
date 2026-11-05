/**
 * Tests for the stakeholder-role panel's key handling and delete flow.
 *
 * Both behaviours come from discussion #907: an admin created a role with a
 * typo'd key, could not type the separator the API's error message advertised,
 * and then could neither rename nor remove the role.
 */
import { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StakeholderRolePanel, { type StakeholderRolePanelHandle } from "./StakeholderRolePanel";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/api/client", () => ({ api: apiMock }));

const localesMock = vi.hoisted(() => ({ enabled: ["en"] as string[] }));
vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({ enabledLocales: localesMock.enabled }),
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
  localesMock.enabled = ["en"];
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

  it("explains that the type's last active role cannot be deleted", async () => {
    // Nobody holds it and no survey targets it — the only blocker is that it
    // is the type's last active role, which gets its own explanation.
    mockApi({
      usage: {
        ...UNUSED,
        can_delete: false,
        stakeholder_count: 0,
        card_count: 0,
        survey_count: 0,
        is_last_active: true,
      },
    });
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getAllByRole("button", { name: /delete/i })[1]);

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "This is the last active role for this card type, so it cannot be deleted or archived.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete role$/i })).not.toBeInTheDocument();
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

describe("StakeholderRolePanel — legacy permission keys", () => {
  /**
   * A role on an install upgraded through migration 024 carries permission keys
   * the current catalogue does not define. The permission editor renders only
   * the keys the schema endpoint returns, so they were invisible here and could
   * not be unticked — yet the panel resent the stored map verbatim, the API
   * rejected the whole PATCH, and the colour change went down with it.
   */
  const LEGACY_ROLE = [
    {
      id: "1",
      card_type_key: "Application",
      key: "responsible",
      label: "Responsible",
      color: "#1976d2",
      permissions: { "card.view": true, "card.quality_seal": true },
      is_archived: false,
      sort_order: 0,
      stakeholder_count: 0,
    },
  ];

  function mockLegacyApi() {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes("/usage")) return Promise.resolve(UNUSED);
      if (path.includes("permissions-schema"))
        return Promise.resolve({ "card.view": "View card" });
      return Promise.resolve(LEGACY_ROLE);
    });
    apiMock.patch.mockResolvedValue({});
  }

  it("does not resend a permission key the editor cannot display", async () => {
    mockLegacyApi();
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);

    const save = await screen.findByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    const [, body] = apiMock.patch.mock.calls[0];
    expect(body.permissions).toEqual({ "card.view": true });
    expect(body.permissions["card.quality_seal"]).toBeUndefined();
  });

  it("keeps every permission when the schema fetch came back empty", async () => {
    // Guard on the filter above: an empty schema must mean "cannot tell", not
    // "no permissions", or a failed fetch would silently blank the role.
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes("/usage")) return Promise.resolve(UNUSED);
      if (path.includes("permissions-schema")) return Promise.resolve({});
      return Promise.resolve(LEGACY_ROLE);
    });
    apiMock.patch.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);

    const save = await screen.findByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    const [, body] = apiMock.patch.mock.calls[0];
    expect(body.permissions).toEqual({ "card.view": true, "card.quality_seal": true });
  });

  it("shows a failed save inside the panel, not only at the top of the drawer", async () => {
    // The drawer's alert renders above the tab bar, so a failure while editing
    // a role further down scrolls out of sight and the save just looks inert.
    mockLegacyApi();
    apiMock.patch.mockRejectedValue(new Error("Unknown permission keys: card.quality_seal"));
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={onError} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);

    const save = await screen.findByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    expect(await screen.findByText(/Unknown permission keys/)).toBeInTheDocument();
    // The drawer-level alert still fires for anyone scrolled to the top.
    expect(onError).toHaveBeenCalled();
  });
});

describe("StakeholderRolePanel — confirmation escapes the role label", () => {
  it("renders an admin-typed label as text, never as markup", async () => {
    // The confirm line goes through `dangerouslySetInnerHTML` (the translation
    // carries `<strong>`), so the interpolated label must be HTML-escaped.
    const label = '<img data-xss="role" src="x" onerror="window.__xss=1">';
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes("/usage")) return Promise.resolve(UNUSED);
      if (path.includes("permissions-schema")) return Promise.resolve({});
      return Promise.resolve([ROLES[0], { ...ROLES[1], label }]);
    });
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText(label);
    await user.click(screen.getAllByRole("button", { name: /delete/i })[1]);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("strong")).toHaveTextContent(label);
    expect(document.body.querySelector("[data-xss]")).toBeNull();
  });
});

describe("StakeholderRolePanel — description translations", () => {
  it("saves a per-language description beside the translated label", async () => {
    localesMock.enabled = ["en", "de"];
    mockApi();
    apiMock.patch.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);

    await user.type(await screen.findByLabelText("Deutsch"), "Verantwortlich");
    await user.type(
      screen.getByLabelText("Deutsch — description"),
      "Pflegt die Karte.",
    );

    const save = screen.getByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    const [, body] = apiMock.patch.mock.calls[0];
    expect(body.translations).toEqual({
      label: { de: "Verantwortlich" },
      description: { de: "Pflegt die Karte." },
    });
  });

  it("offers no translation inputs when English is the only language", async () => {
    mockApi();
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);
    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    await screen.findByDisplayValue("Responsible");
    expect(screen.queryByLabelText(/— description$/)).not.toBeInTheDocument();
  });
});

describe("StakeholderRolePanel — savePendingForm (the drawer's header Save)", () => {
  it("has nothing pending and resolves true without a request when no form is open", async () => {
    mockApi();
    const ref = createRef<StakeholderRolePanelHandle>();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={() => {}} />);
    await screen.findByText("Responsible");

    expect(ref.current!.hasPendingForm()).toBe(false);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.savePendingForm();
    });
    expect(ok).toBe(true);
    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it("saves an open inline edit through the form's own save and resolves true", async () => {
    mockApi();
    apiMock.patch.mockResolvedValue({});
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    await user.type(await screen.findByLabelText(/^Description/), "Keeps it current.");
    expect(ref.current!.hasPendingForm()).toBe(true);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.savePendingForm();
    });
    expect(ok).toBe(true);
    expect(apiMock.patch).toHaveBeenCalledTimes(1);
    const [path, body] = apiMock.patch.mock.calls[0];
    expect(path).toBe("/metamodel/types/Application/stakeholder-roles/responsible");
    expect(body.description).toBe("Keeps it current.");
    // The edit form closed, so nothing is pending any more.
    await waitFor(() => expect(ref.current!.hasPendingForm()).toBe(false));
  });

  it("resolves false and keeps the form open with its error when the save fails", async () => {
    mockApi();
    apiMock.patch.mockRejectedValue(new Error("Role save refused"));
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    await screen.findByDisplayValue("Responsible");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.savePendingForm();
    });
    expect(ok).toBe(false);
    expect(await screen.findByText("Role save refused")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Role save refused");
    expect(ref.current!.hasPendingForm()).toBe(true);
  });

  it("resolves false without a request for an invalid create form", async () => {
    mockApi();
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Responsible");
    await user.click(screen.getByRole("button", { name: /add role/i }));
    // A key but no label: the form's own Create stays disabled.
    await user.type(await screen.findByLabelText(/^Key/), "dataSteward");
    expect(ref.current!.hasPendingForm()).toBe(true);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.savePendingForm();
    });
    expect(ok).toBe(false);
    expect(apiMock.post).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Failed to create role");
  });

  it("creates the role from a filled-in create form and resolves true", async () => {
    mockApi();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getByRole("button", { name: /add role/i }));
    await user.type(await screen.findByLabelText(/^Label/), "Data Steward");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.savePendingForm();
    });
    expect(ok).toBe(true);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    const [path, body] = apiMock.post.mock.calls[0];
    expect(path).toBe("/metamodel/types/Application/stakeholder-roles");
    expect(body).toMatchObject({ key: "dataSteward", label: "Data Steward" });
  });

  it("treats an open but untouched create form as nothing to save", async () => {
    mockApi();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getByRole("button", { name: /add role/i }));
    await screen.findByLabelText(/^Label/);
    expect(ref.current!.hasPendingForm()).toBe(false);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.savePendingForm();
    });
    expect(ok).toBe(true);
    expect(apiMock.post).not.toHaveBeenCalled();
  });
});

describe("StakeholderRolePanel — clearing a description", () => {
  it("sends an emptied description as null so the stored text is cleared", async () => {
    mockApi();
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes("/usage")) return Promise.resolve(UNUSED);
      if (path.includes("permissions-schema")) return Promise.resolve({});
      return Promise.resolve([{ ...ROLES[0], description: "Old text" }, ROLES[1]]);
    });
    apiMock.patch.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    const description = await screen.findByDisplayValue("Old text");
    await user.clear(description);
    await user.type(description, "   ");

    const save = screen.getByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    const [, body] = apiMock.patch.mock.calls[0];
    expect(body).toHaveProperty("description", null);
  });

  it("sends a trimmed description", async () => {
    mockApi();
    apiMock.patch.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    await user.type(await screen.findByLabelText(/^Description/), "  Owns it.  ");
    const save = screen.getByRole("button", { name: /^save$/i });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    expect(apiMock.patch.mock.calls[0][1].description).toBe("Owns it.");
  });
});

describe("StakeholderRolePanel — pending-form validity (the drawer's header Save)", () => {
  /** Run the drawer's header Save through the panel's handle. */
  async function savePending(ref: React.RefObject<StakeholderRolePanelHandle | null>) {
    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.savePendingForm();
    });
    return ok;
  }

  it("treats a create form holding only whitespace as nothing to save", async () => {
    mockApi();
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Responsible");
    await user.click(screen.getByRole("button", { name: /add role/i }));
    const label = (await screen.findByLabelText(/^Label/)) as HTMLInputElement;
    await user.type(label, "   ");
    await user.type(screen.getByLabelText(/^Description/), "  ");
    expect(label.value).toBe("   ");

    expect(ref.current!.hasPendingForm()).toBe(false);
    expect(await savePending(ref)).toBe(true);
    expect(apiMock.post).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("resolves false without a POST for a create form whose derived key is too short", async () => {
    mockApi();
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Responsible");
    await user.click(screen.getByRole("button", { name: /add role/i }));
    await user.type(await screen.findByLabelText(/^Label/), "Ab");
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
    expect(ref.current!.hasPendingForm()).toBe(true);

    expect(await savePending(ref)).toBe(false);
    expect(apiMock.post).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Failed to create role");
  });

  it("resolves false and reports the error when the create POST fails", async () => {
    mockApi();
    apiMock.post.mockRejectedValue(new Error("Role create refused"));
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Responsible");
    await user.click(screen.getByRole("button", { name: /add role/i }));
    await user.type(await screen.findByLabelText(/^Label/), "Data Steward");

    expect(await savePending(ref)).toBe(false);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Role create refused");
    // The form stays open with what the admin typed.
    expect(screen.getByDisplayValue("Data Steward")).toBeInTheDocument();
    expect(ref.current!.hasPendingForm()).toBe(true);
  });

  it("refuses an edit whose label was emptied, in the panel and through onError", async () => {
    mockApi();
    apiMock.patch.mockResolvedValue({});
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    await user.clear(await screen.findByDisplayValue("Responsible"));
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(ref.current!.hasPendingForm()).toBe(true);

    expect(await savePending(ref)).toBe(false);
    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(await screen.findByText("Failed to update role")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Failed to update role");
    expect(ref.current!.hasPendingForm()).toBe(true);
  });

  it("refuses an edit whose changed key is invalid, though the label is filled in", async () => {
    mockApi();
    apiMock.patch.mockResolvedValue({});
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Typo Role");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[1]);
    const key = (await screen.findByDisplayValue("typoRole")) as HTMLInputElement;
    await waitFor(() => expect(key).toBeEnabled());
    await user.clear(key);
    await user.type(key, "1bad");
    expect(key.value).toBe("1bad");
    expect(screen.getByDisplayValue("Typo Role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

    expect(await savePending(ref)).toBe(false);
    expect(apiMock.patch).not.toHaveBeenCalled();
    expect(await screen.findByText("Failed to update role")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith("Failed to update role");
  });

  it("saves a role whose unchanged key predates camelCase through the header Save", async () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.includes("/usage")) return Promise.resolve({ ...UNUSED, role_key: "data_steward" });
      if (path.includes("permissions-schema")) return Promise.resolve({});
      return Promise.resolve([ROLES[0], { ...ROLES[1], key: "data_steward", label: "Data Steward" }]);
    });
    apiMock.patch.mockResolvedValue({});
    const onError = vi.fn();
    const ref = createRef<StakeholderRolePanelHandle>();
    const user = userEvent.setup();
    render(<StakeholderRolePanel ref={ref} typeKey="Application" onError={onError} />);

    await screen.findByText("Data Steward");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[1]);
    await screen.findByDisplayValue("data_steward");

    expect(await savePending(ref)).toBe(true);
    expect(apiMock.patch).toHaveBeenCalledTimes(1);
    const [path, body] = apiMock.patch.mock.calls[0];
    expect(path).toBe("/metamodel/types/Application/stakeholder-roles/data_steward");
    expect(body.key).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("StakeholderRolePanel — the edit form's own Save button", () => {
  it("is disabled with an empty label and enabled once a label is typed", async () => {
    mockApi();
    apiMock.patch.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    const label = await screen.findByDisplayValue("Responsible");
    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeEnabled();

    await user.clear(label);
    expect(save).toBeDisabled();
    // A click on the disabled button sends nothing.
    fireEvent.click(save);
    expect(apiMock.patch).not.toHaveBeenCalled();

    await user.type(label, "Owner");
    expect(save).toBeEnabled();
  });

  it("is disabled while the PATCH is in flight", async () => {
    mockApi();
    let resolvePatch: (v: unknown) => void = () => {};
    apiMock.patch.mockImplementation(() => new Promise((r) => (resolvePatch = r)));
    const user = userEvent.setup();
    render(<StakeholderRolePanel typeKey="Application" onError={() => {}} />);

    await screen.findByText("Responsible");
    await user.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    await screen.findByDisplayValue("Responsible");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const saving = await screen.findByRole("button", { name: "Saving..." });
    expect(saving).toBeDisabled();
    expect(apiMock.patch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePatch({});
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Saving..." })).not.toBeInTheDocument(),
    );
  });
});
