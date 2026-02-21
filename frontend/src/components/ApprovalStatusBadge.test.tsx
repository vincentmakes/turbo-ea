import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ApprovalStatusBadge from "./ApprovalStatusBadge";

describe("ApprovalStatusBadge", () => {
  it("renders Draft badge", () => {
    render(<ApprovalStatusBadge status="DRAFT" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders Approved badge", () => {
    render(<ApprovalStatusBadge status="APPROVED" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("renders Broken badge", () => {
    render(<ApprovalStatusBadge status="BROKEN" />);
    expect(screen.getByText("Broken")).toBeInTheDocument();
  });

  it("renders Rejected badge", () => {
    render(<ApprovalStatusBadge status="REJECTED" />);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("renders nothing for unknown status", () => {
    const { container } = render(
      <ApprovalStatusBadge status="UNKNOWN" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders correct icon text for Approved", () => {
    render(<ApprovalStatusBadge status="APPROVED" />);
    // MaterialSymbol renders the icon name as text content
    expect(screen.getByText("verified")).toBeInTheDocument();
  });

  it("renders correct icon text for Rejected", () => {
    render(<ApprovalStatusBadge status="REJECTED" />);
    expect(screen.getByText("cancel")).toBeInTheDocument();
  });
});
