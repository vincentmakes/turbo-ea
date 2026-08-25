import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import ShowOnCardSelector from "@/components/cardDisplay/ShowOnCardSelector";
import { MAX_CARD_LINES, type CardLabelSettings } from "@/lib/cardDisplayFields";
import type { CardType } from "@/types";
import { toCardLabels, type LdvDisplaySettings } from "./ldvDisplaySettings";

interface Props {
  types: CardType[];
  /** Card-type keys currently on the canvas — only their fields are offered. */
  activeTypeKeys: string[];
  settings: LdvDisplaySettings;
  update: (patch: Partial<LdvDisplaySettings>) => void;
  /** The fullscreened element, when the view is fullscreen. */
  container?: Element | null;
}

/**
 * The Layered Dependency View's "Show on card" toolbar button.
 *
 * A component of its own rather than JSX inside `LayeredDependencyView`
 * because that view cannot mount under jsdom — React Flow needs layout APIs
 * jsdom does not implement — so anything rendered inside it is untestable.
 * That is how the picker this replaces shipped with no coverage at all.
 *
 * It is a thin adapter: the shared selector speaks `CardLabelSettings`
 * (`fields`), the view's store speaks `LdvDisplaySettings` (`extraFields`), and
 * lifecycle rides along as an extra line the diagram editor has no equivalent
 * for.
 */
export default function LdvShowOnCard({
  types,
  activeTypeKeys,
  settings,
  update,
  container,
}: Props) {
  const { t } = useTranslation(["reports"]);

  const labels = useMemo(() => toCardLabels(settings), [settings]);

  const onChange = (next: CardLabelSettings) =>
    update({
      showType: !!next.showType,
      showSubtype: !!next.showSubtype,
      extraFields: next.fields,
    });

  return (
    <ShowOnCardSelector
      trigger="icon"
      container={container}
      types={types}
      activeTypeKeys={activeTypeKeys}
      labels={labels}
      onChange={onChange}
      maxLines={MAX_CARD_LINES}
      extraLines={[
        {
          key: "showLifecycle",
          // The same word the card prints, so the tick and the line it produces
          // read alike.
          label: t("dependency.lifecycleLabel"),
          checked: settings.showLifecycle,
          onSet: (checked) => update({ showLifecycle: checked }),
        },
      ]}
    />
  );
}
