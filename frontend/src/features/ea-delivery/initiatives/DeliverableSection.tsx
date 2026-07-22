import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { CARD_TYPE_COLORS, STATUS_COLORS } from "@/theme/tokens";
import { SOAW_STATUS_COLORS } from "./constants";
import type {
  ArchitectureDecision,
  TransitionPlan,
  DiagramSummary,
  SoAW,
} from "@/types";

export type DeliverableKind = "soaw" | "diagram" | "adr" | "plan";

interface BaseProps {
  initiativeId?: string;
  onAdd?: (kind: DeliverableKind, initiativeId?: string) => void;
}

interface SoawProps extends BaseProps {
  kind: "soaw";
  items: SoAW[];
  onSoawContextMenu?: (anchor: HTMLElement, soaw: SoAW) => void;
}

interface DiagramProps extends BaseProps {
  kind: "diagram";
  items: DiagramSummary[];
  onUnlinkDiagram?: (diagram: DiagramSummary, initiativeId: string) => void;
  onLinkDiagrams?: (initiativeId: string) => void;
}

interface AdrProps extends BaseProps {
  kind: "adr";
  items: ArchitectureDecision[];
}

interface PlanProps extends BaseProps {
  kind: "plan";
  items: TransitionPlan[];
  onPlanContextMenu?: (anchor: HTMLElement, plan: TransitionPlan) => void;
}

type Props = SoawProps | DiagramProps | AdrProps | PlanProps;

const KIND_META: Record<
  DeliverableKind,
  { icon: string; color: string }
> = {
  soaw: { icon: "description", color: "#e65100" },
  diagram: { icon: "schema", color: CARD_TYPE_COLORS.Application },
  adr: { icon: "gavel", color: STATUS_COLORS.info },
  plan: { icon: "route", color: "#6a1b9a" },
};

/**
 * One artefact group: header (icon · label · count · "+ Add") and a stack of
 * compact rows. Empty groups collapse to a single "+ Add …" stub button.
 */
