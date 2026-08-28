/**
 * The authenticated PPM portfolio board.
 *
 * A thin container over `PpmPortfolioView`: it loads the data, decides what a
 * row click does, and supplies the `ReportShell` chrome that gives the page its
 * print and PPTX/XLSX export. The account-less twin served by a published web
 * portal is `features/web-portals/PortalPpmPortfolio.tsx`; both render the same
 * view, so the two boards cannot drift.
 *
 * `ReportShell` is imported here rather than in the view on purpose — it pulls
 * the xlsx/pptx export engine behind it, which must not reach the public portal
 * bundle.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useMetamodel } from "@/hooks/useMetamodel";
import ReportShell from "@/features/reports/ReportShell";
import PpmPortfolioView from "./PpmPortfolioView";
import type { PpmPortfolioShellParts } from "./PpmPortfolioView";
import type {
  PpmGanttItem,
  PpmGroupOption,
  PpmDashboardData,
  PpmPortfolioItem,
  PpmPortfolioGroupOption,
} from "@/types";

export default function PpmPortfolio() {
  const { t } = useTranslation("ppm");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Read the type array directly rather than through `getType`: the subtype
  // definitions live on the card type, and this is the same lookup
  // `useCardSubtypeLabel` does — which is what the board used before the split.
  const { types } = useMetamodel();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PpmGanttItem[]>([]);
  const [dashboard, setDashboard] = useState<PpmDashboardData | null>(null);
  const [groupOptions, setGroupOptions] = useState<PpmGroupOption[]>([]);
  // The view owns the control; this mirrors it so the fetch can key off it.
  const [groupBy, setGroupBy] = useState(searchParams.get("groupBy") || "Organization");

  useEffect(() => {
    api.get<PpmGroupOption[]>("/reports/ppm/group-options").then(setGroupOptions);
  }, []);

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      setLoading(true);
      try {
        const [g, d] = await Promise.all([
          api.get<PpmGanttItem[]>(`/reports/ppm/gantt?group_by=${groupBy}`, { signal }),
          api.get<PpmDashboardData>("/reports/ppm/dashboard", { signal }),
        ]);
        if (!isCurrent()) return;
        setItems(g);
        setDashboard(d);
      } finally {
        // Only the winner owns the spinner — changing grouping twice quickly
        // used to let the first response settle the UI (#882).
        if (isCurrent()) setLoading(false);
      }
    },
    [groupBy],
  );

  // Prefer the live metamodel entity over the payload's own label so an admin's
  // rename shows up without a refetch; the payload is the fallback.
  const options: PpmPortfolioGroupOption[] = groupOptions.map((opt) => {
    const ct = types.find((tp) => tp.key === opt.type_key);
    return {
      type_key: opt.type_key,
      label: ct?.label || opt.type_label,
      translations: ct?.translations ?? opt.translations,
    };
  });

  const subtypeDefs = types.find((tp) => tp.key === "Initiative")?.subtypes ?? [];

  const handleOpen = useCallback(
    (item: PpmPortfolioItem, target?: "detail" | "reports") => {
      navigate(target === "reports" ? `/ppm/${item.id}?tab=reports` : `/ppm/${item.id}`);
    },
    [navigate],
  );

  const shell = useCallback(
    ({ content, toolbar, printParams, buildExportData, chartRef }: PpmPortfolioShellParts) => (
      <ReportShell
        title={t("title")}
        icon="view_timeline"
        hasTableToggle={false}
        maxWidth={1800}
        chartRef={chartRef}
        printParams={printParams}
        buildExportData={buildExportData}
        paginateRowSelector="[data-export-row]"
        disableSavedReportsLink
        toolbar={toolbar}
      >
        {content}
      </ReportShell>
    ),
    [t],
  );

  return (
    <PpmPortfolioView
      items={items}
      dashboard={dashboard}
      groupOptions={options}
      subtypeDefs={subtypeDefs}
      loading={loading}
      onGroupByChange={setGroupBy}
      onOpen={handleOpen}
      shell={shell}
    />
  );
}
