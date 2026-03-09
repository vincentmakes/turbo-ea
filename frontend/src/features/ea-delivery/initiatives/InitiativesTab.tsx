import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import MuiCard from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import InputAdornment from "@mui/material/InputAdornment";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import InitiativeCard from "./InitiativeCard";
import InitiativeListView from "./InitiativeListView";
import ArtefactColumns from "./ArtefactColumns";
import { useInitiativeData } from "./useInitiativeData";
import type { SoAW, DiagramSummary } from "@/types";

type ViewMode = "cards" | "list";

interface Props {
  onCreateSoaw: (initiativeId: string) => void;
  onCreateAdr: (preLinked: { id: string; name: string; type: string }[]) => void;
  onLinkDiagrams: (initiativeId: string) => void;
  onCreateArtefact: (e: React.MouseEvent<HTMLElement>, initiativeId: string) => void;
  onUnlinkDiagram: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu: (anchor: HTMLElement, soaw: SoAW) => void;
  /** Expose data hook to parent for dialog logic */
  onDataReady?: (data: ReturnType<typeof useInitiativeData>) => void;
}

export default function InitiativesTab({
  onCreateSoaw,
  onCreateAdr,
  onLinkDiagrams,
  onCreateArtefact,
  onUnlinkDiagram,
  onSoawContextMenu,
  onDataReady,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const { types: metamodelTypes } = useMetamodel();
  const rl = useResolveLabel();

  const data = useInitiativeData();
  const {
    tree,
    loading,
    error,
    setError,
    initiatives,
    filteredInitiatives,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    subtypeFilter,
    setSubtypeFilter,
    unlinkedSoaws,
    unlinkedDiagrams,
    unlinkedAdrs,
    soaws,
    diagrams,
  } = data;

  // Expose data to parent on mount / change
  React.useEffect(() => {
    onDataReady?.(data);
  }, [data, onDataReady]);

  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [unlinkedExpanded, setUnlinkedExpanded] = useState(false);

  const initiativeType = useMemo(
    () => metamodelTypes.find((t) => t.key === "Initiative"),
    [metamodelTypes],
  );
  const subtypes = initiativeType?.subtypes ?? [];

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Filter bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <TextField
          size="small"
          placeholder={t("header.searchInitiatives")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 220 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={20} />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          select
          size="small"
          label={t("filter.status")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "ACTIVE" | "ARCHIVED" | "")}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="ACTIVE">{t("filter.active")}</MenuItem>
          <MenuItem value="ARCHIVED">{t("filter.archived")}</MenuItem>
          <MenuItem value="">{t("filter.all")}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={t("filter.subtype")}
          value={subtypeFilter}
          onChange={(e) => setSubtypeFilter(e.target.value)}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="">{t("filter.allSubtypes")}</MenuItem>
          {subtypes.map((st) => (
            <MenuItem key={st.key} value={st.key}>
              {rl(st.key, st.translations)}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ flex: 1 }} />

        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          {t("header.resultCount", { count: filteredInitiatives.length })}
        </Typography>

        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
        >
          <ToggleButton value="cards">
            <Tooltip title={t("view.cardView")}>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="dashboard" size={20} />
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="list">
            <Tooltip title={t("view.listView")}>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <MaterialSymbol icon="view_list" size={20} />
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Empty state */}
      {initiatives.length === 0 && soaws.length === 0 && diagrams.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("empty.noInitiatives")}
        </Alert>
      )}

      {/* List view */}
      {viewMode === "list" && (
        <InitiativeListView
          tree={tree}
          onLinkDiagrams={onLinkDiagrams}
          onCreateArtefact={onCreateArtefact}
          onUnlinkDiagram={onUnlinkDiagram}
          onSoawContextMenu={onSoawContextMenu}
        />
      )}

      {/* Cards view */}
      {viewMode === "cards" && (
        <>
          {filteredInitiatives.length === 0 && initiatives.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t("empty.noMatch")}
            </Alert>
          )}

          {tree.map((node, idx) => (
            <InitiativeCard
              key={node.initiative.id}
              node={node}
              defaultExpanded={idx === 0}
              onLinkDiagrams={onLinkDiagrams}
              onCreateArtefact={onCreateArtefact}
              onUnlinkDiagram={onUnlinkDiagram}
              onSoawContextMenu={onSoawContextMenu}
              onCreateSoaw={onCreateSoaw}
              onCreateAdr={(init) => onCreateAdr([init])}
            />
          ))}

          {/* Unlinked artefacts */}
          {(unlinkedSoaws.length > 0 ||
            unlinkedDiagrams.length > 0 ||
            unlinkedAdrs.length > 0) && (
            <MuiCard sx={{ mb: 2, borderLeft: "4px solid #999" }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 2,
                  py: 1.5,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={() => setUnlinkedExpanded((p) => !p)}
              >
                <IconButton size="small" sx={{ mr: 1 }}>
                  <MaterialSymbol
                    icon={unlinkedExpanded ? "expand_more" : "chevron_right"}
                    size={20}
                  />
                </IconButton>
                <MaterialSymbol icon="folder_open" size={22} color="#999" />
                <Typography
                  sx={{ ml: 1, fontWeight: 600, flex: 1, color: "text.secondary" }}
                >
                  {t("unlinked.title")}
                </Typography>
                <Chip
                  label={t("card.artefactCount", {
                    count:
                      unlinkedSoaws.length + unlinkedDiagrams.length + unlinkedAdrs.length,
                  })}
                  size="small"
                  variant="outlined"
                />
              </Box>
              <Collapse in={unlinkedExpanded}>
                <Box sx={{ px: 2, pb: 2 }}>
                  <ArtefactColumns
                    soaws={unlinkedSoaws}
                    diagrams={unlinkedDiagrams}
                    adrs={unlinkedAdrs}
                    initiativeId=""
                  />
                </Box>
              </Collapse>
            </MuiCard>
          )}
        </>
      )}
    </>
  );
}
