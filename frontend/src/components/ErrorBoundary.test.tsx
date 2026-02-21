import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

// Suppress console.error from ErrorBoundary's componentDidCatch and React's
// own error boundary logging during tests.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Helper: a component that throws on demand
// ---------------------------------------------------------------------------

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test render error");
  return <div>Child content</div>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ErrorBoundary", () => {
  it("renders children normally when no error", () => {
    render(
      <ErrorBoundary>
        <div>Hello world</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("catches errors and shows fallback UI", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test render error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows label in fallback when provided", () => {
    render(
      <ErrorBoundary label="Description Section">
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(
      screen.getByText('Something went wrong in "Description Section"')
    ).toBeInTheDocument();
  });

  it("shows inline fallback with inline prop", () => {
    render(
      <ErrorBoundary inline>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText("Failed to render")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // Should NOT show the full "Something went wrong" block
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("shows inline fallback with label", () => {
    render(
      <ErrorBoundary inline label="Cost Field">
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText("Failed to render Cost Field")).toBeInTheDocument();
  });

  it("retry button resets error state and re-renders children", () => {
    // We need a component whose throw behavior can change between renders.
    // Use a ref-like approach: first render throws, retry should not throw.
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error("Boom");
      return <div>Recovered content</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>
    );

    // Should show error fallback
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Fix the condition so next render succeeds
    shouldThrow = false;

    // Click retry
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    // Should now show the recovered content
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("retry button on inline fallback also resets error state", () => {
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error("Inline boom");
      return <div>Inline recovered</div>;
    }

    render(
      <ErrorBoundary inline>
        <ConditionalThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText("Failed to render")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(screen.getByText("Inline recovered")).toBeInTheDocument();
    expect(screen.queryByText("Failed to render")).not.toBeInTheDocument();
  });
});
