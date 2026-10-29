/**
 * What a query counts: approval status, lifecycle phase, health and
 * governance flags (orphaned, stale, without stakeholders, no end-of-life
 * data) as chips — each option with a one-line description — and "has /
 * lacks a relation" to another type. Collapsible, open from the
 * start when the widget already filters on something.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { APPROVAL_STATUSES, LIFECYCLE_PHASES, OFFERED_FLAGS, hasFilters } from "../widgetConfigModel";
import SelectField from "./SelectField";
import type { DraftProps } from "./types";
import { useConfigLabels } from "./useConfigLabels";

const NONE = "";
/** The flags that carry a description; a retired flag still on a widget has none. */
const DESCRIBED_FLAGS: ReadonlySet<string> = new Set(OFFERED_FLAGS);

interface Props extends DraftProps {
  /** Flags on offer for the chosen card type. */
  flagOptions: string[];
  /** Relation side keys a has / lacks filter can use (empty hides it). */
  presenceOptions: string[];
}

export default function FiltersSection({ draft, set, setQuery, flagOptions, presenceOptions }: Props) {
  const { t } = useTranslation("common");
  const labels = useConfigLabels();
  const [expanded, setExpanded] = useState(() => hasFilters(draft));
  const query = draft.query;
  const typeKey = query.card_type ?? null;
  const anyOption = { value: NONE, label: t("dashboard.config.anyValue") };
  // A flag already on the widget stays listed even where it is no longer offered.
  const options = Array.from(new Set([...flagOptions, ...draft.flags]));
  const presence = draft.relationPresence;

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, open) => setExpanded(open)}
      disableGutters
      variant="outlined"
      data-testid="config-filters"
    >
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Typography variant="subtitle2">{t("dashboard.config.filters")}</Typography>
        {hasFilters(draft) && !expanded && (
          <Chip size="small" label={t("dashboard.config.filtersActive")} sx={{ ml: 1, height: 20 }} />
        )}
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <SelectField
              label={t("dashboard.config.approvalFilter")}
              value={query.approval_status ?? NONE}
              onChange={(v) => setQuery({ approval_status: v || null })}
              options={[anyOption, ...APPROVAL_STATUSES.map((s) => ({ value: s, label: t(`status.${s.toLowerCase()}`) }))]}
              testId="config-approval"
            />
            <SelectField
              label={t("dashboard.config.lifecycleFilter")}
              value={query.lifecycle_phase ?? NONE}
              onChange={(v) => setQuery({ lifecycle_phase: v || null })}
              options={[anyOption, ...LIFECYCLE_PHASES.map((p) => ({ value: p, label: t(`lifecycle.${p}`) }))]}
              testId="config-lifecycle"
            />
          </Box>
          <Autocomplete
            multiple
            size="small"
            options={options}
            value={draft.flags}
            onChange={(_, value) => set("flags", value)}
            getOptionLabel={(f) => labels.flag(f, typeKey)}
            disableCloseOnSelect
            renderOption={(props, f) => {
              const { key, ...optionProps } = props as typeof props & { key: string };
              return (
                <li key={key} {...optionProps}>
                  <ListItemText
                    primary={labels.flag(f, typeKey)}
                    secondary={DESCRIBED_FLAGS.has(f) ? t(`dashboard.query.flagHelp.${f}`) : undefined}
                    sx={{ my: 0 }}
                  />
                </li>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((f, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                return <Chip key={key} size="small" label={labels.flag(f, typeKey)} {...tagProps} />;
              })
            }
            renderInput={(params) => (
              <TextField {...params} label={t("dashboard.config.flags")} placeholder={t("dashboard.config.flagsPlaceholder")} />
            )}
            data-testid="config-flags"
          />
          {presenceOptions.length > 0 && (
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 2, alignItems: "center" }}>
              <SelectField
                label={t("dashboard.config.relationPresence")}
                value={presence.rt ?? NONE}
                onChange={(v) => set("relationPresence", { ...presence, rt: v || null })}
                options={[anyOption, ...presenceOptions.map((side) => ({ value: side, label: labels.relationSide(side, typeKey) }))]}
                testId="config-relation-presence"
              />
              <ToggleButtonGroup
                exclusive
                size="small"
                value={presence.has ? "has" : "lacks"}
                disabled={!presence.rt}
                onChange={(_, value: "has" | "lacks" | null) => {
                  if (value) set("relationPresence", { ...presence, has: value === "has" });
                }}
                aria-label={t("dashboard.config.relationPresence")}
              >
                <ToggleButton value="has">{t("dashboard.config.has")}</ToggleButton>
                <ToggleButton value="lacks">{t("dashboard.config.lacks")}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
