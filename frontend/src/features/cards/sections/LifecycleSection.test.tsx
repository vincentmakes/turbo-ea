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

describe("LifecycleSection — footer", () => {
  const card = cardWith({ active: "2025-01-01" });

  it("renders the footer at the end of the open section", () => {
    const { container } = render(
      <LifecycleSection
        card={card}
        onSave={async () => {}}
        footer={<div data-testid="footer">relations</div>}
      />,
    );
    const footer = screen.getByTestId("footer");
    const details = container.querySelector(".MuiAccordionDetails-root")!;
    expect(details.lastElementChild).toBe(footer);
  });

  it("does not mount the footer while the section is collapsed, and mounts it on open", () => {
    render(
      <LifecycleSection
        card={card}
        onSave={async () => {}}
        initialExpanded={false}
        footer={<div data-testid="footer">relations</div>}
      />,
    );
    expect(screen.queryByTestId("footer")).toBeNull();
    fireEvent.click(screen.getByText("Lifecycle"));
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Lifecycle"));
    expect(screen.queryByTestId("footer")).toBeNull();
  });

  it("renders the same section without a footer", () => {
    const { container: withNone } = render(
      <LifecycleSection card={card} onSave={async () => {}} />,
    );
    const { container: withNull } = render(
      <LifecycleSection card={card} onSave={async () => {}} footer={null} />,
    );
    expect(withNone.innerHTML).toBe(withNull.innerHTML);
    expect(withNone.querySelector(".MuiAccordionDetails-root")!.children).toHaveLength(1);
  });
});

