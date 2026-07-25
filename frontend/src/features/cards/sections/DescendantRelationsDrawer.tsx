/**
 * DescendantRelationsDrawer — the read-only roll-up behind the
 * "+N in sub-items" chip on a relation group (discussion #863).
 *
 * Answers "which applications hang off this capability's sub-capabilities?"
 * without the user maintaining the link twice, and without making the
 * Relations section itself busier: one chip in the group header, the full
 * list one click away.
 *
 * Deliberately read-only — no add, no unlink, no attribute editing. The rows
 * belong to the descendant that owns them, so `relations` stays the single
 * source of truth for every edge; you unlink from the child, never from here.
 * The `via` chips name that owning descendant and navigate to it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Pagination from "@mui/material/Pagination";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PHASE_COLORS, getCurrentPhase } from "@/components/LifecycleBadge";
import { api } from "@/api/client";
import { isHexColor, readableTypeColor } from "@/lib/color";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel, useRelationLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import type {
  DescendantRelationRow,
  DescendantRelationsResponse,
  RelationType,
} from "@/types";

const PAGE_SIZE = 50;

/** Bucket key for rows whose card carries no subtype — always sorted last. */
const NO_SUBTYPE = "__none__";

export default function DescendantRelationsDrawer({
  open,
  onClose,
  cardId,
  rt,
  isSource,
}: {
  open: boolean;
  onClose: () => void;
  cardId: string;
  rt: RelationType;
  isSource: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const subtypeLabel = useSubtypeLabel();

  const [rows, setRows] = useState<DescendantRelationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [viaTotal, setViaTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const otherTypeKey = isSource ? rt.target_type_key : rt.source_type_key;
  const otherType = getType(otherTypeKey);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .get<DescendantRelationsResponse>(
        `/cards/${cardId}/descendant-relations?relation_type=${encodeURIComponent(rt.key)}` +
          `&page=${page}&page_size=${PAGE_SIZE}`,
      )
      .then((res) => {
        setRows(res.rows);
        setTotal(res.total);
        setViaTotal(res.via_total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("relations.rollup.error")))
      .finally(() => setLoading(false));
  }, [cardId, rt.key, page, t]);

  // Lazy — nothing is fetched until the drawer is actually opened.
  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  // Reset paging when the drawer is re-opened on another relation type.
  useEffect(() => {
    if (!open) setPage(1);
  }, [open]);

  const goTo = (id: string) => {
    onClose();
    navigate(`/cards/${id}`);
  };

  // Two-level grouping: subtype (outer, collapsible) → lifecycle phase (inner,
  // label only). Both levels exist to STRIP CHIPS off the rows — a header
  // saying "Business Application · 8" replaces eight identical chips, so a
  // uniform value is the best case for a header, not a reason to skip it.
  // That is why there is no row-count threshold here, unlike the relations
  // list: that is a working surface where a header costs more than a chip;
  // this is a reading surface where it costs less.
  //
  // The server sorts subtype (metamodel order) → lifecycle → name, so a plain
  // contiguous scan reproduces both levels and keeps buckets whole across
  // pages — no client-side sorting, which would undo the server's ordering.
  const peerType = otherType;

  // The subtype level is skipped entirely when NO row carries one: nothing to
  // say, so neither a header nor a chip appears.
  const hasAnySubtype = useMemo(() => rows.some((r) => !!r.subtype), [rows]);

  const buckets = useMemo(() => {
    const out: { key: string; isNoSubtype: boolean; rows: DescendantRelationRow[] }[] = [];
    for (const row of rows) {
      const key = row.subtype || NO_SUBTYPE;
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, isNoSubtype: !row.subtype, rows: [row] });
    }
    return out;
  }, [rows]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleBucket = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderRow = (row: DescendantRelationRow) => {
    const rowType = getType(row.type);
    const phase = getCurrentPhase(row.lifecycle);
    return (
    <ListItemButton
      key={row.id}
      onClick={() => goTo(row.id)}
      sx={{ alignItems: "flex-start", py: 1 }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {rowType && (
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: rowType.color,
                flexShrink: 0,
              }}
            />
          )}
          <Typography variant="body2" fontWeight={500} noWrap>
            {row.name}
          </Typography>
          {/* Lifecycle as a colour dot rather than a badge — the phase name
              lives in the tooltip, so the row keeps its information without
              carrying a second chip. Nothing renders when the card has no
              dated phase. The subtype is named once in the group header. */}
          {phase && (
            <Tooltip title={t(`common:lifecycle.${phase}`)}>
              <Box
                aria-label={t(`common:lifecycle.${phase}`)}
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  bgcolor:
                    PHASE_COLORS[phase] === "default"
                      ? "text.disabled"
                      : `${PHASE_COLORS[phase]}.main`,
                }}
              />
            </Tooltip>
          )}
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flexWrap: "wrap",
            mt: 0.5,
          }}
        >
          {/* The drawer's own "nested one level down" glyph stands
              in for the word "via" — the header explainer already
              states what these chips are, and dropping the word
              gives the chips the horizontal room. */}
          <Tooltip title={t("relations.rollup.via")}>
            <Box component="span" sx={{ display: "inline-flex", color: "text.disabled" }}>
              <MaterialSymbol icon="subdirectory_arrow_right" size={14} />
            </Box>
          </Tooltip>
          {row.via.map((v) => {
            // Accent the chip with the sub-item's card-type colour
            // so it reads as a card, not a tag. `readableTypeColor`
            // keeps admin-picked colours legible in both themes —
            // never paint a raw type colour as text.
            const viaHex = getType(v.type)?.color;
            const accent =
              viaHex && isHexColor(viaHex)
                ? readableTypeColor(viaHex, isDark)
                : undefined;
            return (
              <Tooltip key={v.id} title={t("relations.rollup.viaTooltip")}>
                <Chip
                  size="small"
                  label={v.name}
                  variant="outlined"
                  onClick={(e) => {
                    e.stopPropagation();
                    goTo(v.id);
                  }}
                  sx={{
                    height: 18,
                    fontSize: "0.65rem",
                    cursor: "pointer",
                    ...(accent && {
                      color: accent,
                      borderColor: alpha(accent, 0.5),
                      "&:hover": { bgcolor: alpha(accent, 0.08) },
                    }),
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
      </Box>
    </ListItemButton>
    );
  };

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: "100vw", sm: 460 }, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.5 }}>
          {/* Not `account_tree` — that glyph belongs to the subtype-grouping
              toggle on the relation group header. `subdirectory_arrow_right`
              is the app's existing "nested one level down" mark (EolReport,
              PortfolioReport), which is exactly what this drawer shows. */}
          <MaterialSymbol icon="subdirectory_arrow_right" size={20} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={600} noWrap>
              {t("relations.rollup.title", {
                type: otherType ? typeLabel(otherType) : otherTypeKey,
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {isSource ? relLabel(rt) : relLabel(rt, true)}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label={t("common:actions.close")}>
            <MaterialSymbol icon="close" size={20} />
          </IconButton>
        </Box>
        <Divider />

        <Box sx={{ px: 2, py: 1.25, bgcolor: "action.hover" }}>
          {/* How concentrated the roll-up is: 12 cards spread over 5 sub-items
              reads very differently from 12 all hanging off one. */}
          {total > 0 && (
            <Typography
              variant="caption"
              fontWeight={600}
              component="div"
              sx={{ mb: 0.25 }}
            >
              {t("relations.rollup.countLine", { count: total, vias: viaTotal })}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t("relations.rollup.explainer")}
          </Typography>
        </Box>
        <Divider />

        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {!loading && error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: "italic" }}>
            {t("relations.rollup.empty")}
          </Typography>
        )}

        {!loading && !error && rows.length > 0 && (
          <Box sx={{ overflowY: "auto" }}>
            {buckets.map((b) => {
              const isOpen = !collapsed.has(b.key);
              const def = b.isNoSubtype
                ? undefined
                : peerType?.subtypes?.find((s) => s.key === b.key);
              const label = b.isNoSubtype
                ? t("relations.subtype.noSubtype")
                : def
                  ? subtypeLabel(def)
                  : b.key;

              const list = (
                <List dense disablePadding>
                  {b.rows.map(renderRow)}
                </List>
              );

              // Skip the subtype level entirely when no row carries one —
              // nothing to say, so no header and no chip.
              if (!hasAnySubtype) return <Box key={b.key}>{list}</Box>;

              return (
                <Box key={b.key}>
                  <Box
                    component="button"
                    onClick={() => toggleBucket(b.key)}
                    sx={{
                      all: "unset",
                      boxSizing: "border-box",
                      width: "100%",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      px: 2,
                      py: 0.5,
                      bgcolor: "background.default",
                      borderTop: "1px solid",
                      borderColor: "divider",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <MaterialSymbol icon={isOpen ? "expand_more" : "chevron_right"} size={16} />
                    <Typography
                      variant="caption"
                      fontWeight={600}
                      color={b.isNoSubtype ? "text.disabled" : "text.secondary"}
                      sx={{ flex: 1, fontStyle: b.isNoSubtype ? "italic" : "normal" }}
                    >
                      {label}
                    </Typography>
                    <Chip
                      size="small"
                      label={b.rows.length}
                      variant="outlined"
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  </Box>
                  <Collapse in={isOpen} unmountOnExit>
                    {list}
                  </Collapse>
                </Box>
              );
            })}
          </Box>
        )}

        {!loading && !error && pageCount > 1 && (
          <>
            <Divider />
            <Box sx={{ display: "flex", justifyContent: "center", py: 1.5 }}>
              <Pagination
                size="small"
                count={pageCount}
                page={page}
                onChange={(_, p) => setPage(p)}
              />
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}
