/**
 * Regression tests for EOL-report bugs fixed after the mutation pass: dates in
 * the workspace format, and no hardcoded English on the timeline or in the
 * countdowns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

const saved = vi.hoisted(() => ({ config: null as Record<string, unknown> | null }));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: () => {},
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: () => {},
    resetAll: () => {},
    reportType: "eol",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({ chartRef: createRef(), thumbnail: undefined, captureAndSave: () => {} }),
}));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { toIsoDate } from "@/lib/dates";
import EolReport from "./EolReport";

const TYPES = [
  makeCardType({ key: "ITComponent", label: "IT Component" }),
  makeCardType({ key: "Application", label: "Application" }),
];

const item = (over: Record<string, unknown> & { id: string; name: string }) => ({
  type: "ITComponent",
  eol_product: null,
  eol_cycle: null,
  status: "supported",
  source: "api",
  cycle_data: null,
  lifecycle: {},
  affected_apps: [],
  ...over,
});

const ITEMS = [
  item({
    id: "nginx",
    name: "Nginx LB",
    eol_product: "nginx",
    eol_cycle: "1.25",
    status: "eol",
    cycle_data: { releaseDate: "2018-01-01", eol: "2020-01-31", support: "2019-06-15", latest: "1.25.4" },
  }),
  item({
    id: "crm",
    name: "Legacy CRM",
    type: "Application",
    status: "eol",
    source: "manual",
    cycle_data: { eol: "2021-03-05" },
  }),
];

const SUMMARY = {
  eol: 2,
  approaching: 0,
  supported: 0,
  missing: 0,
  impacted_apps: 0,
  approaching_impacted_apps: 0,
  manual: 1,
};

function renderReport() {
  return render(
    <MemoryRouter>
      <EolReport />
    </MemoryRouter>,
  );
}

async function inLanguage(lng: string, fn: () => Promise<void>) {
  const previous = i18n.language;
  await act(async () => {
    await i18n.changeLanguage(lng);
  });
  try {
    await fn();
  } finally {
    await act(async () => {
      await i18n.changeLanguage(previous);
    });
  }
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  saved.config = null;
  mockApi.on("get", "/reports/eol", { items: ITEMS, summary: SUMMARY });
});

describe("EolReport dates", () => {
  it("shows the table's EOL and support dates in the workspace date format", async () => {
    hookState.dateFormat = "DD/MM/YYYY";
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    const nginx = screen.getByRole("row", { name: /^Nginx LB/ });
    expect(within(nginx).getByText("31/01/2020")).toBeInTheDocument();
    expect(within(nginx).getByText("15/06/2019")).toBeInTheDocument();
    const crm = screen.getByRole("row", { name: /^Legacy CRM/ });
    expect(within(crm).getByText("05/03/2021")).toBeInTheDocument();
  });

  it("dates the timeline's tooltips in the workspace date format", async () => {
    hookState.dateFormat = "YYYY-MM-DD";
    renderReport();
    await screen.findByText("Today");
    expect(screen.getByLabelText("Active support until 2019-06-15")).toBeInTheDocument();
    expect(screen.getByLabelText("End of Life: 2020-01-31")).toBeInTheDocument();
  });
});

describe("EolReport timeline wording", () => {
  it("names the bar tooltip's date as End of Life, in the UI language", async () => {
    hookState.dateFormat = "DD/MM/YYYY";
    await inLanguage("fr", async () => {
      renderReport();
      await screen.findByText("Aujourd’hui");
      expect(
        screen.getByLabelText(/^nginx 1\.25 · Fin de vie : 31\/01\/2020 \(.+\)$/),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/EOL: /)).not.toBeInTheDocument();
    });
  });

  it("labels a manual row's bar as the card's Lifecycle, in the UI language", async () => {
    await inLanguage("de", async () => {
      renderReport();
      await screen.findAllByText("Legacy CRM");
      expect(screen.getByText("Lebenszyklus")).toBeInTheDocument();
      expect(screen.queryByText("lifecycle")).not.toBeInTheDocument();
    });
  });

  it("labels a manual row's bar as the card's Lifecycle in English too", async () => {
    renderReport();
    await screen.findAllByText("Legacy CRM");
    expect(screen.getByText("Lifecycle")).toBeInTheDocument();
  });
});

describe("EolReport countdowns", () => {
  const inDays = (n: number) => toIsoDate(new Date(Date.now() + n * 86400000));
  /** One row per name, its end of life the given number of days away. */
  const serveCountdowns = (days: Record<string, number>) =>
    mockApi.on("get", "/reports/eol", {
      items: Object.entries(days).map(([name, n]) =>
        item({ id: name, name, eol_product: "p", eol_cycle: name, cycle_data: { eol: inDays(n) } }),
      ),
      summary: SUMMARY,
    });
  /** The countdown after a row's EOL date, e.g. "(2 months)". */
  const countdown = (name: string) =>
    within(screen.getByRole("row", { name: new RegExp(`^${name}`) })).getByText(/^\(.+\)$/).textContent;

  it("words every unit as a counted English phrase", async () => {
    saved.config = { view: "table" };
    serveCountdowns({ Gone: -40, Today: 0, Tomorrow: 1, Week: 7, Month: 30, Quarter: 90, Year: 365, Later: 800 });
    renderReport();
    await screen.findByRole("table");
    expect(countdown("Gone")).toBe("(40 days ago)");
    expect(countdown("Today")).toBe("(0 days ago)");
    expect(countdown("Tomorrow")).toBe("(1 day)");
    expect(countdown("Week")).toBe("(7 days)");
    expect(countdown("Month")).toBe("(1 month)");
    expect(countdown("Quarter")).toBe("(3 months)");
    expect(countdown("Year")).toBe("(1 year)");
    expect(countdown("Later")).toBe("(2.2 years)");
  });

  it("words the countdown in the UI language", async () => {
    saved.config = { view: "table" };
    serveCountdowns({ Gone: -40, Tomorrow: 1, Quarter: 90, Later: 800 });
    await inLanguage("de", async () => {
      renderReport();
      await screen.findByRole("table");
      expect(countdown("Gone")).toBe("(vor 40 Tagen)");
      expect(countdown("Tomorrow")).toBe("(1 Tag)");
      expect(countdown("Quarter")).toBe("(3 Monate)");
      expect(countdown("Later")).toBe("(2.2 Jahre)");
    });
  });

  it("uses the language's own plural forms beyond one and other", async () => {
    saved.config = { view: "table" };
    serveCountdowns({ Three: 3, Five: 5, TwentyOne: 21 });
    await inLanguage("ru", async () => {
      renderReport();
      await screen.findByRole("table");
      expect(countdown("Three")).toBe("(3 дня)");
      expect(countdown("Five")).toBe("(5 дней)");
      expect(countdown("TwentyOne")).toBe("(21 день)");
    });
  });

  it("uses Arabic's dual and its many form", async () => {
    saved.config = { view: "table" };
    serveCountdowns({ Two: 2, Eleven: 11 });
    await inLanguage("ar", async () => {
      renderReport();
      await screen.findByRole("table");
      expect(countdown("Two")).toBe("(2 يومان)");
      expect(countdown("Eleven")).toBe("(11 يومًا)");
    });
  });

  it("names it on the timeline's bar tooltip as well", async () => {
    serveCountdowns({ Quarter: 90 });
    await inLanguage("fr", async () => {
      renderReport();
      await screen.findByText("Aujourd’hui");
      expect(screen.getByLabelText(/^p Quarter · Fin de vie : .+ \(3 mois\)$/)).toBeInTheDocument();
    });
  });
});
