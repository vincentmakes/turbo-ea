import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { brand } from "@/theme/tokens";
import { DRAG_HANDLE_CLASS, useWidgetControls } from "../widgets/WidgetFrame";

// Stryker disable all: the card's padding and its full-height column layout; jsdom does no layout, so no test can observe them
const ROOT_SX = { p: 2, height: "100%", display: "flex", flexDirection: "column" } as const;
// Stryker restore all

interface Props {
  icon: string;
  iconColor?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  /** `data-*` attributes for the card's root (an export marker, a test id). */
  [data: `data-${string}`]: string | boolean | undefined;
}

/**
 * A workspace or admin section: icon + title, the section's own action at the
 * end of the row, then its body. On a dashboard in customize mode it stays
 * exactly that, plus the frame's controls in its title row — the drag handle
 * before the icon (the whole icon + title group drags) and the configure /
 * remove buttons after the section's action. Every state of a section
 * (loading, empty, error) renders inside it, so the controls are always there.
 */
export default function SectionPaper({
  icon,
  iconColor = brand.primary,
  title,
  action,
  children,
  ...data
}: Props) {
  const controls = useWidgetControls();
  return (
    <Paper
      variant="outlined"
      {...data}
      sx={ROOT_SX}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Box
          className={controls ? DRAG_HANDLE_CLASS : undefined}
          sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0, ...(controls && { cursor: "grab" }) }}
        >
          {controls?.handle}
          <MaterialSymbol icon={icon} size={20} color={iconColor} />
          <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
        </Box>
        {action}
        {controls && (
          <Box data-testid="section-actions" sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {controls.actions}
          </Box>
        )}
      </Box>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Paper>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
      {message}
    </Typography>
  );
}

export function ViewAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Typography
      component="a"
      href={to}
      variant="caption"
      sx={{
        color: "primary.main",
        textDecoration: "none",
        "&:hover": { textDecoration: "underline" },
      }}
    >
      {label} →
    </Typography>
  );
}
