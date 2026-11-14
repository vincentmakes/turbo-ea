/**
 * PpmRiskTab — the initiative risk register (summary, grid, create/edit
 * dialog). Pins the counts, that risk text is shown in full, and the exact
 * bodies sent to `/ppm/initiatives/{id}/risks` and `/ppm/risks/{id}`.
 *
 * AG Grid cannot lay out under jsdom, so the grid is the shared stub plus a
 * plain table that renders every row through the page's own cell renderers:
 * the rows' buttons are the real ones. The grid's columns, sort and freeze
 * are pinned in `PpmRiskGrid.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import userEvent from "@testing-library/user-event";
import type { PpmRisk } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useThemeMode", () => import("@/test/hooks").then((m) => m.useThemeModeModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
const exportPpmRisks = vi.hoisted(() => vi.fn());
vi.mock("./ppmRiskSpreadsheet", () => ({ exportPpmRisks }));
/** The import dialog has its own suite; here it only shows what it was handed. */
vi.mock("./PpmRiskImportDialog", () => ({
  default: (p: {
    open: boolean;
    initiativeId: string;
    existingRisks: { id: string }[];
    onClose: () => void;
    onImported: () => void;
  }) =>
    p.open ? (
      <div data-testid="import-dialog">
        <span>{`${p.initiativeId}:${p.existingRisks.map((r) => r.id).join(",")}`}</span>
        <button onClick={p.onImported}>imported</button>
        <button onClick={p.onClose}>close import</button>
      </div>
    ) : null,
}));
vi.mock("ag-grid-react", async () => {
  const m = await import("@/test/agGridStub");
  type Def = { colId: string; cellRenderer?: ComponentType<Record<string, unknown>> };
  return {
    AgGridReact: (props: { rowData: PpmRisk[]; columnDefs: Def[] }) => (
      <>
        {m.AgGridReactStub(props)}
        <table>
          <tbody>
            {props.rowData.map((data) => (
              <tr key={data.id}>
                {props.columnDefs.map((def) => (
                  <td key={def.colId}>
                    {def.cellRenderer
                      ? createElement(def.cellRenderer, {
                          data,
                          value: m.gridStub.cellValue(def.colId, data),
                        })
                      : String(m.gridStub.cellValue(def.colId, data, { formatted: true }) ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  };
});

import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { RAG_COLORS } from "@/theme/tokens";
import i18n from "@/i18n";
import PpmRiskTab from "./PpmRiskTab";

const USERS = [
  { id: "u1", display_name: "Ada Lovelace", email: "ada@example.com" },
  { id: "u2", display_name: "", email: "grace@example.com" },
];

function risk(overrides: Partial<PpmRisk> & { id: string; title: string }): PpmRisk {
  return {
    initiative_id: "i1",
    description: null,
    probability: 3,
    impact: 3,
    risk_score: 9,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

const LONG = `${"Long description ".repeat(18)}`.slice(0, 299) + "!";

const RISKS: PpmRisk[] = [
  risk({
    id: "r1",
    title: "Vendor lock-in",
    description: "Runbook at https://wiki.example.com/lockin",
    probability: 5,
    impact: 4,
    risk_score: 20,
    mitigation: "Dual-source the platform",
    owner_id: "u1",
    owner_name: "Ada Lovelace",
    status: "open",
  }),
  risk({ id: "r2", title: "Budget overrun", description: LONG, risk_score: 9, status: "mitigating" }),
  risk({ id: "r3", title: "Late delivery", probability: 1, impact: 2, risk_score: 2, status: "accepted" }),
];

const createPath = "/ppm/initiatives/i1/risks";

function renderTab(risks: PpmRisk[] = RISKS, initiativeName?: string) {
  const onRefresh = vi.fn();
  const user = userEvent.setup();
  render(
    <PpmRiskTab
      initiativeId="i1"
      risks={risks}
      onRefresh={onRefresh}
      initiativeName={initiativeName}
    />,
  );
  return { user, onRefresh };
}

const kpi = (caption: string) =>
  (screen.getByText(caption, { selector: ".MuiTypography-caption" }).nextElementSibling as HTMLElement)
    .textContent;
const rowOf = (title: string) => screen.getByText(title).closest("tr") as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  exportPpmRisks.mockReset();
  gridStub.reset();
  mockApi.reset();
  mockApi.on("get", "/users", USERS);
  mockApi.on("post", createPath, {});
  mockApi.on("patch", /^\/ppm\/risks\//, {});
  mockApi.on("delete", /^\/ppm\/risks\//, null);
});

describe("PpmRiskTab — summary and grid", () => {
  it("counts all, open and high (score ≥ 15) risks", () => {
    renderTab();
    expect(kpi("Total Risks")).toBe("3");
    expect(kpi("Open")).toBe("1");
    expect(kpi("High Risks")).toBe("1");
  });

  it("renders each risk's numbers, status, owner and mitigation", () => {
    renderTab();
    const row = rowOf("Vendor lock-in");
    expect(within(row).getByText("20")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(row).getByText("Dual-source the platform")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "https://wiki.example.com/lockin" })).toBeInTheDocument();
    expect(within(rowOf("Budget overrun")).getByText("Mitigating")).toBeInTheDocument();
    expect(within(rowOf("Late delivery")).getByText("Accepted")).toBeInTheDocument();
  });

  it("colours the score chip by band", () => {
    renderTab();
    const chipOf = (title: string, score: string) =>
      within(rowOf(title)).getByText(score, { selector: ".MuiChip-label" }).closest(".MuiChip-root") as HTMLElement;
    expect(chipOf("Vendor lock-in", "20")).toHaveStyle({ backgroundColor: RAG_COLORS.red });
    expect(chipOf("Budget overrun", "9")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
    expect(chipOf("Late delivery", "2")).toHaveStyle({ backgroundColor: RAG_COLORS.green });
    // White text on every band (palette.common.white).
  });

  it("shows a long description in full and dashes for a missing owner or mitigation", () => {
    renderTab();
    const row = rowOf("Budget overrun");
    expect(LONG).toHaveLength(300);
    expect(within(row).getByText(LONG)).toBeInTheDocument();
    expect(within(row).queryByText(/\.\.\.$/)).not.toBeInTheDocument();
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });

  it("hands the grid no rows, and counts nothing, when there are no risks", () => {
    renderTab([]);
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "0");
    expect(gridStub.lastProps().overlayNoRowsTemplate).toBe("<span>No risks yet</span>");
    expect(kpi("Total Risks")).toBe("0");
    expect(kpi("Open")).toBe("0");
    expect(kpi("High Risks")).toBe("0");
  });
});

describe("PpmRiskTab — create, edit, delete", () => {
  it("creates a risk with the entered fields and a live score preview", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add Risk")).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox", { name: "Risk Title" }), "Key person leaves");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Bus factor of one");
    const [probability, impact] = within(dialog).getAllByRole("slider");
    fireEvent.change(probability, { target: { value: 4 } });
    fireEvent.change(impact, { target: { value: 5 } });
    expect(within(dialog).getByText("Risk Score: 20")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("combobox", { name: "Owner" }));
    await user.click(await screen.findByRole("option", { name: "grace@example.com" }));

    await user.click(within(dialog).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Mitigated" }));

    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(mockApi.callsOf("post", createPath)).toHaveLength(1));
    expect(mockApi.callsOf("post", createPath)[0].body).toEqual({
      title: "Key person leaves",
      description: "Bus factor of one",
      probability: 4,
      impact: 5,
      mitigation: null,
      owner_id: "u2",
      status: "mitigated",
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("edits a risk with its values pre-filled and can clear the owner", async () => {
    const { user, onRefresh } = renderTab();
    // Let the user list land so the owner autocomplete can show its value.
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    await user.click(within(rowOf("Vendor lock-in")).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit Risk")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Risk Title" })).toHaveValue("Vendor lock-in");
    expect(within(dialog).getByRole("textbox", { name: "Mitigation" })).toHaveValue("Dual-source the platform");
    expect(within(dialog).getByText("Risk Score: 20")).toBeInTheDocument();
    const owner = within(dialog).getByRole("combobox", { name: "Owner" });
    await waitFor(() => expect(owner).toHaveValue("Ada Lovelace"));

    // Emptying the input clears a non-freeSolo Autocomplete's value.
    await user.clear(owner);
    await user.clear(within(dialog).getByRole("textbox", { name: "Mitigation" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/ppm/risks/r1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/ppm/risks/r1")[0].body).toEqual({
      title: "Vendor lock-in",
      description: "Runbook at https://wiki.example.com/lockin",
      probability: 5,
      impact: 4,
      mitigation: null,
      owner_id: null,
      status: "open",
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("deletes a risk and refreshes the parent", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/ppm/risks/r3")).toHaveLength(1));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("cancels the dialog without writing", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("still opens the dialog when the user list cannot be loaded", async () => {
    mockApi.fail("get", "/users", 403);
    const { user } = renderTab();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Owner" }));
    expect(await screen.findByText("No options")).toBeInTheDocument();
  });
});

describe("PpmRiskTab — labels and bands", () => {
  it("hands the grid every risk", () => {
    renderTab();
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "3");
    expect(gridStub.rows()).toEqual(RISKS);
  });

  it("puts a score of exactly 15 in the high band and exactly 6 in the medium one", () => {
    renderTab([
      risk({ id: "b1", title: "Fifteen", probability: 3, impact: 5, risk_score: 15 }),
      risk({ id: "b3", title: "Six", probability: 2, impact: 3, risk_score: 6 }),
    ]);
    expect(kpi("High Risks")).toBe("1");
    const chipOf = (title: string, score: string) =>
      within(rowOf(title)).getByText(score, { selector: ".MuiChip-label" }).closest(".MuiChip-root") as HTMLElement;
    expect(chipOf("Fifteen", "15")).toHaveStyle({ backgroundColor: RAG_COLORS.red });
    expect(chipOf("Six", "6")).toHaveStyle({ backgroundColor: RAG_COLORS.amber });
  });

  it("shows a multi-line mitigation in full", () => {
    const plan = "Dual-source the platform.\nReview every quarter with procurement and legal.";
    renderTab([risk({ id: "d1", title: "Exact", mitigation: plan })]);
    const text = within(rowOf("Exact")).getByText((_, el) => el?.textContent === plan && el.tagName === "P");
    expect(text).toHaveStyle({ whiteSpace: "pre-wrap" });
  });
});

describe("PpmRiskTab — dialog form", () => {
  it("edits a risk with no description or mitigation as empty fields, sent back as null", async () => {
    const { user } = renderTab();
    await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(within(dialog).getByRole("textbox", { name: "Mitigation" })).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/ppm/risks/r3")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/ppm/risks/r3")[0].body).toEqual({
      title: "Late delivery",
      description: null,
      probability: 1,
      impact: 2,
      mitigation: null,
      owner_id: null,
      status: "accepted",
    });
  });

  it("opens a blank form after an edit was cancelled", async () => {
    const { user } = renderTab();
    await user.click(within(rowOf("Vendor lock-in")).getByRole("button", { name: "Edit" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Risk Title" })).toHaveValue("");
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(within(dialog).getByRole("textbox", { name: "Mitigation" })).toHaveValue("");
    expect(within(dialog).getByText("Probability: 3")).toBeInTheDocument();
    expect(within(dialog).getByText("Impact: 3")).toBeInTheDocument();
    expect(within(dialog).getByText("Risk Score: 9")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveTextContent("Open");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("leaves the owner empty on a new risk once the users have loaded", async () => {
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    const owner = within(screen.getByRole("dialog")).getByRole("combobox", { name: "Owner" });
    await user.click(owner);
    expect(await screen.findByRole("option", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(owner).toHaveValue("");
  });

  it("labels the status picker and offers every status", async () => {
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    const dialog = screen.getByRole("dialog");
    // The floating label, and the same text sizing the outline's notch.
    expect(within(dialog).getByText("Status", { selector: "label" })).toBeInTheDocument();
    expect(within(dialog).getByText("Status", { selector: "legend span" })).toBeInTheDocument();
    const status = within(dialog).getByRole("combobox", { name: "Status" });
    expect(status).toHaveTextContent("Open");
    await user.click(status);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Open",
      "Mitigating",
      "Mitigated",
      "Closed",
      "Accepted",
    ]);
  });

  it("closes on Escape without writing", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("translates the dialog buttons through the shared common keys", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      const { user } = renderTab();
      await user.click(screen.getByRole("button", { name: /Risiko hinzufügen/ }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});

describe("PpmRiskTab — saving once", () => {
  /** A promise the test settles by hand. */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("creates a risk once however often Save is clicked, and locks Save meanwhile", async () => {
    const write = deferred<object>();
    mockApi.on("post", createPath, () => write.promise);
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Risk Title" }), "Scope creep");
    const save = within(dialog).getByRole("button", { name: "Save" });
    // Both clicks land before the dialog re-renders.
    act(() => {
      save.click();
      save.click();
    });
    expect(mockApi.callsOf("post", createPath)).toHaveLength(1);
    expect(save).toBeDisabled();

    write.resolve({});
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post", createPath)).toHaveLength(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("unlocks Save after a failed save so the user can retry", async () => {
    let posts = 0;
    mockApi.on("post", createPath, () => (++posts === 1 ? Promise.reject(new Error("offline")) : {}));
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Risk Title" }), "Scope creep");
    const save = within(dialog).getByRole("button", { name: "Save" });
    await user.click(save);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("offline");
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toBe(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("PpmRiskTab — failed writes", () => {
  it("keeps the dialog open and says why when creating a risk fails", async () => {
    mockApi.fail("post", createPath, 500);
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Risk Title" }), "Scope creep");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(`POST ${createPath} failed`);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and says why when saving an edit fails", async () => {
    mockApi.fail("patch", "/ppm/risks/r3", 422);
    const { user, onRefresh } = renderTab();
    await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PATCH /ppm/risks/r3 failed");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when a save fails without one", async () => {
    mockApi.on("post", createPath, () => Promise.reject("network down"));
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Risk Title" }), "Scope creep");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("opens the dialog again without the previous attempt's error", async () => {
    mockApi.fail("patch", "/ppm/risks/r3", 422);
    const { user } = renderTab();
    await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "Edit" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await within(screen.getByRole("dialog")).findByRole("alert");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Add Risk/ }));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed delete above the table, until the next delete succeeds", async () => {
    mockApi.fail("delete", "/ppm/risks/r3", 409);
    const { user, onRefresh } = renderTab();
    await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("DELETE /ppm/risks/r3 failed");
    expect(alert.compareDocumentPosition(screen.getByRole("table"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(onRefresh).not.toHaveBeenCalled();

    await user.click(within(rowOf("Budget overrun")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dismisses a failed delete", async () => {
    mockApi.fail("delete", "/ppm/risks/r3", 409);
    const { user } = renderTab();
    await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "Delete" }));
    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("PpmRiskTab — accessible names", () => {
  it("names every row's edit and delete buttons", () => {
    renderTab();
    for (const title of ["Vendor lock-in", "Budget overrun", "Late delivery"]) {
      expect(within(rowOf(title)).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(rowOf(title)).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    }
  });

  it("names the description field and the row buttons in the user's language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    try {
      const { user } = renderTab();
      expect(within(rowOf("Late delivery")).getByRole("button", { name: "Löschen" })).toBeInTheDocument();
      await user.click(within(rowOf("Late delivery")).getByRole("button", { name: "Bearbeiten" }));
      expect(
        within(screen.getByRole("dialog")).getByRole("textbox", { name: "Beschreibung" }),
      ).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});

describe("PpmRiskTab — toolbar", () => {
  it("opens the import dialog for this initiative and its risks", async () => {
    const { user, onRefresh } = renderTab();
    expect(screen.queryByTestId("import-dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Import/ }));
    const dialog = screen.getByTestId("import-dialog");
    expect(dialog).toHaveTextContent("i1:r1,r2,r3");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reloads the risks once an import has written, keeping the dialog open on its summary", async () => {
    const { user, onRefresh } = renderTab();
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await user.click(screen.getByRole("button", { name: "imported" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("import-dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "close import" }));
    expect(screen.queryByTestId("import-dialog")).not.toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("names the export after the initiative", async () => {
    const { user } = renderTab(RISKS, "ERP move");
    await user.click(screen.getByRole("button", { name: /Export/ }));
    expect(exportPpmRisks).toHaveBeenCalledTimes(1);
    expect(exportPpmRisks.mock.calls[0][1]).toBe("ERP move");
    expect(exportPpmRisks.mock.calls[0][0].map((r: PpmRisk) => r.id).sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("keeps counting every risk while the sidebar narrows the grid", async () => {
    const { user } = renderTab();
    await user.click(screen.getByRole("button", { name: "Accepted" }));
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "1");
    expect(kpi("Total Risks")).toBe("3");
    expect(kpi("Open")).toBe("1");
    expect(kpi("High Risks")).toBe("1");
  });
});