describe("LifecycleSection — phases an extension maintains", () => {
  const stored = {
    plan: "2020-01-01",
    active: "2022-01-01",
    phaseOut: "2029-01-01",
    endOfLife: "2030-01-01",
  };
  const maintained = { phases: ["active", "endOfLife"], name: "Acme Sync" };
  const chipLabel = () => i18n.t("cards:lifecycle.maintained.chip");
  const tooltip = () => i18n.t("cards:lifecycle.maintained.tooltip", { name: "Acme Sync" });
  const editButton = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.dataset.testid !== "help-tip")
      .at(-1)!;

  it("without the prop shows no chip, keeps every field editable and saves the draft as is", async () => {
    const onSave = vi.fn(async () => {});
    const { container } = render(<LifecycleSection card={cardWith(stored)} onSave={onSave} />);
    expect(screen.queryByTestId("lifecycle-maintained-chip")).toBeNull();
    fireEvent.click(editButton());
    for (const phase of ["plan", "phaseIn", "active", "phaseOut", "endOfLife"]) {
      expect(container.querySelector(`[data-phase="${phase}"] input`)).not.toBeDisabled();
    }
    expect(container.querySelector('[data-phase="phaseIn"] input')).not.toHaveAttribute("min");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.save") }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ lifecycle: stored }));
  });

  it("puts one chip under each maintained phase on the timeline, naming the extension", async () => {
    render(
      <LifecycleSection card={cardWith(stored)} onSave={async () => {}} maintained={maintained} />,
    );
    const chips = screen.getAllByTestId("lifecycle-maintained-chip");
    expect(chips.map((c) => c.dataset.maintainedPhase)).toEqual(["active", "endOfLife"]);
    expect(chips[0]).toHaveTextContent(chipLabel());
    fireEvent.mouseOver(chips[0]);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(tooltip());
    expect(tooltip()).toContain("Acme Sync");
  });

  it("ignores a phase key it does not know", () => {
    render(
      <LifecycleSection
        card={cardWith(stored)}
        onSave={async () => {}}
        maintained={{ phases: ["retired", "plan"], name: "Acme Sync" }}
      />,
    );
    expect(
      screen.getAllByTestId("lifecycle-maintained-chip").map((c) => c.dataset.maintainedPhase),
    ).toEqual(["plan"]);
  });

  it("disables the maintained fields while editing and bounds the manual ones between them", () => {
    const { container } = render(
      <LifecycleSection card={cardWith(stored)} onSave={async () => {}} maintained={maintained} />,
    );
    fireEvent.click(editButton());
    const input = (phase: string) =>
      container.querySelector(`[data-phase="${phase}"] input`) as HTMLInputElement;
    expect(input("active")).toBeDisabled();
    expect(input("endOfLife")).toBeDisabled();
    expect(input("plan")).not.toBeDisabled();
    expect(input("phaseOut")).not.toBeDisabled();
    // Plan sits before Active: bounded above only.
    expect(input("plan")).toHaveAttribute("max", "2022-01-01");
    expect(input("plan")).not.toHaveAttribute("min");
    // Phase Out sits between Active and End of Life.
    expect(input("phaseOut")).toHaveAttribute("min", "2022-01-01");
    expect(input("phaseOut")).toHaveAttribute("max", "2030-01-01");
    const hint = i18n.t("cards:lifecycle.maintained.boundHint");
    const phaseOutBox = container.querySelector('[data-phase="phaseOut"]') as HTMLElement;
    expect(within(phaseOutBox).getByText(hint)).toBeInTheDocument();
    // A maintained phase carries the chip in the edit row too, and no hint.
    const activeBox = container.querySelector('[data-phase="active"]') as HTMLElement;
    expect(within(activeBox).getByTestId("lifecycle-maintained-chip")).toBeInTheDocument();
    expect(within(activeBox).queryByText(hint)).toBeNull();
  });

  it("sends a manual phase change and leaves the maintained phases out of the save", async () => {
    const onSave = vi.fn(async () => {});
    const card = cardWith(stored);
    const { container, rerender } = render(
      <LifecycleSection card={card} onSave={onSave} maintained={maintained} />,
    );
    fireEvent.click(editButton());
    const phaseOut = container.querySelector('[data-phase="phaseOut"] input') as HTMLInputElement;
    fireEvent.focus(phaseOut);
    fireEvent.change(phaseOut, { target: { value: "2028-06-01" } });
    fireEvent.blur(phaseOut);
    // The stored card moved under the open editor (the extension re-derived
    // End of Life): the save carries no maintained phase at all, so neither the
    // loaded nor the re-rendered copy can read as a change on the server.
    rerender(
      <LifecycleSection
        card={cardWith({ ...stored, endOfLife: "2031-01-01" })}
        onSave={onSave}
        maintained={maintained}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.save") }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        lifecycle: { plan: "2020-01-01", phaseOut: "2028-06-01" },
      }),
    );
  });

  it("a jump focuses the first undated phase that is still set by hand", () => {
    const { container } = render(
      <LifecycleSection
        card={cardWith({ active: "2022-01-01" })}
        onSave={async () => {}}
        maintained={{ phases: ["plan"], name: "Acme Sync" }}
        editOn={{ anchor: "card-section-lifecycle", nonce: 1 }}
      />,
    );
    expect(document.activeElement).toBe(container.querySelector('[data-phase="phaseIn"] input'));
  });

  it("hides the edit button and says why when every phase is maintained", () => {
    render(
      <LifecycleSection
        card={cardWith(stored)}
        onSave={async () => {}}
        maintained={{
          phases: ["plan", "phaseIn", "active", "phaseOut", "endOfLife"],
          name: "Acme Sync",
        }}
        editOn={{ anchor: "card-section-lifecycle", nonce: 1 }}
      />,
    );
    expect(screen.queryByRole("button", { name: i18n.t("common:actions.save") })).toBeNull();
    const summary = document.querySelector(".MuiAccordionSummary-root")!;
    expect(summary.querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByTestId("lifecycle-all-maintained")).toHaveTextContent(
      i18n.t("cards:lifecycle.maintained.allLocked", { name: "Acme Sync" }),
    );
  });

  it("keeps the edit button while one phase is still manual", () => {
    render(
      <LifecycleSection
        card={cardWith(stored)}
        onSave={async () => {}}
        maintained={{ phases: ["plan", "phaseIn", "active", "phaseOut"], name: "Acme Sync" }}
      />,
    );
    const summary = document.querySelector(".MuiAccordionSummary-root")!;
    expect(summary.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByTestId("lifecycle-all-maintained")).toBeNull();
  });

  it("shows the server's refusal and stays in edit mode", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("The End of Life date is maintained by Acme Sync.");
    });
    render(<LifecycleSection card={cardWith(stored)} onSave={onSave} maintained={maintained} />);
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.save") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The End of Life date is maintained by Acme Sync.",
    );
    expect(screen.getByRole("button", { name: i18n.t("common:actions.save") })).toBeInTheDocument();
    // Cancel clears it.
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.cancel") }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the extension on the edit row's chip too", async () => {
    const { container } = render(
      <LifecycleSection card={cardWith(stored)} onSave={async () => {}} maintained={maintained} />,
    );
    fireEvent.click(editButton());
    const activeBox = container.querySelector('[data-phase="active"]') as HTMLElement;
    fireEvent.mouseOver(within(activeBox).getByTestId("lifecycle-maintained-chip"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(tooltip());
  });

  it("locks the phases of a claim that arrives after the first render", () => {
    const { rerender } = render(
      <LifecycleSection card={cardWith(stored)} onSave={async () => {}} />,
    );
    const summary = () => document.querySelector(".MuiAccordionSummary-root")!;
    expect(summary().querySelectorAll("button")).toHaveLength(1);
    rerender(
      <LifecycleSection
        card={cardWith(stored)}
        onSave={async () => {}}
        maintained={{
          phases: ["plan", "phaseIn", "active", "phaseOut", "endOfLife"],
          name: "Acme Sync",
        }}
      />,
    );
    expect(summary().querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByTestId("lifecycle-all-maintained")).toBeInTheDocument();
  });

  it("closes the edit row after a successful save", async () => {
    const onSave = vi.fn(async () => {});
    render(<LifecycleSection card={cardWith(stored)} onSave={onSave} maintained={maintained} />);
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.save") }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: i18n.t("common:actions.save") })).toBeNull(),
    );
    expect(onSave).toHaveBeenCalledWith({
      lifecycle: { plan: "2020-01-01", phaseOut: "2029-01-01" },
    });
  });

  it("clears a refusal when the next save starts", async () => {
    let attempt = 0;
    let release: () => void = () => {};
    const onSave = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("Refused once."));
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    render(<LifecycleSection card={cardWith(stored)} onSave={onSave} maintained={maintained} />);
    const save = () => screen.getByRole("button", { name: i18n.t("common:actions.save") });
    fireEvent.click(editButton());
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Refused once.");

    // A second save is in flight: the earlier refusal no longer stands.
    fireEvent.click(save());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    release();
    await waitFor(() => expect(screen.queryByRole("button", { name: i18n.t("common:actions.save") })).toBeNull());
  });

  it("dismisses a refusal from its close button, and Cancel leaves none for the next edit", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Refused.");
    });
    render(<LifecycleSection card={cardWith(stored)} onSave={onSave} maintained={maintained} />);
    const save = () => screen.getByRole("button", { name: i18n.t("common:actions.save") });
    fireEvent.click(editButton());
    fireEvent.click(save());
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Refused.");
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.cancel") }));
    fireEvent.click(editButton());
    expect(screen.getByRole("button", { name: i18n.t("common:actions.save") })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("words a lifecycle_maintained refusal in the UI language, not the server's English", async () => {
    const onSave = vi.fn(async () => {
      throw Object.assign(new Error("English server sentence"), {
        detail: {
          error: "lifecycle_maintained",
          message: "English server sentence",
          phases: ["active", "endOfLife"],
          extension: "Acme Sync",
        },
      });
    });
    render(<LifecycleSection card={cardWith(stored)} onSave={onSave} maintained={maintained} />);
    fireEvent.click(editButton());
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common:actions.save") }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      i18n.t("cards:lifecycle.maintained.refused", {
        name: "Acme Sync",
        phases: `${i18n.t("common:lifecycle.active")}, ${i18n.t("common:lifecycle.endOfLife")}`,
      }),
    );
    expect(alert).not.toHaveTextContent("English server sentence");
  });
});
