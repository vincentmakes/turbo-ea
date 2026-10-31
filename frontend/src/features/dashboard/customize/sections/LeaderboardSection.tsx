/**
 * The Data quality leaderboard's settings: how it ranks (average data quality
 * or number of cards), from how many cards someone appears, which card types
 * and stakeholder roles count (keys only — every type the reader may see, and
 * the roles those types define, each named through the entity-aware
 * resolver), whether only the roles that fill the data-quality stakeholder
 * slot count, and how many people it lists.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType, LeaderboardRankBy } from "@/types";
import {
  LEADERBOARD_MAX_ROWS,
  LEADERBOARD_MIN_CARDS,
  LEADERBOARD_RANKINGS,
  leaderboardRoleOptions,
  roleEntity,
} from "../../widgets/leaderboardConfig";
import SelectField from "./SelectField";
import type { DraftProps } from "./types";

const RANK_LABEL_KEYS: Record<LeaderboardRankBy, string> = {
  average_quality: "dashboard.leaderboard.rankByAverage",
  card_count: "dashboard.leaderboard.rankByCount",
};

interface Props extends Pick<DraftProps, "draft" | "set"> {
  /** The card types the reader may see (module mode, not hidden). */
  cardTypes: CardType[];
}

export default function LeaderboardSection({ draft, set, cardTypes }: Props) {
  const { t } = useTranslation("common");
  const typeLabel = useTypeLabel();

  const typeNames = useMemo(() => new Map(cardTypes.map((ct) => [ct.key, typeLabel(ct)])), [cardTypes, typeLabel]);
  const roleOptions = useMemo(
    () => leaderboardRoleOptions(cardTypes, draft.leaderboardTypes),
    [cardTypes, draft.leaderboardTypes],
  );
  const roleNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const option of roleOptions) {
      // A role key may be named differently on each type: list each name once.
      const labels = option.definitions.map((def) => typeLabel(roleEntity(def)));
      names.set(option.key, Array.from(new Set(labels)).join(" / "));
    }
    return names;
  }, [roleOptions, typeLabel]);

  // A key already on the widget stays listed even where it is no longer offered.
  const typeKeys = Array.from(new Set([...cardTypes.map((ct) => ct.key), ...draft.leaderboardTypes]));
  const roleKeys = Array.from(new Set([...roleOptions.map((o) => o.key), ...draft.leaderboardRoles]));

  return (
    <Stack spacing={2} data-testid="config-leaderboard">
      <SelectField
        label={t("dashboard.leaderboard.rankBy")}
        value={draft.rankBy}
        onChange={(v) => set("rankBy", v as LeaderboardRankBy)}
        options={LEADERBOARD_RANKINGS.map((r) => ({ value: r, label: t(RANK_LABEL_KEYS[r]) }))}
        testId="config-leaderboard-rank-by"
      />
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
        <TextField
          size="small"
          type="number"
          fullWidth
          label={t("dashboard.leaderboard.minCards")}
          value={draft.minCards}
          onChange={(e) => set("minCards", e.target.value)}
          slotProps={{
            htmlInput: {
              min: LEADERBOARD_MIN_CARDS.min,
              max: LEADERBOARD_MIN_CARDS.max,
              "data-testid": "config-leaderboard-min-cards",
            },
          }}
        />
        <TextField
          size="small"
          type="number"
          fullWidth
          label={t("dashboard.leaderboard.maxRows")}
          value={draft.maxRows}
          onChange={(e) => set("maxRows", e.target.value)}
          slotProps={{
            htmlInput: {
              min: LEADERBOARD_MAX_ROWS.min,
              max: LEADERBOARD_MAX_ROWS.max,
              "data-testid": "config-leaderboard-max-rows",
            },
          }}
        />
      </Box>
      <Autocomplete
        multiple
        size="small"
        options={typeKeys}
        value={draft.leaderboardTypes}
        onChange={(_, value) => set("leaderboardTypes", value)}
        getOptionLabel={(key) => typeNames.get(key) ?? key}
        disableCloseOnSelect
        renderTags={(value, getTagProps) =>
          value.map((key, index) => {
            const { key: tagKey, ...tagProps } = getTagProps({ index });
            return <Chip key={tagKey} size="small" label={typeNames.get(key) ?? key} {...tagProps} />;
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={t("dashboard.leaderboard.cardTypes")}
            placeholder={draft.leaderboardTypes.length === 0 ? t("dashboard.config.allCardTypes") : undefined}
          />
        )}
        data-testid="config-leaderboard-types"
      />
      <Autocomplete
        multiple
        size="small"
        options={roleKeys}
        value={draft.leaderboardRoles}
        onChange={(_, value) => set("leaderboardRoles", value)}
        getOptionLabel={(key) => roleNames.get(key) ?? key}
        disableCloseOnSelect
        renderTags={(value, getTagProps) =>
          value.map((key, index) => {
            const { key: tagKey, ...tagProps } = getTagProps({ index });
            return <Chip key={tagKey} size="small" label={roleNames.get(key) ?? key} {...tagProps} />;
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={t("dashboard.leaderboard.roles")}
            placeholder={draft.leaderboardRoles.length === 0 ? t("dashboard.leaderboard.allRoles") : undefined}
          />
        )}
        data-testid="config-leaderboard-roles"
      />
      <FormControlLabel
        data-testid="config-leaderboard-counting-roles"
        control={
          <Switch checked={draft.countingRolesOnly} onChange={(e) => set("countingRolesOnly", e.target.checked)} />
        }
        label={t("dashboard.leaderboard.countingRolesOnly")}
      />
    </Stack>
  );
}
