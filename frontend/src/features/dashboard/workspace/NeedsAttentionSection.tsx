import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ButtonBase from "@mui/material/ButtonBase";
import { alpha } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import { SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";

interface Props {
  overdueTodoCount: number;
  brokenCardCount: number;
}

interface AttentionItem {
  key: string;
  icon: string;
  color: string;
  count: number;
  label: string;
  href: string;
}

function AttentionCard({ item, onClick }: { item: AttentionItem; onClick: () => void }) {
  const { t } = useTranslation("common");
  return (
    <ButtonBase
      onClick={onClick}
      focusRipple
      sx={{
        flex: "1 1 240px",
        minWidth: 240,
        textAlign: "left",
        borderRadius: 1,
        "&:focus-visible": { outline: (theme) => `2px solid ${theme.palette.primary.main}` },
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: "100%",
          p: 2,
          display: "flex",
          alignItems: "center",
          gap: 2,
          borderLeft: `4px solid ${item.color}`,
          transition: "background-color 120ms",
          "&:hover": { bgcolor: (theme) => alpha(item.color, theme.palette.mode === "dark" ? 0.16 : 0.06) },
        }}
      >
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: (theme) => alpha(item.color, theme.palette.mode === "dark" ? 0.24 : 0.14),
            color: item.color,
            flexShrink: 0,
          }}
        >
          <MaterialSymbol icon={item.icon} size={22} color={item.color} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
            {item.count}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {item.label}
          </Typography>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            color: "primary.main",
            fontSize: 13,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {t("actions.review")}
          <MaterialSymbol icon="chevron_right" size={18} />
        </Box>
      </Paper>
    </ButtonBase>
  );
}

export default function NeedsAttentionSection({ overdueTodoCount, brokenCardCount }: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();

  const items: AttentionItem[] = [];
  if (overdueTodoCount > 0) {
    items.push({
      key: "overdueTodos",
      icon: "schedule",
      color: STATUS_COLORS.warning,
      count: overdueTodoCount,
      label: t("dashboard.workspace.attention.overdueTodos", { count: overdueTodoCount }),
      href: "/todos",
    });
  }
  if (brokenCardCount > 0) {
    items.push({
      key: "brokenCards",
      icon: "report",
      color: SEVERITY_COLORS.high,
      count: brokenCardCount,
      label: t("dashboard.workspace.attention.brokenCards", { count: brokenCardCount }),
      href: "/inventory?approval_status=BROKEN&mine=stakeholder",
    });
  }

  if (items.length === 0) return null;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <MaterialSymbol icon="priority_high" size={20} color={SEVERITY_COLORS.high} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("dashboard.workspace.needsAttention")}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        {items.map((item) => (
          <AttentionCard key={item.key} item={item} onClick={() => navigate(item.href)} />
        ))}
      </Box>
    </Box>
  );
}
