import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
// jsdom has no canvas: the trend chart is the shared EChart double, and a
// test reads the option the panel built.
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

import i18n from "@/i18n";
import { api } from "@/api/client";
import { echartState } from "@/test/echartMock";
import { hookState } from "@/test/hooks";
import { BPM_ASSESSMENT_COLORS } from "@/theme/tokens";
import { DIMENSIONS } from "./bpmChartOptions";
import ProcessAssessmentPanel from "./ProcessAssessmentPanel";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const TREND = "Process Assessments";
/** The five dimension names, in series order, as the table header shows them. */
const ENGLISH_NAMES = ["Overall", "Efficiency", "Effectiveness", "Compliance", "Automation"];

const mockAssessments = [
  {
    id: "a1",
    assessment_date: "2025-06-15",
    assessor_name: "John Doe",
    overall_score: 4,
    efficiency: 3,
    effectiveness: 4,
    compliance: 5,
    automation: 2,
    notes: "Good progress",
  },
  {
    id: "a2",
    assessment_date: "2025-05-01",
    assessor_name: "Jane Smith",
    overall_score: 3,
    efficiency: 2,
    effectiveness: 3,
    compliance: 4,
    automation: 1,
    notes: "",
  },
];

function renderPanel() {
  return render(<ProcessAssessmentPanel processId="proc-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  echartState.reset();
  hookState.isRtl = false;
  vi.mocked(api.get).mockResolvedValue(mockAssessments);
});

