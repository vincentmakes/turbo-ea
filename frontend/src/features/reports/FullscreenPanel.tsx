import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";

export default function FullscreenPanel({
  children,
  label,
  onContainerChange,
}: {
  /** A function child learns whether the panel is full screen, to fill the screen. */
  children: ReactNode | ((isFullscreen: boolean) => ReactNode);
  label: string;
  onContainerChange?: (container: HTMLElement | null) => void;
}) {
  const { t } = useTranslation("reports");
  const ref = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const setRef = useCallback((element: HTMLDivElement | null) => {
    ref.current = element;
    onContainerChange?.(element);
  }, [onContainerChange]);

  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === ref.current;
      setIsFullscreen(active);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    if (isFullscreen) document.exitFullscreen();
    else ref.current?.requestFullscreen();
  };

  return (
    <Box
      ref={setRef}
      data-testid="fullscreen-panel"
      sx={{
        position: "relative",
        ...(isFullscreen && {
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.default",
          p: 2,
        }),
      }}
    >
      <Tooltip title={isFullscreen ? t("shell.exitFullscreen") : label} slotProps={{ popper: { container: isFullscreen ? ref.current : undefined } }}>
        <IconButton
          size="small"
          onClick={toggle}
          aria-label={isFullscreen ? t("shell.exitFullscreen") : label}
          sx={{ position: "absolute", top: 4, right: 4, zIndex: 1, "@media print": { display: "none" } }}
        >
          <MaterialSymbol icon={isFullscreen ? "fullscreen_exit" : "fullscreen"} size={18} />
        </IconButton>
      </Tooltip>
      {typeof children === "function" ? children(isFullscreen) : children}
    </Box>
  );
}
