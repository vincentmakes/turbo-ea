import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, Stack, Tooltip, Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { api } from "@/api/client";
import CardDetailSidePanel from "@/components/CardDetailSidePanel";
import ClickableCardName from "@/components/ClickableCardName";
import { DiagramCanvasToolbar, DiagramDisplayMenu, DiagramEditorHeader, DiagramGridTool, DiagramSyncButton, DiagramTool } from "@/components/DiagramEditorToolbar";
import { FilterCheckboxList } from "@/components/FilterSidebarSection";
import MaterialSymbol from "@/components/MaterialSymbol";
import { canReadType, hasPermission, hasTypePermission } from "@/components/RequirePermission";
import ShortcutsDialog from "@/features/archimate/ShortcutsDialog";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useDiagramDotGrid } from "@/hooks/useDiagramDotGrid";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { useApiQuery } from "@/hooks/useApiQuery";
import { iconSize } from "@/theme/tokens";
import type { ConnectorRouting } from "@/lib/connectorRouting";
import { crowFoot, type BoEdgeGeometry } from "./boConnectorGeometry";
import BoRelationshipDiagram, { type BoCanvasAction, type BoCanvasControls } from "./BoRelationshipDiagram";
import {
  BoApplicationLinkDialog, BoNewObjectDialog, BoObjectLinkDialog, BoRenameDialog,
} from "./BoRelationshipEditDialogs";
import { useBoDrawing } from "./useBoDrawing";
import { useBoRecovery } from "./useBoRecovery";
import type { InventoryChange } from "./useBoDrawing";

export interface BoNode {
  id: string;
  name: string;
  subtype: string | null;
  isPersonalData: boolean;
  isPaymentData: boolean;
}
export interface BoEdge { id: string; source: string; target: string; cardinality: string | null; routing?: ConnectorRouting | null; geometry?: BoEdgeGeometry | null }
export interface BoApplication { id: string; name: string }
export interface BoGroup {
  master: BoApplication | null;
  slaves: BoApplication[];
  unclassified: BoApplication[];
}
export interface BoGraph {
  nodes: BoNode[];
  edges: BoEdge[];
  positions: Record<string, { x: number; y: number }>;
  applications: Record<string, BoGroup>;
  capabilities: { can_manage_master: boolean };
  snapshot_revision: string | null;
}

const toolbarButton = { textTransform: "none", whiteSpace: "nowrap" } as const;
const legend = [
  ["data", "database"], ["document", "description"], ["legacy", "category"],
  ["personalData", "shield"], ["paymentData", "credit_card"],
] as const;

function glyph(icon: string) {
  return <span aria-hidden="true"><MaterialSymbol icon={icon} size={iconSize.sm} /></span>;
}

