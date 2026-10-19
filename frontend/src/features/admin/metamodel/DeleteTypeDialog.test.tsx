/**
 * Tests for the permanent card-type deletion dialog.
 *
 * The dialog loads the impact, lists it, and keeps **Delete permanently**
 * locked until the admin types the type key; the DELETE carries
 * `delete_cards=true` exactly when cards exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import { HIDDEN_TYPE, RELATION_TYPES, makeCardType, makeRelationType } from "@/test/fixtures/metamodel";

import DeleteTypeDialog, { type TypeDeleteImpact } from "./DeleteTypeDialog";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const ta = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

const GADGET = makeCardType({ key: "Gadget", label: "Gadget", built_in: false });
const REL_GADGET = makeRelationType({
  key: "relGadgetToApp",
  label: "powers",
  reverse_label: "is powered by",
  source_type_key: "Gadget",
  target_type_key: "Application",
  translations: { label: { de: "treibt an" } },
});

const IMPACT_PATH = "/metamodel/types/Gadget/delete-impact";

const FULL_IMPACT: TypeDeleteImpact = {
  key: "Gadget",
  label: "Gadget",
  built_in: false,
  card_count: 4,
  active_card_count: 3,
  archived_card_count: 1,
  relation_count: 3,
  relation_types: [
    { key: "relGadgetToApp", label: "powers", relation_count: 2 },
    { key: "relGadgetSelf", label: "feeds", relation_count: 1 },
  ],
  calculation_count: 1,
  stakeholder_role_count: 2,
};

const EMPTY_IMPACT: TypeDeleteImpact = {
  ...FULL_IMPACT,
  card_count: 0,
  active_card_count: 0,
  archived_card_count: 0,
  relation_count: 0,
  relation_types: [],
  calculation_count: 0,
  stakeholder_role_count: 0,
};

function renderDialog(overrides: { open?: boolean; cardType?: typeof GADGET | null } = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const utils = renderWithProviders(
    <DeleteTypeDialog
      open={overrides.open ?? true}
      cardType={"cardType" in overrides ? overrides.cardType! : GADGET}
      relationTypes={[...RELATION_TYPES, REL_GADGET]}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  );
  return { ...utils, onClose, onDeleted };
}

const confirmButton = () => screen.getByRole("button", { name: ta("metamodel.deleteType.confirm") });
const confirmField = () =>
  screen.getByRole("textbox", { name: ta("metamodel.deleteType.confirmLabel", { key: "Gadget" }) });

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", IMPACT_PATH, FULL_IMPACT);
  mockApi.on("delete", /^\/metamodel\/types\/Gadget/, { status: "deleted", key: "Gadget" });
});

describe("DeleteTypeDialog — impact", () => {
  it("renders nothing without a type and fetches nothing while closed", () => {
    renderDialog({ cardType: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    renderDialog({ open: false });
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("lists every kind of dependant with its count", async () => {
    renderDialog();
    const list = await screen.findByTestId("delete-type-impact");
    expect(within(list).getByText(ta("metamodel.deleteType.cards", { count: 4 }))).toBeInTheDocument();
    expect(
      within(list).getByText(ta("metamodel.deleteType.archivedCards", { count: 1 })),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(ta("metamodel.deleteType.relationTypes", { count: 2 })),
    ).toBeInTheDocument();
    expect(within(list).getByText(ta("metamodel.deleteType.relations", { count: 3 }))).toBeInTheDocument();
    expect(
      within(list).getByText(ta("metamodel.deleteType.calculations", { count: 1 })),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(ta("metamodel.deleteType.stakeholderRoles", { count: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: new RegExp(ta("metamodel.deleteType.title", { label: "Gadget" })) })).toBeInTheDocument();
  });

  it("names each relation type by its verb from the metamodel, with the row count", async () => {
    renderDialog();
    const list = await screen.findByTestId("delete-type-impact");
    // Known to the metamodel: the (translated) verb.
    expect(within(list).getByText("powers · 2")).toBeInTheDocument();
    // Unknown to the metamodel: the label the backend sent.
    expect(within(list).getByText("feeds · 1")).toBeInTheDocument();
  });

  it("uses the locale's verb for a known relation type", async () => {
    await i18n.changeLanguage("de");
    try {
      renderDialog();
      const list = await screen.findByTestId("delete-type-impact");
      expect(within(list).getByText("treibt an · 2")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("says so when nothing depends on the type", async () => {
    mockApi.on("get", IMPACT_PATH, EMPTY_IMPACT);
    renderDialog();
    expect(await screen.findByText(ta("metamodel.deleteType.noImpact"))).toBeInTheDocument();
    expect(screen.queryByTestId("delete-type-impact")).not.toBeInTheDocument();
  });

  it("hides the archived line when no card is archived", async () => {
    mockApi.on("get", IMPACT_PATH, { ...FULL_IMPACT, archived_card_count: 0, card_count: 3 });
    renderDialog();
    const list = await screen.findByTestId("delete-type-impact");
    expect(within(list).getByText(ta("metamodel.deleteType.cards", { count: 3 }))).toBeInTheDocument();
    expect(within(list).queryByText(/archived/)).not.toBeInTheDocument();
  });

  it("leaves out every line whose count is zero", async () => {
    mockApi.on("get", IMPACT_PATH, {
      ...FULL_IMPACT,
      relation_types: [],
      relation_count: 0,
      calculation_count: 0,
      stakeholder_role_count: 0,
    });
    renderDialog();
    const list = await screen.findByTestId("delete-type-impact");
    expect(within(list).getByText(ta("metamodel.deleteType.cards", { count: 4 }))).toBeInTheDocument();
    expect(within(list).queryByText(/relation type/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/calculation/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/stakeholder role/)).not.toBeInTheDocument();
  });

  it.each([
    ["one relation type", { relation_types: [{ key: "relX", label: "x", relation_count: 0 }] }],
    ["one calculation", { calculation_count: 1 }],
    ["one stakeholder role", { stakeholder_role_count: 1 }],
  ])("lists the impact rather than saying nothing depends on the type when there is %s", async (_label, extra) => {
    mockApi.on("get", IMPACT_PATH, { ...EMPTY_IMPACT, ...extra });
    renderDialog();
    expect(await screen.findByTestId("delete-type-impact")).toBeInTheDocument();
    expect(screen.queryByText(ta("metamodel.deleteType.noImpact"))).not.toBeInTheDocument();
  });

  it("reports a failed impact load and keeps the button locked", async () => {
    mockApi.fail("get", IMPACT_PATH, 500);
    const { user } = renderDialog();
    expect(await screen.findByText(ta("metamodel.deleteType.loadFailed"))).toBeInTheDocument();
    await user.type(confirmField(), "Gadget");
    expect(confirmButton()).toBeDisabled();
  });
});

describe("DeleteTypeDialog — confirmation", () => {
  it("unlocks the button only when the typed key matches exactly", async () => {
    const { user } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    expect(confirmButton()).toBeDisabled();
    await user.type(confirmField(), "gadget");
    expect(confirmButton()).toBeDisabled();
    await user.clear(confirmField());
    await user.type(confirmField(), "Gadget");
    expect(confirmButton()).toBeEnabled();
  });

  it("ignores surrounding whitespace in the typed key", async () => {
    const { user } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.type(confirmField(), "  Gadget  ");
    expect(confirmButton()).toBeEnabled();
  });

  it("a further keystroke after a match never deletes on its own", async () => {
    const { user, onDeleted } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.type(confirmField(), "Gadgetx");
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(confirmButton()).toBeDisabled();
  });

  it("locks both buttons while the delete is in flight", async () => {
    let finish: (v: unknown) => void = () => {};
    mockApi.on("delete", /^\/metamodel\/types\/Gadget/, () => new Promise((r) => (finish = r)));
    const { user, onDeleted } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.type(confirmField(), "Gadget");
    await user.click(confirmButton());
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: tc("actions.cancel") })).toBeDisabled();
    expect(confirmField()).toBeDisabled();
    finish({ status: "deleted" });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("deletes with delete_cards=true when cards exist and reports back", async () => {
    const { user, onDeleted } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.type(confirmField(), "Gadget");
    await user.click(confirmButton());
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("delete").map((c) => c.path)).toEqual([
      "/metamodel/types/Gadget?delete_cards=true",
    ]);
  });

  it("deletes without the flag when the type has no cards", async () => {
    mockApi.on("get", IMPACT_PATH, EMPTY_IMPACT);
    const { user, onDeleted } = renderDialog();
    await screen.findByText(ta("metamodel.deleteType.noImpact"));
    await user.type(confirmField(), "Gadget{Enter}");
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("delete").map((c) => c.path)).toEqual(["/metamodel/types/Gadget"]);
  });

  it("Enter does nothing while the key does not match", async () => {
    const { user, onDeleted } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.type(confirmField(), "Gadg{Enter}");
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    mockApi.fail("delete", /^\/metamodel\/types\/Gadget/, 403, "Not enough permissions");
    const { user, onDeleted } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.type(confirmField(), "Gadget");
    await user.click(confirmButton());
    // The mock words a refusal as "DELETE <path> failed"; the dialog shows the message as is.
    expect(await screen.findByText(/failed/)).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
    // The refusal can be dismissed, and the dialog stays.
    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByText(/failed/)).not.toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancel closes without deleting", async () => {
    const { user, onClose } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.click(screen.getByRole("button", { name: tc("actions.cancel") }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("starts fresh on every opening", async () => {
    const { user, rerender } = renderDialog();
    await screen.findByTestId("delete-type-impact");
    await user.type(confirmField(), "Gadget");
    expect(confirmButton()).toBeEnabled();
    const closed = wrapWithProviders(
      <DeleteTypeDialog open={false} cardType={GADGET} relationTypes={[]} onClose={() => {}} onDeleted={() => {}} />,
    );
    rerender(closed);
    const reopened = wrapWithProviders(
      <DeleteTypeDialog open cardType={GADGET} relationTypes={[]} onClose={() => {}} onDeleted={() => {}} />,
    );
    rerender(reopened);
    await screen.findByTestId("delete-type-impact");
    expect(confirmField()).toHaveValue("");
    expect(confirmButton()).toBeDisabled();
  });

  it("asks for the key of the type it was given, not of another", async () => {
    renderDialog({ cardType: HIDDEN_TYPE });
    expect(
      await screen.findByRole("textbox", {
        name: ta("metamodel.deleteType.confirmLabel", { key: "Secret" }),
      }),
    ).toBeInTheDocument();
  });
});