describe("ProcessAssessmentPanel", () => {
  it("shows title", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Process Assessments")).toBeInTheDocument();
    });
  });

  it("shows New Assessment button", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("New Assessment")).toBeInTheDocument();
    });
  });

  it("fetches assessments on mount", async () => {
    renderPanel();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/bpm/processes/proc-1/assessments");
    });
  });

  it("shows assessment table with data", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("15 Jun 2025")).toBeInTheDocument();
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("Good progress")).toBeInTheDocument();
      expect(screen.getByText("01 May 2025")).toBeInTheDocument();
      expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    });
  });

  it("shows score chips with correct values", async () => {
    renderPanel();
    await waitFor(() => {
      // First assessment: scores 4, 3, 4, 5, 2
      // Second assessment: scores 3, 2, 3, 4, 1
      const chips4 = screen.getAllByText("4");
      const chips3 = screen.getAllByText("3");
      expect(chips4.length).toBeGreaterThanOrEqual(2);
      expect(chips3.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("renders trend chart when multiple assessments", async () => {
    renderPanel();
    const chart = await screen.findByRole("img", { name: TREND });
    expect(getComputedStyle(chart.parentElement!).height).toBe("260px");
  });

  it("does not render chart with single assessment", async () => {
    vi.mocked(api.get).mockResolvedValue([mockAssessments[0]]);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("15 Jun 2025")).toBeInTheDocument();
    });
    expect(screen.queryByRole("img", { name: TREND })).not.toBeInTheDocument();
    expect(echartState.props).toHaveLength(0);
  });

  it("plots the five dimensions oldest assessment first, in their colours", async () => {
    renderPanel();
    await screen.findByRole("img", { name: TREND });

    const option = echartState.byName(TREND).option;
    expect(option.xAxis.data).toEqual(["01 May 2025", "15 Jun 2025"]);
    expect(option.series.map((s: any) => s.name)).toEqual(ENGLISH_NAMES);
    expect(option.series.map((s: any) => s.lineStyle.color)).toEqual([
      BPM_ASSESSMENT_COLORS.overall_score,
      BPM_ASSESSMENT_COLORS.efficiency,
      BPM_ASSESSMENT_COLORS.effectiveness,
      BPM_ASSESSMENT_COLORS.compliance,
      BPM_ASSESSMENT_COLORS.automation,
    ]);
    expect(option.series.map((s: any) => s.data)).toEqual([
      [3, 4],
      [2, 3],
      [3, 4],
      [4, 5],
      [1, 2],
    ]);
    expect(option.series.every((s: any) => s.type === "line")).toBe(true);
  });

  it("scales the trend 1 to 5 with a key-only legend", async () => {
    renderPanel();
    await screen.findByRole("img", { name: TREND });

    const option = echartState.byName(TREND).option;
    expect(option.yAxis).toMatchObject({ type: "value", min: 1, max: 5, interval: 1, position: "left" });
    expect(option.legend.selectedMode).toBe(false);
    expect(option.legend.data).toEqual(ENGLISH_NAMES);
    expect(option.xAxis.inverse).toBe(false);
  });

  it("names the legend, the series and the sliders in the reader's language", async () => {
    await i18n.changeLanguage("de");
    try {
      const de = i18n.getFixedT("de", "bpm");
      const names = DIMENSIONS.map((d) => de(d.labelKey));
      // German really differs, so the English names cannot pass for it.
      expect(names).not.toEqual(ENGLISH_NAMES);

      renderPanel();
      const chart = await screen.findByRole("img", { name: de("assessment.title") });
      expect(chart).toBeInTheDocument();
      const option = echartState.byName(de("assessment.title")).option;
      expect(option.legend.data).toEqual(names);
      expect(option.series.map((s: any) => s.name)).toEqual(names);

      await userEvent.click(screen.getByText(de("assessment.newAssessment"), { selector: "button" }));
      const dialog = screen.getByRole("dialog");
      for (const name of names) expect(within(dialog).getByText(`${name}: 3`)).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("mirrors the trend in a right-to-left language", async () => {
    hookState.isRtl = true;
    renderPanel();
    await screen.findByRole("img", { name: TREND });

    const option = echartState.byName(TREND).option;
    expect(option.xAxis.inverse).toBe(true);
    expect(option.yAxis.position).toBe("right");
  });

  it("dates the trend and the table in the interface language", async () => {
    // Before the fix the month came from the browser locale, so an Arabic
    // interface read "15 Jun 2025" — reordered to "Jun 2025 15" right-to-left.
    await i18n.changeLanguage("ar");
    try {
      const ar = i18n.getFixedT("ar", "bpm");
      renderPanel();
      await screen.findByRole("img", { name: ar("assessment.title") });

      const option = echartState.byName(ar("assessment.title")).option;
      expect(option.xAxis.data).toEqual(["01 مايو 2025", "15 يونيو 2025"]);
      expect(screen.getByText("15 يونيو 2025")).toBeInTheDocument();
      expect(screen.getByText("01 مايو 2025")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("edges each dimension in the guide with its trend colour", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Assessment guide" }));

    const edge = (title: string) => getComputedStyle(screen.getByText(title, { selector: "p" }).parentElement!).borderLeft;
    const rgb = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return `3px solid rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    const guide = within(screen.getByRole("presentation"));
    expect(guide.getByText("Assessment Guide")).toBeInTheDocument();
    expect(edge("Efficiency")).toBe(rgb(BPM_ASSESSMENT_COLORS.efficiency));
    expect(edge("Effectiveness")).toBe(rgb(BPM_ASSESSMENT_COLORS.effectiveness));
    expect(edge("Compliance")).toBe(rgb(BPM_ASSESSMENT_COLORS.compliance));
    expect(edge("Automation")).toBe(rgb(BPM_ASSESSMENT_COLORS.automation));
    expect(edge("Overall")).toBe(rgb(BPM_ASSESSMENT_COLORS.overall_score));
    // Each dimension is explained under its title, with the guide's own copy.
    const en = i18n.getFixedT("en", "bpm");
    for (const dim of ["Efficiency", "Effectiveness", "Compliance", "Automation", "Overall"]) {
      const desc = en(`assessment.help${dim}Desc`);
      expect(desc).not.toMatch(/^assessment\./);
      expect(guide.getByText(desc)).toBeInTheDocument();
    }
  });

  it("renames the legend and series when the interface language changes while mounted", async () => {
    renderPanel();
    await screen.findByRole("img", { name: TREND });
    expect(echartState.byName(TREND).option.legend.data).toEqual(ENGLISH_NAMES);
    try {
      await act(async () => {
        await i18n.changeLanguage("de");
      });
      const de = i18n.getFixedT("de", "bpm");
      const names = DIMENSIONS.map((d) => de(d.labelKey));
      const option = echartState.byName(de("assessment.title")).option;
      expect(option.legend.data).toEqual(names);
      expect(option.series.map((s: any) => s.name)).toEqual(names);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("shows empty state when no assessments", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/No assessments yet/)).toBeInTheDocument();
    });
  });

  it("opens create dialog", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("New Assessment")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("New Assessment"));

    expect(screen.getByRole("heading", { name: "New Assessment" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("shows dimension sliders in create dialog", async () => {
    renderPanel();
    await userEvent.click(screen.getByText("New Assessment"));

    const dialog = screen.getByRole("dialog");
    for (const name of ENGLISH_NAMES) expect(within(dialog).getByText(`${name}: 3`)).toBeInTheDocument();
  });

  it("submits new assessment", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "new-a" });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("New Assessment")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("New Assessment"));

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByText("Save"));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/bpm/processes/proc-1/assessments",
        expect.objectContaining({
          overall_score: 3,
          efficiency: 3,
          effectiveness: 3,
          compliance: 3,
          automation: 3,
        }),
      );
    });
  });

  it("has table headers", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Date")).toBeInTheDocument();
      expect(screen.getByText("Assessor")).toBeInTheDocument();
      expect(screen.getByText("Overall")).toBeInTheDocument();
      expect(screen.getByText("Efficiency")).toBeInTheDocument();
      expect(screen.getByText("Effectiveness")).toBeInTheDocument();
      expect(screen.getByText("Compliance")).toBeInTheDocument();
      expect(screen.getByText("Automation")).toBeInTheDocument();
      expect(screen.getByText("Notes")).toBeInTheDocument();
    });
  });
});
