import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { CARD_TYPE_COLORS } from "@/theme/tokens";
import { INITIATIVE_STATUS_COLORS } from "./constants";
import DeliverableSection, {
  type DeliverableKind,
} from "./DeliverableSection";
import NewArtefactSplitButton from "./NewArtefactSplitButton";
import type {
  ArchitectureDecision,
  DiagramSummary,
  SoAW,
} from "@/types";
import type { InitiativeTreeNode } from "./useInitiativeData";

interface UnlinkedSelection {
  kind: "unlinked";
  soaws: SoAW[];
  diagrams: DiagramSummary[];
  adrs: ArchitectureDecision[];
}

interface InitiativeSelection {
  kind: "initiative";
  node: InitiativeTreeNode;
}

export type WorkspaceSelection = InitiativeSelection | UnlinkedSelection | null;

interface Props {
  selection: WorkspaceSelection;
  onSelectInitiative: (id: string) => void;
  onCreateArtefact: (kind: DeliverableKind, initiativeId?: string) => void;
  onLinkDiagrams: (initiativeId: string) => void;
  onUnlinkDiagram: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu: (anchor: HTMLElement, soaw: SoAW) => void;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (id: string) => void;
}

/**
 * Right-pane workspace. Renders the selected initiative's deliverables,
 * children, and key details — or the orphaned-artefacts view for the
 * synthetic "Unlinked" selection — or an empty-state CTA when nothing is
 * selected yet.
 */
