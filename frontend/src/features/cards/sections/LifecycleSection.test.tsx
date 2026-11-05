import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));
const phaseHelpMock = vi.hoisted(() => ({ help: {} as Record<string, string> }));
vi.mock("@/hooks/useLifecyclePhaseHelp", () => ({
  useLifecyclePhaseHelp: () => ({
    help: {},
    phaseHelp: (phase: string) => phaseHelpMock.help[phase] ?? "",
  }),
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (v: string) => `d:${v}` }),
}));

import i18n from "@/i18n";
import type { Card } from "@/types";
import { LIFECYCLE_PHASE_COLORS } from "@/theme/tokens";
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

describe("LifecycleSection — the header is not a button inside a button", () => {
  it("renders its summary as a div[role=button] around the edit button", () => {
    const { container } = render(<LifecycleSection card={cardWith({})} onSave={async () => {}} />);
    const summary = container.querySelector(".MuiAccordionSummary-root")!;
    expect(summary.tagName).toBe("DIV");
    expect(summary).toHaveAttribute("role", "button");
    expect(summary.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelectorAll("button button")).toHaveLength(0);

    expect(summary).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });
});

describe("LifecycleSection — progress fill", () => {
  it("walks the fill's gradient through every reached phase colour", () => {
    const { container } = render(
      <LifecycleSection card={cardWith({ plan: "2020-01-01", phaseIn: "2021-01-01" })} onSave={async () => {}} />,
    );
    // jsdom drops a gradient from computed style, so read the Emotion rule of
    // each rendered element's own class instead.
    const css = [...document.querySelectorAll("style")].map((el) => el.textContent).join("\n");
    const ruleOf = (el: Element) =>
      [...el.classList].map((c) => css.match(new RegExp(`\\.${c}\\{([^}]*)\\}`))?.[1] ?? "").join(";");
    const gradient = `linear-gradient(90deg, ${LIFECYCLE_PHASE_COLORS.plan} 0.00%, ${LIFECYCLE_PHASE_COLORS.phaseIn} 100.00%)`;
    expect([...container.querySelectorAll("div")].some((el) => ruleOf(el).includes(gradient))).toBe(true);
  });
});

describe("LifecycleSection — phase help", () => {
  afterEach(() => {
    phaseHelpMock.help = {};
  });

  it("puts an info icon beside a phase with help, and none otherwise", () => {
    phaseHelpMock.help = { phaseOut: "Being replaced; no new users." };
    render(<LifecycleSection card={cardWith({})} onSave={async () => {}} />);
    expect(
      screen.getByRole("button", { name: "Being replaced; no new users." }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("help-tip")).toHaveLength(1);
  });

  it("shows no icon when no phase has help", () => {
    render(<LifecycleSection card={cardWith({})} onSave={async () => {}} />);
    expect(screen.queryByTestId("help-tip")).toBeNull();
  });

  it("keeps the timeline's icon while editing and adds none to the date row", () => {
    phaseHelpMock.help = { plan: "An idea not yet approved." };
    const { container } = render(
      <LifecycleSection card={cardWith({})} onSave={async () => {}} />,
    );
    // The timeline's help icons are buttons too; the edit button is the last other one.
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => b.dataset.testid !== "help-tip");
    fireEvent.click(buttons[buttons.length - 1]);

    const planField = container.querySelector('[data-phase="plan"]') as HTMLElement;
    expect(planField).not.toBeNull();
    expect(within(planField).queryByTestId("help-tip")).toBeNull();
    expect(within(planField).queryByText("An idea not yet approved.")).toBeNull();
    // One icon per phase with help in all: the timeline's, still on screen.
    const icons = screen.getAllByTestId("help-tip");
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAccessibleName("An idea not yet approved.");
  });
});
