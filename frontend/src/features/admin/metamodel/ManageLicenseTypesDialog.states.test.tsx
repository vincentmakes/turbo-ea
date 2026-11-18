import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { mockApi } from "@/test/apiMock";
import ManageLicenseTypesDialog from "./ManageLicenseTypesDialog";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

// Own file: the catalogue cache is a module singleton, and these states need it empty.
const METRICS_PATH = "/metamodel/license-metrics";

beforeEach(() => {
  mockApi.reset();
});

describe("ManageLicenseTypesDialog loading states", () => {
  it("says so when the catalogue could not be loaded", async () => {
    mockApi.fail("get", METRICS_PATH, 500);
    render(<ManageLicenseTypesDialog open onClose={vi.fn()} />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows a spinner while the catalogue loads", async () => {
    mockApi.on("get", METRICS_PATH, () => new Promise(() => {}));
    render(<ManageLicenseTypesDialog open onClose={vi.fn()} />);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
  });
});
