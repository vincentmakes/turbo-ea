import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  DecisionStandingChip,
  DecisionStateChip,
  DecisionStatusChip,
} from "./DecisionStandingChip";

describe("DecisionStandingChip", () => {
  it("renders nothing without a standing", () => {
    const { container: a } = render(<DecisionStandingChip standing={null} />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<DecisionStandingChip standing={undefined} />);
    expect(b).toBeEmptyDOMElement();
  });

  it("labels and colours a standing", () => {
    const { container } = render(<DecisionStandingChip standing="revoked" />);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    const chip = container.querySelector(".MuiChip-root")!;
    expect(chip.className).toContain("MuiChip-colorError");
    expect(chip.className).toContain("MuiChip-outlined");
  });

  it("fills the in-force chip", () => {
    const { container } = render(<DecisionStandingChip standing="in_force" />);
    expect(screen.getByText("In force")).toBeInTheDocument();
    const chip = container.querySelector(".MuiChip-root")!;
    expect(chip.className).toContain("MuiChip-colorSuccess");
    expect(chip.className).toContain("MuiChip-filled");
  });
});

describe("DecisionStatusChip", () => {
  it("labels a recorded decision Recorded, outlined", () => {
    const { container } = render(
      <DecisionStatusChip adr={{ status: "signed", recorded_at: "2026-01-01T00:00:00Z" }} />,
    );
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(container.querySelector(".MuiChip-root")!.className).toContain("MuiChip-outlined");
  });

  it("labels a signed and an in-review decision by status", () => {
    render(<DecisionStatusChip adr={{ status: "signed", recorded_at: null }} />);
    expect(screen.getByText("Signed")).toBeInTheDocument();
    const { container } = render(<DecisionStatusChip adr={{ status: "in_review" }} />);
    expect(screen.getByText("In Review")).toBeInTheDocument();
    expect(container.querySelector(".MuiChip-root")!.className).toContain("MuiChip-colorWarning");
  });
});

describe("DecisionStateChip", () => {
  it("prefers the standing once there is one", () => {
    render(<DecisionStateChip adr={{ status: "signed", standing: "amended" }} />);
    expect(screen.getByText("In force (amended)")).toBeInTheDocument();
    expect(screen.queryByText("Signed")).not.toBeInTheDocument();
  });

  it("falls back to the status for a draft", () => {
    render(<DecisionStateChip adr={{ status: "draft", standing: null }} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });
});

describe("review outcome chips", () => {
  const outcome = (kind: "changes_requested" | "rejected" | "withdrawn") => ({
    kind,
    at: "2026-11-27T10:00:00Z",
    by: { id: "u1", display_name: "Ada" },
    note: "why",
  });

  it("shows the outcome instead of Draft", () => {
    const { container } = render(
      <DecisionStatusChip adr={{ status: "draft", outcome: outcome("rejected") }} />,
    );
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    const chip = container.querySelector(".MuiChip-root")!;
    expect(chip.className).toContain("MuiChip-colorError");
    expect(chip.className).toContain("MuiChip-filled");
  });

  it("outlines changes requested in the warning hue", () => {
    const { container } = render(
      <DecisionStateChip
        adr={{ status: "draft", standing: null, outcome: outcome("changes_requested") }}
      />,
    );
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    const chip = container.querySelector(".MuiChip-root")!;
    expect(chip.className).toContain("MuiChip-colorWarning");
    expect(chip.className).toContain("MuiChip-outlined");
  });

  it("labels a withdrawn decision Withdrawn, neutral", () => {
    const { container } = render(
      <DecisionStatusChip adr={{ status: "draft", outcome: outcome("withdrawn") }} />,
    );
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();
    expect(container.querySelector(".MuiChip-root")!.className).toContain("MuiChip-colorDefault");
  });

  it("ignores an outcome outside a draft", () => {
    render(<DecisionStatusChip adr={{ status: "in_review", outcome: outcome("rejected") }} />);
    expect(screen.getByText("In Review")).toBeInTheDocument();
  });
});
