/**
 * A sankey's query: the relation it follows, and what each side groups by.
 * Each side offers its own end's fields — the source side the source type's,
 * the target side the target type's — plus `card` to draw individual cards.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { useRelationLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import type { CardType, RelationType } from "@/types";
import { sankeySideOptions } from "../widgetConfigModel";
import SelectField from "./SelectField";
import type { DraftProps } from "./types";
import { useConfigLabels } from "./useConfigLabels";

const NONE = "";

interface Props extends DraftProps {
  relations: RelationType[];
  /** Every card type (a side's fields are looked up here). */
  types: CardType[];
}

export default function SankeySection({ draft, setQuery, relations, types }: Props) {
  const { t } = useTranslation("common");
  const typeLabel = useTypeLabel();
  const relationLabel = useRelationLabel();
  const labels = useConfigLabels();
  const query = draft.query;
  const rt = relations.find((r) => r.key === query.relation_type);
  const sourceOptions = sankeySideOptions(rt, "source", types);
  const targetOptions = sankeySideOptions(rt, "target", types);
  const typeOf = (key: string) => types.find((ct) => ct.key === key);

  return (
    <Stack spacing={2}>
      <SelectField
        label={t("dashboard.config.relationType")}
        value={query.relation_type ?? NONE}
        onChange={(v) => setQuery({ relation_type: v || null })}
        options={relations.map((r) => ({
          value: r.key,
          label: `${typeLabel(typeOf(r.source_type_key))} → ${relationLabel(r)} → ${typeLabel(typeOf(r.target_type_key))}`,
        }))}
        required
        testId="config-relation-type"
      />
      {rt && (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <SelectField
            label={t("dashboard.config.sourceDimension", { type: typeLabel(typeOf(rt.source_type_key)) })}
            value={query.group_by ?? "type"}
            onChange={(v) => setQuery({ group_by: v || null })}
            options={sourceOptions.map((d) => ({ value: d, label: labels.dimension(d, rt.source_type_key) }))}
            testId="config-source-dimension"
          />
          <SelectField
            label={t("dashboard.config.targetDimension", { type: typeLabel(typeOf(rt.target_type_key)) })}
            value={query.group_by_2 ?? "type"}
            onChange={(v) => setQuery({ group_by_2: v || null })}
            options={targetOptions.map((d) => ({ value: d, label: labels.dimension(d, rt.target_type_key) }))}
            testId="config-target-dimension"
          />
        </Box>
      )}
    </Stack>
  );
}
