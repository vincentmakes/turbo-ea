import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MuiCard from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { INITIATIVE_STATUS_COLORS } from "./constants";
import ArtefactColumns from "./ArtefactColumns";
import type { InitiativeTreeNode } from "./useInitiativeData";
import type { SoAW, DiagramSummary } from "@/types";

interface Props {
  node: InitiativeTreeNode;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  favorites: Set<string>;
  expandedIds: Record<string, boolean>;
  onLinkDiagrams: (initiativeId: string) => void;
  onCreateArtefact: (e: React.MouseEvent<HTMLElement>, initiativeId: string) => void;
  onUnlinkDiagram: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu: (anchor: HTMLElement, soaw: SoAW) => void;
  onCreateSoaw: (initiativeId: string) => void;
  onCreateAdr: (initiative: { id: string; name: string; type: string }) => void;
}

export default function InitiativeCard({
  node,
  expanded,
  onToggleExpand,
  isFavorite,
  onToggleFavorite,
  favorites,
  expandedIds,
  onLinkDiagrams,
  onCreateArtefact,
  onUnlinkDiagram,
  onSoawContextMenu,
  onCreateSoaw,
  onCreateAdr,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();

  const { initiative, diagrams, soaws, adrs, children, level } = node;
  const attrs = (initiative.attributes ?? {}) as Record<string, unknown>;
  const initStatus = attrs.initiativeStatus as string | undefined;
  const artefactCount = soaws.length + diagrams.length + adrs.length;
  const isArchived = initiative.status === "ARCHIVED";

  const statusLabels: Record<string, string> = {
    onTrack: t("initiativeStatus.onTrack"),
    atRisk: t("initiativeStatus.atRisk"),
    offTrack: t("initiativeStatus.offTrack"),
    onHold: t("initiativeStatus.onHold"),
    completed: t("initiativeStatus.completed"),
  };

  return (
    <Box sx={{ ml: level * 3 }}>
      <MuiCard
        sx={{
          mb: 1.5,
          borderLeft: `4px solid ${isArchived ? "#999" : "#33cc58"}`,
          opacity: isArchived ? 0.7 : 1,
        }}
      >
        {/* Row 1: Name + actions */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            px: 2,
            pt: 1.5,
            pb: 0.5,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
          onClick={() => onToggleExpand(initiative.id)}
        >
          <IconButton size="small" sx={{ mr: 1 }}>
            <MaterialSymbol icon={expanded ? "expand_more" : "chevron_right"} size={20} />
          </IconButton>

          {/* Favorite star */}
          <Tooltip
            title={isFavorite ? t("favorite.remove") : t("favorite.add")}
          >
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(initiative.id);
              }}
              sx={{ mr: 0.5 }}
            >
              <MaterialSymbol
                icon="kid_star"
                size={20}
                color={isFavorite ? "#f5a623" : "#ccc"}
              />
            </IconButton>
          </Tooltip>

          <MaterialSymbol
            icon="rocket_launch"
            size={22}
            color={isArchived ? "#999" : "#33cc58"}
          />
          <Typography
            sx={{
              ml: 1,
              fontWeight: 600,
              flex: 1,
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
            }}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/cards/${initiative.id}`);
            }}
          >
            {initiative.name}
          </Typography>

          {/* Actions */}
          <Tooltip title={t("card.linkDiagramsTooltip")}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onLinkDiagrams(initiative.id);
              }}
              sx={{ mr: 0.5 }}
            >
              <MaterialSymbol icon="link" size={20} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("card.createArtefactTooltip")}>
            <IconButton
              size="small"
              aria-label={t("card.createArtefactTooltip")}
              onClick={(e) => {
                e.stopPropagation();
                onCreateArtefact(e, initiative.id);
              }}
            >
              <MaterialSymbol icon="add_circle_outline" size={20} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Row 2: Chips */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 2, pb: 1.5, pl: 8 }}>
          {isArchived && (
            <Chip
              label={t("common:status.archived")}
              size="small"
              variant="outlined"
              color="default"
              sx={{ height: 22, fontSize: "0.75rem" }}
            />
          )}
          {initiative.subtype && (
            <Chip
              label={initiative.subtype}
              size="small"
              sx={{ textTransform: "capitalize", height: 22, fontSize: "0.75rem" }}
            />
          )}
          {initStatus && (
            <Chip
              label={statusLabels[initStatus] ?? initStatus}
              size="small"
              sx={{
                bgcolor: INITIATIVE_STATUS_COLORS[initStatus] ?? "#9e9e9e",
                color: "#fff",
                fontWeight: 500,
                height: 22,
                fontSize: "0.75rem",
              }}
            />
          )}
          {children.length > 0 && (
            <Chip
              icon={<MaterialSymbol icon="account_tree" size={14} />}
              label={t("hierarchy.children", { count: children.length })}
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: "0.75rem" }}
            />
          )}

          <Box sx={{ flex: 1 }} />

          {/* Artefact chips */}
          {soaws.length > 0 && (
            <Chip
              icon={<MaterialSymbol icon="description" size={14} />}
              label={t("list.soawCount", { count: soaws.length })}
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: "0.75rem" }}
            />
          )}
          {diagrams.length > 0 && (
            <Chip
              icon={<MaterialSymbol icon="schema" size={14} />}
              label={t("list.diagramCount", { count: diagrams.length })}
              size="small"
              variant="outlined"
              color="info"
              sx={{ height: 22, fontSize: "0.75rem" }}
            />
          )}
          {adrs.length > 0 && (
            <Chip
              icon={<MaterialSymbol icon="gavel" size={14} />}
              label={t("list.adrCount", { count: adrs.length })}
              size="small"
              variant="outlined"
              color="primary"
              sx={{ height: 22, fontSize: "0.75rem" }}
            />
          )}
        </Box>

        {/* Expanded: 3-column artefact layout */}
        <Collapse in={expanded}>
          <Box sx={{ px: 2, pb: 2 }}>
            {artefactCount === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("empty.noArtefacts")}{" "}
                <Box
                  component="span"
                  sx={{
                    color: "primary.main",
                    cursor: "pointer",
                    "&:hover": { textDecoration: "underline" },
                  }}
                  onClick={() => onLinkDiagrams(initiative.id)}
                >
                  {t("empty.linkDiagram")}
                </Box>
                {t("empty.or")}
                <Box
                  component="span"
                  sx={{
                    color: "primary.main",
                    cursor: "pointer",
                    "&:hover": { textDecoration: "underline" },
                  }}
                  onClick={() => onCreateSoaw(initiative.id)}
                >
                  {t("empty.createSoaw")}
                </Box>
                {t("empty.or")}
                <Box
                  component="span"
                  sx={{
                    color: "primary.main",
                    cursor: "pointer",
                    "&:hover": { textDecoration: "underline" },
                  }}
                  onClick={() =>
                    onCreateAdr({
                      id: initiative.id,
                      name: initiative.name,
                      type: initiative.type,
                    })
                  }
                >
                  {t("empty.createAdr")}
                </Box>
                .
              </Typography>
            ) : (
              <ArtefactColumns
                soaws={soaws}
                diagrams={diagrams}
                adrs={adrs}
                initiativeId={initiative.id}
                onUnlinkDiagram={onUnlinkDiagram}
                onSoawContextMenu={onSoawContextMenu}
              />
            )}
          </Box>
        </Collapse>
      </MuiCard>

      {/* Render children recursively */}
      {children.map((child) => (
        <InitiativeCard
          key={child.initiative.id}
          node={child}
          expanded={!!expandedIds[child.initiative.id]}
          onToggleExpand={onToggleExpand}
          isFavorite={favorites.has(child.initiative.id)}
          onToggleFavorite={onToggleFavorite}
          favorites={favorites}
          expandedIds={expandedIds}
          onLinkDiagrams={onLinkDiagrams}
          onCreateArtefact={onCreateArtefact}
          onUnlinkDiagram={onUnlinkDiagram}
          onSoawContextMenu={onSoawContextMenu}
          onCreateSoaw={onCreateSoaw}
          onCreateAdr={onCreateAdr}
        />
      ))}
    </Box>
  );
}