export default function DeliverableSection(props: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();

  const { kind, items, initiativeId, onAdd } = props;
  const meta = KIND_META[kind];
  const labelKey = {
    soaw: "artefactGroup.soaws",
    diagram: "artefactGroup.diagrams",
    adr: "artefactGroup.adrs",
    plan: "artefactGroup.plans",
  }[kind];
  const addKey = `deliverable.add.${kind}` as const;
  const emptyKey = `deliverable.empty.${kind}` as const;

  const renderEmpty = () => (
    <Box sx={{ pl: 1, py: 0.5 }}>
      {onAdd ? (
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="add" size={16} />}
          onClick={() => onAdd(kind, initiativeId)}
          sx={{ textTransform: "none", color: "text.secondary" }}
        >
          {t(addKey)}
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
          {t(emptyKey)}
        </Typography>
      )}
    </Box>
  );

  return (
    <Box sx={{ mb: 1.5 }}>
      {/* Section header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          mb: 0.5,
        }}
      >
        <MaterialSymbol icon={meta.icon} size={18} color={meta.color} />
        <Typography
          variant="overline"
          sx={{ lineHeight: 1, fontWeight: 600, letterSpacing: 0.5 }}
        >
          {t(labelKey)}
        </Typography>
        <Chip
          label={items.length}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: "0.7rem" }}
        />
        <Box sx={{ flex: 1 }} />
        {onAdd && items.length > 0 && (
          <Tooltip title={t(addKey)}>
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={() => onAdd(kind, initiativeId)}
              sx={{ textTransform: "none" }}
            >
              {t("common:actions.add")}
            </Button>
          </Tooltip>
        )}
      </Box>

      {items.length === 0 && renderEmpty()}

      {/* Items */}
      {kind === "soaw" &&
        (items as SoAW[]).map((s) => (
          <SoawRow
            key={s.id}
            soaw={s}
            color={meta.color}
            onContextMenu={(props as SoawProps).onSoawContextMenu}
          />
        ))}

      {kind === "diagram" &&
        (items as DiagramSummary[]).map((d) => (
          <DiagramRow
            key={d.id}
            diagram={d}
            color={meta.color}
            initiativeId={initiativeId}
            onUnlink={(props as DiagramProps).onUnlinkDiagram}
          />
        ))}

      {kind === "adr" &&
        (items as ArchitectureDecision[]).map((a) => (
          <AdrRow key={a.id} adr={a} color={meta.color} />
        ))}

      {kind === "plan" &&
        (items as TransitionPlan[]).map((p) => (
          <PlanRow
            key={p.id}
            plan={p}
            color={meta.color}
            onContextMenu={(props as PlanProps).onPlanContextMenu}
          />
        ))}

      {/* Diagram-link affordance — kept distinct from the create flow */}
      {kind === "diagram" &&
        items.length > 0 &&
        initiativeId &&
        (props as DiagramProps).onLinkDiagrams && (
          <Box sx={{ pl: 1, mt: 0.5 }}>
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="link" size={16} />}
              onClick={() =>
                (props as DiagramProps).onLinkDiagrams!(initiativeId)
              }
              sx={{ textTransform: "none", color: "text.secondary" }}
            >
              {t("card.linkDiagramsTooltip")}
            </Button>
          </Box>
        )}
    </Box>
  );

  // ── Row sub-components ──────────────────────────────────────────────

  function SoawRow({
    soaw,
    color,
    onContextMenu,
  }: {
    soaw: SoAW;
    color: string;
    onContextMenu?: (a: HTMLElement, s: SoAW) => void;
  }) {
    const statusLabels: Record<string, string> = {
      draft: t("status.draft"),
      in_review: t("status.inReview"),
      approved: t("status.approved"),
      signed: t("status.signed"),
    };
    return (
      <CompactRow
        icon={<MaterialSymbol icon="description" size={18} color={color} />}
        onClick={() => navigate(`/ea-delivery/soaw/${soaw.id}`)}
      >
        <Typography sx={{ fontSize: "0.9rem", flex: 1, minWidth: 0 }} noWrap>
          {soaw.name}
          {soaw.revision_number > 1 && (
            <Typography
              component="span"
              sx={{ ml: 0.5, fontSize: "0.8rem", color: "text.secondary" }}
            >
              {t("soaw.revision", { number: soaw.revision_number })}
            </Typography>
          )}
        </Typography>
        <Chip
          label={statusLabels[soaw.status] ?? soaw.status}
          size="small"
          color={SOAW_STATUS_COLORS[soaw.status] ?? "default"}
          sx={{ height: 22 }}
        />
        <Tooltip title={t("soaw.previewTooltip")}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/ea-delivery/soaw/${soaw.id}/preview`);
            }}
          >
            <MaterialSymbol icon="visibility" size={18} />
          </IconButton>
        </Tooltip>
        {onContextMenu && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e.currentTarget, soaw);
            }}
          >
            <MaterialSymbol icon="more_vert" size={18} />
          </IconButton>
        )}
      </CompactRow>
    );
  }

  function DiagramRow({
    diagram,
    color,
    initiativeId,
    onUnlink,
  }: {
    diagram: DiagramSummary;
    color: string;
    initiativeId?: string;
    onUnlink?: (d: DiagramSummary, id: string) => void;
  }) {
    return (
      <CompactRow
        icon={<MaterialSymbol icon="schema" size={18} color={color} />}
        onClick={() => navigate(`/diagrams/${diagram.id}`)}
      >
        <Typography sx={{ fontSize: "0.9rem", flex: 1, minWidth: 0 }} noWrap>
          {diagram.name}
        </Typography>
        {diagram.card_ids.length > 1 && (
          <Tooltip
            title={t("diagram.linkedToCards", {
              count: diagram.card_ids.length,
            })}
          >
            <Chip
              label={t("diagram.linkedToCards", {
                count: diagram.card_ids.length,
              })}
              size="small"
              variant="outlined"
              sx={{ height: 22 }}
            />
          </Tooltip>
        )}
        {onUnlink && initiativeId && (
          <Tooltip title={t("diagram.unlinkTooltip")}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onUnlink(diagram, initiativeId);
              }}
            >
              <MaterialSymbol icon="link_off" size={18} />
            </IconButton>
          </Tooltip>
        )}
      </CompactRow>
    );
  }

  function AdrRow({ adr, color }: { adr: ArchitectureDecision; color: string }) {
    const statusLabels: Record<string, string> = {
      draft: t("status.draft"),
      in_review: t("status.inReview"),
      approved: t("status.approved"),
      signed: t("status.signed"),
    };
    return (
      <CompactRow
        icon={<MaterialSymbol icon="gavel" size={18} color={color} />}
        onClick={() => navigate(`/ea-delivery/adr/${adr.id}`)}
      >
        <Chip
          label={adr.reference_number}
          size="small"
          variant="outlined"
          sx={{ fontFamily: "monospace", fontSize: "0.7rem", height: 22 }}
        />
        <Typography sx={{ fontSize: "0.9rem", flex: 1, minWidth: 0 }} noWrap>
          {adr.title}
        </Typography>
        <Chip
          label={statusLabels[adr.status] ?? adr.status}
          size="small"
          color={SOAW_STATUS_COLORS[adr.status] ?? "default"}
          sx={{ height: 22 }}
        />
      </CompactRow>
    );
  }

  function PlanRow({
    plan,
    color,
    onContextMenu,
  }: {
    plan: TransitionPlan;
    color: string;
    onContextMenu?: (a: HTMLElement, p: TransitionPlan) => void;
  }) {
    const isDraft = plan.status === "draft";
    return (
      <CompactRow
        icon={<MaterialSymbol icon="route" size={18} color={color} />}
        onClick={() =>
          navigate(
            isDraft ? `/ea-delivery/plans/${plan.id}` : `/ea-delivery/plans/${plan.id}/preview`,
          )
        }
      >
        <Typography sx={{ fontSize: "0.9rem", flex: 1, minWidth: 0 }} noWrap>
          {plan.title}
        </Typography>
        <Chip
          label={isDraft ? t("plan.status.draft") : t("plan.status.committed")}
          size="small"
          color={isDraft ? "default" : "success"}
          sx={{ height: 22 }}
        />
        <Tooltip title={t("plan.previewTooltip")}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/ea-delivery/plans/${plan.id}/preview`);
            }}
          >
            <MaterialSymbol icon="visibility" size={18} />
          </IconButton>
        </Tooltip>
        {onContextMenu && (
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e.currentTarget, plan);
            }}
          >
            <MaterialSymbol icon="more_vert" size={18} />
          </IconButton>
        )}
      </CompactRow>
    );
  }
}

function CompactRow({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.75,
        borderRadius: 1,
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? { bgcolor: "action.hover" } : {},
      }}
    >
      {icon}
      {children}
    </Box>
  );
}
