import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (v: string) => `d:${v}` }),
}));

import i18n from "@/i18n";
import type { Card } from "@/types";
import LifecycleSection from "./LifecycleSection";

const cardWith = (lifecycle: Record<string, string>) =>
  ({ id: "card-1", type: "Application", name: "App", lifecycle }) as unknown as Card;

const warningText = (phase: string, date: string) =>
  i18n.t("cards:lifecycle.orderWarning", {
    phase: i18n.t(`common:lifecycle.${phase}`),
    date: `d:${date}`,
  });

const outOfOrder = { active: "2025-01-01", phaseOut: "2031-06-01", endOfLife: "2031-01-01" };

describe("LifecycleSection — phase order warning", () => {
  it("marks a phase dated after a later phase on the timeline", () => {
    render(<LifecycleSection card={cardWith(outOfOrder)} onSave={async () => {}} />);
    expect(
      screen.getByRole("img", { name: warningText("endOfLife", "2031-01-01") }),
    ).toBeInTheDocument();
  });

  it("shows nothing for an in-order lifecycle", () => {
    render(
      <LifecycleSection
        card={cardWith({ phaseOut: "2030-01-01", endOfLife: "2031-01-01" })}
        onSave={async () => {}}
      />,
    );
    expect(screen.queryByRole("img", { name: /d:/ })).toBeNull();
  });

  it("warns under the field while editing, and still saves", async () => {
    const onSave = vi.fn(async () => {});
    render(<LifecycleSection card={cardWith(outOfOrder)} onSave={onSave} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);

    const helper = screen
      .getAllByText(warningText("endOfLife", "2031-01-01"))
      .find((el) => el.classList.contains("MuiFormHelperText-root"));
    expect(helper).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.save") }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ lifecycle: outOfOrder }));
  });
});

describe("LifecycleSection — data-quality jump", () => {
  it("carries its jump anchor and opens on a jump request", () => {
    const { container, rerender } = render(
      <LifecycleSection card={cardWith({})} onSave={async () => {}} initialExpanded={false} />,
    );
    const root = container.querySelector(".MuiAccordion-root")!;
    const summary = container.querySelector(".MuiAccordionSummary-root")!;
    expect(root.id).toBe("card-section-lifecycle");
    expect(summary.getAttribute("aria-expanded")).toBe("false");

    rerender(
      <LifecycleSection
        card={cardWith({})}
        onSave={async () => {}}
        initialExpanded={false}
        expandOn={1}
      />,
    );
    expect(summary.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("LifecycleSection — a jump opens it in edit mode", () => {
  const request = (nonce = 1) => ({ anchor: "card-section-lifecycle", nonce });
  const save = () => screen.queryByRole("button", { name: i18n.t("common:actions.save") });

  it("enters edit mode on a jump, focused on the first phase without a date", () => {
    const { container, rerender } = render(
      <LifecycleSection card={cardWith({ plan: "2024-01-01" })} onSave={async () => {}} />,
    );
    expect(save()).not.toBeInTheDocument();
    rerender(
      <LifecycleSection
        card={cardWith({ plan: "2024-01-01" })}
        onSave={async () => {}}
        editOn={request()}
      />,
    );
    expect(save()).toBeInTheDocument();
    const phaseIn = container.querySelector('[data-phase="phaseIn"] input');
    expect(phaseIn).not.toBeNull();
    expect(document.activeElement).toBe(phaseIn);
  });

  it("focuses nothing when every phase has a date", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const full = {
      plan: "2020-01-01",
      phaseIn: "2021-01-01",
      active: "2022-01-01",
      phaseOut: "2030-01-01",
      endOfLife: "2031-01-01",
    };
    render(<LifecycleSection card={cardWith(full)} onSave={async () => {}} editOn={request()} />);
    expect(save()).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("stays read-only on a jump without edit rights", () => {
    render(
      <LifecycleSection card={cardWith({})} onSave={async () => {}} canEdit={false} editOn={request()} />,
    );
    expect(save()).not.toBeInTheDocument();
  });

  it("acts once per jump: after Cancel the same jump does not reopen it", () => {
    const jump = request();
    const { rerender } = render(
      <LifecycleSection card={cardWith({})} onSave={async () => {}} editOn={jump} />,
    );
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.cancel") }));
    rerender(<LifecycleSection card={cardWith({})} onSave={async () => {}} editOn={jump} />);
    expect(save()).not.toBeInTheDocument();
  });
});
