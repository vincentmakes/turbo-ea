import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Link from "@mui/material/Link";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker from "@/components/CardPicker";
import { DateField } from "@/components/DateField";
import RichTextEditor from "./RichTextEditor";
import SignatureRequestDialog from "./SignatureRequestDialog";
import DecisionBanners from "./DecisionBanners";
import RevisionStrip, { decisionRevisionItems, showsRevisionStrip } from "./RevisionStrip";
import DecisionPeopleField from "./DecisionPeopleField";
import DecisionLinksBlock from "./DecisionLinksBlock";
import DecisionFilesSection from "./DecisionFilesSection";
import RecordAsDecidedDialog from "./RecordAsDecidedDialog";
import ReviseMenu, { createRevision } from "./ReviseMenu";
import { DecisionStandingChip, DecisionStatusChip } from "./DecisionStandingChip";
import { decisionRefLabel } from "./decisionStanding";
import { problemMessage } from "./decisionProblems";
import {
  buildSavePayload,
  canRecord,
  chainIds,
  contentFromDetail,
  currentRevisionId,
  editorAccess,
  storedPayload,
  type SavePayload,
} from "./adrEditorModel";
import { hasUnsavedEdits } from "./editorDirty";
import DocumentHistoryButton from "./collab/DocumentHistoryButton";
import DocumentSidePanel from "./collab/DocumentSidePanel";
import SectionDiscussionMarker from "./collab/SectionDiscussionMarker";
import { RejectDocumentDialog, SignDocumentDialog } from "./collab/ReviewDialogs";
import { deepLinkDialog } from "./collab/reviewDeepLink";
import { sectionOptions, signBody } from "./collab/discussionModel";
import {
  documentPeopleIds,
  unlinkedMentionedCards,
  type MentionContext,
} from "./mentions/mentionModel";
import type { MentionKind } from "@/lib/mentionHtml";
import { api, ApiError } from "@/api/client";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageSubject } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/components/RequirePermission";
import { ExtensionBoundary, ExtensionSlot, useExtensionAdrPanels } from "@/lib/extensionHost";
import { printAdr } from "./adrPrint";
import type {
  ArchitectureDecision,
  DecisionLinkInput,
  DecisionPerson,
  SoAWSignatory,
} from "@/types";
import { STATUS_COLORS as STATUS_HUES } from "@/theme/tokens";

const CHANGE_SUMMARY_MAX = 2000;
/** What "@" offers in a decision's text. */
const DOCUMENT_MENTIONS: MentionKind[] = ["card", "decision"];

