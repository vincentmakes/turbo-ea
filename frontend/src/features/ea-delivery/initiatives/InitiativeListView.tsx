import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import MaterialSymbol from "@/components/MaterialSymbol";
import { INITIATIVE_STATUS_COLORS } from "./constants";
import ArtefactColumns from "./ArtefactColumns";
import { flattenTree, type InitiativeTreeNode } from "./useInitiativeData";
import type { SoAW, DiagramSummary } from "@/types";

interface Props {
  tree: InitiativeTreeNode[];
  onLinkDiagrams: (initiativeId: string) => void;
  onCreateArtefact: (e: React.MouseEvent<HTMLElement>, initiativeId: string) => void;
  onUnlinkDiagram: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu: (anchor: HTMLElement, soaw: SoAW) => void;
}

export default function InitiativeListView({
  tree,
  onLinkDiagrams,
  onCreateArtefact,
  onUnlinkDiagram,
  onSoawContextMenu,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));

  const flat = flattenTree(tree);

  const statusLabels: Record<string, string> = {
    onTrack: t("initiativeStatus.onTrack"),
    atRisk: t("initiativeStatus.atRisk"),
    offTrack: t("initiativeStatus.offTrack"),
    onHold: t("initiativeStatus.onHold"),
    completed: t("initiativeStatus.completed"),
  };

  const totalCols = 7;

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: "action.hover" }}>
            <TableCell sx={{ fontWeight: 600 }}>{t("list.name")}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t("list.subtype")}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t("list.status")}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t("artefactGroup.soaws")}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t("artefactGroup.diagrams")}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{t("artefactGroup.adrs")}</TableCell>
            <TableCell sx={{ fontWeight: 600, width: 80 }}>{t("list.actions")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {flat.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={totalCols}
                sx={{ textAlign: "center", py: 4, color: "text.secondary" }}
              >
                {t("empty.noMatch")}
              </TableCell>
            </TableRow>
          )}
          {flat.map((node) => {
            const { initiative, soaws, diagrams, adrs, level } = node;
            const attrs = (initiative.attributes ?? {}) as Record<string, unknown>;
            const initStatus = attrs.initiativeStatus as string | undefined;
            const artefactCount = soaws.length + diagrams.length + adrs.length;
            const isRowOpen = expandedRows[initiative.id] ?? false;
            const isArchived = initiative.status === "ARCHIVED";

            return (
              <React.Fragment key={initiative.id}>
                <TableRow
                  hover
                  sx={{
                    cursor: "pointer",
                    opacity: isArchived ? 0.6 : 1,
                    ...(isRowOpen && { "& > td": { borderBottom: "none" } }),
                  }}
                  onClick={() => navigate(`/cards/${initiative.id}`)}
                >
                  {/* Name */}
                  <TableCell>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        pl: level * 3,
                      }}
                    >
                      <MaterialSymbol icon="rocket_launch" size={18} color="#33cc58" />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {initiative.name}
                      </Typography>
                      {isArchived && (
                        <Chip
                          label={t("common:status.archived")}
                          size="small"
                          variant="outlined"
                          color="default"
                          sx={{ height: 20, fontSize: "0.7rem" }}
                        />
                      )}
                    </Box>
                  </TableCell>

                  {/* Subtype */}
                  <TableCell>
                    {initiative.subtype ? (
                      <Chip
                        label={initiative.subtype}
                        size="small"
                        sx={{ textTransform: "capitalize" }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    {initStatus ? (
                      <Chip
                        label={statusLabels[initStatus] ?? initStatus}
                        size="small"
                        sx={{
                          bgcolor: INITIATIVE_STATUS_COLORS[initStatus] ?? "#9e9e9e",
                          color: "#fff",
                          fontWeight: 500,
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>

                  {/* SoAWs */}
                  <TableCell
                    onClick={(e) => {
                      e.stopPropagation();
                      if (artefactCount > 0) toggleRow(initiative.id);
                    }}
                    sx={
                      artefactCount > 0
                        ? { cursor: "pointer", "&:hover": { bgcolor: "action.selected" } }
                        : undefined
                    }
                  >
                    {soaws.length > 0 ? (
                      <Chip
                        icon={<MaterialSymbol icon="description" size={14} />}
                        label={soaws.length}
                        size="small"
                        variant="outlined"
                        sx={{ height: 22, fontSize: "0.75rem" }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>

                  {/* Diagrams */}
                  <TableCell
                    onClick={(e) => {
                      e.stopPropagation();
                      if (artefactCount > 0) toggleRow(initiative.id);
                    }}
                    sx={
                      artefactCount > 0
                        ? { cursor: "pointer", "&:hover": { bgcolor: "action.selected" } }
                        : undefined
                    }
                  >
                    {diagrams.length > 0 ? (
                      <Chip
                        icon={<MaterialSymbol icon="schema" size={14} />}
                        label={diagrams.length}
                        size="small"
                        variant="outlined"
                        color="info"
                        sx={{ height: 22, fontSize: "0.75rem" }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>

                  {/* ADRs */}
                  <TableCell
                    onClick={(e) => {
                      e.stopPropagation();
                      if (artefactCount > 0) toggleRow(initiative.id);
                    }}
                    sx={
                      artefactCount > 0
                        ? { cursor: "pointer", "&:hover": { bgcolor: "action.selected" } }
                        : undefined
                    }
                  >
                    {adrs.length > 0 ? (
                      <Chip
                        icon={<MaterialSymbol icon="gavel" size={14} />}
                        label={adrs.length}
                        size="small"
                        variant="outlined"
                        color="primary"
                        sx={{ height: 22, fontSize: "0.75rem" }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>

                  {/* Actions */}
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Box sx={{ display: "flex" }}>
                      <Tooltip title={t("card.createArtefactTooltip")}>
                        <IconButton
                          size="small"
                          onClick={(e) => onCreateArtefact(e, initiative.id)}
                        >
                          <MaterialSymbol icon="add_circle_outline" size={18} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t("card.linkDiagrams")}>
                        <IconButton
                          size="small"
                          onClick={() => onLinkDiagrams(initiative.id)}
                        >
                          <MaterialSymbol icon="link" size={18} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>

                {/* Expandable artefact sub-row */}
                {artefactCount > 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={totalCols}
                      sx={{ py: 0, bgcolor: isRowOpen ? "action.hover" : "transparent" }}
                    >
                      <Collapse in={isRowOpen} timeout="auto" unmountOnExit>
                        <ArtefactColumns
                          soaws={soaws}
                          diagrams={diagrams}
                          adrs={adrs}
                          initiativeId={initiative.id}
                          onUnlinkDiagram={onUnlinkDiagram}
                          onSoawContextMenu={onSoawContextMenu}
                        />
                      </Collapse>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