export default function InitiativeWorkspace({
  selection,
  onSelectInitiative,
  onCreateArtefact,
  onLinkDiagrams,
  onUnlinkDiagram,
  onSoawContextMenu,
  isFavorite,
  onToggleFavorite,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);

  if (selection === null) {
    return <EmptyState onCreate={onCreateArtefact} />;
  }

  if (selection.kind === "unlinked") {
    return (
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          <MaterialSymbol icon="folder_open" size={28} color="#999" />
          <Typography variant="h5" fontWeight={600}>
            {t("sidebar.unlinked")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("workspace.unlinkedSubtitle")}
        </Typography>
        <DeliverableSection
          kind="soaw"
          items={selection.soaws}
          onSoawContextMenu={onSoawContextMenu}
        />
        <DeliverableSection kind="diagram" items={selection.diagrams} />
        <DeliverableSection kind="adr" items={selection.adrs} />
      </Box>
    );
  }

  return (
    <InitiativeView
      node={selection.node}
      onSelectInitiative={onSelectInitiative}
      onCreateArtefact={onCreateArtefact}
      onLinkDiagrams={onLinkDiagrams}
      onUnlinkDiagram={onUnlinkDiagram}
      onSoawContextMenu={onSoawContextMenu}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

// ── Initiative view ───────────────────────────────────────────────────

function InitiativeView({
  node,
  onSelectInitiative,
  onCreateArtefact,
  onLinkDiagrams,
  onUnlinkDiagram,
  onSoawContextMenu,
  isFavorite,
  onToggleFavorite,
}: {
  node: InitiativeTreeNode;
  onSelectInitiative: (id: string) => void;
  onCreateArtefact: (kind: DeliverableKind, initiativeId?: string) => void;
  onLinkDiagrams: (initiativeId: string) => void;
  onUnlinkDiagram: (diagram: DiagramSummary, initiativeId: string) => void;
  onSoawContextMenu: (anchor: HTMLElement, soaw: SoAW) => void;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { initiative, children, soaws, diagrams, adrs } = node;
  const attrs = (initiative.attributes ?? {}) as Record<string, unknown>;
  const initStatus = attrs.initiativeStatus as string | undefined;
  const isArchived = initiative.status === "ARCHIVED";
  const fav = isFavorite(initiative.id);

  const statusLabels: Record<string, string> = {
    onTrack: t("initiativeStatus.onTrack"),
    atRisk: t("initiativeStatus.atRisk"),
    offTrack: t("initiativeStatus.offTrack"),
    onHold: t("initiativeStatus.onHold"),
    completed: t("initiativeStatus.completed"),
  };

  return (
    <Box sx={{ p: 2 }}>
      {/* Header strip */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
        <MaterialSymbol
          icon="rocket_launch"
          size={32}
          color={isArchived ? "#999" : CARD_TYPE_COLORS.Initiative}
        />
        <Typography variant="h5" fontWeight={600} sx={{ flex: 1, minWidth: 0 }} noWrap>
          {initiative.name}
        </Typography>
        <Tooltip
          title={fav ? t("favorite.remove") : t("favorite.add")}
        >
          <IconButton size="small" onClick={() => onToggleFavorite(initiative.id)}>
            <MaterialSymbol
              icon="cards_star"
              size={22}
              color={fav ? "#f5a623" : "currentColor"}
            />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workspace.openCard")}>
          <IconButton size="small" onClick={() => setPreviewOpen(true)}>
            <MaterialSymbol icon="visibility" size={20} />
          </IconButton>
        </Tooltip>
      </Box>

      <CardDetailSidePanel
        cardId={previewOpen ? initiative.id : null}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />

      {/* Status chips */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2 }}>
        {isArchived && (
          <Chip
            label={t("common:status.archived")}
            size="small"
            variant="outlined"
            sx={{ height: 22 }}
          />
        )}
        {initiative.subtype && (
          <Chip
            label={initiative.subtype}
            size="small"
            sx={{ textTransform: "capitalize", height: 22 }}
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
            }}
          />
        )}
      </Box>

      {/* Deliverables section */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <Typography variant="h6" fontWeight={600} sx={{ flex: 1 }}>
            {t("workspace.section.deliverables")}
          </Typography>
          <NewArtefactSplitButton
            initiativeId={initiative.id}
            onSelect={onCreateArtefact}
            variant="text"
            label={t("common:actions.add")}
          />
        </Box>
        <DeliverableSection
          kind="soaw"
          items={soaws}
          initiativeId={initiative.id}
          onAdd={onCreateArtefact}
          onSoawContextMenu={onSoawContextMenu}
        />
        <DeliverableSection
          kind="diagram"
          items={diagrams}
          initiativeId={initiative.id}
          onAdd={onCreateArtefact}
          onUnlinkDiagram={onUnlinkDiagram}
          onLinkDiagrams={onLinkDiagrams}
        />
        <DeliverableSection
          kind="adr"
          items={adrs}
          initiativeId={initiative.id}
          onAdd={onCreateArtefact}
        />
      </Box>

      {/* Children section */}
      {children.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
            {t("workspace.section.children")}
          </Typography>
          <Box>
            {children.map((c) => (
              <Box
                key={c.initiative.id}
                onClick={() => onSelectInitiative(c.initiative.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <MaterialSymbol
                  icon="rocket_launch"
                  size={18}
                  color={CARD_TYPE_COLORS.Initiative}
                />
                <Typography sx={{ fontSize: "0.9rem", flex: 1 }} noWrap>
                  {c.initiative.name}
                </Typography>
                {c.initiative.subtype && (
                  <Chip
                    label={c.initiative.subtype}
                    size="small"
                    sx={{ textTransform: "capitalize", height: 20 }}
                  />
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Details section */}
      <Box>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
          {t("workspace.section.details")}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {initiative.subtype && (
            <DetailRow
              label={t("filter.subtype")}
              value={initiative.subtype}
              capitalize
            />
          )}
          <DetailRow
            label={t("filter.status")}
            value={
              isArchived ? t("common:status.archived") : t("common:status.active")
            }
          />
          {initiative.description && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t("common:labels.description")}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {initiative.description}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function DetailRow({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", gap: 1 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 90, textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ textTransform: capitalize ? "capitalize" : "none" }}
      >
        {value}
      </Typography>
    </Box>
  );
}

// ── Empty state ───────────────────────────────────────────────────────

function EmptyState({
  onCreate,
}: {
  onCreate: (kind: DeliverableKind, initiativeId?: string) => void;
}) {
  const { t } = useTranslation(["delivery", "common"]);
  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 96px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        p: 4,
        textAlign: "center",
      }}
    >
      <MaterialSymbol icon="design_services" size={48} color="action.disabled" />
      <Typography variant="h6" fontWeight={500}>
        {t("workspace.empty.title")}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 420 }}
      >
        {t("workspace.empty.subtitle")}
      </Typography>
      <NewArtefactSplitButton onSelect={onCreate} variant="contained" />
    </Box>
  );
}
