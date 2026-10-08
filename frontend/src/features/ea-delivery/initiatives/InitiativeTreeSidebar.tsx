import { useCallback, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useOptionLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import { CARD_TYPE_COLORS, STATUS_COLORS } from "@/theme/tokens";
import { INITIATIVE_STATUS_COLORS } from "./constants";
import type { InitiativeTreeNode } from "./useInitiativeData";

export const UNLINKED_KEY = "__unlinked__";

/** The Initiative type's own option for an `initiativeStatus` value, if any. */
function useInitiativeStatusOption() {
  const { types } = useMetamodel();
  return useCallback(
    (status: string) =>
      types
        .find((mt) => mt.key === "Initiative")
        ?.fields_schema.flatMap((section) => section.fields)
        .find((field) => field.key === "initiativeStatus")
        ?.options?.find((o) => o.key === status),
    [types],
  );
}

/**
 * Names an initiative's `initiativeStatus` value — the sidebar's status dot and
 * the workspace header's status chip share it. The Initiative type's own
 * option label (translated) comes first, so an admin's custom option reads as
 * its label rather than its key; the bundled wording covers a built-in key the
 * metamodel lacks, and anything else is shown as stored.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useInitiativeStatusLabel() {
  const { t } = useTranslation(["delivery", "common"]);
  const statusOption = useInitiativeStatusOption();
  const optLabel = useOptionLabel();
  return useCallback(
    (status: string): string => {
      const option = statusOption(status);
      if (option) return optLabel(option);
      const builtIn: Record<string, string> = {
        onTrack: t("initiativeStatus.onTrack"),
        atRisk: t("initiativeStatus.atRisk"),
        offTrack: t("initiativeStatus.offTrack"),
        onHold: t("initiativeStatus.onHold"),
        completed: t("initiativeStatus.completed"),
      };
      return builtIn[status] ?? status;
    },
    [statusOption, optLabel, t],
  );
}

/**
 * Colours an initiative's `initiativeStatus` value, resolved like its label:
 * the Initiative type's option colour first, so an admin's custom option is
 * not grey; the bundled colour for a built-in key; grey for anything else.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useInitiativeStatusColor() {
  const statusOption = useInitiativeStatusOption();
  return useCallback(
    (status: string): string =>
      statusOption(status)?.color || INITIATIVE_STATUS_COLORS[status] || STATUS_COLORS.neutral,
    [statusOption],
  );
}

/**
 * Enter / Space on a row selects it, as a click does. Only a key pressed on
 * the row itself counts: the chevron and the star inside it are buttons of
 * their own, and their keys belong to them.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function selectOnKey(select: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    select();
  };
}

interface FilterState {
  search: string;
  status: "ACTIVE" | "ARCHIVED" | "";
  subtype: string;
  artefacts: "" | "with" | "without";
  favoritesOnly: boolean;
}

interface FilterSetters {
  setSearch: (v: string) => void;
  setStatus: (v: "ACTIVE" | "ARCHIVED" | "") => void;
  setSubtype: (v: string) => void;
  setArtefacts: (v: "" | "with" | "without") => void;
  setFavoritesOnly: (v: boolean) => void;
}

interface Props {
  tree: InitiativeTreeNode[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  filter: FilterState;
  filterSetters: FilterSetters;
  unlinkedCount: number;
}

export default function InitiativeTreeSidebar({
  tree,
  totalCount,
  selectedId,
  onSelect,
  favorites,
  onToggleFavorite,
  filter,
  filterSetters,
  unlinkedCount,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const { types: metamodelTypes } = useMetamodel();
  const stLabel = useSubtypeLabel();

  const initiativeType = metamodelTypes.find((mt) => mt.key === "Initiative");
  const subtypes = initiativeType?.subtypes ?? [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sticky filter strip */}
      <Box
        sx={{
          p: 1.25,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <TextField
          size="small"
          placeholder={t("sidebar.searchPlaceholder")}
          value={filter.search}
          onChange={(e) => filterSetters.setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={18} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          <TextField
            select
            size="small"
            label={t("filter.status")}
            value={filter.status}
            onChange={(e) =>
              filterSetters.setStatus(
                e.target.value as "ACTIVE" | "ARCHIVED" | "",
              )
            }
            sx={{ flex: "1 1 110px", minWidth: 110 }}
          >
            <MenuItem value="ACTIVE">{t("filter.active")}</MenuItem>
            <MenuItem value="ARCHIVED">{t("filter.archived")}</MenuItem>
            <MenuItem value="">{t("filter.all")}</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label={t("filter.subtype")}
            value={filter.subtype}
            onChange={(e) => filterSetters.setSubtype(e.target.value)}
            sx={{ flex: "1 1 110px", minWidth: 110 }}
          >
            <MenuItem value="">{t("filter.allSubtypes")}</MenuItem>
            {subtypes.map((st) => (
              <MenuItem key={st.key} value={st.key}>
                {stLabel(st)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label={t("filter.artefacts")}
            value={filter.artefacts}
            onChange={(e) =>
              filterSetters.setArtefacts(e.target.value as "" | "with" | "without")
            }
            sx={{ flex: "1 1 110px", minWidth: 110 }}
          >
            <MenuItem value="">{t("filter.all")}</MenuItem>
            <MenuItem value="with">{t("filter.withArtefacts")}</MenuItem>
            <MenuItem value="without">{t("filter.withoutArtefacts")}</MenuItem>
          </TextField>
          <Tooltip title={t("filter.favoritesOnly")}>
            <IconButton
              size="small"
              onClick={() =>
                filterSetters.setFavoritesOnly(!filter.favoritesOnly)
              }
              sx={{
                color: filter.favoritesOnly ? "#f5a623" : "text.secondary",
                border: filter.favoritesOnly
                  ? "1px solid #f5a623"
                  : "1px solid transparent",
                borderRadius: 1,
              }}
            >
              <MaterialSymbol icon="cards_star" size={20} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Tree body */}
      <Box sx={{ flex: 1, overflow: "auto", p: 0.5 }}>
        {unlinkedCount > 0 && (
          <UnlinkedRow
            count={unlinkedCount}
            selected={selectedId === UNLINKED_KEY}
            onSelect={() => onSelect(UNLINKED_KEY)}
          />
        )}
        {tree.length === 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 4 }}
          >
            {t("sidebar.noResults")}
          </Typography>
        )}
        {tree.map((node) => (
          <TreeBranch
            key={node.initiative.id}
            node={node}
            selectedId={selectedId}
            onSelect={onSelect}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </Box>

      {/* Footer */}
      <Box
        sx={{
          px: 1.25,
          py: 0.75,
          borderTop: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t("sidebar.count", { count: totalCount })}
        </Typography>
      </Box>
    </Box>
  );
}

// ── Tree branch (recursive, collapsible) ──────────────────────────────

interface BranchProps {
  node: InitiativeTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}

function TreeBranch({
  node,
  selectedId,
  onSelect,
  favorites,
  onToggleFavorite,
}: BranchProps) {
  const statusLabel = useInitiativeStatusLabel();
  const statusColor = useInitiativeStatusColor();
  // Default: parents are open; collapses are user-driven, in-memory.
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const { initiative, level } = node;
  const isSelected = selectedId === initiative.id;
  const isArchived = initiative.status === "ARCHIVED";
  const attrs = (initiative.attributes ?? {}) as Record<string, unknown>;
  const initStatus = attrs.initiativeStatus as string | undefined;
  const isFavorite = favorites.has(initiative.id);
  const totalArtefacts =
    node.soaws.length + node.diagrams.length + node.adrs.length;

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          pl: level * 1.5 + 0.25,
          pr: 0.5,
          py: 0.25,
          minHeight: 36,
          borderRadius: 1,
          cursor: "pointer",
          position: "relative",
          bgcolor: isSelected ? "action.selected" : "transparent",
          borderLeft: isSelected
            ? `3px solid ${CARD_TYPE_COLORS.Initiative}`
            : "3px solid transparent",
          "&:hover": { bgcolor: isSelected ? "action.selected" : "action.hover" },
        }}
        role="button"
        tabIndex={0}
        aria-label={initiative.name}
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onSelect(initiative.id)}
        onKeyDown={selectOnKey(() => onSelect(initiative.id))}
      >
        {/* Tree guide lines for nested levels */}
        {Array.from({ length: level }).map((_, i) => (
          <Box
            key={i}
            sx={{
              position: "absolute",
              left: i * 12 + 8,
              top: 0,
              bottom: 0,
              width: "1px",
              bgcolor: "divider",
            }}
          />
        ))}

        {hasChildren ? (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            sx={{ width: 20, height: 20 }}
          >
            <MaterialSymbol
              icon={open ? "expand_more" : "chevron_right"}
              size={18}
            />
          </IconButton>
        ) : (
          <Box sx={{ width: 20 }} />
        )}

        <MaterialSymbol
          icon="rocket_launch"
          size={18}
          color={isArchived ? "#999" : CARD_TYPE_COLORS.Initiative}
        />

        <Typography
          sx={{
            ml: 0.5,
            fontSize: "0.875rem",
            fontWeight: isSelected ? 600 : 400,
            flex: 1,
            minWidth: 0,
            color: isArchived ? "text.secondary" : "text.primary",
          }}
          noWrap
        >
          {initiative.name}
        </Typography>

        {/* Tiny artefact count + status dot + favorite */}
        {totalArtefacts > 0 && (
          <Chip
            label={totalArtefacts}
            size="small"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", px: 0 }}
          />
        )}
        {initStatus && (
          <Tooltip title={statusLabel(initStatus)} placement="top">
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: statusColor(initStatus),
              }}
            />
          </Tooltip>
        )}
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(initiative.id);
          }}
          sx={{
            width: 22,
            height: 22,
            opacity: isFavorite ? 1 : 0.35,
            "&:hover": { opacity: 1 },
          }}
        >
          <MaterialSymbol
            icon="cards_star"
            size={16}
            color={isFavorite ? "#f5a623" : "currentColor"}
          />
        </IconButton>
      </Box>

      {hasChildren && open && (
        <>
          {node.children.map((child) => (
            <TreeBranch
              key={child.initiative.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </>
      )}
    </>
  );
}

// ── Synthetic "Unlinked" row ──────────────────────────────────────────

function UnlinkedRow({
  count,
  selected,
  onSelect,
}: {
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={t("sidebar.unlinked")}
      onClick={onSelect}
      onKeyDown={selectOnKey(onSelect)}
      aria-current={selected ? "true" : undefined}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 0.75,
        py: 0.5,
        minHeight: 36,
        borderRadius: 1,
        cursor: "pointer",
        bgcolor: selected ? "action.selected" : "transparent",
        borderLeft: selected
          ? "3px solid #999"
          : "3px solid transparent",
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
        mb: 0.5,
      }}
    >
      <MaterialSymbol icon="folder_open" size={18} color="#999" />
      <Typography
        sx={{
          fontSize: "0.875rem",
          flex: 1,
          color: "text.secondary",
          fontStyle: "italic",
        }}
        noWrap
      >
        {t("sidebar.unlinked")}
      </Typography>
      <Chip
        label={count}
        size="small"
        variant="outlined"
        sx={{ height: 18, fontSize: "0.65rem" }}
      />
    </Box>
  );
}
