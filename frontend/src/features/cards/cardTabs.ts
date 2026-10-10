/**
 * Which tabs a card's detail page shows, in which order, and which one opens.
 *
 * The strip used to be addressed by index, with every tab's position worked
 * out by hand from the ones before it. A deep link named by key
 * (`?tab=resources`) therefore opened the Card tab, and a tab appearing or
 * vanishing as its count loaded moved the selection onto its neighbour. Each
 * tab is now addressed by its key; an index is accepted only for the links
 * that still carry one (`?tab=1` for a process's flow).
 */

export const CARD_TAB_KEYS = [
  "card",
  "processFlow",
  "assessments",
  "soaw",
  "comments",
  "todos",
  "stakeholders",
  "resources",
  "adrs",
  "risks",
  "compliance",
  "history",
  "ppm",
] as const;

export type CardTabKey = (typeof CARD_TAB_KEYS)[number];

/** The i18n key (`cards` namespace) labelling each tab. */
export const CARD_TAB_LABEL_KEYS: Record<CardTabKey, string> = {
  card: "tabs.card",
  processFlow: "tabs.processFlow",
  assessments: "tabs.assessments",
  soaw: "tabs.soaw",
  comments: "tabs.comments",
  todos: "tabs.todos",
  stakeholders: "tabs.stakeholders",
  resources: "tabs.resources",
  adrs: "tabs.adrs",
  risks: "tabs.risks",
  compliance: "tabs.compliance",
  history: "tabs.history",
  ppm: "tabs.ppm",
};

export function isCardTabKey(value: string): value is CardTabKey {
  return (CARD_TAB_KEYS as readonly string[]).includes(value);
}

/**
 * A tab listing a card's linked items. While its count is still loading
 * (`null`) the tab shows, so it never flashes in on a card that has items;
 * once the count settles at 0 it goes.
 */
export function hasItemsOrLoading(count: number | null): boolean {
  return count === null || count > 0;
}

export interface CardTabInputs {
  cardType: string;
  /** BusinessProcess: Process Flow + Assessments (off in the side panel). */
  showBpmTabs: boolean;
  /** Initiative: the PPM tab (off where PPM itself hosts the card). */
  showPpmTab: boolean;
  ppmEnabled: boolean;
  grcEnabled: boolean;
  canViewRisks: boolean;
  risksCount: number | null;
  canViewCompliance: boolean;
  complianceCount: number | null;
  canViewAdr: boolean;
  adrCount: number | null;
  /** An empty ADR tab stays for someone who can link the first decision. */
  canManageAdrLinks: boolean;
}

/** The card's built-in tabs, left to right. */
export function cardTabKeys(input: CardTabInputs): CardTabKey[] {
  const keys: CardTabKey[] = ["card"];
  if (input.showBpmTabs && input.cardType === "BusinessProcess") {
    keys.push("processFlow", "assessments");
  }
  if (input.cardType === "Initiative") keys.push("soaw");
  keys.push("comments", "todos", "stakeholders", "resources");
  if (input.canViewAdr && (hasItemsOrLoading(input.adrCount) || input.canManageAdrLinks)) {
    keys.push("adrs");
  }
  if (input.grcEnabled && input.canViewRisks && hasItemsOrLoading(input.risksCount)) {
    keys.push("risks");
  }
  if (
    input.grcEnabled &&
    input.canViewCompliance &&
    hasItemsOrLoading(input.complianceCount)
  ) {
    keys.push("compliance");
  }
  keys.push("history");
  if (input.showPpmTab && input.ppmEnabled && input.cardType === "Initiative") {
    keys.push("ppm");
  }
  return keys;
}

/**
 * The tab to show for a requested one: a key the strip carries, or an index
 * into it (a number or a string of digits). Anything else opens the Card tab.
 */
export function resolveCardTab(
  requested: number | string | undefined,
  values: readonly string[],
): string {
  if (requested === undefined || requested === "") return "card";
  if (typeof requested === "number" || /^\d+$/.test(requested)) {
    return values[Number(requested)] ?? "card";
  }
  return values.includes(requested) ? requested : "card";
}

/**
 * Opening a tab clears its activity dot. The PPM tab is not opened in place
 * (choosing it navigates to the PPM page), and extension tabs carry no dot.
 */
export function notesVisit(value: string): value is CardTabKey {
  return isCardTabKey(value) && value !== "ppm";
}

export interface CardTabExtension<D> {
  key: string;
  plugin: { cardTabs?: D[] };
}

export interface CardTabDef {
  id: string;
  appliesTo?: string[];
  permission?: string;
}

/** The value an extension tab takes in the strip. */
export function extensionTabValue(extKey: string, tabId: string): string {
  return `ext:${extKey}:${tabId}`;
}

/** Extension tabs for this card, after the built-in ones: by card type, then permission. */
export function visibleExtensionTabs<D extends CardTabDef>(
  extensions: readonly CardTabExtension<D>[],
  cardType: string,
  can: (permission: string) => boolean,
): { extKey: string; def: D; value: string }[] {
  return extensions.flatMap(({ key, plugin }) =>
    (plugin.cardTabs ?? [])
      .filter((def) => !def.appliesTo || def.appliesTo.includes(cardType))
      .filter((def) => !def.permission || can(def.permission))
      .map((def) => ({ extKey: key, def, value: extensionTabValue(key, def.id) })),
  );
}
