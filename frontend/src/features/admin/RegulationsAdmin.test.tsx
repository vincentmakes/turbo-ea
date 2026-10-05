/**
 * Compliance regulations admin: the list, the empty state, the create / edit
 * dialog, the enable toggle and the delete confirm, through the shared api kit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
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
