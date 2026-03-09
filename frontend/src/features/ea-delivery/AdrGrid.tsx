import { useState, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, RowClickedEvent } from "ag-grid-community";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useThemeMode } from "@/hooks/useThemeMode";
import type { ArchitectureDecision, CardType } from "@/types";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

/** Strip HTML tags for plain-text display */
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").trim();
}

interface Props {
  adrs: ArchitectureDecision[];
  metamodelTypes: CardType[];
  loading: boolean;
  onEdit: (adr: ArchitectureDecision) => void;
  onPreview: (adr: ArchitectureDecision) => void;
  onDuplicate: (adr: ArchitectureDecision) => void;
  onDelete: (adr: ArchitectureDecision) => void;
  quickFilterText: string;
  onQuickFilterChange: (text: string) => void;
}

const STATUS_CHIP_PROPS: Record<string, { label_key: string; color: "default" | "warning" | "success" }> = {
  draft: { label_key: "status.draft", color: "default" },
  in_review: { label_key: "status.inReview", color: "warning" },
  signed: { label_key: "status.signed", color: "success" },
};

export default function AdrGrid({
  adrs,
  metamodelTypes,
  loading,
  onEdit,
  onPreview,
  onDuplicate,
  onDelete,
  quickFilterText,
  onQuickFilterChange,
}: Props) {
  const { t } = useTranslation("delivery");
  const navigate = useNavigate();
  const { mode } = useThemeMode();
  const gridRef = useRef<AgGridReact>(null);

  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    adr: ArchitectureDecision;
  } | null>(null);

  const typeColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ct of metamodelTypes) map[ct.key] = ct.color;
    return map;
  }, [metamodelTypes]);

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, resizable: true }),
    [],
  );

  const columnDefs = useMemo<ColDef<ArchitectureDecision>[]>(
    () => [
      {
        headerName: t("adr.grid.reference"),
        field: "reference_number",
        width: 120,
        minWidth: 100,
      },
      {
        headerName: t("adr.grid.title"),
        field: "title",
        flex: 1,
        minWidth: 180,
      },
      {
        headerName: t("adr.grid.decision"),
        field: "decision",
        flex: 1,
        minWidth: 180,
        valueFormatter: (params: { value: string | null }) => stripHtml(params.value),
        cellStyle: {
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },
      {
        headerName: t("adr.grid.status"),
        field: "status",
        width: 140,
        cellRenderer: (params: { value: string }) => {
          const cfg = STATUS_CHIP_PROPS[params.value];
          if (!cfg) return params.value;
          return (
            <Chip
              label={t(cfg.label_key)}
              color={cfg.color}
              size="small"
              sx={{ fontWeight: 500 }}
            />
          );
        },
      },
      {
        headerName: t("adr.grid.linkedCards"),
        sortable: false,
        minWidth: 160,
        flex: 1,
        valueGetter: (params: { data: ArchitectureDecision | undefined }) =>
          (params.data?.linked_cards ?? []).map((c) => c.name).join(", "),
        cellRenderer: (params: { data: ArchitectureDecision | undefined }) => {
          const cards = params.data?.linked_cards;
          if (!cards || cards.length === 0) return null;
          return (
            <Tooltip
              title={cards.map((c) => c.name).join(", ")}
              enterDelay={400}
              disableHoverListener={cards.length <= 2}
            >
              <Box
                sx={{
                  display: "flex",
                  gap: 0.5,
                  alignItems: "center",
                  flexWrap: "nowrap",
                  overflow: "hidden",
                  py: 0.25,
                }}
              >
                {cards.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    size="small"
                    sx={{
                      bgcolor: typeColorMap[c.type] || "#9e9e9e",
                      color: "#fff",
                      fontWeight: 500,
                      maxWidth: 140,
                      flexShrink: 0,
                      "& .MuiChip-label": {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      },
                    }}
                  />
                ))}
              </Box>
            </Tooltip>
          );
        },
      },
      {
        headerName: t("adr.grid.created"),
        field: "created_at",
        width: 130,
        valueFormatter: (params: { value: string | null }) =>
          params.value ? new Date(params.value).toLocaleDateString() : "",
      },
      {
        headerName: t("adr.grid.signed"),
        field: "signed_at",
        width: 130,
        valueFormatter: (params: { value: string | null }) =>
          params.value ? new Date(params.value).toLocaleDateString() : "",
      },
    ],
    [t, typeColorMap],
  );

  const onRowClicked = useCallback(
    (event: RowClickedEvent<ArchitectureDecision>) => {
      if (event.data) {
        navigate(`/ea-delivery/adr/${event.data.id}`);
      }
    },
    [navigate],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement;
      const rowEl = target.closest<HTMLElement>("[row-index]");
      if (!rowEl) return;
      const rowIndex = Number(rowEl.getAttribute("row-index"));
      const rowNode = gridRef.current?.api?.getDisplayedRowAtIndex(rowIndex);
      if (!rowNode?.data) return;
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        adr: rowNode.data,
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleMenuAction = useCallback(
    (action: (adr: ArchitectureDecision) => void) => {
      if (contextMenu) {
        action(contextMenu.adr);
        setContextMenu(null);
      }
    },
    [contextMenu],
  );

  const isDark = mode === "dark";

  return (
    <>
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
        {/* Search bar inside the grid panel */}
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t("adr.searchPlaceholder")}
            value={quickFilterText}
            onChange={(e) => onQuickFilterChange(e.target.value)}
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
        </Box>

        <Box
          className={isDark ? "ag-theme-quartz-dark" : "ag-theme-quartz"}
          sx={{ flex: 1, minHeight: 0 }}
          onContextMenu={handleContextMenu}
        >
          <AgGridReact<ArchitectureDecision>
            ref={gridRef}
            rowData={adrs}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            quickFilterText={quickFilterText}
            loading={loading}
            onRowClicked={onRowClicked}
            rowHeight={44}
            headerHeight={44}
            suppressCellFocus
            animateRows={false}
            getRowId={(params) => params.data.id}
          />
        </Box>
      </Box>

      <Menu
        open={contextMenu !== null}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
        }
      >
        <MenuItem onClick={() => handleMenuAction(onEdit)}>
          <ListItemIcon>
            <MaterialSymbol icon="edit" size={20} />
          </ListItemIcon>
          <ListItemText>{t("adr.edit")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleMenuAction(onPreview)}>
          <ListItemIcon>
            <MaterialSymbol icon="visibility" size={20} />
          </ListItemIcon>
          <ListItemText>{t("adr.preview")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleMenuAction(onDuplicate)}>
          <ListItemIcon>
            <MaterialSymbol icon="content_copy" size={20} />
          </ListItemIcon>
          <ListItemText>{t("adr.duplicate")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleMenuAction(onDelete)}>
          <ListItemIcon>
            <MaterialSymbol icon="delete" size={20} color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>{t("adr.delete")}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
