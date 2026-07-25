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
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Pagination from "@mui/material/Pagination";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel, useRelationLabel, useSubtypeLabel } from "@/hooks/useResolveLabel";
import type {
  DescendantRelationRow,
  DescendantRelationsResponse,
  RelationType,
} from "@/types";

const PAGE_SIZE = 50;

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
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const relLabel = useRelationLabel();
  const subtypeLabel = useSubtypeLabel();

  const [rows, setRows] = useState<DescendantRelationRow[]>([]);
  const [total, setTotal] = useState(0);
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

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: { xs: "100vw", sm: 460 }, display: "flex", flexDirection: "column" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.5 }}>
          <MaterialSymbol icon="account_tree" size={20} />
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
          <List dense disablePadding sx={{ overflowY: "auto" }}>
            {rows.map((row) => {
              const rowType = getType(row.type);
              const subDef = row.subtype
                ? rowType?.subtypes?.find((s) => s.key === row.subtype)
                : undefined;
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
                      {subDef && (
                        <Chip
                          size="small"
                          label={subtypeLabel(subDef)}
                          variant="outlined"
                          sx={{ height: 18, fontSize: "0.65rem" }}
                        />
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
                      <Typography variant="caption" color="text.secondary">
                        {t("relations.rollup.via")}
                      </Typography>
                      {row.via.map((v) => (
                        <Tooltip key={v.id} title={t("relations.rollup.viaTooltip")}>
                          <Chip
                            size="small"
                            label={v.name}
                            variant="outlined"
                            onClick={(e) => {
                              e.stopPropagation();
                              goTo(v.id);
                            }}
                            sx={{ height: 18, fontSize: "0.65rem", cursor: "pointer" }}
                          />
                        </Tooltip>
                      ))}
                    </Box>
                  </Box>
                </ListItemButton>
              );
            })}
          </List>
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
