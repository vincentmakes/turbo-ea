import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import LinkifiedText from "@/components/LinkifiedText";
import CataloguePage from "@/features/reference-catalogue/CataloguePage";
import type {
  CatalogueKindConfig,
  CatalogueNode,
} from "@/features/reference-catalogue/types";

function ValueStreamDetailExtras({ node }: { node: CatalogueNode }) {
  const { t } = useTranslation(["cards"]);
  const isStage = node.level === 2;
  if (!isStage) return null;
  const caps = node.capability_ids ?? [];
  const procs = node.process_ids ?? [];
  if (
    node.stage_order == null &&
    !node.industry_variant &&
    !node.notes &&
    caps.length === 0 &&
    procs.length === 0
  ) {
    return null;
  }
  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        {node.stage_order != null && (
          <Chip
            size="small"
            label={t("cards:valueStreamCatalogue.stageOrderLabel", { order: node.stage_order })}
            variant="outlined"
          />
        )}
        {node.industry_variant && (
          <Chip
            size="small"
            color="warning"
            label={t("cards:valueStreamCatalogue.industryVariantLabel", {
              variant: node.industry_variant,
            })}
            variant="outlined"
          />
        )}
      </Stack>

      {node.notes && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            {t("cards:valueStreamCatalogue.notesLabel")}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            <LinkifiedText text={node.notes} />
          </Typography>
        </Box>
      )}

      {caps.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            {t("cards:valueStreamCatalogue.capabilityIdsLabel")}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {caps.map((bc) => (
              <Chip key={bc} size="small" label={bc} variant="outlined" color="primary" />
            ))}
          </Stack>
        </Box>
      )}

      {procs.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            {t("cards:valueStreamCatalogue.processIdsLabel")}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {procs.map((bp) => (
              <Chip key={bp} size="small" label={bp} variant="outlined" color="warning" />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

const config: CatalogueKindConfig = {
  kind: "valueStream",
  basePath: "/value-stream-catalogue",
  payloadKey: "value_streams",
  idPrefix: "VS-",
  i18nNamespace: "valueStreamCatalogue",
  inventoryCardType: "BusinessContext",
  // Matches the BusinessContext card-type colour in the metamodel seed.
  accentColor: "#fe6690",
  selectionColor: "#D63384",
  levelLabel: (level) => (level === 1 ? "Stream" : "Stage"),
  heroIcon: "alt_route",
  renderDetailExtras: (node) => <ValueStreamDetailExtras node={node} />,
};

export default function ValueStreamCataloguePage() {
  return <CataloguePage config={config} />;
}