export default function BoRelationshipPage() {
  const { t } = useTranslation(["reports", "common", "archimate", "diagrams", "cards"]);
  const navigate = useNavigate();
  const user = useOptionalAuthUser();
  const canOpenApplications = hasTypePermission(user, "inventory.view", "Application");
  const canEdit = hasPermission(user?.permissions, "boRelationship.edit");
  const canEditRelations = canEdit && hasPermission(user?.permissions, "relations.manage");
  const canLinkApplications = canEditRelations && canReadType(user, "Application", "module");
  const canCreateObjects = canEdit && hasTypePermission(user, "inventory.create", "DataObject");
  const permissionScope = JSON.stringify(user?.permissions ?? {});
  const editorScope = `${user?.id ?? ""}:${permissionScope}`;
  const { data, error, loading, refetch } = useApiQuery<BoGraph>("/bo-relationship");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedMany, setSelectedMany] = useState<ReadonlySet<string>>();
  const [panelOpen, setPanelOpen] = useState(true);
  const detailsId = useId();
  const applicationsId = useId();
  const [applicationsOpen, setApplicationsOpen] = useState(true);
  const [showGrid, toggleGrid] = useDiagramDotGrid("data-modeller");
  const canvas = useRef<BoCanvasControls>(null);
  const [colorBy, setColorBy] = useState<"default" | "subtype" | "personalData" | "paymentData">("default");
  const [display, setDisplay] = useState({ subtype: true, personalData: true, paymentData: true });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const clipboard = useRef<{ scope: string; nodes: BoNode[] }>(null);
  const [pasteQueue, setPasteQueue] = useState<BoNode[]>([]);
  const [renameObject, setRenameObject] = useState<BoNode | null>(null);
  const [renameError, setRenameError] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const { run: runRenameCheck } = useLatestRequest();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [personalData, setPersonalData] = useState(false);
  const [paymentData, setPaymentData] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);
  const [masterBusy, setMasterBusy] = useState(false);
  const [liveGroups, setLiveGroups] = useState<Record<string, BoGroup>>({});
  const [dialog, setDialog] = useState<"object" | "relation" | "application" | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState<BoEdge | null>(null);
  const [changes, setChanges] = useState<InventoryChange[]>([]);
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);
  const { run: runChangeCheck } = useLatestRequest();
  const graphLoaded = data !== undefined;
  const removedRef = useRef<string[]>([]);
  const [syncRequested, setSyncRequested] = useState(false);
  const checkChanges = useCallback(() => {
    setChecking(true);
    void runChangeCheck(async ({ signal, isCurrent }) => {
      try {
        const result = await api.get<{ changes: InventoryChange[] }>("/bo-relationship/changes", { signal });
        const removed = removedRef.current;
        const extra = removed.length ? await api.post<{ changes: InventoryChange[] }>("/bo-relationship/changes/draft", { removed_relation_ids: removed }) : { changes: [] };
        if (isCurrent()) { setChanges([...result.changes ?? [], ...extra.changes.filter((item) => !result.changes.some((change) => change.kind === item.kind && change.id === item.id))]); setRecoveryChanges([]); setCheckError(""); }
      } catch (error) {
        if (isCurrent()) setCheckError(error instanceof Error ? error.message : String(error));
      } finally {
        if (isCurrent()) setChecking(false);
      }
    });
  }, [runChangeCheck]);
  useEffect(() => {
    if (graphLoaded) checkChanges();
  }, [graphLoaded, checkChanges]);
  const masterLock = useRef(false);
  const latestQuery = useRef({ data, loading });
  latestQuery.current = { data, loading };
  const drawing = useBoDrawing(data, (aliases, savedLayout, updatedApplications) => {
    if (savedLayout) checkChanges();
    if (aliases.size) setSelected((id) => id ? aliases.get(id) ?? id : null);
    // A graph read already in flight may have started before this Save.
    if (savedLayout && (latestQuery.current.loading || latestQuery.current.data !== data)) refetch();
    if (updatedApplications.length) {
      setDetailVersion((n) => n + 1);
      if (savedLayout) {
        setLiveGroups((groups) => Object.fromEntries(
          Object.entries(groups).filter(([id]) => !updatedApplications.includes(id)),
        ));
      }
    }
  }, editorScope);
  removedRef.current = drawing.removedIds;
  const recovery = useBoRecovery(data, user?.id, canEdit, drawing.draft, drawing.accepted, drawing.restoreDraft, drawing.busy, { create: canCreateObjects, relations: canEditRelations, applications: canLinkApplications, scope: permissionScope });
  const [recoveryChanges, setRecoveryChanges] = useState<InventoryChange[]>([]);
  const combinedChanges = [...changes, ...recoveryChanges.filter((item) => !changes.some((change) => change.kind === item.kind && change.id === item.id))];
  useEffect(() => {
    if (!drawing.removals.length && !drawing.draft.objects.length && !drawing.draft.relations.length && !drawing.draft.applications.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drawing.removals.length, drawing.draft.objects.length, drawing.draft.relations.length, drawing.draft.applications.length]);
  const pendingChanges = combinedChanges.filter((change) =>
    !drawing.accepted.some((item) => item.kind === change.kind && item.id === change.id && item.revision === change.revision)
    && !(change.kind === "edge" && drawing.removals.some(({ edge }) => edge.id === change.id)));
  // Independent facets combine with AND, as in the approved diagram mockup.
  const visibleNodes = useMemo(() => drawing.nodes.filter((node) =>
    (!personalData || node.isPersonalData) && (!paymentData || node.isPaymentData),
  ), [drawing.nodes, personalData, paymentData]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => drawing.edges.filter((edge) =>
    visibleIds.has(edge.source) && visibleIds.has(edge.target),
  ), [drawing.edges, visibleIds]);
  const activeSelection = selected && visibleIds.has(selected) ? selected : null;
  const selectedNode = visibleNodes.find(({ id }) => id === activeSelection);
  const busy = drawing.busy || masterBusy || recovery.blocked || renamePending;
  useEffect(() => {
    if (data && selected && !visibleIds.has(selected)) setSelected(null);
  }, [data, selected, visibleIds]);
  const canManageMaster = canEdit && (drawing.graph?.capabilities.can_manage_master ?? false);
  // Graph reloads keep the accepted drawing. The mutation returns live roles
  // for the panel without implicitly accepting inventory changes.
  const group = activeSelection
    ? (canManageMaster ? liveGroups[activeSelection] : undefined) ?? drawing.applications[activeSelection]
    : undefined;
  const pendingApplications = drawing.pendingApplications.filter(({ objectId }) => objectId === activeSelection);
  const unavailableTargets = new Set([activeSelection]);
  for (const { source, target } of [...drawing.edges, ...drawing.removals.map(({ edge }) => edge)]) {
    if (source === activeSelection) unavailableTargets.add(target);
    if (target === activeSelection) unavailableTargets.add(source);
  }
  const availableTargets = visibleNodes.filter(({ id }) => !unavailableTargets.has(id));
  const drawerSelection = activeSelection && !drawing.isDraftObject(activeSelection) ? activeSelection : null;
  const removalLabel = confirmRemoval ? t("boRelationship.relationEndpoints", {
    source: drawing.nodes.find(({ id }) => id === confirmRemoval.source)?.name,
    target: drawing.nodes.find(({ id }) => id === confirmRemoval.target)?.name,
  }) : "";

  const activateObject = (id: string) => {
    setSelected(id);
    setSelectedMany(undefined);
    setPanelOpen(true);
  };

  const closeObjectDialog = () => {
    setPasteQueue([]);
    setDialog(null);
  };

  const startRename = (node: BoNode) => {
    setRenameError("");
    if (drawing.isDraftObject(node.id)) {
      setRenameObject(node);
      return;
    }
    setMutationError("");
    void runRenameCheck(async ({ signal, isCurrent }) => {
      try {
        const detail = await api.get<{ card: { name: string }; permissions: { can_edit: boolean } }>(
          `/bo-relationship/objects/${node.id}/detail`, { signal },
        );
        if (!isCurrent()) return;
        if (detail.permissions.can_edit) setRenameObject({ ...node, name: detail.card.name });
        else setMutationError(t("common:errors.forbidden"));
      } catch (error) {
        if (isCurrent()) setMutationError(error instanceof Error ? error.message : String(error));
      }
    });
  };

  const rename = async (node: BoNode, name: string) => {
    if (!canEdit || busy || !visibleIds.has(node.id)) return;
    if (drawing.isDraftObject(node.id)) {
      if (drawing.renameDraftObject(node.id, name)) setRenameObject(null);
      else setRenameError(t("boRelationship.saveFailed"));
      return;
    }
    setRenamePending(true);
    setRenameError("");
    try {
      await api.patch(`/cards/${node.id}`, { name });
      setRenameObject(null);
      setDetailVersion((version) => version + 1);
      checkChanges();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenamePending(false);
    }
  };

  const onShortcut = (action: BoCanvasAction, focusedId?: string): boolean => {
    if (action === "selectAll") {
      if (visibleNodes.length === 0) return false;
      if (visibleNodes.length === 1) activateObject(visibleNodes[0].id);
      else {
        setSelected(null);
        setSelectedMany(visibleIds);
      }
      return true;
    }
    if (!canEdit || busy || dialog || renameObject || confirmRemoval) return false;
    if (action === "undo") return drawing.undo();
    if (action === "redo") return drawing.redo();
    if (action === "paste") {
      const copies = clipboard.current?.scope === editorScope
        ? clipboard.current.nodes
        : [];
      if (!canCreateObjects || copies.length === 0) return false;
      setPasteQueue(copies);
      setDialog("object");
      return true;
    }
    const ids = selectedMany ?? new Set([focusedId ?? activeSelection]);
    const nodes = visibleNodes.filter(({ id }) => ids.has(id));
    if (nodes.length === 0) return false;
    if (action === "copy" && canCreateObjects) {
      clipboard.current = { scope: editorScope, nodes };
      return true;
    }
    if (action === "delete" && drawing.removeNodes(nodes.map(({ id }) => id))) {
      setSelected(null);
      setSelectedMany(undefined);
      return true;
    }
    if (action === "edit" && nodes.length === 1) {
      startRename(nodes[0]);
      return true;
    }
    return false;
  };

  const availableShortcuts = new Set([
    "selectAll", "zoomIn", "zoomOut", "zoomFit",
    ...(canEdit ? ["undo", "redo", "delete", "edit"] : []),
    ...(canCreateObjects ? ["copy", "paste"] : []),
  ]);

  const changeMaster = async (applicationId: string | null) => {
    if (!activeSelection || !canManageMaster || busy || masterLock.current) return;
    masterLock.current = true;
    setMasterBusy(true);
    try {
      const updated = await api.put<BoGroup>(
        `/bo-relationship/objects/${activeSelection}/master`,
        { application_id: applicationId },
      );
      setLiveGroups((groups) => ({ ...groups, [activeSelection]: updated }));
      setMutationError("");
      setDetailVersion((n) => n + 1);
      refetch();
      checkChanges();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    } finally {
      masterLock.current = false;
      setMasterBusy(false);
    }
  };

  const renderGroup = (label: string, entries: BoApplication[], primary = false) => (
    <Stack spacing={0.5} role="group" aria-label={label}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip label={label} size="small" variant="outlined" color={primary ? "success" : "default"} />
        <Typography variant="caption" color="text.secondary">{entries.length}</Typography>
      </Stack>
      {entries.map((app) => (
        <Stack direction="row" spacing={0.5} alignItems="center" key={app.id}>
          {canOpenApplications ? (
            <Box sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
              <ClickableCardName name={app.name} to={`/cards/${app.id}`} />
            </Box>
          ) : (
            <Typography variant="body2" sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
              {app.name}
            </Typography>
          )}
          {canManageMaster && (
            <Tooltip title={t(primary ? "boRelationship.clearMaster" : "boRelationship.setMaster")}>
              <span>
                <IconButton
                  size="small"
                  disabled={busy}
                  aria-label={t(primary ? "boRelationship.clearMaster" : "boRelationship.setMaster")}
                  onClick={() => void changeMaster(primary ? null : app.id)}
                >
                  {glyph(primary ? "link_off" : "star_outline")}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      ))}
    </Stack>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <DiagramEditorHeader title={t("boRelationship.title")} onBack={() => {
        if ((drawing.removals.length || drawing.hasChanges) && !window.confirm(t(drawing.removals.length
          ? "boRelationship.discardRemovalsWarning" : "cards:detail.unsavedLeaveConfirm"))) return;
        navigate("/diagrams");
      }}>
        {data && <>
          <DiagramDisplayMenu label={t("diagrams:viewSelector.cardType")} icon="palette" single
            options={([
              ["default", "diagrams:viewSelector.cardType"], ["subtype", "boRelationship.subtype"],
              ["personalData", "boRelationship.personalData"], ["paymentData", "boRelationship.paymentData"],
            ] as const).map(([value, label]) => ({
              label: t(label), checked: colorBy === value, onSelect: () => setColorBy(value),
            }))} />
          <DiagramDisplayMenu label={t("common:cardDisplay.showOnCard")} icon="label"
            options={(["subtype", "personalData", "paymentData"] as const).map((value) => ({
              label: t(`boRelationship.${value}`), checked: display[value],
              onSelect: () => setDisplay((current) => ({ ...current, [value]: !current[value] })),
            }))} />
          <DiagramSyncButton onClick={() => { setSyncRequested(true); checkChanges(); }} disabled={checking}
            pending={pendingChanges.length + drawing.removals.length} />
        </>}
      </DiagramEditorHeader>
      {loading && !data && <CircularProgress />}
      {error && <Alert severity="error">{error.message}</Alert>}
      {mutationError && <Alert severity="error">{mutationError}</Alert>}
      {data && (
        <Card variant="outlined" sx={{ "--bo-canvas-height": "clamp(360px, calc(100dvh - 226px), 900px)", border: 0, borderRadius: 0 }}>
          <DiagramCanvasToolbar label={t("boRelationship.title")}>
            {canCreateObjects && (
              <Button size="small" sx={toolbarButton} startIcon={glyph("add")}
                disabled={busy} onClick={() => setDialog("object")}>{t("boRelationship.newObject")}</Button>
            )}
            <DiagramTool label={t("boRelationship.applications")} icon={applicationsOpen ? "left_panel_close" : "left_panel_open"}
              expanded={applicationsOpen} controls={applicationsOpen ? applicationsId : undefined}
              onClick={() => setApplicationsOpen((open) => !open)} />
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            {canEdit && <>
              <DiagramTool label={t("archimate:toolbar.undo")} icon="undo" disabled={busy || !drawing.canUndo} onClick={drawing.undo} />
              <DiagramTool label={t("archimate:toolbar.redo")} icon="redo" disabled={busy || !drawing.canRedo} onClick={drawing.redo} />
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            </>}
            <DiagramTool label={t("archimate:toolbar.zoomIn")} icon="zoom_in" onClick={() => canvas.current?.zoom(1)} />
            <DiagramTool label={t("archimate:toolbar.zoomOut")} icon="zoom_out" onClick={() => canvas.current?.zoom(-1)} />
            <DiagramTool label={t("archimate:toolbar.fit")} icon="fit_screen" onClick={() => canvas.current?.fit()} />
            <DiagramTool label={t("archimate:toolbar.exportSvg")} icon="image" disabled={visibleNodes.length === 0}
              onClick={() => canvas.current?.exportSvg(t("boRelationship.title"))} />
            <DiagramTool label={t("boRelationship.filters")} icon={personalData || paymentData ? "filter_alt" : "filter_list"}
              expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} />
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            {canEditRelations && (
              <DiagramTool label={t("boRelationship.linkObjects")} icon="account_tree"
                disabled={busy || availableTargets.length === 0 || !selectedNode} onClick={() => setDialog("relation")} />
            )}
            {canLinkApplications && (
              <DiagramTool label={t("boRelationship.linkApplication")} icon="link"
                disabled={busy || !selectedNode} onClick={() => setDialog("application")} />
            )}
            {canEdit && <>
              <Button size="small" variant="contained" sx={toolbarButton} startIcon={glyph("save")}
                disabled={busy || !drawing.hasChanges} onClick={() => {
                  if (!masterLock.current) void drawing.save().then((ok) => { if (ok) recovery.clear(); });
                }}>{t("common:actions.save")}</Button>
              <DiagramTool label={t("boRelationship.saveAndExit")} icon="exit_to_app" disabled={busy}
                onClick={() => void (async () => {
                  if (drawing.removals.length && !window.confirm(t("boRelationship.discardRemovalsWarning"))) return;
                  const ok = drawing.hasChanges ? await drawing.save() : true;
                  if (ok) { recovery.clear(); navigate("/"); }
                })()} />
            </>}
            <Typography variant="body2" color={drawing.hasChanges ? "warning.main" : "text.secondary"} role="status" sx={{ px: 1 }}>
              {t(drawing.hasChanges ? "boRelationship.unsavedChanges" : "boRelationship.sharedVersion")}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <DiagramGridTool enabled={showGrid} onToggle={toggleGrid} />
            <DiagramTool label={t("archimate:toolbar.shortcuts")} icon="keyboard" onClick={() => setShortcutsOpen(true)} />
            <DiagramTool label={t("archimate:toolbar.togglePanel")} icon={panelOpen ? "right_panel_close" : "right_panel_open"}
              expanded={panelOpen} controls={panelOpen ? detailsId : undefined} onClick={() => setPanelOpen((open) => !open)} />
          </DiagramCanvasToolbar>
          <Stack spacing={1} sx={{ "& > *": { mx: 2, my: 0.75 } }}>
            {filtersOpen && <FilterCheckboxList nativeCheckboxes items={[
              { key: "personal", label: t("boRelationship.personalData"), checked: personalData, onToggle: () => setPersonalData((value) => !value) },
              { key: "payment", label: t("boRelationship.paymentData"), checked: paymentData, onToggle: () => setPaymentData((value) => !value) },
            ]} />}
            {recovery.failed && <Alert severity="warning" action={<><Button onClick={recovery.retry}>{t("boRelationship.retryDraft")}</Button><Button onClick={recovery.discard}>{t("boRelationship.discardDraft")}</Button></>}>{t("boRelationship.draftValidationFailed")}</Alert>}
            {recovery.candidate && <Alert severity="info" action={<><Button onClick={() => { setRecoveryChanges(recovery.candidate?.changes ?? []); recovery.apply(); }}>{t("boRelationship.restoreDraft")}</Button><Button onClick={recovery.discard}>{t("boRelationship.discardDraft")}</Button></>}>{t("boRelationship.draftFound")}</Alert>}
            {checkError && <Alert severity="error">{t("boRelationship.checkFailed")} {checkError}</Alert>}
            {syncRequested && !checking && !checkError && pendingChanges.length === 0 && drawing.removals.length === 0 && (
              <Alert severity="success" onClose={() => setSyncRequested(false)}>{t("diagrams:sync.allInSync")}</Alert>
            )}
            {pendingChanges.length > 0 && (
              <Box sx={{ maxHeight: 160, overflowY: "auto", px: 1, bgcolor: "action.hover", borderRadius: 1 }}>
                <Typography variant="subtitle2">{t("boRelationship.inventoryChanges")}</Typography>
                {pendingChanges.map((change) => {
                  const value = change.after ?? change.before;
                  const label = value && "name" in value ? value.name
                    : value && "application" in value ? value.application.name
                    : value && "source" in value
                      ? [value.source, value.target].map((id) => drawing.nodes.find((node) => node.id === id)?.name ?? id).join(" ↔ ")
                      : change.id;
                  return <Stack direction="row" spacing={1} key={`${change.kind}:${change.id}`}>
                    <Typography>{label} · {t(`boRelationship.change_${change.change}`)}</Typography>
                    {canEdit && <Button disabled={busy} onClick={() => {
                      if (change.kind === "application_link" || change.placement) setLiveGroups({});
                      drawing.acceptChanges([change]);
                    }}>
                      {t("boRelationship.acceptChange")}
                    </Button>}
                  </Stack>;
                })}
              </Box>
            )}
            {canEdit && drawing.issues.length > 0 && (
              <Alert severity="warning">
                <Typography variant="subtitle2">{t("boRelationship.pendingSave")}</Typography>
                {drawing.issues.map(({ id, names, reason, detail, discardable }) => {
                  const name = names.filter(Boolean).join(" ↔ ");
                  return (
                    <Stack key={id} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">
                        {[name, detail || t(`boRelationship.${reason}`)].filter(Boolean).join(" · ")}
                      </Typography>
                      {discardable && (
                        <Button
                          size="small"
                          disabled={busy}
                          aria-label={t("boRelationship.discardFailedDraft", { name })}
                          onClick={() => drawing.discardFailedDraft(id)}
                        >
                          {t("boRelationship.discardDraft")}
                        </Button>
                      )}
                    </Stack>
                  );
                })}
              </Alert>
            )}
            {canEditRelations && drawing.removals.length > 0 && (
              <Stack spacing={1} sx={{ my: 1, maxHeight: 160, overflowY: "auto" }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="subtitle2">{t("boRelationship.pendingRemovals")}</Typography>
                  <Button disabled={busy} onClick={() => void drawing.syncRemovals(drawing.removals)}>
                    {t("boRelationship.syncAll")}
                  </Button>
                </Stack>
                {drawing.removals.map((item) => (
                  <Box key={item.edge.id} role="group" aria-label={item.label}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">{item.label}</Typography>
                      <Button disabled={busy} onClick={() => void drawing.syncRemovals([item])}>
                        {t("boRelationship.syncRemoval")}
                      </Button>
                      <Button disabled={busy} onClick={() => drawing.cancelRemoval(item.edge)}>
                        {t("boRelationship.cancelRemoval")}
                      </Button>
                    </Stack>
                    {item.error !== undefined && (
                      <Alert severity="error">{item.error || t("boRelationship.syncFailed")}</Alert>
                    )}
                  </Box>
                ))}
              </Stack>
            )}
          </Stack>
          <Box sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              md: applicationsOpen ? "minmax(172px, 0.27fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
              lg: [applicationsOpen && "minmax(184px, 0.26fr)", "minmax(0, 1fr)", panelOpen && "minmax(292px, 0.45fr)"].filter(Boolean).join(" "),
            },
            gridTemplateAreas: {
              xs: ['"canvas"', applicationsOpen && '"applications"', panelOpen && '"details"'].filter(Boolean).join(" "),
              md: applicationsOpen
                ? (panelOpen ? '"applications canvas" "details details"' : '"applications canvas"')
                : (panelOpen ? '"canvas" "details"' : '"canvas"'),
              lg: `"${[applicationsOpen && "applications", "canvas", panelOpen && "details"].filter(Boolean).join(" ")}"`,
            },
          }}>
            {applicationsOpen && <Stack component="aside" id={applicationsId} aria-label={t("boRelationship.applications")} spacing={1.5}
              sx={{ gridArea: "applications", minWidth: 0, p: 1.5,
                maxHeight: { md: "calc(var(--bo-canvas-height) + 40px)" }, overflowY: "auto",
                borderInlineEnd: (theme) => ({ md: `1px solid ${theme.palette.divider}` }),
                borderBlockStart: (theme) => ({ xs: `1px solid ${theme.palette.divider}`, md: 0 }) }}>
              <Typography variant="subtitle2">{t("boRelationship.applications")}</Typography>
              {!activeSelection && <Typography variant="body2" color="text.secondary">{t("boRelationship.noSelection")}</Typography>}
              {activeSelection && (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                    {selectedNode?.name}
                  </Typography>
                  {renderGroup(t("boRelationship.master"), group?.master ? [group.master] : [], true)}
                  {renderGroup(t("boRelationship.slave"), group?.slaves ?? [])}
                  {renderGroup(t("boRelationship.unclassified"), group?.unclassified ?? [])}
                  {canEditRelations && pendingApplications.length > 0 && (
                    <Box>
                      <Typography variant="subtitle2">{t("boRelationship.pendingLinks")}</Typography>
                      {pendingApplications.map(({ application, role }) => (
                        <Typography key={application.id} variant="body2" sx={{ overflowWrap: "anywhere" }}>
                          {application.name} · {t(`boRelationship.${role}`)}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </>
              )}
            </Stack>}
            <Box sx={{ gridArea: "canvas", minWidth: 0 }}>
              {(personalData || paymentData) && visibleNodes.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>{t("boRelationship.noFilterResults")}</Typography>
              )}
              <Box sx={{ height: "var(--bo-canvas-height)", minWidth: 0 }}>
                <BoRelationshipDiagram
                  ref={canvas}
                  showGrid={showGrid}
                  colorBy={colorBy}
                  display={display}
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  positions={drawing.positions}
                  selectedId={activeSelection}
                  selectedIds={selectedMany}
                  onActivate={activateObject}
                  onShortcut={onShortcut}
                  onChangeGeometry={canEdit && !busy ? drawing.setEdgeGeometry : undefined}
                  onChangeRouting={canEdit && !busy ? drawing.setEdgeRouting : undefined}
                  onMove={canEdit && !busy ? drawing.move : undefined}
                  onRequestRemoveEdge={canEditRelations && !busy ? (id) => {
                    if (drawing.discardDraftRelation(id)) return;
                    const edge = visibleEdges.find((item) => item.id === id);
                    if (edge) setConfirmRemoval(edge);
                  } : undefined}
                />
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap
                sx={{ borderTop: 1, borderColor: "divider", px: 1.5, py: 0.75 }}>
                {legend.map(([key, icon]) => (
                  <Stack key={key} direction="row" spacing={0.5} alignItems="center" color="text.secondary">
                    <MaterialSymbol icon={icon} size={iconSize.xs} />
                    <Typography variant="caption">{t(`boRelationship.${key}`)}</Typography>
                  </Stack>
                ))}
                <Stack direction="row" spacing={1} alignItems="center" color="text.secondary" aria-label={t("boRelationship.cardinality")}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <svg aria-hidden="true" width={22} height={16}><path d="M 1 8 H 21" fill="none" stroke="currentColor" /></svg>
                    <Typography variant="caption">1</Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <svg aria-hidden="true" width={22} height={16}><path d={`M 1 8 H 21 ${crowFoot({ x: 21, y: 8 }, { x: 1, y: 8 })}`} fill="none" stroke="currentColor" /></svg>
                    <Typography variant="caption">N / M</Typography>
                  </Stack>
                </Stack>
              </Stack>
            </Box>
            {panelOpen && <Box component="aside" id={detailsId} aria-label={t("boRelationship.cardDetails")}
              sx={{ gridArea: "details", minWidth: 0, minHeight: 0,
                borderInlineStart: (theme) => ({ lg: `1px solid ${theme.palette.divider}` }),
                borderBlockStart: (theme) => ({ xs: `1px solid ${theme.palette.divider}`, lg: 0 }) }}>
              {!drawerSelection && (
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ p: 1.5, color: "text.secondary" }}>
                  {glyph("description")}
                  <Typography variant="subtitle2">{t("boRelationship.cardDetails")}</Typography>
                </Stack>
              )}
              <CardDetailSidePanel
                cardId={drawerSelection}
                open={drawerSelection !== null}
                onClose={() => setPanelOpen(false)}
                docked
                boScoped
                onKeepCard={activateObject}
                refreshKey={detailVersion}
                onSaved={() => { refetch(); checkChanges(); }}
              />
            </Box>}
          </Box>
        </Card>
      )}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} actions={availableShortcuts} />
      {canCreateObjects && dialog === "object" && (
        <BoNewObjectDialog key={pasteQueue[0]?.id} copy={pasteQueue[0]} onClose={closeObjectDialog} onStage={(input) => {
          const id = drawing.stageObject(input);
          if (!id) return;
          activateObject(id);
          if (pasteQueue.length > 1) setPasteQueue((copies) => copies.slice(1));
          else closeObjectDialog();
        }} />
      )}
      {canEdit && renameObject && visibleIds.has(renameObject.id) && (
        <BoRenameDialog key={renameObject.id} object={renameObject} error={renameError} pending={renamePending}
          onClose={() => setRenameObject(null)} onRename={(name) => void rename(renameObject, name)} />
      )}
      {canEditRelations && dialog === "relation" && selectedNode && (
        <BoObjectLinkDialog source={selectedNode} targets={availableTargets} onClose={() => setDialog(null)} onStage={(input) => {
          drawing.stageRelation(input);
          setDialog(null);
        }} />
      )}
      {canLinkApplications && dialog === "application" && selectedNode && (
        <BoApplicationLinkDialog
          object={selectedNode}
          canManageMaster={canManageMaster}
          master={group?.master}
          pendingMaster={pendingApplications.find(({ role }) => role === "master")?.application}
          excludeIds={[
            ...(group?.master ? [group.master.id] : []),
            ...(group?.slaves ?? []).map(({ id }) => id),
            ...(group?.unclassified ?? []).map(({ id }) => id),
            ...pendingApplications.map(({ application }) => application.id),
          ]}
          onClose={() => setDialog(null)}
          onStage={(input) => {
            drawing.stageApplication(input);
            setDialog(null);
          }}
        />
      )}
      {canEditRelations && confirmRemoval && (
        <Dialog open onClose={() => setConfirmRemoval(null)} aria-labelledby="bo-remove-title">
          <DialogTitle id="bo-remove-title">{t("boRelationship.removeRelationTitle")}</DialogTitle>
          <DialogContent>
            <Typography variant="subtitle2">{removalLabel}</Typography>
            <Typography>{t("boRelationship.removeRelationDescription")}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmRemoval(null)}>{t("boRelationship.keepLine")}</Button>
            <Button color="error" onClick={() => {
              drawing.queueRemoval(confirmRemoval, removalLabel);
              setConfirmRemoval(null);
            }}>{t("boRelationship.queueRemoval")}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
