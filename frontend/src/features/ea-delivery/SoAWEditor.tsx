import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/DateField";
import { useParams, useNavigate, useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Collapse from "@mui/material/Collapse";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha, useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import OriginChip from "@/components/OriginChip";
import RichTextEditor from "./RichTextEditor";
import EditableTable from "./EditableTable";
import SignatureRequestDialog from "./SignatureRequestDialog";
import {
  getTemplateSections,
  getTogafPhases,
  buildDefaultSections,
  type TemplateSectionDef,
} from "./soawTemplate";
import { exportToDocx, exportToPdf } from "./soawExport";
import { SoawBanners, soawHref } from "./DecisionBanners";
import RevisionStrip, { showsRevisionStrip, soawRevisionItems } from "./RevisionStrip";
import { isLocked } from "./decisionStanding";
import {
  EMPTY_DOC_INFO,
  EMPTY_VERSION_ROW,
  canRequestSoawSignatures,
  canReviseSoaw,
  canSaveSoaw,
  reviseRefusal,
  soawCurrentRevisionId,
  soawEditorFields,
  soawSavePayload,
  soawStateFromLoaded,
  type SoawCustomSection,
  type SoawEditorFields,
} from "./soawEditorState";
import { hasUnsavedEdits } from "./editorDirty";
import DocumentHistoryButton from "./collab/DocumentHistoryButton";
import DocumentSidePanel from "./collab/DocumentSidePanel";
import SectionDiscussionMarker from "./collab/SectionDiscussionMarker";
import { documentPeopleIds } from "./mentions/mentionModel";
import { RejectDocumentDialog, SignDocumentDialog } from "./collab/ReviewDialogs";
import { deepLinkDialog } from "./collab/reviewDeepLink";
import { sectionOptions, signBody, soawSectionOptions } from "./collab/discussionModel";
import type { MentionKind } from "@/lib/mentionHtml";
import { api } from "@/api/client";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageSubject } from "@/hooks/usePageTitle";
import type { Card, SoAW, SoAWSectionData, SoAWSignatory } from "@/types";
import { DELIVERABLE_COLORS, RAG_COLORS, WARNING_STRONG_COLOR, brand } from "@/theme/tokens";

// ─── constants ──────────────────────────────────────────────────────────────

// ─── component ──────────────────────────────────────────────────────────────

/** What "@" offers in a SoAW's text. */
const DOCUMENT_MENTIONS: MentionKind[] = ["card", "decision"];

