import CataloguePage from "@/features/reference-catalogue/CataloguePage";
import type { CatalogueKindConfig } from "@/features/reference-catalogue/types";
import { CARD_TYPE_COLORS, brand } from "@/theme/tokens";

const config: CatalogueKindConfig = {
  kind: "capability",
  basePath: "/capability-catalogue",
  payloadKey: "capabilities",
  idPrefix: "BC-",
  i18nNamespace: "catalogue",
  inventoryCardType: "BusinessCapability",
  // Brand navy used across the EA app for capabilities (see HierarchySection,
  // CapabilityMapReport.CapabilityCard, the public catalogue site at
  // catalog.turbo-ea.org).
  accentColor: CARD_TYPE_COLORS.BusinessCapability,
  selectionColor: brand.primary,
  // Level 0 represents Macro Capabilities — an executive-level grouping
  // above L1. Cross-Industry currently ships 9 macros (MC-10..MC-90); other
  // industries may add their own later.
  levelLabel: (level) => (level === 0 ? "Macro" : `L${level}`),
  heroIcon: "account_tree",
};

export default function CapabilityCataloguePage() {
  return <CataloguePage config={config} />;
}
