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
 * bundle. So is the Filters section (`CardFilterSection`, `ppmBoardFilters`),
 * which the portal board does not offer: the view only takes the section as a
 * node, the ids it keeps, its print lines and its `?filters=` value.
 *
 * The section starts folded and its payload (`/reports/ppm/filter-data`) is
 * fetched the first time it is opened — or at once, when the URL already
 * carries a selection — so the default page load costs no extra request.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import CardFilterSection from "@/features/reports/CardFilterSection";
import ReportShell from "@/features/reports/ReportShell";
import type { PrintParam } from "@/features/reports/ReportShell";
import {
  EMPTY_CARD_FILTERS,
  countActiveFilters,
  describeActiveFilters,
} from "@/features/reports/cardFilters";
import type { CardFilterValue } from "@/features/reports/cardFilters";
import { useCardFilterOptions } from "@/features/reports/useCardFilterOptions";
import PpmPortfolioView from "./PpmPortfolioView";
import { BOARD_MAX_WIDTH } from "./ppmPortfolioFormat";
import {
  decodeCardFilters,
  encodeCardFilters,
  matchingInitiativeIds,
  otherTypesFirst,
} from "./ppmBoardFilters";
import type { PpmFilterData } from "./ppmBoardFilters";
import type { PpmPortfolioShellParts } from "./PpmPortfolioView";
import type {
  PpmGanttItem,
  PpmGroupOption,
  PpmDashboardData,
  PpmPortfolioItem,
  PpmPortfolioGroupOption,
} from "@/types";

/** No print lines from the Filters section (nothing selected, or nothing loaded). */
const NO_PRINT_PARAMS: PrintParam[] = [];

export default function PpmPortfolio() {
  const { t } = useTranslation(["ppm", "reports", "common"]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Read the type array directly rather than through `getType`: the subtype
  // definitions live on the card type, and this is the same lookup
  // `useCardSubtypeLabel` does — which is what the board used before the split.
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();

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
          api.get<PpmGanttItem[]>(
            `/reports/ppm/gantt?group_by=${encodeURIComponent(groupBy)}`,
            { signal },
          ),
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

  const initiativeType = types.find((tp) => tp.key === "Initiative");
  const subtypeDefs = initiativeType?.subtypes ?? [];

  /* ---- The Filters section ------------------------------------------ */

  // Read once from the URL; the view writes it back through its one URL-sync
  // effect (a second `setSearchParams` here would clobber that one's write).
  const [filters, setFilters] = useState<CardFilterValue>(() =>
    decodeCardFilters(searchParams.get("filters")),
  );
  // Folded on every visit, even with a selection in the URL — the board is the
  // point of the page, and the header's count chip says filters are on.
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  // Latched: once requested the path never returns to null, which would clear
  // the payload (`useApiQuery`) and refetch on every re-open.
  const [requested, setRequested] = useState(() => countActiveFilters(filters) > 0);
  const filterQuery = useApiQuery<PpmFilterData>(requested ? "/reports/ppm/filter-data" : null);
  const filterData = filterQuery.data;

  const relationTypes = useMemo(() => filterData?.relation_types ?? [], [filterData]);
  const groupableTypes = useMemo(() => filterData?.groupable_types ?? {}, [filterData]);
  const tagGroups = useMemo(() => filterData?.tag_groups ?? [], [filterData]);

  const {
    relationOptions: payloadOrder,
    relSubtypes,
    facetFields,
  } = useCardFilterOptions({
    cardTypeKey: "Initiative",
    relationTypes,
    groupableTypes,
    includeDescendants: filters.includeDescendants,
  });
  // Other card types before the Initiative's own facets, in the section and
  // the print header alike.
  const relationOptions = useMemo(
    () => otherTypesFirst(payloadOrder, relationTypes, "Initiative"),
    [payloadOrder, relationTypes],
  );

  const matchIds = useMemo(
    () =>
      filterData
        ? matchingInitiativeIds(filterData.items, filters, {
            facetFields,
            relationTypes,
            groupableTypes,
            relSubtypes,
            tagGroups,
          })
        : null,
    [filterData, filters, facetFields, relationTypes, groupableTypes, relSubtypes, tagGroups],
  );

  // A selection whose payload has not arrived yet must not show the board
  // unfiltered; a failed load narrows nothing and says so in the section.
  const filtersPending =
    countActiveFilters(filters) > 0 && !filterData && filterQuery.error === null;

  // Only filters that are applied reach the print header: without the payload
  // the board is unfiltered, and the options to name a pick by are missing.
  const extraPrintParams: PrintParam[] = useMemo(
    () =>
      !filterData
        ? NO_PRINT_PARAMS
        : describeActiveFilters({
        value: filters,
        relationOptions,
        tagGroups,
        subtypeOptions: [],
        fields: facetFields,
        relSubtypes,
        labels: {
          subtype: t("reports:portfolio.filters.subtype"),
          tags: t("reports:portfolio.tags"),
          empty: t("common:labels.empty"),
          subCards: t("reports:cardFilters.inclSubCards"),
        },
      }),
    [filterData, filters, relationOptions, tagGroups, facetFields, relSubtypes, t],
  );

  const initiativeLabel = typeLabel(initiativeType);
  const filterSection = (
    <CardFilterSection
      label={
        initiativeLabel
          ? t("reports:portfolio.typeFilters", { type: initiativeLabel })
          : t("reports:common.filters")
      }
      // A failed load is shown open, so its message is seen — not a folded
      // header whose count chip claims a filter that is not applied.
      collapsed={filtersCollapsed && filterQuery.error === null}
      onToggle={() => {
        setFiltersCollapsed((v) => !v);
        setRequested(true);
      }}
      value={filters}
      onChange={setFilters}
      relationOptions={relationOptions}
      tagGroups={tagGroups}
      subtypeOptions={[]}
      fields={facetFields}
      relSubtypes={relSubtypes}
      onClearAll={() =>
        setFilters((prev) => ({ ...EMPTY_CARD_FILTERS, includeDescendants: prev.includeDescendants }))
      }
      disabledReason={
        filterQuery.error
          ? t("filtersLoadFailed")
          : filterData
            ? undefined
            : t("common:labels.loading")
      }
    />
  );

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
        maxWidth={BOARD_MAX_WIDTH}
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
      loading={loading || filtersPending}
      onGroupByChange={setGroupBy}
      onOpen={handleOpen}
      shell={shell}
      filterSection={filterSection}
      matchIds={matchIds}
      extraPrintParams={extraPrintParams}
      filtersParam={encodeCardFilters(filters)}
    />
  );
}
