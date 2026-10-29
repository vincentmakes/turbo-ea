/**
 * The widget catalogue: every widget type's metadata (`widgetMeta.ts`) plus
 * the component that renders it. The grid looks a widget up here; the
 * "Add widget" drawer lists it by family.
 */
import type { ComponentType } from "react";
import type { WidgetType } from "@/types";
import BrowseByTypeWidget from "./BrowseByTypeWidget";
import ChartWidget from "./ChartWidget";
import KpiWidget from "./KpiWidget";
import RecentActivityWidget from "./RecentActivityWidget";
import SectionWidget from "./SectionWidget";
import { WIDGET_META, WIDGET_TYPE_KEYS, type WidgetMeta, type WidgetProps } from "./widgetMeta";

export {
  NO_MODULES,
  WIDGET_META,
  WIDGET_TYPE_KEYS,
  chartTitleKey,
  isKnownWidgetType,
  neededSources,
  visibleWidgets,
  widgetModule,
  widgetPermission,
  widgetSource,
  widgetSources,
  widgetTitle,
} from "./widgetMeta";
export type { DashboardModules, WidgetChrome, WidgetFamily, WidgetMeta, WidgetProps } from "./widgetMeta";

export interface WidgetRegistryEntry extends WidgetMeta {
  Component: ComponentType<WidgetProps>;
}

function componentFor(type: WidgetType): ComponentType<WidgetProps> {
  switch (type) {
    case "kpi":
      return KpiWidget;
    case "chart":
      return ChartWidget;
    case "recent_activity":
      return RecentActivityWidget;
    case "browse_by_type":
      return BrowseByTypeWidget;
    default:
      return SectionWidget;
  }
}

export const WIDGET_REGISTRY: Record<WidgetType, WidgetRegistryEntry> = Object.fromEntries(
  WIDGET_TYPE_KEYS.map((type) => [type, { ...WIDGET_META[type], Component: componentFor(type) }]),
) as Record<WidgetType, WidgetRegistryEntry>;
