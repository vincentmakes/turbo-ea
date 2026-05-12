import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import CreateSoAWDialog from "@/features/ea-delivery/CreateSoAWDialog";
import CreateAdrDialog from "@/features/ea-delivery/CreateAdrDialog";
import LinkDiagramsDialog from "@/features/ea-delivery/LinkDiagramsDialog";
import { InitiativesTab } from "@/features/ea-delivery/initiatives";
import NewArtefactSplitButton, {
  type ArtefactKind,
} from "@/features/ea-delivery/initiatives/NewArtefactSplitButton";
import { UNLINKED_KEY } from "@/features/ea-delivery/initiatives/InitiativeTreeSidebar";
import CreateDiagramDialog from "@/features/diagrams/CreateDiagramDialog";
import type { DiagramSummary, SoAW } from "@/types";
import type { useInitiativeData } from "@/features/ea-delivery/initiatives";

/**
 * EA Delivery report — the Initiatives workspace (hierarchical tree + per-initiative
 * deliverables) relocated under /reports/. Replaces the dissolved /ea-delivery page;
 * Principles + Decisions + Risks moved to /grc in the 1.8.0 refactor.
 */
export default function EaDeliveryReport() {
  const { t } = useTranslation(["delivery", "common"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedInitiativeId = searchParams.get("initiative");

  const setSelectedInitiativeId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("initiative", id);
          else next.delete("initiative");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ── SoAW dialog ─────────────────────────────────────────────────────────
  const [soawCreateOpen, setSoawCreateOpen] = useState(false);
  const [soawCreateInitiativeId, setSoawCreateInitiativeId] = useState<string>("");

  // ── ADR dialog ──────────────────────────────────────────────────────────
  const [adrCreateOpen, setAdrCreateOpen] = useState(false);
  const [adrCreatePreLinkedCards, setAdrCreatePreLinkedCards] = useState<
    { id: string; name: string; type: string }[]
  >([]);

  // ── Link diagrams dialog ────────────────────────────────────────────────
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInitiativeId, setLinkInitiativeId] = useState("");
  const [linkSelected, setLinkSelected] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);

  // ── Create diagram dialog ───────────────────────────────────────────────
  const [diagramCreateOpen, setDiagramCreateOpen] = useState(false);
  const [diagramCreateCardIds, setDiagramCreateCardIds] = useState<string[]>([]);

  // ── SoAW context menu ───────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    anchor: HTMLElement;
    soaw: SoAW;
  } | null>(null);

  const [error, setError] = useState("");

  // ── Data from InitiativesTab (exposed via callback) ─────────────────────
  const dataRef = useRef<ReturnType<typeof useInitiativeData> | null>(null);

  const handleDataReady = useCallback(
    (d: ReturnType<typeof useInitiativeData>) => {
      dataRef.current = d;
    },
    [],
  );

  const handleCreateSoawForInitiative = useCallback((initiativeId: string) => {
    setSoawCreateInitiativeId(initiativeId);
    setSoawCreateOpen(true);
  }, []);

  const handleCreateDiagramForInitiative = useCallback(
    (initiativeId?: string) => {
      setDiagramCreateCardIds(initiativeId ? [initiativeId] : []);
      setDiagramCreateOpen(true);
    },
    [],
  );

  const openAdrCreateDialog = useCallback(
    (preLinked: { id: string; name: string; type: string }[] = []) => {
      setAdrCreatePreLinkedCards(preLinked);
      setAdrCreateOpen(true);
    },
    [],
  );

  // ── Link diagram handlers ──────────────────────────────────────────────

  const openLinkDialog = useCallback((initiativeId: string) => {
    setLinkInitiativeId(initiativeId);
    const allDiagrams = dataRef.current?.diagrams ?? [];
    const alreadyLinked = allDiagrams
      .filter((d) => d.card_ids.includes(initiativeId))
      .map((d) => d.id);
    setLinkSelected(alreadyLinked);
    setLinkOpen(true);
  }, []);

  const toggleLinkDiagram = (diagramId: string) => {
    setLinkSelected((prev) =>
      prev.includes(diagramId) ? prev.filter((id) => id !== diagramId) : [...prev, diagramId],
    );
  };

  const handleLinkDiagrams = async () => {
    if (!linkInitiativeId) return;
    setLinking(true);
    try {
      const allDiagrams = dataRef.current?.diagrams ?? [];
      const promises = allDiagrams.map((d) => {
        const wasLinked = d.card_ids.includes(linkInitiativeId);
        const isNowLinked = linkSelected.includes(d.id);
        if (wasLinked === isNowLinked) return null;
        const newIds = isNowLinked
          ? [...d.card_ids, linkInitiativeId]
          : d.card_ids.filter((id) => id !== linkInitiativeId);
        return api.patch(`/diagrams/${d.id}`, { card_ids: newIds });
      });
      await Promise.all(promises.filter(Boolean));
      setLinkOpen(false);
      dataRef.current?.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.linkDiagrams"));
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkDiagram = useCallback(
    async (diagram: DiagramSummary, initiativeId: string) => {
      try {
        const newIds = diagram.card_ids.filter((id) => id !== initiativeId);
        await api.patch(`/diagrams/${diagram.id}`, { card_ids: newIds });
        dataRef.current?.refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : t("error.unlinkDiagram"));
      }
    },
    [t],
  );

  // ── SoAW delete + context menu ─────────────────────────────────────────

  const handleDeleteSoaw = async (id: string) => {
    if (!confirm(t("confirm.deleteSoaw"))) return;
    try {
      await api.delete(`/soaw/${id}`);
      dataRef.current?.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.deleteSoaw"));
    }
    setCtxMenu(null);
  };

  const handleSoawContextMenu = useCallback((anchor: HTMLElement, soaw: SoAW) => {
    setCtxMenu({ anchor, soaw });
  }, []);

  // ── Single dispatcher for the "+ New artefact" button ──────────────────

  const handleCreateArtefact = useCallback(
    (kind: ArtefactKind, initiativeId?: string) => {
      const target = initiativeId && initiativeId !== UNLINKED_KEY ? initiativeId : "";
      if (kind === "soaw") {
        handleCreateSoawForInitiative(target);
        return;
      }
      if (kind === "diagram") {
        handleCreateDiagramForInitiative(target || undefined);
        return;
      }
      if (kind === "adr") {
        if (target) {
          const init = dataRef.current?.initiatives.find((i) => i.id === target);
          openAdrCreateDialog(
            init ? [{ id: init.id, name: init.name, type: init.type }] : [],
          );
        } else {
          openAdrCreateDialog([]);
        }
      }
    },
    [handleCreateSoawForInitiative, handleCreateDiagramForInitiative, openAdrCreateDialog],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: 1,
          columnGap: 1,
          mb: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", flex: "1 1 auto", minWidth: 0 }}>
          <MaterialSymbol icon="architecture" size={28} color="#1976d2" />
          <Box sx={{ ml: 1, minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {t("page.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("page.subtitle")}
            </Typography>
          </Box>
        </Box>
        <Box
          sx={{
            ml: { sm: "auto" },
            width: { xs: "100%", sm: "auto" },
            display: "flex",
            justifyContent: { xs: "flex-start", sm: "flex-end" },
          }}
        >
          <NewArtefactSplitButton
            initiativeId={
              selectedInitiativeId && selectedInitiativeId !== UNLINKED_KEY
                ? selectedInitiativeId
                : undefined
            }
            onSelect={(kind, id) => handleCreateArtefact(kind, id)}
            variant="contained"
          />
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <InitiativesTab
        selectedInitiativeId={selectedInitiativeId}
        onSelectInitiative={setSelectedInitiativeId}
        onCreateSoaw={handleCreateSoawForInitiative}
        onCreateAdr={openAdrCreateDialog}
        onCreateDiagram={handleCreateDiagramForInitiative}
        onLinkDiagrams={openLinkDialog}
        onUnlinkDiagram={handleUnlinkDiagram}
        onSoawContextMenu={handleSoawContextMenu}
        onDataReady={handleDataReady}
      />

      {/* SoAW context menu (right-click on a SoAW row in the workspace) */}
      <Menu anchorEl={ctxMenu?.anchor} open={!!ctxMenu} onClose={() => setCtxMenu(null)}>
        <MenuItem
          onClick={() => {
            if (ctxMenu) navigate(`/ea-delivery/soaw/${ctxMenu.soaw.id}/preview`);
            setCtxMenu(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="visibility" size={18} />
          </ListItemIcon>
          <ListItemText>{t("menu.preview")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (ctxMenu) navigate(`/ea-delivery/soaw/${ctxMenu.soaw.id}`);
            setCtxMenu(null);
          }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="edit" size={18} />
          </ListItemIcon>
          <ListItemText>{t("menu.edit")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => ctxMenu && handleDeleteSoaw(ctxMenu.soaw.id)}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon>
            <MaterialSymbol icon="delete" size={18} color="#d32f2f" />
          </ListItemIcon>
          <ListItemText>{t("menu.delete")}</ListItemText>
        </MenuItem>
      </Menu>

      {/* SoAW create dialog (lifted to features/ea-delivery/CreateSoAWDialog) */}
      <CreateSoAWDialog
        open={soawCreateOpen}
        onClose={() => setSoawCreateOpen(false)}
        onCreated={(created) => {
          dataRef.current?.refetch();
          navigate(`/ea-delivery/soaw/${created.id}`);
        }}
        fixedInitiativeId={soawCreateInitiativeId || undefined}
        initiatives={dataRef.current?.initiatives ?? []}
      />

      {/* ADR create dialog */}
      <CreateAdrDialog
        open={adrCreateOpen}
        onClose={() => setAdrCreateOpen(false)}
        onCreated={(adr) => {
          dataRef.current?.refetch();
          navigate(`/ea-delivery/adr/${adr.id}`);
        }}
        preLinkedCards={adrCreatePreLinkedCards}
      />

      {/* Create diagram dialog */}
      <CreateDiagramDialog
        open={diagramCreateOpen}
        onClose={() => setDiagramCreateOpen(false)}
        initialCardIds={diagramCreateCardIds}
        onCreated={() => dataRef.current?.refetch()}
      />

      {/* Link diagrams dialog */}
      <LinkDiagramsDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        diagrams={dataRef.current?.diagrams ?? []}
        initiatives={dataRef.current?.initiatives ?? []}
        linkInitiativeId={linkInitiativeId}
        linkSelected={linkSelected}
        linking={linking}
        onToggle={toggleLinkDiagram}
        onSave={handleLinkDiagrams}
      />
    </Box>
  );
}