export default function ADREditor() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { formatDate } = useDateFormat();
  const { user } = useAuth();
  const adrPanels = useExtensionAdrPanels();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));
  const isNew = !id;
  // The record as last loaded, so an export keeps the audit fields (creator,
  // created / modified dates) the editor has no state for.
  const loadedRef = useRef<ArchitectureDecision | null>(null);
  // The same record as state, for what renders from it: banners, the revision
  // strip, standing, links, files.
  const [detail, setDetail] = useState<ArchitectureDecision | null>(null);
  // Bumped to load the record again (a save refused because it was locked).
  const [reloadKey, setReloadKey] = useState(0);
  // What the server holds, as the payload Save would send for it: compared
  // with the live payload to know whether there are edits to save first.
  const storedRef = useRef<SavePayload | null>(null);
  // The decision this page shows now: a reply for another one (the user moved
  // to another revision while it was in flight) is not applied.
  const idRef = useRef(id);
  useEffect(() => {
    idRef.current = id;
  }, [id]);

  // ADR state
  const [title, setTitle] = useState("");
  // Follows the draft title as it is typed, the way a document editor does.
  usePageSubject(title);
  const [status, setStatus] = useState("draft");
  const [context, setContext] = useState("");
  const [decision, setDecision] = useState("");
  const [consequences, setConsequences] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [revisionNumber, setRevisionNumber] = useState(1);
  const [signatories, setSignatories] = useState<SoAWSignatory[]>([]);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  // The ADR attributes bag (`ext.*` keys). Passed verbatim to the extension
  // slots so a contribution can gate itself (e.g. show a jump button only when
  // it has data) without an extra fetch. Core owns the bag; it is generic here.
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [linkedCards, setLinkedCards] = useState<
    { id: string; name: string; type: string }[]
  >([]);
  const [decidedOn, setDecidedOn] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [decisionMakers, setDecisionMakers] = useState<DecisionPerson[]>([]);
  const [participants, setParticipants] = useState<DecisionPerson[]>([]);
  const [links, setLinks] = useState<DecisionLinkInput[]>([]);
  const [changeSummary, setChangeSummary] = useState("");

  // UI state
  // Loading from the first render for a saved decision: the page (and the
  // discussion panel, which reads on mount) is not mounted before the load.
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [snackbar, setSnackbar] = useState("");
  // One-shot workflow actions (sign, duplicate, revise, link a card) run one
  // at a time: a double click must not send the same POST twice, and the
  // buttons say so while one runs. Save has its own guard: it may not run
  // twice either, but it must not be blocked by a sign in flight.
  const action = useSubmitOnce();
  const save = useSubmitOnce();

  // Sign dialog
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [requestingSignatures, setRequestingSignatures] = useState(false);

  // Record-as-decided dialog
  const [recordOpen, setRecordOpen] = useState(false);

  // Sign (with an optional note) and reject dialogs, and why the last
  // attempt from each was refused (shown inside the dialog).
  const [signOpen, setSignOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
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

  // Deep-link handler: when the MCP server returns a `pending` response
  // with `deep_link: /ea-delivery/adr/{id}?action=sign|reject|request-
  // signatures`, the user clicks it and lands here. Auto-open the
  // matching dialog so the human can finish the workflow in one click.
  // The param is consumed (cleared) so a refresh doesn't re-open; the dialog
  // opens once the decision and the reader are known (`deepLinkDialog`).
  const [deepLink, setDeepLink] = useState<string | null>(null);
  useEffect(() => {
    if (isNew) return;
    const action = searchParams.get("action");
    if (!action) return;
    setDeepLink(action);
    setSearchParams({}, { replace: true });
  }, [isNew, searchParams, setSearchParams]);

  // Current user (`meLoaded` once the answer, or its failure, is in)
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [meLoaded, setMeLoaded] = useState(false);

  // Card link dialog
  const [cardLinkOpen, setCardLinkOpen] = useState(false);

  const isSigned = status === "signed";
  const access = editorAccess(status, isNew);
  const locked = access.locked;
  const canManage = hasPermission(user?.permissions, "adr.manage");
  const isRevision = Boolean(detail?.parent_id);

  // Load current user
  useEffect(() => {
    api
      .get<{ id: string }>("/auth/me")
      .then((res) => setCurrentUserId(res.id))
      .catch(() => {})
      .finally(() => setMeLoaded(true));
  }, []);

  // Every field from a decision as the server returned it. The ONE path for
  // the detail: the load and every action whose reply is the detail (save,
  // request signatures, sign, recall, reject, record) go through it, so the
  // links block, banners, standing chip and revise menu never go stale.
  const applyLoaded = useCallback((adr: ArchitectureDecision) => {
    const content = contentFromDetail(adr);
    loadedRef.current = adr;
    storedRef.current = storedPayload(adr);
    setDetail(adr);
    setTitle(content.title);
    setStatus(adr.status);
    setContext(content.context);
    setDecision(content.decision);
    setConsequences(content.consequences);
    setAlternatives(content.alternatives);
    setReferenceNumber(adr.reference_number);
    setRevisionNumber(adr.revision_number);
    setSignatories(adr.signatories || []);
    setSignedAt(adr.signed_at);
    setAttributes(adr.attributes || {});
    setLinkedCards(adr.linked_cards || []);
    setDecidedOn(content.decidedOn);
    setEffectiveFrom(content.effectiveFrom);
    setValidUntil(content.validUntil);
    setDecisionMakers(content.decisionMakers);
    setParticipants(content.participants);
    setLinks(content.links);
    setChangeSummary(content.changeSummary);
    setOpenThreads(adr.open_thread_count);
  }, []);

  // An action's reply, applied only while the page still shows that decision.
  const applyReply = (adr: ArchitectureDecision | null | undefined) => {
    if (adr && adr.id === idRef.current) applyLoaded(adr);
  };

  // Load existing ADR. Re-keyed on in-page revision navigation: only the
  // latest load may fill the page (a late reply for the revision just left
  // would otherwise show, and be saved over, the one now open).
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!id) return;
      setLoading(true);
      try {
        const adr = await api.get<ArchitectureDecision>(`/adr/${id}`, { signal });
        if (isCurrent()) applyLoaded(adr);
      } catch {
        if (isCurrent()) setError(t("adr.editor.error.loadFailed"));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [id, reloadKey],
  );

  // Save
  // Exports read the editor's live state, unsaved edits included — the SoAW
  // editor does the same, so what you see is what you print.
  const editorAdr = (): ArchitectureDecision => ({
    related_decisions: [],
    created_by: null,
    parent_id: null,
    created_at: null,
    updated_at: null,
    ...(loadedRef.current ?? {}),
    id: id ?? "",
    reference_number: referenceNumber,
    title,
    status: status as ArchitectureDecision["status"],
    context,
    decision,
    consequences,
    alternatives_considered: alternatives,
    signatories,
    signed_at: signedAt,
    revision_number: revisionNumber,
    attributes,
    linked_cards: linkedCards,
    decided_on: decidedOn || null,
    effective_from: effectiveFrom || null,
    valid_until: validUntil || null,
    decision_makers: decisionMakers,
    participants,
    change_summary: changeSummary || null,
  });

  const handleExportPdf = () => printAdr(editorAdr());

  const handleExportWord = async () => {
    try {
      // Lazy: keeps the docx engine out of the editor chunk until asked for.
      const { exportAdrsToDocx } = await import("./adrExport");
      await exportAdrsToDocx([editorAdr()]);
    } catch {
      setError(t("adr.export.error"));
    }
  };

  const savePayload = () =>
    buildSavePayload(
      {
        title,
        context,
        decision,
        consequences,
        alternatives,
        decidedOn,
        effectiveFrom,
        validUntil,
        decisionMakers,
        participants,
        links,
        changeSummary,
      },
      isRevision,
    );

  // Edits the server does not hold yet (always true on a new decision).
  const hasEdits = () => hasUnsavedEdits(savePayload(), storedRef.current);

  // Saves the editor; true when it saved. Errors are shown here.
  const saveEdits = async (): Promise<boolean> => {
    if (!title.trim()) {
      setError(t("adr.editor.titleRequired"));
      return false;
    }
    const saved = await save.run(async () => {
      setSaving(true);
      try {
        const payload = savePayload();
        if (isNew) {
          const created = await api.post<ArchitectureDecision>("/adr", payload);
          navigate(`/ea-delivery/adr/${created.id}`, { replace: true });
        } else {
          applyReply(await api.patch<ArchitectureDecision>(`/adr/${id}`, payload));
        }
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          // Locked meanwhile (sent for review elsewhere): show what it now is.
          setError(t("adr.editor.error.locked"));
          setReloadKey((k) => k + 1);
        } else {
          setError(problemMessage(err, t) ?? t("adr.editor.error.saveFailed"));
        }
        return false;
      } finally {
        setSaving(false);
      }
    });
    return saved === true;
  };

  const handleSave = async () => {
    if (await saveEdits()) setSnackbar(t("adr.editor.savedSuccessfully"));
  };

  // Requesting signatures locks the decision, and the server sends what it
  // holds for review: pending edits are saved first, and the dialog opens only
  // once they are (a failed save shows its error and opens nothing).
  const openRequestSignatures = async () => {
    if (hasEdits() && !(await saveEdits())) return;
    setSignDialogOpen(true);
  };

  // Record as decided saves pending edits first too: the backend checks the
  // decision makers it holds, not the ones on screen. A failure throws, and
  // the dialog shows it without recording.
  const saveBeforeRecord = async () => {
    if (!hasEdits()) return;
    applyReply(await api.patch<ArchitectureDecision>(`/adr/${id}`, savePayload()));
  };

  const handleRecorded = (adr: ArchitectureDecision) => {
    applyReply(adr);
    setRecordOpen(false);
    setSnackbar(t("adr.record.done"));
  };

  // "Create consolidated revision" on an amended decision: a revision naming
  // the amending decisions, then open it.
  const handleConsolidate = () =>
    action.run(async () => {
      if (!id) return;
      const amenders = (detail?.amended_by ?? []).map((r) => r.id);
      const out = await createRevision(id, { consolidates: amenders }, t);
      if ("error" in out) {
        setError(out.error);
        return;
      }
      navigate(`/ea-delivery/adr/${out.id}`);
      setSnackbar(out.notice);
    });

  // Duplicate
  const handleDuplicate = () =>
    action.run(async () => {
      if (!id) return;
      try {
        const dup = await api.post<ArchitectureDecision>(
          `/adr/${id}/duplicate`,
          {},
        );
        navigate(`/ea-delivery/adr/${dup.id}`);
        setSnackbar(t("adr.editor.duplicated"));
      } catch {
        setError(t("adr.editor.error.duplicateFailed"));
      }
    });

  // Request signatures
  const handleRequestSignatures = async (userIds: string[]) => {
    if (!id || userIds.length === 0) return;
    setRequestingSignatures(true);
    try {
      const updated = await api.post<ArchitectureDecision>(
        `/adr/${id}/request-signatures`,
        { user_ids: userIds },
      );
      applyReply(updated);
      setSignDialogOpen(false);
      setSnackbar(t("adr.editor.signatureRequestsSent"));
    } catch (err) {
      // A lock refusal names what blocks it (an unsigned linked decision, a
      // past "valid until", …).
      setError(problemMessage(err, t) ?? t("adr.editor.error.requestSignaturesFailed"));
    } finally {
      setRequestingSignatures(false);
    }
  };

  // Sign, with the note (if any) the dialog collected
  const handleSign = (note: string) =>
    action.run(async () => {
      if (!id) return;
      try {
        const updated = await api.post<ArchitectureDecision>(
          `/adr/${id}/sign`,
          signBody("adr", note),
        );
        applyReply(updated);
        setSignOpen(false);
        setSnackbar(
          updated.status === "signed"
            ? t("adr.editor.documentFullySigned")
            : t("adr.editor.signatureRecorded"),
        );
      } catch (err) {
        // Shown in the dialog, which stays open (the page's alert is behind it).
        setSignError(problemMessage(err, t) ?? t("adr.editor.error.signFailed"));
      }
    });

  // Recall signatures
  const handleRecallSignatures = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await api.post<ArchitectureDecision>(
        `/adr/${id}/recall-signatures`,
        {},
      );
      applyReply(updated);
      setSnackbar(t("adr.editor.signaturesRecalled"));
    } catch {
      setError(t("adr.editor.error.recallFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Reject
  const handleReject = async (reason: string) => {
    if (!id || !reason) return;
    setSaving(true);
    try {
      const updated = await api.post<ArchitectureDecision>(
        `/adr/${id}/reject`,
        { comment: reason },
      );
      applyReply(updated);
      setRejectDialogOpen(false);
      setSnackbar(t("adr.editor.documentRejected"));
    } catch (err) {
      setRejectError(problemMessage(err, t) ?? t("adr.editor.error.rejectFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Card linking
  const openCardLink = () => setCardLinkOpen(true);

  const handleLinkCard = (cardId: string) =>
    action.run(async () => {
      if (!id) return;
      try {
        const updated = await api.post<ArchitectureDecision>(
          `/adr/${id}/cards`,
          { card_id: cardId },
        );
        setLinkedCards(updated.linked_cards || []);
        setCardLinkOpen(false);
      } catch {
        setError(t("cards:resources.error.linkFailed"));
      }
    });

  const handleUnlinkCard = async (cardId: string) => {
    if (!id) return;
    try {
      await api.delete(`/adr/${id}/cards/${cardId}`);
      setLinkedCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch {
      setError(t("cards:resources.error.unlinkFailed"));
    }
  };

  // Cards the text mentions that are not linked: offered one click each.
  const mentionedUnlinked = unlinkedMentionedCards(
    [context, decision, consequences, alternatives].join(""),
    linkedCards.map((c) => c.id),
  );

  // The "@" list's order: linked cards first in the text, and the
  // decision's people first in its comments.
  const linkedKey = linkedCards.map((c) => c.id).join(",");
  const peopleKey = documentPeopleIds({
    signatories,
    decision_makers: decisionMakers,
    participants,
  }).join(",");
  const textMentionContext = useMemo<MentionContext>(
    () => ({ linkedCardIds: linkedKey ? linkedKey.split(",") : [] }),
    [linkedKey],
  );
  const commentMentionContext = useMemo<MentionContext>(
    () => ({
      linkedCardIds: linkedKey ? linkedKey.split(",") : [],
      priorityUserIds: peopleKey ? peopleKey.split(",") : [],
    }),
    [linkedKey, peopleKey],
  );

  const currentUserIsSignatory = signatories.some(
    (s) => s.user_id === currentUserId && s.status === "pending",
  );
  const signedCount = signatories.filter((s) => s.status === "signed").length;

  // A deep link's dialog, once this decision and the reader are known.
  const deepLinkReady = deepLink !== null && meLoaded && detail !== null && detail.id === id;
  useEffect(() => {
    if (!deepLinkReady || deepLink === null) return;
    setDeepLink(null);
    const dialog = deepLinkDialog(deepLink, status === "in_review" && currentUserIsSignatory);
    if (dialog === "sign") {
      setSignError("");
      setSignOpen(true);
    } else if (dialog === "request-signatures") setSignDialogOpen(true);
    else if (dialog === "reject") {
      setRejectError("");
      setRejectDialogOpen(true);
    }
  }, [deepLinkReady, deepLink, status, currentUserIsSignatory]);

  // Save (on a new decision), Duplicate and New Revision navigate to another
  // decision and confirm in the same breath, so the page goes from the old
  // decision to the spinner to the new one while the confirmation shows. Both
  // returns below are the same two-slot fragment with the toast second, so it
  // is ONE toast throughout: rendered inside each branch, it was remounted at
  // every switch, re-animating and restarting its timer.
  const snackbarEl = (
    <Snackbar
      open={!!snackbar}
      autoHideDuration={3000}
      onClose={() => setSnackbar("")}
      message={snackbar}
    />
  );

  if (loading) {
    return (
      <>
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: 300,
          }}
        >
          <CircularProgress />
        </Box>
        {snackbarEl}
      </>
    );
  }

  const stripItems = detail ? decisionRevisionItems(detail.revisions ?? [], t) : [];
  const stripShown = showsRevisionStrip(stripItems);
  const historyButton = (placeCompact: boolean) =>
    !isNew && id ? (
      <DocumentHistoryButton<ArchitectureDecision>
        owner={{ kind: "adr", id }}
        label={[
          referenceNumber
            ? decisionRefLabel({ reference_number: referenceNumber, revision_number: revisionNumber }, t)
            : "",
          title || t("adr.editor.untitled"),
        ]
          .filter(Boolean)
          .join(" · ")}
        status={status}
        refreshKey={detail?.updated_at ?? undefined}
        isDirty={hasEdits}
        onRestored={(adr) => applyReply(adr)}
        compact={placeCompact}
      />
    ) : null;

  return (
    <>
    <DocumentSidePanel
      owner={!isNew && id ? { kind: "adr", id } : null}
      sections={sectionOptions("adr", t)}
      openThreadCount={detail?.open_thread_count}
      onOpenCountChange={setOpenThreads}
      refreshKey={detail?.updated_at ?? undefined}
      mentionContext={commentMentionContext}
    >
    <Box sx={{ maxWidth: 900, mx: "auto", p: 2 }}>
      {/* ── Header ── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <Tooltip title={t("adr.editor.backTooltip")}>
          <IconButton onClick={() => navigate(-1)}>
            <MaterialSymbol icon="arrow_back" size={24} />
          </IconButton>
        </Tooltip>

        {referenceNumber && (
          <Chip
            label={decisionRefLabel(
              { reference_number: referenceNumber, revision_number: revisionNumber },
              t,
            )}
            variant="outlined"
            size="small"
            sx={{ fontWeight: 700 }}
          />
        )}

        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          {isNew ? t("adr.editor.newTitle") : title || t("adr.editor.untitled")}
        </Typography>

        <DecisionStatusChip adr={{ status: status as ArchitectureDecision["status"], recorded_at: detail?.recorded_at }} />
        <DecisionStandingChip standing={detail?.standing} />

        {/* History sits beside the revision strip when one is shown. */}
        {!stripShown && historyButton(compact)}

        {/* Preview / PDF / Word — the SoAW editor's export trio, same shape. */}
        {!isNew &&
          (compact ? (
            <Tooltip title={t("editor.preview")}>
              <IconButton onClick={() => navigate(`/ea-delivery/adr/${id}/preview`)}>
                <MaterialSymbol icon="visibility" size={20} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="visibility" size={18} />}
              sx={{ textTransform: "none" }}
              onClick={() => navigate(`/ea-delivery/adr/${id}/preview`)}
            >
              {t("editor.preview")}
            </Button>
          ))}
        {compact ? (
          <Tooltip title={t("editor.exportPdf")}>
            <IconButton onClick={handleExportPdf}>
              <MaterialSymbol icon="picture_as_pdf" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="picture_as_pdf" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleExportPdf}
          >
            {t("editor.pdf")}
          </Button>
        )}
        {!isSigned &&
          (compact ? (
            <Tooltip title={t("editor.exportWord")}>
              <IconButton onClick={handleExportWord}>
                <MaterialSymbol icon="article" size={20} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="article" size={18} />}
              sx={{ textTransform: "none" }}
              onClick={handleExportWord}
            >
              {t("editor.word")}
            </Button>
          ))}
      </Box>

      {/* ── Where the decision stands, and its chain ── */}
      {detail && !isNew && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2, "&:empty": { display: "none" } }}>
          <DecisionBanners
            adr={{ ...detail, status: status as ArchitectureDecision["status"] }}
            mode="editor"
            onCreateConsolidatedRevision={canManage ? handleConsolidate : undefined}
          />
          {stripShown && (
            <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
              <RevisionStrip
                items={stripItems}
                activeId={detail.id}
                currentId={currentRevisionId(detail)}
                hrefFor={(rid) => `/ea-delivery/adr/${rid}`}
              />
              {historyButton(false)}
            </Box>
          )}
        </Box>
      )}

      {/* ── Signed Banner (a recorded decision has no signing date: the
          recorded line above says how it was locked) ── */}
      {isSigned && signedAt && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("adr.editor.signedBanner", {
            date: formatDate(signedAt),
          })}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* ── Action Buttons ── */}
      <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
        {!locked && (
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            onClick={handleSave}
            disabled={saving}
            sx={{ textTransform: "none" }}
          >
            {saving ? t("adr.editor.saving") : t("adr.editor.save")}
          </Button>
        )}
        {!isNew && !isSigned && status === "draft" && (
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="send" size={18} />}
            onClick={openRequestSignatures}
            disabled={saving}
            sx={{ textTransform: "none" }}
          >
            {t("adr.editor.requestSignatures")}
          </Button>
        )}
        {canRecord(user?.permissions, status, isNew) && (
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="history_edu" size={18} />}
            onClick={() => setRecordOpen(true)}
            sx={{ textTransform: "none" }}
          >
            {t("adr.record.open")}
          </Button>
        )}
        {!isNew && status === "in_review" && (
          <Tooltip title={t("adr.editor.recallSignaturesTooltip")} describeChild>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<MaterialSymbol icon="undo" size={18} />}
              onClick={handleRecallSignatures}
              disabled={saving}
              sx={{ textTransform: "none" }}
            >
              {t("adr.editor.recallSignatures")}
            </Button>
          </Tooltip>
        )}
        {!isNew && status === "in_review" && currentUserIsSignatory && (
          <>
            <Button
              variant="contained"
              color="success"
              startIcon={<MaterialSymbol icon="draw" size={18} />}
              onClick={openSign}
              disabled={action.busy}
              sx={{ textTransform: "none" }}
            >
              {t("adr.editor.sign")}
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<MaterialSymbol icon="block" size={18} />}
              onClick={openReject}
              disabled={saving}
              sx={{ textTransform: "none" }}
            >
              {t("adr.editor.reject")}
            </Button>
          </>
        )}
        {isSigned && detail && (
          <ReviseMenu
            adr={{ ...detail, status, title, linked_cards: linkedCards } as ArchitectureDecision}
            canManage={canManage}
            onNotice={setSnackbar}
            onError={setError}
          />
        )}
        {!isNew && (
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="content_copy" size={18} />}
            onClick={handleDuplicate}
            disabled={action.busy}
            sx={{ textTransform: "none" }}
          >
            {t("adr.editor.duplicate")}
          </Button>
        )}

        {/* Generic extension slot in the action row — header-level affordances
            in line with the buttons above (e.g. a jump to an extension section
            lower on the page, with at-a-glance chips). Renders nothing when no
            extension contributes. */}
        {!isNew && id && (
          <ExtensionSlot
            name="adr.header"
            context={{
              adrId: id,
              status,
              signed: isSigned,
              readOnly: access.panelReadOnly,
              attributes,
              standing: detail?.standing ?? null,
              isCurrent: detail?.is_current,
            }}
          />
        )}
      </Box>

      {/* ── Signature Progress ── */}
      {signatories.length > 0 && (
        <Alert
          severity={status === "signed" ? "success" : "info"}
          sx={{ mb: 2 }}
        >
          {t("adr.editor.signaturesProgress", {
            signed: signedCount,
            total: signatories.length,
          })}
        </Alert>
      )}

      {/* ── Form Fields ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <TextField
          label={t("adr.title")}
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={locked}
          sx={{ mb: 2 }}
        />
      </Paper>

      {/* ── Context ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <Typography variant="h6">{t("adr.context")}</Typography>
          <SectionDiscussionMarker section="context" />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.contextHint")}
        </Typography>
        <RichTextEditor
          mentions={DOCUMENT_MENTIONS}
          mentionContext={textMentionContext}
          content={context}
          onChange={setContext}
          readOnly={locked}
          placeholder={t("adr.contextHint")}
        />
      </Paper>

      {/* ── Decision ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <Typography variant="h6">{t("adr.decision")}</Typography>
          <SectionDiscussionMarker section="decision" />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.decisionHint")}
        </Typography>
        <RichTextEditor
          mentions={DOCUMENT_MENTIONS}
          mentionContext={textMentionContext}
          content={decision}
          onChange={setDecision}
          readOnly={locked}
          placeholder={t("adr.decisionHint")}
        />
      </Paper>

      {/* ── Alternatives Considered ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <Typography variant="h6">{t("adr.alternativesConsidered")}</Typography>
          <SectionDiscussionMarker section="alternatives_considered" />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.alternativesHint")}
        </Typography>
        <RichTextEditor
          mentions={DOCUMENT_MENTIONS}
          mentionContext={textMentionContext}
          content={alternatives}
          onChange={setAlternatives}
          readOnly={locked}
          placeholder={t("adr.alternativesHint")}
        />
      </Paper>

      {/* ── Consequences ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <Typography variant="h6">{t("adr.consequences")}</Typography>
          <SectionDiscussionMarker section="consequences" />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.consequencesHint")}
        </Typography>
        <RichTextEditor
          mentions={DOCUMENT_MENTIONS}
          mentionContext={textMentionContext}
          content={consequences}
          onChange={setConsequences}
          readOnly={locked}
          placeholder={t("adr.consequencesHint")}
        />
      </Paper>

      {/* ── Dates ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t("adr.dates.title")}
        </Typography>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <DateField
            label={t("adr.dates.decidedOn")}
            value={decidedOn}
            onChange={setDecidedOn}
            disabled={locked}
            size="small"
          />
          <DateField
            label={t("adr.dates.effectiveFrom")}
            value={effectiveFrom}
            onChange={setEffectiveFrom}
            disabled={locked}
            size="small"
          />
          <DateField
            label={t("adr.dates.validUntil")}
            value={validUntil}
            onChange={setValidUntil}
            disabled={locked}
            size="small"
            helperText={t("adr.dates.validUntilHint")}
          />
        </Box>
      </Paper>

      {/* ── People ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t("adr.people.title")}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <DecisionPeopleField
            part="decision_makers"
            value={decisionMakers}
            onChange={setDecisionMakers}
            readOnly={locked}
          />
          <DecisionPeopleField
            part="participants"
            value={participants}
            onChange={setParticipants}
            readOnly={locked}
          />
        </Box>
      </Paper>

      {/* ── Links to other decisions ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t("adr.links.title")}
        </Typography>
        {locked && (detail?.links?.outgoing.length ?? 0) + (detail?.links?.incoming.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("adr.links.none")}
          </Typography>
        ) : (
          <DecisionLinksBlock
            links={detail?.links}
            value={links}
            onChange={setLinks}
            ownIds={detail ? chainIds(detail) : []}
            readOnly={locked}
          />
        )}
      </Paper>

      {/* ── Change summary (a revision only) ── */}
      {isRevision && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t("adr.revise.changeSummary")}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t("adr.revise.changeSummary")}
            placeholder={t("adr.revise.changeSummaryHint")}
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            disabled={locked}
            error={changeSummary.length > CHANGE_SUMMARY_MAX}
            helperText={t("adr.revise.changeSummaryCount", {
              length: changeSummary.length,
              max: CHANGE_SUMMARY_MAX,
            })}
          />
        </Paper>
      )}

      {/* ── Files ── */}
      {!isNew && id && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t("adr.files.title")}
          </Typography>
          <DecisionFilesSection
            adrId={id}
            files={detail?.files}
            editable={access.filesEditable && canManage}
            locked={locked}
          />
        </Paper>
      )}

      {/* ── Linked Cards ── */}
      {!isNew && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 2,
            }}
          >
            <Typography variant="h6">{t("adr.linkedCards")}</Typography>
            {access.cardsEditable && (
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={openCardLink}
                sx={{ textTransform: "none" }}
              >
                {t("adr.editor.addCard")}
              </Button>
            )}
          </Box>
          {linkedCards.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("adr.editor.noLinkedCards")}
            </Typography>
          ) : (
            <List dense>
              {linkedCards.map((card) => (
                <ListItem
                  key={card.id}
                  secondaryAction={
                    access.cardsEditable ? (
                      <Tooltip title={t("adr.editor.unlinkCard")}>
                        <IconButton
                          size="small"
                          onClick={() => handleUnlinkCard(card.id)}
                        >
                          <MaterialSymbol icon="link_off" size={18} />
                        </IconButton>
                      </Tooltip>
                    ) : undefined
                  }
                >
                  <ListItemText
                    primary={
                      <Link
                        href={`/cards/${card.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/cards/${card.id}`);
                        }}
                      >
                        {card.name}
                      </Link>
                    }
                    secondary={card.type}
                  />
                </ListItem>
              ))}
            </List>
          )}
          {access.cardsEditable && canManage && mentionedUnlinked.length > 0 && (
            <Box sx={{ mt: 2 }} data-testid="mentioned-unlinked">
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t("adr.editor.mentionedNotLinked")}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {mentionedUnlinked.map((card) => (
                  // describeChild: the card's name stays the button's name.
                  <Tooltip key={card.id} title={t("adr.editor.linkThisCard")} describeChild>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<MaterialSymbol icon="add_link" size={18} />}
                      onClick={() => handleLinkCard(card.id)}
                      disabled={action.busy}
                      sx={{ textTransform: "none" }}
                    >
                      {card.label}
                    </Button>
                  </Tooltip>
                ))}
              </Box>
            </Box>
          )}
        </Paper>
      )}

      {/* ── Extension ADR panels (SDK 1.3) ── */}
      {!isNew &&
        id &&
        adrPanels
          .filter(
            ({ contribution }) =>
              !contribution.permission ||
              hasPermission(user?.permissions, contribution.permission),
          )
          .map(({ extKey, contribution }) => (
            <ExtensionBoundary key={`adrpanel:${extKey}:${contribution.id}`} extensionKey={extKey}>
              {/* Collapse the wrapper when the panel renders nothing (e.g. a
                  phase-gated panel that hides itself once the ADR is signed) so
                  it never leaves an empty card behind. */}
              <Paper sx={{ p: 3, mb: 3, "&:empty": { display: "none" } }}>
                <contribution.component
                  adrId={id}
                  status={status}
                  signed={isSigned}
                  readOnly={access.panelReadOnly}
                  standing={detail?.standing ?? null}
                  isCurrent={detail?.is_current}
                />
              </Paper>
            </ExtensionBoundary>
          ))}

      {/* ── Signatories ── */}
      {signatories.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t("adr.editor.signatures")}
          </Typography>
          <List dense>
            {signatories.map((sig) => (
              <ListItem key={sig.user_id}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <MaterialSymbol
                    icon={
                      sig.status === "signed"
                        ? "check_circle"
                        : "radio_button_unchecked"
                    }
                    size={20}
                    color={sig.status === "signed" ? STATUS_HUES.success : STATUS_HUES.warning}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={sig.display_name}
                  secondary={
                    sig.status === "signed" && sig.signed_at
                      ? t("adr.editor.sigSignedAt", {
                          date: formatDate(sig.signed_at),
                        })
                      : t("adr.editor.sigPending")
                  }
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      {/* Generic extension slot below the signature block: the sanctioned place
          for post-decision, ADR-scoped content that belongs after sign-off
          (e.g. value-realization tracking). Renders nothing when no extension
          contributes. */}
      {!isNew && id && (
        <ExtensionSlot
          name="adr.signature.footer"
          context={{
            adrId: id,
            status,
            signed: isSigned,
            readOnly: false,
            attributes,
            standing: detail?.standing ?? null,
            isCurrent: detail?.is_current,
          }}
        />
      )}

      {/* ── Sign Dialog ── */}
      <SignatureRequestDialog
        open={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onRequest={handleRequestSignatures}
        title={t("adr.editor.signDialog.title")}
        description={t("adr.editor.signDialog.description")}
        requesting={requestingSignatures}
        decisionMakers={decisionMakers}
        openThreadCount={openThreads}
      />

      {/* ── Record as decided ── */}
      {!isNew && id && (
        <RecordAsDecidedDialog
          open={recordOpen}
          adrId={id}
          decisionMakers={decisionMakers}
          onClose={() => setRecordOpen(false)}
          onRecorded={handleRecorded}
          prepare={saveBeforeRecord}
        />
      )}

      {/* ── Card Link Dialog ── */}
      <Dialog
        open={cardLinkOpen}
        onClose={() => setCardLinkOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("adr.editor.linkCard")}</DialogTitle>
        <DialogContent>
          <CardPicker
            value={null}
            onChange={(card) => {
              if (card) handleLinkCard(card.id);
            }}
            excludeIds={linkedCards.map((c) => c.id)}
            enabled={cardLinkOpen}
            autoFocus
            fullWidth
            size="small"
            placeholder={t("adr.editor.searchCards")}
            disabled={action.busy}
            sx={{ mt: 1 }}
          />
          {linkedCards.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
                {t("adr.editor.alreadyLinked")}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {linkedCards.map((card) => (
                  <Chip key={card.id} label={card.name} size="small" variant="outlined" />
                ))}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCardLinkOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Sign and Reject Dialogs ── */}
      <SignDocumentDialog
        open={signOpen}
        onClose={() => setSignOpen(false)}
        onSign={handleSign}
        title={t("collab.sign.adrTitle")}
        description={t("collab.sign.adrDescription")}
        openThreadCount={openThreads}
        busy={action.busy}
        error={signError}
        onDismissError={() => setSignError("")}
      />
      <RejectDocumentDialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        onReject={handleReject}
        title={t("adr.editor.rejectDialog.title")}
        description={t("adr.editor.rejectDialog.description")}
        label={t("adr.editor.rejectDialog.commentLabel")}
        submitLabel={t("adr.editor.reject")}
        openThreadCount={openThreads}
        busy={saving}
        error={rejectError}
        onDismissError={() => setRejectError("")}
      />

    </Box>
    </DocumentSidePanel>
    {/* ── Snackbar ── */}
    {snackbarEl}
    </>
  );
}
