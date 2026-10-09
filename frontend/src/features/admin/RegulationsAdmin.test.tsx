/**
 * Compliance regulations admin: the list, the empty state, the create / edit
 * dialog, the enable toggle and the delete confirm, through the shared api kit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/hooks/useComplianceRegulations", () => ({
  useComplianceRegulations: () => ({
    regulations: [],
    enabled: [],
    byKey: {},
    loaded: true,
    refresh: h.refresh,
  }),
}));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import type { ComplianceRegulation } from "@/types";
import RegulationsAdmin from "./RegulationsAdmin";

const PATH = "/metamodel/compliance-regulations";

function makeRegulation(
  overrides: Partial<ComplianceRegulation> & { id: string; key: string },
): ComplianceRegulation {
  return {
    label: overrides.key.toUpperCase(),
    description: null,
    is_enabled: true,
    built_in: false,
    sort_order: 0,
    translations: {},
    ...overrides,
  };
}

const GDPR = makeRegulation({
  id: "reg-1",
  key: "gdpr",
  label: "GDPR",
  description: "Personal data of EU residents.",
  built_in: true,
  sort_order: 10,
});
const NIS2 = makeRegulation({ id: "reg-2", key: "nis2", label: "NIS2", is_enabled: false, built_in: true });
const INTERNAL = makeRegulation({
  id: "reg-3",
  key: "internal",
  label: "Internal controls",
  sort_order: 30,
  translations: { fr: "Contrôles internes" },
});
const ITEMS = [GDPR, NIS2, INTERNAL];

function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".MuiCard-root");
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return row;
}

async function renderPage(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<RegulationsAdmin />);
  await screen.findByText("GDPR");
  return user;
}

async function expectNoDialog() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockApi.reset();
  h.refresh.mockClear();
  mockApi.on("get", PATH, ITEMS);
});

describe("RegulationsAdmin list", () => {
  it("renders every regulation with its key, chips and description", async () => {
    await renderPage();

    const gdpr = rowOf("GDPR");
    expect(within(gdpr).getByText("gdpr")).toBeInTheDocument();
    expect(within(gdpr).getByText("Built-in")).toBeInTheDocument();
    expect(within(gdpr).getByText("Personal data of EU residents.")).toBeInTheDocument();
    expect(within(gdpr).getByRole("checkbox")).toBeChecked();
    // Built-ins cannot be deleted, only disabled.
    expect(within(gdpr).getByRole("button", { name: /delete/i })).toBeDisabled();

    const nis2 = rowOf("NIS2");
    expect(within(nis2).getByText("Disabled")).toBeInTheDocument();
    expect(within(nis2).getByRole("checkbox")).not.toBeChecked();

    expect(within(rowOf("Internal controls")).queryByText("Built-in")).not.toBeInTheDocument();
    expect(within(rowOf("Internal controls")).getByRole("button", { name: /delete/i })).toBeEnabled();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when no regulation exists", async () => {
    mockApi.on("get", PATH, []);
    render(<RegulationsAdmin />);
    expect(
      await screen.findByText(
        "No regulations yet. Add one to enable manual or AI-driven compliance assessment.",
      ),
    ).toBeInTheDocument();
  });

  it("reports a failed load in a dismissible alert", async () => {
    mockApi.fail("get", PATH);
    const user = userEvent.setup();
    render(<RegulationsAdmin />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load regulations.");
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("toggles a regulation and reloads", async () => {
    mockApi.on("patch", `${PATH}/reg-2`, {});
    const user = await renderPage();

    await user.click(within(rowOf("NIS2")).getByRole("checkbox"));

    await waitFor(() => expect(mockApi.callsOf("patch", `${PATH}/reg-2`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${PATH}/reg-2`)[0].body).toEqual({ is_enabled: true });
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a failed toggle and leaves the switch as it was", async () => {
    mockApi.fail("patch", `${PATH}/reg-2`);
    const user = await renderPage();

    await user.click(within(rowOf("NIS2")).getByRole("checkbox"));

    expect(await screen.findByRole("alert")).toHaveTextContent(`PATCH ${PATH}/reg-2 failed`);
    expect(within(rowOf("NIS2")).getByRole("checkbox")).not.toBeChecked();
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("reports a failed toggle without an Error generically", async () => {
    mockApi.on("patch", `${PATH}/reg-2`, () => Promise.reject("down"));
    const user = await renderPage();

    await user.click(within(rowOf("NIS2")).getByRole("checkbox"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save regulation.");
  });
});

describe("RegulationsAdmin dialog", () => {
  it("creates a regulation with a lower-cased key and cleaned translations", async () => {
    mockApi.on("post", PATH, {});
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /Add regulation/ }));
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Key"), "HIPAA");
    await user.type(within(dialog).getByLabelText("Display label"), "HIPAA");
    await user.type(within(dialog).getByLabelText("Assessment scope"), "US health data");
    // Three regulations exist, so the suggested sort order is 3 * 10 + 100.
    expect(within(dialog).getByLabelText("Sort order")).toHaveValue(130);
    await user.type(within(dialog).getByLabelText("Deutsch"), " HIPAA (DE) ");
    await user.type(within(dialog).getByLabelText("Español"), "  ");
    await user.click(create);

    await waitFor(() => expect(mockApi.callsOf("post", PATH)).toHaveLength(1));
    expect(mockApi.callsOf("post", PATH)[0].body).toEqual({
      key: "hipaa",
      label: "HIPAA",
      description: "US health data",
      is_enabled: true,
      sort_order: 130,
      translations: { de: "HIPAA (DE)" },
    });
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });

  it("edits a regulation with its key locked and sends a null description when cleared", async () => {
    mockApi.on("patch", `${PATH}/reg-1`, {});
    const user = await renderPage();

    await user.click(within(rowOf("GDPR")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit regulation")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Key")).toBeDisabled();
    expect(within(dialog).getByLabelText("Assessment scope")).toHaveValue(
      "Personal data of EU residents.",
    );

    await user.clear(within(dialog).getByLabelText("Assessment scope"));
    const sortOrder = within(dialog).getByLabelText("Sort order");
    await user.clear(sortOrder);
    await user.type(sortOrder, "15");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", `${PATH}/reg-1`)).toHaveLength(1));
    expect(mockApi.callsOf("patch", `${PATH}/reg-1`)[0].body).toEqual({
      label: "GDPR",
      description: null,
      is_enabled: true,
      sort_order: 15,
      translations: {},
    });
    await expectNoDialog();
  });

  it("keeps the dialog open and shows the server message when saving fails", async () => {
    mockApi.fail("patch", `${PATH}/reg-3`);
    const user = await renderPage();

    await user.click(within(rowOf("Internal controls")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Français")).toHaveValue("Contrôles internes");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent(`PATCH ${PATH}/reg-3 failed`);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("RegulationsAdmin delete", () => {
  it("confirms, cancels, then deletes a custom regulation", async () => {
    mockApi.on("delete", `${PATH}/reg-3`, {});
    const user = await renderPage();

    await user.click(within(rowOf("Internal controls")).getByRole("button", { name: /delete/i }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete regulation")).toBeInTheDocument();
    expect(within(dialog).getByText(/Delete the regulation "Internal controls"\?/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(within(rowOf("Internal controls")).getByRole("button", { name: /delete/i }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockApi.callsOf("delete", `${PATH}/reg-3`)).toHaveLength(1));
    await expectNoDialog();
    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
  });

  it("reports a failed delete", async () => {
    mockApi.fail("delete", `${PATH}/reg-3`);
    const user = await renderPage();

    await user.click(within(rowOf("Internal controls")).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent("Could not delete regulation.");
  });
});

const EMPTY_TEXT = "No regulations yet. Add one to enable manual or AI-driven compliance assessment.";

describe("RegulationsAdmin first paint and reloads", () => {
  it("paints nothing but the header before the list has loaded", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<RegulationsAdmin />);
    expect(host.textContent).toContain("Manage the compliance frameworks");
    expect(host.textContent).not.toContain(EMPTY_TEXT);
    // No regulation row (and so no enable toggle) and no error before the fetch.
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows neither the empty state nor an alert once regulations have loaded", async () => {
    await renderPage();
    expect(screen.getByText(/Manage the compliance frameworks that drive the TurboLens/)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the empty state while the list reloads after a create", async () => {
    mockApi.on("get", PATH, []);
    mockApi.on("post", PATH, {});
    const user = userEvent.setup();
    render(<RegulationsAdmin />);
    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();

    let resolve: (v: unknown) => void = () => {};
    mockApi.on("get", PATH, () => new Promise((r) => (resolve = r)));
    await user.click(screen.getByRole("button", { name: /Add regulation/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Key"), "hipaa");
    await user.type(within(dialog).getByLabelText("Display label"), "HIPAA");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument());
    await act(async () => resolve([makeRegulation({ id: "reg-9", key: "hipaa", label: "HIPAA" })]));
    expect(await screen.findByText("hipaa")).toBeInTheDocument();
  });

  it("reloads the list when the interface language changes, keeping it on screen meanwhile", async () => {
    await renderPage();
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
    let resolve: (v: unknown) => void = () => {};
    mockApi.on("get", PATH, () => new Promise((r) => (resolve = r)));
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      await waitFor(() => expect(mockApi.callsOf("get", PATH)).toHaveLength(2));
      expect(screen.getByText("GDPR")).toBeInTheDocument();
      expect(screen.getByText("Internal controls")).toBeInTheDocument();
      await act(async () => resolve(ITEMS));
      expect(screen.getByText("GDPR")).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});

describe("RegulationsAdmin row tooltips", () => {
  it("labels the toggle and the delete button by what they do", async () => {
    await renderPage();
    expect(
      within(rowOf("GDPR")).getByLabelText(
        "Disable — keeps existing findings but removes the regulation from scans and dropdowns.",
      ),
    ).toBeInTheDocument();
    expect(within(rowOf("NIS2")).getByLabelText("Enable")).toBeInTheDocument();
    expect(
      within(rowOf("GDPR")).getByLabelText(
        "Built-in regulations cannot be deleted. Disable them with the toggle instead.",
      ),
    ).toBeInTheDocument();
    expect(within(rowOf("Internal controls")).getByLabelText("Delete")).toBeInTheDocument();
  });
});

describe("RegulationsAdmin dialog details", () => {
  async function openCreate(user: UserEvent) {
    await user.click(screen.getByRole("button", { name: /Add regulation/ }));
    return screen.findByRole("dialog");
  }

  it("shows the create form's title, help texts and one translation field per other locale", async () => {
    const user = await renderPage();
    const dialog = await openCreate(user);

    expect(within(dialog).getByText("Add regulation")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Lowercase identifier used internally and on stored findings/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Plain-language description of what to assess/)).toBeInTheDocument();
    expect(within(dialog).getByText("Translations")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Display label per locale. Leave empty to fall back to the default label."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("English")).not.toBeInTheDocument();
    for (const name of ["Deutsch", "Français", "Español", "Italiano", "Português", "中文", "Русский", "Dansk", "العربية"]) {
      expect(within(dialog).getByLabelText(name)).toBeInTheDocument();
    }
  });

  it("enables Create only once both a key and a label carry text", async () => {
    const user = await renderPage();
    const dialog = await openCreate(user);
    const create = within(dialog).getByRole("button", { name: "Create" });
    const key = within(dialog).getByLabelText("Key");
    const label = within(dialog).getByLabelText("Display label");

    await user.type(label, "HIPAA");
    expect(create).toBeDisabled();
    await user.type(key, "   ");
    expect(create).toBeDisabled();
    await user.clear(label);
    await user.clear(key);
    await user.type(key, "hipaa");
    expect(create).toBeDisabled();
    await user.type(label, "   ");
    expect(create).toBeDisabled();
    await user.type(label, "H");
    expect(create).toBeEnabled();
  });

  it("trims the key, label and scope it sends and drops a blank scope", async () => {
    mockApi.on("post", PATH, {});
    const user = await renderPage();
    const dialog = await openCreate(user);

    await user.type(within(dialog).getByLabelText("Key"), "  HIPAA ");
    await user.type(within(dialog).getByLabelText("Display label"), "  HIPAA rule ");
    await user.type(within(dialog).getByLabelText("Assessment scope"), "  US health data ");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockApi.callsOf("post", PATH)).toHaveLength(1));
    expect(mockApi.callsOf("post", PATH)[0].body).toMatchObject({
      key: "hipaa",
      label: "HIPAA rule",
      description: "US health data",
    });
  });

  it("starts an edit with an empty scope when the regulation has none", async () => {
    const user = await renderPage();
    await user.click(within(rowOf("NIS2")).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Assessment scope")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("opens a fresh create form after cancelling an edit", async () => {
    const user = await renderPage();
    await user.click(within(rowOf("GDPR")).getByRole("button", { name: "Edit" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit regulation")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    dialog = await openCreate(user);
    expect(within(dialog).getByText("Add regulation")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Key")).toBeEnabled();
    expect(within(dialog).getByLabelText("Key")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("closes the create dialog on Cancel and on Escape without saving", async () => {
    const user = await renderPage();
    let dialog = await openCreate(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();

    dialog = await openCreate(user);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("shows a generic message when saving fails without an Error", async () => {
    mockApi.on("post", PATH, () => Promise.reject("nope"));
    const user = await renderPage();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("Key"), "hipaa");
    await user.type(within(dialog).getByLabelText("Display label"), "HIPAA");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent(
      "Could not save regulation.",
    );
  });
});

describe("RegulationsAdmin delete dialog", () => {
  it("closes the confirm on Escape without deleting", async () => {
    const user = await renderPage();
    await user.click(within(rowOf("Internal controls")).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("ignores a Delete click that lands while the cancelled confirm is closing", async () => {
    mockApi.on("delete", `${PATH}/reg-3`, {});
    const user = await renderPage();
    await user.click(within(rowOf("Internal controls")).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirmDelete = within(dialog).getByRole("button", { name: "Delete" });

    fireEvent.click(cancel);
    fireEvent.click(confirmDelete);

    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
