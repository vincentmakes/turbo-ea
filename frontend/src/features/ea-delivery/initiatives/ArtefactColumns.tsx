import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MuiCard from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { SOAW_STATUS_COLORS } from "./constants";
import type { SoAW, DiagramSummary, ArchitectureDecision } from "@/types";

interface Props {
  soaws: SoAW[];
  diagrams: DiagramSummary[];
  adrs: ArchitectureDecision[];
  initiativeId: string;
  onUnlinkDiagram?: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu?: (anchor: HTMLElement, soaw: SoAW) => void;
}

export default function ArtefactColumns({
  soaws,
  diagrams,
  adrs,
  initiativeId,
  onUnlinkDiagram,
  onSoawContextMenu,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();

  const soawStatusLabels: Record<string, string> = {
    draft: t("status.draft"),
    in_review: t("status.inReview"),
    approved: t("status.approved"),
    signed: t("status.signed"),
  };

  const renderColumnHeader = (icon: string, color: string, label: string, count: number) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
      <MaterialSymbol icon={icon} size={18} color={color} />
      <Typography variant="overline" sx={{ lineHeight: 1, fontWeight: 600 }}>
        {label} ({count})
      </Typography>
    </Box>
  );

  const renderEmptyPlaceholder = (label: string) => (
    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", py: 1 }}>
      {label}
    </Typography>
  );

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
        gap: 2,
        py: 1.5,
        px: 1,
      }}
    >
      {/* SoAW column */}
      <Box>
        {renderColumnHeader("description", "#e65100", t("artefactGroup.soaws"), soaws.length)}
        {soaws.length === 0 && renderEmptyPlaceholder(t("artefactGroup.noSoaws"))}
        {soaws.map((s) => (
          <MuiCard key={s.id} variant="outlined" sx={{ mb: 1 }}>
            <CardActionArea
              onClick={() => navigate(`/ea-delivery/soaw/${s.id}`)}
              sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
            >
              <MaterialSymbol icon="description" size={20} color="#e65100" />
              <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
                {s.name}
                {s.revision_number > 1 && (
                  <Typography
                    component="span"
                    sx={{ ml: 0.5, fontSize: "0.8rem", color: "text.secondary" }}
                  >
                    {t("soaw.revision", { number: s.revision_number })}
                  </Typography>
                )}
              </Typography>
              <Chip
                label={soawStatusLabels[s.status] ?? s.status}
                size="small"
                color={SOAW_STATUS_COLORS[s.status] ?? "default"}
              />
              <Tooltip title={t("soaw.previewTooltip")}>
                <IconButton
                  size="small"
                  sx={{ ml: 0.5 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    navigate(`/ea-delivery/soaw/${s.id}/preview`);
                  }}
                >
                  <MaterialSymbol icon="visibility" size={18} />
                </IconButton>
              </Tooltip>
              {onSoawContextMenu && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onSoawContextMenu(e.currentTarget, s);
                  }}
                >
                  <MaterialSymbol icon="more_vert" size={18} />
                </IconButton>
              )}
            </CardActionArea>
          </MuiCard>
        ))}
      </Box>

      {/* Diagrams column */}
      <Box>
        {renderColumnHeader("schema", "#1976d2", t("artefactGroup.diagrams"), diagrams.length)}
        {diagrams.length === 0 && renderEmptyPlaceholder(t("artefactGroup.noDiagrams"))}
        {diagrams.map((d) => (
          <MuiCard key={d.id} variant="outlined" sx={{ mb: 1 }}>
            <CardActionArea
              onClick={() => navigate(`/diagrams/${d.id}`)}
              sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
            >
              <MaterialSymbol icon="schema" size={20} color="#1976d2" />
              <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
                {d.name}
              </Typography>
              {d.card_ids.length > 1 && (
                <Tooltip title={t("diagram.linkedToCards", { count: d.card_ids.length })}>
                  <Chip
                    label={t("diagram.linkedToCards", { count: d.card_ids.length })}
                    size="small"
                    variant="outlined"
                    sx={{ mr: 0.5 }}
                  />
                </Tooltip>
              )}
              {onUnlinkDiagram && (
                <Tooltip title={t("diagram.unlinkTooltip")}>
                  <IconButton
                    size="small"
                    sx={{ ml: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onUnlinkDiagram(d, initiativeId);
                    }}
                  >
                    <MaterialSymbol icon="link_off" size={18} />
                  </IconButton>
                </Tooltip>
              )}
            </CardActionArea>
          </MuiCard>
        ))}
      </Box>

      {/* ADR column */}
      <Box>
        {renderColumnHeader("gavel", "#1976d2", t("artefactGroup.adrs"), adrs.length)}
        {adrs.length === 0 && renderEmptyPlaceholder(t("artefactGroup.noAdrs"))}
        {adrs.map((a) => (
          <MuiCard key={a.id} variant="outlined" sx={{ mb: 1 }}>
            <CardActionArea
              onClick={() => navigate(`/ea-delivery/adr/${a.id}`)}
              sx={{ p: 1.5, display: "flex", justifyContent: "flex-start" }}
            >
              <MaterialSymbol icon="gavel" size={20} color="#1976d2" />
              <Chip
                label={a.reference_number}
                size="small"
                variant="outlined"
                sx={{ ml: 1, fontFamily: "monospace", fontSize: "0.7rem" }}
              />
              <Typography sx={{ ml: 1, fontSize: "0.9rem", flex: 1 }}>
                {a.title}
              </Typography>
              <Chip
                label={soawStatusLabels[a.status] ?? a.status}
                size="small"
                color={SOAW_STATUS_COLORS[a.status] ?? "default"}
              />
            </CardActionArea>
          </MuiCard>
        ))}
      </Box>
    </Box>
  );
}
