/**
 * The Licensing import dialog: preview (dry_run=true), skipped / flagged rows with a human reason,
 * apply (dry_run=false, same file), client-side refusals and the server's own message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
import en from "@/i18n/locales/en/reports.json";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachmentFormats";
import LicensingImportDialog from "./LicensingImportDialog";

vi.mock("@/api/client", () => ({ api: { upload: vi.fn() } }));
const catalogue = vi.hoisted(() => ({
  state: { metrics: [] as unknown[], loading: false, failed: false, reload: () => {} },
}));
vi.mock("@/hooks/useLicenseCatalogue", () => ({ useLicenseCatalogue: () => catalogue.state }));
import { api } from "@/api/client";

const typeItem = (metric: string, key: string, label: string) => ({
  id: `${metric}-${key}`,
  metric_key: metric,
  key,
  label,
  sort_order: 1,
  archived: false,
  translations: {},
});
const CATALOGUE = [
  { id: "u", key: "users", label: "Users", sort_order: 1, archived: false, translations: {}, types: [typeItem("users", "prod", "Prod"), typeItem("users", "standard", "Standard")] },
  { id: "c", key: "cores", label: "Cores", sort_order: 2, archived: true, translations: {}, types: [typeItem("cores", "xeon", "Xeon"), typeItem("cores", "standard", "Standard")] },
];

// Every `reason` the backend's plan_import can return (services/license_import.py).
const BACKEND_REASONS = [
  "card_not_found",
  "ambiguous_card",
  "invalid_metric",
  "ambiguous_metric",
  "unknown_license_type",
  "ambiguous_license_type",
  "invalid_year",
  "duplicate_cell",
  "invalid_number",
  "nothing_to_write",
  "forecast_actual",
  "archived_license_type",
  "archived_license_metric",
  "type_not_in_metric",
];

const RESULT = {
  matched: 3,
  applied: 0,
  skipped: [
    { row: 4, component: "Ghost", reason: "card_not_found", detail: "", metric: "" },
    { row: 7, component: "SAP", reason: "invalid_year", detail: "1999", metric: "users" },
    { row: 9, component: "CRM", reason: "type_not_in_metric", detail: "Xeon", metric: "users" },
    { row: 11, component: "ERP", reason: "archived_license_metric", detail: "cores", metric: "cores" },
    { row: 12, component: "HR", reason: "archived_license_type", detail: "standard", metric: "cores" },
    { row: 13, component: "FIN", reason: "unknown_license_type", detail: "Bar", metric: "Foo" },
  ],
};

const xlsx = (name = "licenses.xlsx") =>
  new File(["x"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

function setup(over: { onClose?: () => void; onApplied?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn();
  const onApplied = over.onApplied ?? vi.fn();
  const view = render(<LicensingImportDialog open onClose={onClose} onApplied={onApplied} />);
  const input = () => document.querySelector('input[type="file"]') as HTMLInputElement;
  return { onClose, onApplied, input, ...view };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  catalogue.state = { metrics: CATALOGUE, loading: false, failed: false, reload: () => {} };
});

describe("LicensingImportDialog", () => {
  it("previews with dry_run=true and lists skipped rows with their reason", async () => {
    vi.mocked(api.upload).mockResolvedValue(RESULT as never);
    const { input } = setup();
    const file = xlsx();
    await userEvent.upload(input(), file);
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith("/licenses/import?dry_run=true", file));
    expect(await screen.findByText("Card not found")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    const ghost = rows.find((r) => within(r).queryByText("Ghost"))!;
    expect(ghost).toHaveTextContent("4");
    expect(ghost).toHaveTextContent("Card not found");
    const sap = rows.find((r) => within(r).queryByText("SAP"))!;
    expect(sap).toHaveTextContent("7");
    expect(sap).toHaveTextContent("1999");
    const crm = rows.find((r) => within(r).queryByText("CRM"))!;
    expect(crm).toHaveTextContent("License type belongs to another metric (Users: Xeon)");
    expect(screen.getByRole("button", { name: "Apply 3 rows" })).toBeEnabled();
  });

  it("shows the metric and the pair behind an archived refusal as labels, not keys", async () => {
    vi.mocked(api.upload).mockResolvedValue(RESULT as never);
    const { input } = setup();
    await userEvent.upload(input(), xlsx());
    const rows = await screen.findAllByRole("row");
    expect(rows.find((r) => within(r).queryByText("ERP"))!).toHaveTextContent(
      "Metric is archived and not yet used on this card (Cores (archived))",
    );
    expect(rows.find((r) => within(r).queryByText("HR"))!).toHaveTextContent(
      "License type is archived and not yet used on this card (Cores: Standard (archived))",
    );
  });

  it("names the metric of the row's pair, never every metric owning the type key", async () => {
    vi.mocked(api.upload).mockResolvedValue(RESULT as never);
    const { input } = setup();
    await userEvent.upload(input(), xlsx());
    const rows = await screen.findAllByRole("row");
    // `standard` exists under Users and Cores: only the refused pair (Cores) is named.
    expect(rows.find((r) => within(r).queryByText("HR"))!).not.toHaveTextContent("Users: Standard");
    // A metric and type the catalogue does not know stay as the file wrote them.
    expect(rows.find((r) => within(r).queryByText("FIN"))!).toHaveTextContent("(Foo: Bar)");
    // A year refusal has no pair to name.
    expect(rows.find((r) => within(r).queryByText("SAP"))!).toHaveTextContent("1999");
    expect(rows.find((r) => within(r).queryByText("SAP"))!).not.toHaveTextContent("users");
  });

  it("keeps the file's own text while the catalogue is not there", async () => {
    catalogue.state = { metrics: [], loading: true, failed: false, reload: () => {} };
    vi.mocked(api.upload).mockResolvedValue(RESULT as never);
    const { input } = setup();
    await userEvent.upload(input(), xlsx());
    const rows = await screen.findAllByRole("row");
    expect(rows.find((r) => within(r).queryByText("ERP"))!).toHaveTextContent("(cores)");
  });

  it("shows the message of an ambiguous metric", async () => {
    vi.mocked(api.upload).mockResolvedValue({
      matched: 0, applied: 0,
      skipped: [{ row: 3, component: "ACME", reason: "ambiguous_metric", detail: "Seats", metric: "Seats" }],
    } as never);
    const { input } = setup();
    await userEvent.upload(input(), xlsx());
    expect(await screen.findByText(/The metric text matches more than one metric; use the metric key\. \(Seats\)/)).toBeInTheDocument();
  });

  it("has no rows-to-check chip any more", async () => {
    vi.mocked(api.upload).mockResolvedValue(RESULT as never);
    const { input } = setup();
    await userEvent.upload(input(), xlsx());
    await screen.findByText("Card not found");
    expect(screen.queryByText(/to check/)).toBeNull();
  });

  it("applies with dry_run=false, re-sending the same file, and calls onApplied", async () => {
    vi.mocked(api.upload)
      .mockResolvedValueOnce(RESULT as never)
      .mockResolvedValueOnce({ ...RESULT, applied: 3 } as never);
    const { input, onApplied, onClose } = setup();
    const file = xlsx();
    await userEvent.upload(input(), file);
    await userEvent.click(await screen.findByRole("button", { name: "Apply 3 rows" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(api.upload).toHaveBeenLastCalledWith("/licenses/import?dry_run=false", file);
    expect(onClose).toHaveBeenCalled();
  });

  it("disables Apply when nothing matched", async () => {
    vi.mocked(api.upload).mockResolvedValue({ ...RESULT, matched: 0 } as never);
    const { input } = setup();
    await userEvent.upload(input(), xlsx());
    const apply = await screen.findByRole("button", { name: "Apply 0 rows" });
    expect(apply).toBeDisabled();
  });

  it("refuses a file over the size cap before uploading", async () => {
    const { input } = setup();
    const big = xlsx("big.xlsx");
    Object.defineProperty(big, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
    await userEvent.upload(input(), big);
    expect(await screen.findByRole("alert")).toHaveTextContent("20 MB");
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("refuses a file that is not .xlsx before uploading", async () => {
    const { input } = setup();
    await userEvent.upload(input(), new File(["x"], "licenses.csv", { type: "text/csv" }), {
      applyAccept: false,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(".xlsx");
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("shows the server message on a 400 and offers no Apply", async () => {
    vi.mocked(api.upload).mockRejectedValue(new Error("Missing column: Metric"));
    const { input } = setup();
    await userEvent.upload(input(), xlsx());
    expect(await screen.findByRole("alert")).toHaveTextContent("Missing column: Metric");
    expect(screen.queryByRole("button", { name: /^Apply/ })).not.toBeInTheDocument();
  });

  it("shows the server message when the apply fails and does not call onApplied", async () => {
    vi.mocked(api.upload)
      .mockResolvedValueOnce(RESULT as never)
      .mockRejectedValueOnce(new Error("archived_license_type"));
    const { input, onApplied } = setup();
    await userEvent.upload(input(), xlsx());
    await userEvent.click(await screen.findByRole("button", { name: "Apply 3 rows" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("archived_license_type");
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("has a translation key for every backend reason code", () => {
    for (const code of BACKEND_REASONS) {
      expect(en, code).toHaveProperty([`licensing.import.reasons.${code}`]);
    }
  });
});
