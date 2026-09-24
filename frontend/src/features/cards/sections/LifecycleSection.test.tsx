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
