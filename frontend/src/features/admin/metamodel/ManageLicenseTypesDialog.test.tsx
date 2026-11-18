import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "@/test/apiMock";
import type { LicenseMetricItem, LicenseTypeItem } from "@/types";
import { invalidateLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import ManageLicenseTypesDialog from "./ManageLicenseTypesDialog";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const METRICS_PATH = "/metamodel/license-metrics";

const ltype = (metric: string, key: string, over: Partial<LicenseTypeItem> = {}): LicenseTypeItem => ({
  id: `${metric}-${key}`,
  metric_key: metric,
  key,
  label: key[0].toUpperCase() + key.slice(1),
  sort_order: 0,
  archived: false,
  translations: {},
  ...over,
});
const lmetric = (key: string, over: Partial<LicenseMetricItem> = {}): LicenseMetricItem => ({
  id: key,
  key,
  label: key[0].toUpperCase() + key.slice(1),
  sort_order: 0,
  archived: false,
  translations: {},
  types: [],
  ...over,
});

const CATALOGUE = [
  lmetric("users", {
    sort_order: 1,
    types: [
      ltype("users", "business", { sort_order: 1 }),
      ltype("users", "guest", { archived: true, sort_order: 2 }),
    ],
  }),
  lmetric("cores", { archived: true, sort_order: 2 }),
];

const metricRow = (key: string) => screen.getByTestId(`license-metric-${key}`);
const typeRow = (metric: string, key: string) => screen.getByTestId(`license-type-${metric}-${key}`);

async function renderDialog() {
  const user = userEvent.setup();
  render(<ManageLicenseTypesDialog open onClose={vi.fn()} />);
  await screen.findByTestId("license-metric-users");
  return user;
}

beforeEach(async () => {
  mockApi.reset();
  mockApi.on("get", METRICS_PATH, CATALOGUE);
  await invalidateLicenseCatalogue();
});

describe("ManageLicenseTypesDialog", () => {
  it("lists every metric with its types, archived ones included", async () => {
    await renderDialog();
    expect(screen.getByRole("heading", { name: "License types" })).toBeInTheDocument();
    expect(within(metricRow("users")).getByText("Users")).toBeInTheDocument();
    expect(within(typeRow("users", "business")).getByText("Business")).toBeInTheDocument();
    expect(within(typeRow("users", "guest")).getByText("Guest")).toBeInTheDocument();
    expect(within(metricRow("cores")).getByText("Cores")).toBeInTheDocument();
  });

  it("shows archived items struck through and never offers delete", async () => {
    await renderDialog();
    expect(within(typeRow("users", "guest")).getByText("Guest")).toHaveStyle({
      textDecoration: "line-through",
    });
    expect(within(typeRow("users", "business")).getByText("Business")).not.toHaveStyle({
      textDecoration: "line-through",
    });
    expect(within(metricRow("cores")).getByText("Cores")).toHaveStyle({
      textDecoration: "line-through",
    });
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("adds a metric through the metrics route", async () => {
    mockApi.on("post", METRICS_PATH, (_p, body) => lmetric("seats", body as object));
    const user = await renderDialog();
    await user.click(screen.getByRole("button", { name: /add metric/i }));
    await user.type(screen.getByLabelText(/^key/i), "seats");
    await user.type(screen.getByLabelText(/^name/i), "Seats");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mockApi.callsOf("post", METRICS_PATH)).toHaveLength(1));
    expect(mockApi.callsOf("post", METRICS_PATH)[0].body).toEqual({
      key: "seats",
      label: "Seats",
      translations: {},
    });
    // The catalogue is read again so every consumer sees the new metric.
    await waitFor(() => expect(mockApi.callsOf("get", METRICS_PATH).length).toBeGreaterThan(1));
  });

  it("adds a type under its metric", async () => {
    const path = `${METRICS_PATH}/users/types`;
    mockApi.on("post", path, (_p, body) => ltype("users", "admin", body as object));
    const user = await renderDialog();
    await user.click(within(metricRow("users")).getByRole("button", { name: /add type/i }));
    await user.type(screen.getByLabelText(/^key/i), "admin");
    await user.type(screen.getByLabelText(/^name/i), "Admin");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mockApi.callsOf("post", path)).toHaveLength(1));
    expect(mockApi.callsOf("post", path)[0].body).toEqual({
      key: "admin",
      label: "Admin",
      translations: {},
    });
  });

  it("edits a type through its own route", async () => {
    const path = `${METRICS_PATH}/users/types/business`;
    mockApi.on("patch", path, {});
    const user = await renderDialog();
    await user.click(within(typeRow("users", "business")).getByRole("button", { name: /edit/i }));
    const name = screen.getByLabelText(/^name/i);
    await user.clear(name);
    await user.type(name, "Business user");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mockApi.callsOf("patch", path)).toHaveLength(1));
    expect(mockApi.callsOf("patch", path)[0].body).toEqual({
      label: "Business user",
      translations: {},
    });
  });

  it("archives a type and restores an archived one", async () => {
    mockApi.on("patch", /^\/metamodel\/license-metrics\//, {});
    const user = await renderDialog();
    await user.click(within(typeRow("users", "business")).getByRole("button", { name: /archive/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `${METRICS_PATH}/users/types/business`)[0].body).toEqual({
        archived: true,
      }),
    );
    await user.click(within(typeRow("users", "guest")).getByRole("button", { name: /restore/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `${METRICS_PATH}/users/types/guest`)[0].body).toEqual({
        archived: false,
      }),
    );
  });

  it("archives and restores a metric", async () => {
    mockApi.on("patch", /^\/metamodel\/license-metrics\//, {});
    const user = await renderDialog();
    await user.click(within(metricRow("users")).getByRole("button", { name: /^archive: users/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `${METRICS_PATH}/users`)[0].body).toEqual({ archived: true }),
    );
    await user.click(within(metricRow("cores")).getByRole("button", { name: /restore/i }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `${METRICS_PATH}/cores`)[0].body).toEqual({ archived: false }),
    );
  });

  it("explains a refused archive instead of failing silently", async () => {
    mockApi.fail("patch", `${METRICS_PATH}/users/types/business`, 500, "boom");
    const user = await renderDialog();
    await user.click(within(typeRow("users", "business")).getByRole("button", { name: /archive/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `PATCH ${METRICS_PATH}/users/types/business failed`,
    );
  });

  it("falls back to the generic message when the refusal carries none", async () => {
    mockApi.on("patch", `${METRICS_PATH}/users/types/business`, () => {
      throw "refused";
    });
    const user = await renderDialog();
    await user.click(within(typeRow("users", "business")).getByRole("button", { name: /archive/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The change could not be saved");
  });

  it("offers no Add type on an archived metric", async () => {
    await renderDialog();
    expect(within(metricRow("users")).getByRole("button", { name: /add type/i })).toBeInTheDocument();
    expect(within(metricRow("cores")).queryByRole("button", { name: /add type/i })).toBeNull();
  });

  it("keeps the type title while the edit dialog closes", async () => {
    const user = await renderDialog();
    await user.click(within(metricRow("users")).getByRole("button", { name: /add type/i }));
    expect(screen.getByText("New license type")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText("New license metric")).toBeNull();
  });

  it("moves a metric down by swapping sort orders, disabled at the ends", async () => {
    mockApi.on("patch", /^\/metamodel\/license-metrics\//, {});
    const user = await renderDialog();
    expect(within(metricRow("users")).getByRole("button", { name: /^move up: users/i })).toBeDisabled();
    expect(within(metricRow("cores")).getByRole("button", { name: /^move down: cores/i })).toBeDisabled();
    await user.click(within(metricRow("users")).getByRole("button", { name: /^move down: users/i }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(2));
    expect(mockApi.callsOf("patch", `${METRICS_PATH}/users`)[0].body).toEqual({ sort_order: 2 });
    expect(mockApi.callsOf("patch", `${METRICS_PATH}/cores`)[0].body).toEqual({ sort_order: 1 });
    await waitFor(() => expect(mockApi.callsOf("get", METRICS_PATH).length).toBeGreaterThan(1));
  });

  it("moves a type up within its metric, disabled at the ends", async () => {
    mockApi.on("patch", /^\/metamodel\/license-metrics\//, {});
    const user = await renderDialog();
    expect(
      within(typeRow("users", "business")).getByRole("button", { name: /^move up: business/i }),
    ).toBeDisabled();
    expect(
      within(typeRow("users", "guest")).getByRole("button", { name: /^move down: guest/i }),
    ).toBeDisabled();
    await user.click(within(typeRow("users", "guest")).getByRole("button", { name: /^move up: guest/i }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(2));
    expect(mockApi.callsOf("patch", `${METRICS_PATH}/users/types/guest`)[0].body).toEqual({
      sort_order: 1,
    });
    expect(mockApi.callsOf("patch", `${METRICS_PATH}/users/types/business`)[0].body).toEqual({
      sort_order: 2,
    });
  });


  it("says a duplicate key already exists", async () => {
    mockApi.fail("post", METRICS_PATH, 409, "duplicate_key");
    const user = await renderDialog();
    await user.click(screen.getByRole("button", { name: /add metric/i }));
    await user.type(screen.getByLabelText(/^key/i), "users");
    await user.type(screen.getByLabelText(/^name/i), "Users");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText(/metric with this key already exists/i)).toBeInTheDocument();
  });
});
