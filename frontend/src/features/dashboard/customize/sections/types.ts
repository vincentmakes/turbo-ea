/** What every section of the configuration dialog receives to edit the draft. */
import type { DashboardQuery } from "@/types";
import type { ConfigDraft } from "../widgetConfigModel";

export interface DraftProps {
  draft: ConfigDraft;
  set: <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => void;
  setQuery: (patch: Partial<DashboardQuery>) => void;
}
