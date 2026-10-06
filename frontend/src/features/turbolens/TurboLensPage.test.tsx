/**
 * TurboLens shell: which tab a `?tab=` URL opens, how a tab click writes the
 * URL back, how an outside navigation (the Assessments tab's "Resume") moves
 * the tab, and the section label it publishes for the browser tab title.
 *
 * Every tab body is stubbed — each has its own test — so this only asserts
 * which one the shell mounts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { useLocation, useNavigate } from "react-router";

vi.mock("@/features/turbolens/TurboLensDashboard", () => ({ default: () => <div>dashboard body</div> }));
vi.mock("@/features/turbolens/TurboLensVendors", () => ({ default: () => <div>vendors body</div> }));
vi.mock("@/features/turbolens/TurboLensResolution", () => ({ default: () => <div>resolution body</div> }));
vi.mock("@/features/turbolens/TurboLensDuplicates", () => ({ default: () => <div>duplicates body</div> }));
vi.mock("@/features/turbolens/TurboLensArchitect", () => ({ default: () => <div>architect body</div> }));
vi.mock("@/features/turbolens/TurboLensAssessments", () => ({ default: () => <div>assessments body</div> }));
vi.mock("@/features/turbolens/TurboLensHistory", () => ({ default: () => <div>history body</div> }));

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import TurboLensPage from "./TurboLensPage";

const TABS = [
  ["Dashboard", "dashboard"],
  ["Vendors", "vendors"],
  ["Resolution", "resolution"],
  ["Duplicates", "duplicates"],
  ["Architect", "architect"],
  ["Assessments", "assessments"],
  ["History", "history"],
] as const;

function Probe() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { section } = usePageTitleSlots();
  return (
    <>
      <output data-testid="location">{`${pathname}${search}`}</output>
      <output data-testid="section">{section?.text ?? ""}</output>
      <button type="button" onClick={() => navigate("/turbolens?tab=history")}>
        go history
      </button>
      <button type="button" onClick={() => navigate("/turbolens")}>
        go home
      </button>
    </>
  );
}

function renderPage(route = "/turbolens") {
  return renderWithProviders(
    <>
      <Probe />
      <TurboLensPage />
    </>,
    { route },
  );
}

/** Exactly one tab body is mounted: the selected tab's. */
function expectOnlyBody(key: string) {
  for (const [, other] of TABS) {
    if (other === key) expect(screen.getByText(`${other} body`)).toBeInTheDocument();
    else expect(screen.queryByText(`${other} body`)).not.toBeInTheDocument();
  }
}

/** A tab's accessible name carries its icon glyph, so match on the label's end. */
function tab(label: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(`${label}$`) });
}

beforeEach(() => {
  resetPageTitle();
});

describe("TurboLensPage", () => {
  it("opens on the dashboard with all seven tabs", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "TurboLens" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(TABS.length);
    for (const [label] of TABS) expect(tab(label)).toBeInTheDocument();
    expect(tab("Dashboard")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("dashboard body")).toBeInTheDocument();
    expectOnlyBody("dashboard");
    expect(screen.getByTestId("section")).toHaveTextContent("Dashboard");
  });

  it.each(TABS.filter(([, key]) => key !== "dashboard"))(
    "opens the %s tab from ?tab=%s",
    async (label, key) => {
      renderPage(`/turbolens?tab=${key}`);

      expect(await screen.findByText(`${key} body`)).toBeInTheDocument();
      expect(tab(label)).toHaveAttribute("aria-selected", "true");
      expectOnlyBody(key);
      expect(screen.getByTestId("section")).toHaveTextContent(label);
    },
  );

  it("falls back to the dashboard for an unknown ?tab=", async () => {
    renderPage("/turbolens?tab=security");

    expect(await screen.findByText("dashboard body")).toBeInTheDocument();
    expect(tab("Dashboard")).toHaveAttribute("aria-selected", "true");
  });

  it("writes the selected tab to the URL, and clears it for the dashboard", async () => {
    const { user } = renderPage();
    await screen.findByText("dashboard body");

    await user.click(tab("Vendors"));
    expect(await screen.findByText("vendors body")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/turbolens?tab=vendors");
    expect(screen.getByTestId("section")).toHaveTextContent("Vendors");

    await user.click(tab("Duplicates"));
    expect(await screen.findByText("duplicates body")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/turbolens?tab=duplicates");

    await user.click(tab("Dashboard"));
    expect(await screen.findByText("dashboard body")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("/turbolens");
  });

  it("follows a navigation that changes ?tab= from outside the tab bar", async () => {
    const { user } = renderPage("/turbolens?tab=assessments");
    await screen.findByText("assessments body");

    await user.click(screen.getByRole("button", { name: "go history" }));
    expect(await screen.findByText("history body")).toBeInTheDocument();
    expect(tab("History")).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "go home" }));
    await waitFor(() => expect(tab("Dashboard")).toHaveAttribute("aria-selected", "true"));
    expect(await screen.findByText("dashboard body")).toBeInTheDocument();
  });

  it("relabels the tabs and the section when the language changes", async () => {
    renderPage("/turbolens?tab=vendors");
    await screen.findByText("vendors body");
    expect(tab("Vendors")).toBeInTheDocument();

    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      await waitFor(() => expect(tab("Anbieter")).toHaveAttribute("aria-selected", "true"));
      expect(tab("Verlauf")).toBeInTheDocument();
      expect(screen.getByTestId("section")).toHaveTextContent("Anbieter");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});
