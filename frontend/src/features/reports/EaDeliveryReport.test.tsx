import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

// InitiativesTab pulls its own data + has a sidebar + AG-Grid-like layout —
// stub it. We're only smoke-testing that the page shell renders and the
// header is in place.
vi.mock("@/features/ea-delivery/initiatives", () => ({
  InitiativesTab: () => <div data-testid="initiatives-tab" />,
  useInitiativeData: vi.fn(),
}));

vi.mock("@/features/ea-delivery/initiatives/NewArtefactSplitButton", () => ({
  default: () => <div data-testid="new-artefact-split-button" />,
  __esModule: true,
}));

vi.mock("@/features/ea-delivery/initiatives/InitiativeTreeSidebar", () => ({
  default: () => null,
  UNLINKED_KEY: "__unlinked__",
}));

vi.mock("@/features/ea-delivery/CreateSoAWDialog", () => ({
  default: () => null,
}));

vi.mock("@/features/ea-delivery/CreateAdrDialog", () => ({
  default: () => null,
}));

vi.mock("@/features/ea-delivery/LinkDiagramsDialog", () => ({
  default: () => null,
}));

vi.mock("@/features/diagrams/CreateDiagramDialog", () => ({
  default: () => null,
}));

import EaDeliveryReport from "./EaDeliveryReport";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EaDeliveryReport", () => {
  it("renders the relocated Initiatives workspace under a Reports header", () => {
    render(
      <MemoryRouter initialEntries={["/reports/ea-delivery"]}>
        <EaDeliveryReport />
      </MemoryRouter>,
    );
    // InitiativesTab + the artefact split button slot in correctly.
    expect(screen.getByTestId("initiatives-tab")).toBeInTheDocument();
    expect(screen.getByTestId("new-artefact-split-button")).toBeInTheDocument();
  });
});