export default function SoAWEditor() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { formatDate, formatDateTime } = useDateFormat();

  const STATUS_CHIP: Record<string, { label: string; color: "default" | "warning" | "success" | "info" }> = {
    draft: { label: t("status.draft"), color: "default" },
    in_review: { label: t("status.inReview"), color: "warning" },
    approved: { label: t("status.approved"), color: "info" },
    signed: { label: t("status.signed"), color: "success" },
  };
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));
  const isNew = !id;

  // SoAW state
  const [name, setName] = useState("");
  usePageSubject(name);
  const [initiativeId, setInitiativeId] = useState("");
  const [status, setStatus] = useState("draft");
  const [docInfo, setDocInfo] = useState<SoAW["document_info"]>(EMPTY_DOC_INFO);
  const [versionHistory, setVersionHistory] = useState<SoAW["version_history"]>([
    EMPTY_VERSION_ROW,
  ]);
  const [sections, setSections] = useState<Record<string, SoAWSectionData>>(
    buildDefaultSections,
  );
  const [customSections, setCustomSections] = useState<SoawCustomSection[]>([]);

  // UI state
  const [initiatives, setInitiatives] = useState<Card[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionAfter, setNewSectionAfter] = useState("");
  // The loaded document's chain facts (revision pointers, the strip).
  const [detail, setDetail] = useState<SoAW | null>(null);
  // A revise refused because a revision is already being drafted.
  const [existingRevisionId, setExistingRevisionId] = useState<string | null>(null);
  const soawIdRef = useRef<string | null>(id ?? null);
  // What the server holds, as the fields a save would send for it: compared
  // with the live fields to know whether there are edits to save first.
  const storedRef = useRef<SoawEditorFields | null>(null);

  // Keep ref in sync when route param changes (e.g. after revision navigation)
  useEffect(() => {
    if (id) soawIdRef.current = id;
  }, [id]);

  // Signing state
  const [signatories, setSignatories] = useState<SoAWSignatory[]>([]);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [revisionNumber, setRevisionNumber] = useState(1);
  // The channel the document was created through (MCP, API, …) — null for
  // the web UI and for documents made before it was tracked.
  const [createdVia, setCreatedVia] = useState<string | null>(null);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  // Sign, with an optional note. A refused sign or reject is shown in its
  // dialog, which stays open.
  const [signOpen, setSignOpen] = useState(false);
  const [signError, setSignError] = useState("");
  const [rejectError, setRejectError] = useState("");
  const openSign = () => {
    setSignError("");
    setSignOpen(true);
  };
  const openReject = () => {
    setRejectError("");
    setRejectDialogOpen(true);
  };
  // Open discussion threads on this revision: the detail's count, then the
  // side panel's live one. Shown as a warning by the review dialogs.
  const [openThreads, setOpenThreads] = useState<number | undefined>(undefined);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  // The answer (or failure) of `/auth/me` is in.
  const [meLoaded, setMeLoaded] = useState(false);

  // Deep-link from the MCP `pending` workflow: /ea-delivery/soaw/:id?action=sign|reject
  // opens the matching dialog so the human can finish in one click, once the
  // document and the reader are known (`deepLinkDialog`).
  const [deepLink, setDeepLink] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    const action = searchParams.get("action");
    if (!action) return;
    setDeepLink(action);
    setSearchParams({}, { replace: true });
  }, [id, searchParams, setSearchParams]);
  const isSigned = status === "signed";
  // Sent for review or signed: the content is locked (recall to edit).
  const locked = isLocked(status);

  // ── load data ──────────────────────────────────────────────────────────

  useEffect(() => {
    const loadInitiatives = async () => {
      try {
        const res = await api.get<{ items: Card[] }>(
          "/cards?type=Initiative&page_size=500",
        );
        setInitiatives(res.items);
      } catch {
        /* non-critical */
      }
    };
    const loadCurrentUser = async () => {
      try {
        const res = await api.get<{ id: string }>("/auth/me");
        setCurrentUserId(res.id);
      } catch {
        /* non-critical */
      } finally {
        setMeLoaded(true);
      }
    };
    loadInitiatives();
    loadCurrentUser();
  }, []);

  // Every field from a document as the server returned it. The ONE path for
  // the detail: the load and every action whose reply is the document (save,
  // request signatures, sign, recall, reject) go through it.
  const applyLoaded = useCallback((data: SoAW) => {
    const state = soawStateFromLoaded(data);
    storedRef.current = soawEditorFields(state);
    setDetail(data);
    setName(state.name);
    setInitiativeId(state.initiativeId);
    setStatus(data.status);
    setDocInfo(state.docInfo);
    setVersionHistory(state.versionHistory);
    setSections(state.sections);
    setCustomSections(state.customSections);
    setSignatories(data.signatories ?? []);
    setSignedAt(data.signed_at);
    setRevisionNumber(data.revision_number ?? 1);
    setCreatedVia(data.created_via ?? null);
    setOpenThreads(data.open_thread_count);
  }, []);

  // An action's reply, applied only while the page still shows that document.
  const applyReply = (data: SoAW | null | undefined) => {
    if (data && data.id === soawIdRef.current) applyLoaded(data);
  };

  // Re-keyed on in-page revision navigation: only the latest load may fill
  // the page (a late reply for the revision just left would otherwise show,
  // and be saved over, the one now open).
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!id) return;
      setLoading(true);
      try {
        const data = await api.get<SoAW>(`/soaw/${id}`, { signal });
        if (!isCurrent()) return;
        applyLoaded(data);
        setExistingRevisionId(null);
      } catch (e) {
        if (isCurrent()) setError(e instanceof Error ? e.message : t("editor.error.loadFailed"));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [id],
  );

  // ── section update helpers ─────────────────────────────────────────────

  const updateSection = useCallback(
    (sectionId: string, patch: Partial<SoAWSectionData>) => {
      setSections((prev) => ({
        ...prev,
        [sectionId]: { ...prev[sectionId], ...patch },
      }));
    },
    [],
  );

  const toggleSectionHidden = useCallback((sectionId: string) => {
    setSections((prev) => ({
      ...prev,
      [sectionId]: {
        ...prev[sectionId],
        hidden: !prev[sectionId]?.hidden,
      },
    }));
  }, []);

  const toggleCollapse = (sectionId: string) =>
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));

  // ── custom sections ────────────────────────────────────────────────────

  const addCustomSection = () => {
    if (!newSectionTitle.trim()) return;
    const cid = `custom_${Date.now()}`;
    setCustomSections((prev) => [
      ...prev,
      {
        id: cid,
        title: newSectionTitle.trim(),
        content: "",
        insertAfter: newSectionAfter,
      },
    ]);
    setNewSectionTitle("");
    setNewSectionAfter("");
    setAddSectionOpen(false);
  };

  const removeCustomSection = (cid: string) => {
    setCustomSections((prev) => prev.filter((c) => c.id !== cid));
    setSections((prev) => {
      const next = { ...prev };
      delete next[cid];
      return next;
    });
  };

  const updateCustomContent = (cid: string, html: string) => {
    setCustomSections((prev) =>
      prev.map((c) => (c.id === cid ? { ...c, content: html } : c)),
    );
  };

  // ── save ───────────────────────────────────────────────────────────────

  // One save at a time: a second click before the first answered would
  // create the document twice.
  const save = useSubmitOnce();

  const editorFields = () =>
    soawEditorFields({ name, initiativeId, docInfo, versionHistory, sections, customSections });

  // Edits the server does not hold yet (always true on a new document).
  const hasEdits = () => hasUnsavedEdits(editorFields(), storedRef.current);

  // In review only the initiative link can change, and Save is offered only
  // when it did.
  const initiativeChanged = (initiativeId || null) !== (detail?.initiative_id ?? null);
  const showSave = canSaveSoaw(status, initiativeChanged);

  // Saves the editor; true when it saved. Errors are shown here.
  const saveEdits = async (): Promise<boolean> => {
    if (!name.trim()) {
      setError(t("editor.documentNameRequired"));
      return false;
    }
    const saved = await save.run(async () => {
      setSaving(true);
      setError("");
      try {
        // In review only the initiative link is sent: the content is locked.
        const payload = soawSavePayload(status, editorFields());
        if (soawIdRef.current) {
          applyReply(await api.patch<SoAW>(`/soaw/${soawIdRef.current}`, payload));
        } else {
          const created = await api.post<SoAW>("/soaw", payload);
          soawIdRef.current = created.id;
          // Route to the saved record so `id` resolves: the header, the
          // Preview and Request-signatures buttons and the `?action=` deep
          // links all key off it. A bare `history.replaceState` left the
          // editor in its "new document" shape until a reload.
          navigate(`/ea-delivery/soaw/${created.id}`, { replace: true });
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : t("editor.error.saveFailed"));
        return false;
      } finally {
        setSaving(false);
      }
    });
    return saved === true;
  };

  const handleSave = async () => {
    const savedStatus = status;
    if (!(await saveEdits())) return;
    // In review the save sent the initiative link alone: say so.
    setSnack(
      savedStatus === "in_review" ? t("editor.initiativeLinkSaved") : t("editor.savedSuccessfully"),
    );
  };

  // Requesting signatures locks the document and the server sends what it
  // holds for review: pending edits are saved first, and the dialog opens
  // only once they are (a failed save shows its error and opens nothing).
  const openRequestSignatures = async () => {
    if (hasEdits() && !(await saveEdits())) return;
    setSignDialogOpen(true);
  };

  // ── signing helpers ────────────────────────────────────────────────────

  const handleRequestSignatures = async (userIds: string[]) => {
    if (!soawIdRef.current || userIds.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const data = await api.post<SoAW>(
        `/soaw/${soawIdRef.current}/request-signatures`,
        { user_ids: userIds },
      );
      applyReply(data);
      setSignDialogOpen(false);
      setSnack(t("editor.signatureRequestsSent"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("editor.error.requestSignaturesFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleSign = async (note: string) => {
    if (!soawIdRef.current) return;
    setSaving(true);
    setError("");
    try {
      const data = await api.post<SoAW>(`/soaw/${soawIdRef.current}/sign`, signBody("soaw", note));
      applyReply(data);
      setSignOpen(false);
      setSnack(data.status === "signed" ? t("editor.documentFullySigned") : t("editor.signatureRecorded"));
    } catch (e) {
      setSignError(e instanceof Error && e.message ? e.message : t("editor.error.signFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleRecallSignatures = async () => {
    if (!soawIdRef.current) return;
    setSaving(true);
    setError("");
    try {
      const data = await api.post<SoAW>(
        `/soaw/${soawIdRef.current}/recall-signatures`,
      );
      applyReply(data);
      setSnack(t("editor.signaturesRecalled"));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("editor.error.recallFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (!soawIdRef.current || !reason) return;
    setSaving(true);
    setError("");
    try {
      const data = await api.post<SoAW>(
        `/soaw/${soawIdRef.current}/reject`,
        { comment: reason },
      );
      applyReply(data);
      setRejectDialogOpen(false);
      setSnack(t("editor.documentRejected"));
    } catch (e) {
      setRejectError(e instanceof Error && e.message ? e.message : t("editor.error.rejectFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleRevise = async () => {
    if (!soawIdRef.current) return;
    setSaving(true);
    setError("");
    setExistingRevisionId(null);
    try {
      const data = await api.post<SoAW>(`/soaw/${soawIdRef.current}/revise`);
      navigate(`/ea-delivery/soaw/${data.id}`);
    } catch (e) {
      const refusal = reviseRefusal(e);
      if (refusal?.kind === "open_revision_exists") {
        setExistingRevisionId(refusal.revisionId);
      } else if (refusal?.kind === "not_revisable") {
        setError(t("editor.error.notRevisable"));
      } else {
        setError(e instanceof Error ? e.message : t("editor.error.reviseFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  const canRevise = canReviseSoaw(status, detail);

  const currentUserIsSignatory = signatories.some(
    (s) => s.user_id === currentUserId && s.status === "pending"
  );

  // A deep link's dialog, once this document and the reader are known.
  const deepLinkReady = deepLink !== null && meLoaded && detail !== null && detail.id === id;
  useEffect(() => {
    if (!deepLinkReady || deepLink === null) return;
    setDeepLink(null);
    const dialog = deepLinkDialog(deepLink, currentUserIsSignatory);
    if (dialog === "sign") {
      setSignError("");
      setSignOpen(true);
    } else if (dialog === "request-signatures") setSignDialogOpen(true);
    else if (dialog === "reject") {
      setRejectError("");
      setRejectDialogOpen(true);
    }
  }, [deepLinkReady, deepLink, currentUserIsSignatory]);

  // ── version history helpers ────────────────────────────────────────────

  const addVersionRow = () =>
    setVersionHistory((prev) => [
      ...prev,
      { version: "", date: "", revised_by: "", description: "" },
    ]);

  const updateVersionRow = (
    idx: number,
    field: string,
    value: string,
  ) =>
    setVersionHistory((prev) =>
      prev.map((row, i) =>
        i === idx ? { ...row, [field]: value } : row,
      ),
    );

  const removeVersionRow = (idx: number) => {
    if (versionHistory.length <= 1) return;
    setVersionHistory((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── build ordered section list (template + custom interleaved) ─────────

  const orderedSections = (): (
    | { kind: "template"; def: TemplateSectionDef; data: SoAWSectionData }
    | { kind: "custom"; cs: typeof customSections[number] }
    | { kind: "part_header"; part: "I" | "II" }
  )[] => {
    const result: ReturnType<typeof orderedSections> = [];
    let currentPart: "I" | "II" | null = null;

    for (const def of getTemplateSections()) {
      // Insert part headers
      if (def.part !== currentPart) {
        currentPart = def.part;
        result.push({ kind: "part_header", part: def.part });
      }

      result.push({
        kind: "template",
        def,
        data: sections[def.id] ?? {
          content: "",
          hidden: false,
        },
      });

      // Insert custom sections that go after this template section
      for (const cs of customSections) {
        if (cs.insertAfter === def.id) {
          result.push({ kind: "custom", cs });
        }
      }
    }

    // Custom sections without a specific insertAfter go at the end
    for (const cs of customSections) {
      if (
        !cs.insertAfter ||
        !getTemplateSections().some((d) => d.id === cs.insertAfter)
      ) {
        if (!result.some((r) => r.kind === "custom" && r.cs.id === cs.id)) {
          result.push({ kind: "custom", cs });
        }
      }
    }

    return result;
  };

  // ── render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const stripItems = detail ? soawRevisionItems(detail.revisions ?? [], t) : [];
  const stripShown = showsRevisionStrip(stripItems);
  const historyButton = (placeCompact: boolean) =>
    !isNew && id ? (
      <DocumentHistoryButton<SoAW>
        owner={{ kind: "soaw", id }}
        label={name || t("editor.untitled")}
        status={status}
        refreshKey={detail?.updated_at}
        isDirty={hasEdits}
        onRestored={(data) => applyReply(data)}
        compact={placeCompact}
      />
    ) : null;

  return (
    <DocumentSidePanel
      owner={!isNew && id ? { kind: "soaw", id } : null}
      sections={sectionOptions(
        "soaw",
        t,
        soawSectionOptions(
          getTemplateSections(),
          Object.fromEntries(customSections.map((cs) => [cs.id, { title: cs.title }])),
        ),
      )}
      openThreadCount={detail?.open_thread_count}
      onOpenCountChange={setOpenThreads}
      refreshKey={detail?.updated_at}
      mentionContext={{ priorityUserIds: documentPeopleIds({ signatories }) }}
    >
    <Box sx={{ maxWidth: 960, mx: "auto" }}>
      {/* Top bar */}
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", mb: 3, gap: 1 }}>
        <Tooltip title={t("editor.backTooltip")}>
          <IconButton onClick={() => navigate("/ea-delivery")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        {!compact && <MaterialSymbol icon="description" size={26} color={DELIVERABLE_COLORS.soaw} />}
        <Typography
          variant={compact ? "subtitle1" : "h5"}
          sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}
          noWrap
        >
          {isNew ? t("editor.newTitle") : name || t("editor.untitled")}
        </Typography>
        {!stripShown && historyButton(compact)}
        {!isNew && (
          compact ? (
            <Tooltip title={t("editor.preview")}>
              <IconButton onClick={() => navigate(`/ea-delivery/soaw/${soawIdRef.current}/preview`)}>
                <MaterialSymbol icon="visibility" size={20} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="visibility" size={18} />}
              sx={{ textTransform: "none" }}
              onClick={() => navigate(`/ea-delivery/soaw/${soawIdRef.current}/preview`)}
            >
              {t("editor.preview")}
            </Button>
          )
        )}
        {compact ? (
          <Tooltip title={t("editor.exportPdf")}>
            <IconButton
              onClick={() => exportToPdf(name, docInfo, versionHistory, sections, customSections, revisionNumber, signatories, signedAt)}
            >
              <MaterialSymbol icon="picture_as_pdf" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="picture_as_pdf" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => exportToPdf(name, docInfo, versionHistory, sections, customSections, revisionNumber, signatories, signedAt)}
          >
            {t("editor.pdf")}
          </Button>
        )}
        {!isSigned && (compact ? (
          <Tooltip title={t("editor.exportWord")}>
            <IconButton
              onClick={() => exportToDocx(name, docInfo, versionHistory, sections, customSections)}
            >
              <MaterialSymbol icon="article" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="article" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => exportToDocx(name, docInfo, versionHistory, sections, customSections)}
          >
            {t("editor.word")}
          </Button>
        ))}
        {showSave && (
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? t("editor.saving") : t("editor.save")}
          </Button>
        )}
        {/* Signing actions: a draft or an approved document only. */}
        {!isNew && canRequestSoawSignatures(status) && soawIdRef.current && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="draw" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={openRequestSignatures}
          >
            {t("editor.requestSignatures")}
          </Button>
        )}
        {currentUserIsSignatory && (
          <>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<MaterialSymbol icon="task_alt" size={18} />}
              sx={{ textTransform: "none" }}
              disabled={saving}
              onClick={openSign}
            >
              {t("editor.sign")}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<MaterialSymbol icon="block" size={18} />}
              sx={{ textTransform: "none" }}
              disabled={saving}
              onClick={openReject}
            >
              {t("editor.reject")}
            </Button>
          </>
        )}
        {canRevise && (
          <Button
            size="small"
            variant="contained"
            startIcon={<MaterialSymbol icon="content_copy" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleRevise}
          >
            {t("editor.newRevision")}
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {existingRevisionId && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          data-testid="soaw-open-revision-exists"
          onClose={() => setExistingRevisionId(null)}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => navigate(soawHref(existingRevisionId))}
            >
              {t("editor.revise.openExisting")}
            </Button>
          }
        >
          {t("editor.revise.openRevisionExists")}
        </Alert>
      )}

      {/* Chain pointers (earlier revision, revision being drafted, review
          lock) and the revision strip. */}
      {detail && !isNew && (
        <Box sx={{ mb: 2, display: "flex", flexDirection: "column", gap: 1 }}>
          <SoawBanners soaw={{ ...detail, status: status as SoAW["status"] }} mode="editor" />
          {stripShown && (
            <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
              <RevisionStrip
                items={stripItems}
                activeId={detail.id}
                currentId={soawCurrentRevisionId(detail)}
                hrefFor={soawHref}
              />
              {historyButton(false)}
            </Box>
          )}
        </Box>
      )}

      {/* Signed banner */}
      {isSigned && (
        <Alert severity="success" sx={{ mb: 2 }} icon={<MaterialSymbol icon="verified" size={20} />}>
          {t("editor.signedBanner", { date: signedAt ? formatDate(signedAt) : "N/A" })}
          {revisionNumber > 1 && t("editor.signedBannerRevision", { number: revisionNumber })}
        </Alert>
      )}

      {/* Signatories progress */}
      {signatories.length > 0 && !isSigned && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          icon={<MaterialSymbol icon="draw" size={20} />}
        >
          {t("editor.signaturesProgress", { signed: signatories.filter((s) => s.status === "signed").length, total: signatories.length })}
        </Alert>
      )}

      {/* ── Document metadata ──────────────────────────────────────────── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          {t("editor.documentInfo")}
        </Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}>
          <TextField
            label={t("editor.documentName")}
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={locked}
          />
          <TextField
            select
            label={t("editor.initiative")}
            fullWidth
            value={initiativeId}
            onChange={(e) => setInitiativeId(e.target.value)}
            disabled={isSigned}
          >
            <MenuItem value="">
              <em>{t("common:labels.none")}</em>
            </MenuItem>
            {initiatives.map((init) => (
              <MenuItem key={init.id} value={init.id}>
                {init.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, mb: 2 }}>
          <TextField
            label={t("editor.preparedBy")}
            fullWidth
            value={docInfo.prepared_by}
            onChange={(e) =>
              setDocInfo((p) => ({ ...p, prepared_by: e.target.value }))
            }
            disabled={locked}
          />
          <TextField
            label={t("editor.reviewedBy")}
            fullWidth
            value={docInfo.reviewed_by}
            onChange={(e) =>
              setDocInfo((p) => ({ ...p, reviewed_by: e.target.value }))
            }
            disabled={locked}
          />
          <DateField
            label={t("editor.reviewDate")}
            fullWidth
            value={docInfo.review_date}
            onChange={(v) =>
              setDocInfo((p) => ({ ...p, review_date: v }))
            }
            disabled={locked}
          />
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Chip
            label={(STATUS_CHIP[status] ?? STATUS_CHIP.draft).label}
            color={(STATUS_CHIP[status] ?? STATUS_CHIP.draft).color}
            size="small"
          />
          {status === "in_review" && (
            <Tooltip title={t("editor.recallSignaturesTooltip")}>
              <Button
                size="small"
                color="warning"
                startIcon={<MaterialSymbol icon="undo" size={16} />}
                sx={{ textTransform: "none" }}
                disabled={saving}
                onClick={handleRecallSignatures}
              >
                {t("editor.recallSignatures")}
              </Button>
            </Tooltip>
          )}
          {revisionNumber > 1 && (
            <Chip
              label={t("editor.revisionLabel", { number: revisionNumber })}
              size="small"
              variant="outlined"
            />
          )}
          <OriginChip origin={createdVia} />
        </Box>
      </Paper>

      {/* ── Version History ────────────────────────────────────────────── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>
            {t("editor.versionHistory")}
          </Typography>
          {!locked && (
            <Tooltip title={t("editor.addVersionEntry")}>
              <IconButton size="small" onClick={addVersionRow}>
                <MaterialSymbol icon="add" size={18} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "action.hover" }}>
              <TableCell sx={{ fontWeight: 600 }}>{t("editor.version")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("editor.date")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("editor.revisedBy")}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t("editor.description")}</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {versionHistory.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    disabled={locked}
                    value={row.version}
                    onChange={(e) =>
                      updateVersionRow(idx, "version", e.target.value)
                    }
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  <DateField
                    size="small"
                    fullWidth
                    disabled={locked}
                    value={row.date}
                    onChange={(v) => updateVersionRow(idx, "date", v)}
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    disabled={locked}
                    value={row.revised_by}
                    onChange={(e) =>
                      updateVersionRow(idx, "revised_by", e.target.value)
                    }
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    disabled={locked}
                    value={row.description}
                    onChange={(e) =>
                      updateVersionRow(idx, "description", e.target.value)
                    }
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  {!locked && versionHistory.length > 1 && (
                    <IconButton size="small" onClick={() => removeVersionRow(idx)}>
                      <MaterialSymbol icon="close" size={16} />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* ── Template sections ──────────────────────────────────────────── */}
      {orderedSections().map((entry) => {
        if (entry.kind === "part_header") {
          return (
            <Box key={`part-${entry.part}`} sx={{ mt: 4, mb: 2 }}>
              <Divider />
              <Typography
                variant="h5"
                sx={{ fontWeight: 700, mt: 2, color: "primary.main" }}
              >
                {entry.part === "I"
                  ? t("editor.partI")
                  : t("editor.partII")}
              </Typography>
            </Box>
          );
        }

        if (entry.kind === "custom") {
          const { cs } = entry;
          return (
            <Paper key={cs.id} sx={{ p: 3, mb: 2, borderLeft: `4px solid ${brand.primary}` }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
                <Chip label={t("editor.customLabel")} size="small" color="primary" sx={{ mr: 1 }} />
                <Box sx={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>{cs.title}</Typography>
                  <SectionDiscussionMarker section={cs.id} />
                </Box>
                {!locked && (
                  <Tooltip title={t("editor.removeCustomSection")}>
                    <IconButton
                      size="small"
                      onClick={() => removeCustomSection(cs.id)}
                    >
                      <MaterialSymbol icon="delete_outline" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              <RichTextEditor
                mentions={DOCUMENT_MENTIONS}
                content={cs.content}
                onChange={(html) => updateCustomContent(cs.id, html)}
                placeholder={t("editor.enterContent")}
                readOnly={locked}
              />
            </Paper>
          );
        }

        // Template section
        const { def, data } = entry;
        const isCollapsed = collapsedSections[def.id] ?? false;
        const isHidden = data.hidden;

        return (
          <Paper
            key={def.id}
            sx={{
              p: 3,
              mb: 2,
              opacity: isHidden ? 0.5 : 1,
              borderLeft: isHidden ? "4px solid" : "none",
              borderLeftColor: isHidden ? "action.disabled" : undefined,
            }}
          >
            {/* Section header */}
            <Box sx={{ display: "flex", alignItems: "center", mb: isCollapsed ? 0 : 1.5 }}>
              <IconButton
                size="small"
                sx={{ mr: 0.5 }}
                onClick={() => toggleCollapse(def.id)}
              >
                <MaterialSymbol
                  icon={isCollapsed ? "chevron_right" : "expand_more"}
                  size={20}
                />
              </IconButton>
              <Box sx={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
                <Typography
                  sx={{
                    fontWeight: 600,
                    fontSize: def.level === 2 ? "1.1rem" : "0.95rem",
                    textDecoration: isHidden ? "line-through" : "none",
                  }}
                >
                  {def.title}
                </Typography>
                <SectionDiscussionMarker section={def.id} />
              </Box>
              {!locked && (
                <Tooltip title={isHidden ? t("editor.showSection") : t("editor.hideSection")}>
                  <IconButton
                    size="small"
                    onClick={() => toggleSectionHidden(def.id)}
                  >
                    <MaterialSymbol
                      icon={isHidden ? "visibility_off" : "visibility"}
                      size={18}
                    />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            {/* Section body */}
            <Collapse in={!isCollapsed && !isHidden}>
              {def.preamble && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5 }}
                >
                  {def.preamble}
                </Typography>
              )}

              {def.type === "rich_text" && (
                <RichTextEditor
                  mentions={DOCUMENT_MENTIONS}
                  content={data.content}
                  onChange={(html) =>
                    updateSection(def.id, { content: html })
                  }
                  placeholder={def.hint}
                  readOnly={locked}
                />
              )}

              {def.type === "table" && data.table_data && (
                <EditableTable
                  columns={data.table_data.columns}
                  rows={data.table_data.rows}
                  onChange={(rows) =>
                    updateSection(def.id, {
                      table_data: {
                        columns: data.table_data!.columns,
                        rows,
                      },
                    })
                  }
                  readOnly={locked}
                />
              )}

              {def.type === "togaf_phases" && (
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell sx={{ fontWeight: 600, width: 280 }}>{t("editor.phase")}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>
                        {t("editor.relevantArtefacts")}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {getTogafPhases().map((phase) => (
                      <TableRow key={phase.key}>
                        <TableCell>{phase.label}</TableCell>
                        <TableCell sx={{ p: 0.5 }}>
                          <TextField
                            size="small"
                            fullWidth
                            multiline
                            disabled={locked}
                            placeholder={t("editor.togafPlaceholder")}
                            value={data.togaf_data?.[phase.key] ?? ""}
                            onChange={(e) => {
                              const next = {
                                ...(data.togaf_data ?? {}),
                                [phase.key]: e.target.value,
                              };
                              updateSection(def.id, { togaf_data: next });
                            }}
                            variant="standard"
                            InputProps={{ disableUnderline: true }}
                            sx={{ px: 1 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Collapse>

            {/* Show collapsed indicator when hidden */}
            {isHidden && !isCollapsed && (
              <Typography variant="body2" color="text.disabled" sx={{ ml: 4 }}>
                {t("editor.hiddenNote")}
              </Typography>
            )}
          </Paper>
        );
      })}

      {/* ── Add custom section ─────────────────────────────────────────── */}
      {!locked && (
        <Box sx={{ display: "flex", justifyContent: "center", my: 3 }}>
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => setAddSectionOpen(true)}
          >
            {t("editor.addCustomSection")}
          </Button>
        </Box>
      )}

      <Dialog
        open={addSectionOpen}
        onClose={() => setAddSectionOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("editor.addCustomSection")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label={t("editor.sectionTitle")}
            fullWidth
            value={newSectionTitle}
            onChange={(e) => setNewSectionTitle(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            onKeyDown={(e) => e.key === "Enter" && addCustomSection()}
          />
          <TextField
            select
            label={t("editor.insertAfter")}
            fullWidth
            value={newSectionAfter}
            onChange={(e) => setNewSectionAfter(e.target.value)}
            helperText={t("editor.insertAfterHelper")}
          >
            <MenuItem value="">
              <em>{t("editor.endOfDocument")}</em>
            </MenuItem>
            {getTemplateSections().map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.title}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddSectionOpen(false)}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            disabled={!newSectionTitle.trim()}
            onClick={addCustomSection}
          >
            {t("common:actions.add")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Signature Block ───────────────────────────────────────────── */}
      {signatories.length > 0 && (
        <Paper sx={{ p: 3, mb: 3, border: "2px solid", borderColor: isSigned ? "success.main" : "grey.300" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <MaterialSymbol
              icon={isSigned ? "verified" : "draw"}
              size={24}
              color={isSigned ? RAG_COLORS.green : WARNING_STRONG_COLOR}
            />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t("editor.signatures")}
            </Typography>
            {isSigned && (
              <Chip label={t("editor.fullySigned")} size="small" color="success" />
            )}
          </Box>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            {signatories.map((sig) => (
              <Box
                key={sig.user_id}
                sx={{
                  p: 2,
                  border: "1px solid",
                  borderColor: sig.status === "signed" ? "success.light" : "divider",
                  borderRadius: 1,
                  bgcolor:
                    sig.status === "signed"
                      ? alpha(theme.palette.success.main, 0.08)
                      : "action.hover",
                }}
              >
                {sig.status === "signed" ? (
                  <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <MaterialSymbol icon="verified" size={20} color={RAG_COLORS.green} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "success.dark" }}>
                        {t("editor.sigApproved")}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {sig.display_name}
                    </Typography>
                    {sig.email && (
                      <Typography variant="caption" color="text.secondary">
                        {sig.email}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      {t("editor.sigSignedAt", { date: sig.signed_at ? formatDateTime(sig.signed_at) : "N/A" })}
                    </Typography>
                  </>
                ) : (
                  <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <MaterialSymbol icon="pending" size={20} color={WARNING_STRONG_COLOR} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "warning.dark" }}>
                        {t("editor.sigPending")}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {sig.display_name}
                    </Typography>
                    {sig.email && (
                      <Typography variant="caption" color="text.secondary">
                        {sig.email}
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* ── Bottom save bar ────────────────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 1,
          pb: 4,
        }}
      >
        <Button
          variant="outlined"
          sx={{ textTransform: "none" }}
          onClick={() => navigate("/ea-delivery")}
        >
          {t("common:actions.back")}
        </Button>
        {showSave && (
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? t("editor.saving") : t("editor.save")}
          </Button>
        )}
        {canRevise && (
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="content_copy" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleRevise}
          >
            {t("editor.newRevision")}
          </Button>
        )}
      </Box>

      {/* Request Signatures dialog */}
      <SignatureRequestDialog
        open={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onRequest={handleRequestSignatures}
        title={t("editor.signDialog.title")}
        description={t("editor.signDialog.description")}
        requesting={saving}
        openThreadCount={openThreads}
      />

      {/* Sign and reject dialogs */}
      <SignDocumentDialog
        open={signOpen}
        onClose={() => setSignOpen(false)}
        onSign={handleSign}
        title={t("collab.sign.soawTitle")}
        description={t("collab.sign.soawDescription")}
        openThreadCount={openThreads}
        busy={saving}
        error={signError}
        onDismissError={() => setSignError("")}
      />
      <RejectDocumentDialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        onReject={handleReject}
        title={t("editor.rejectDialog.title")}
        description={t("editor.rejectDialog.description")}
        label={t("editor.rejectDialog.commentLabel")}
        submitLabel={t("editor.reject")}
        openThreadCount={openThreads}
        busy={saving}
        error={rejectError}
        onDismissError={() => setRejectError("")}
      />

      {/* Snackbar */}
      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
    </DocumentSidePanel>
  );
}
