/**
 * The Data quality leaderboard widget's config, read defensively, and the
 * request it makes. Mirrors `_leaderboard_problem` in
 * `backend/app/services/dashboard_service.py` and the `LEADERBOARD_*`
 * vocabulary in `dashboard_defaults.py`: a value the server would refuse is
 * read as its default here, so a hand-edited config still renders.
 *
 * `max_rows` is stored in the config and sent as the endpoint's `top`
 * parameter — like the chart's `top`, it is never part of a query key.
 */
import type { MetaEntityLike } from "@/hooks/useResolveLabel";
import type {
  CardType,
  LeaderboardRankBy,
  MetamodelTranslations,
  QualityLeaderboardRow,
  StakeholderRoleDefinition,
  TranslationMap,
} from "@/types";

export const LEADERBOARD_RANKINGS: readonly LeaderboardRankBy[] = ["average_quality", "card_count"];
export const LEADERBOARD_MIN_CARDS = { min: 1, max: 100 } as const;
export const LEADERBOARD_MAX_ROWS = { min: 3, max: 50 } as const;

export interface LeaderboardConfig {
  rankBy: LeaderboardRankBy;
  minCards: number;
  maxRows: number;
  cardTypes: string[];
  roles: string[];
  countingRolesOnly: boolean;
}

/** The catalogue default, as the backend's `LEADERBOARD_DEFAULT_CONFIG`. */
export const LEADERBOARD_DEFAULTS: LeaderboardConfig = {
  rankBy: "average_quality",
  minCards: 3,
  maxRows: 10,
  cardTypes: [],
  roles: [],
  countingRolesOnly: true,
};

function intWithin(value: unknown, bounds: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= bounds.min && value <= bounds.max;
}

function keyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((k): k is string => typeof k === "string" && k !== "");
}

export function readLeaderboardConfig(config: Record<string, unknown> | null | undefined): LeaderboardConfig {
  const c = config ?? {};
  return {
    rankBy: LEADERBOARD_RANKINGS.includes(c.rank_by as LeaderboardRankBy)
      ? (c.rank_by as LeaderboardRankBy)
      : LEADERBOARD_DEFAULTS.rankBy,
    minCards: intWithin(c.min_cards, LEADERBOARD_MIN_CARDS) ? c.min_cards : LEADERBOARD_DEFAULTS.minCards,
    maxRows: intWithin(c.max_rows, LEADERBOARD_MAX_ROWS) ? c.max_rows : LEADERBOARD_DEFAULTS.maxRows,
    cardTypes: keyList(c.card_types),
    roles: keyList(c.roles),
    countingRolesOnly: c.counting_roles_only !== false,
  };
}

/** `GET /dashboards/leaderboard` for a config: the key filters repeated, `top` = `max_rows`. */
export function leaderboardPath(config: LeaderboardConfig): string {
  const params = new URLSearchParams();
  params.set("rank_by", config.rankBy);
  params.set("min_cards", String(config.minCards));
  for (const key of config.cardTypes) params.append("card_types", key);
  for (const key of config.roles) params.append("roles", key);
  params.set("counting_roles_only", String(config.countingRolesOnly));
  params.set("top", String(config.maxRows));
  return `/dashboards/leaderboard?${params.toString()}`;
}

export interface LeaderboardRoleOption {
  key: string;
  /** The role's definition on every offered type that has it, to name it by. */
  definitions: StakeholderRoleDefinition[];
}

/**
 * The stakeholder role keys a leaderboard can filter by: those of the chosen
 * card types (every offered type when none is chosen), once per key, in the
 * order they first appear. A role key means the same role on every type, but
 * each type may name it differently, so every definition is kept.
 */
export function leaderboardRoleOptions(types: CardType[], chosenTypes: string[]): LeaderboardRoleOption[] {
  const scope = chosenTypes.length > 0 ? types.filter((t) => chosenTypes.includes(t.key)) : types;
  const byKey = new Map<string, LeaderboardRoleOption>();
  for (const type of scope) {
    for (const role of type.stakeholder_roles ?? []) {
      const option = byKey.get(role.key);
      if (option) option.definitions.push(role);
      else byKey.set(role.key, { key: role.key, definitions: [role] });
    }
  }
  return [...byKey.values()];
}

/**
 * A role definition as the entity the label resolvers take. The metamodel
 * serves a type's roles with `translations` either per property
 * (`{label: {fr: …}}`, what the seed and the role editor store) or as a bare
 * locale map (`{fr: …}`, what the type declares); both become the former.
 */
export function roleEntity(role: StakeholderRoleDefinition): MetaEntityLike {
  const raw = role.translations as unknown;
  let translations: MetamodelTranslations | undefined;
  if (raw && typeof raw === "object") {
    const byProperty = raw as Record<string, unknown>;
    translations =
      byProperty.label && typeof byProperty.label === "object"
        ? (raw as MetamodelTranslations)
        : { label: raw as TranslationMap };
  }
  return { key: role.key, label: role.label, translations };
}

/** A row's bar width in percent: its average, or — ranked by count — its
 *  count against the board's largest count. Clamped to 0–100. */
export function barWidth(row: QualityLeaderboardRow, byCount: boolean, maxCards: number): number {
  const share = byCount ? (row.cards / Math.max(1, maxCards)) * 100 : row.average_quality;
  return Math.min(100, Math.max(0, share));
}
