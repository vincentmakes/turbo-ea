import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
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
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Link from "@mui/material/Link";
import MaterialSymbol from "@/components/MaterialSymbol";
import RichTextEditor from "./RichTextEditor";
import SignatureRequestDialog from "./SignatureRequestDialog";
import { api } from "@/api/client";
import type { Card, ArchitectureDecision, SoAWSignatory } from "@/types";

const STATUS_COLORS: Record<string, "default" | "warning" | "success"> = {
  draft: "default",
  in_review: "warning",
  signed: "success",
};

export default function ADREditor() {
  const { t } = useTranslation(["delivery", "common"]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  // ADR state
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [context, setContext] = useState("");
  const [decision, setDecision] = useState("");
  const [consequences, setConsequences] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [revisionNumber, setRevisionNumber] = useState(1);
  const [signatories, setSignatories] = useState<SoAWSignatory[]>([]);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [linkedCards, setLinkedCards] = useState<
    { id: string; name: string; type: string }[]
  >([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [snackbar, setSnackbar] = useState("");

  // Sign dialog
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [requestingSignatures, setRequestingSignatures] = useState(false);

  // Card link dialog
  const [cardLinkOpen, setCardLinkOpen] = useState(false);
  const [cardSearch, setCardSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Card[]>([]);

  const isSigned = status === "signed";

  // Load existing ADR
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<ArchitectureDecision>(`/adr/${id}`)
      .then((adr) => {
        setTitle(adr.title);
        setStatus(adr.status);
        setContext(adr.context || "");
        setDecision(adr.decision || "");
        setConsequences(adr.consequences || "");
        setAlternatives(adr.alternatives_considered || "");
        setReferenceNumber(adr.reference_number);
        setRevisionNumber(adr.revision_number);
        setSignatories(adr.signatories || []);
        setSignedAt(adr.signed_at);
        setLinkedCards(adr.linked_cards || []);
      })
      .catch(() => setError(t("adr.editor.error.loadFailed")))
      .finally(() => setLoading(false));
  }, [id, t]);

  // Save
  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setError(t("adr.editor.titleRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title,
        context: context || null,
        decision: decision || null,
        consequences: consequences || null,
        alternatives_considered: alternatives || null,
      };
      if (isNew) {
        const created = await api.post<ArchitectureDecision>("/adr", payload);
        navigate(`/ea-delivery/adr/${created.id}`, { replace: true });
        setSnackbar(t("adr.editor.savedSuccessfully"));
      } else {
        await api.patch(`/adr/${id}`, payload);
        setSnackbar(t("adr.editor.savedSuccessfully"));
      }
    } catch {
      setError(t("adr.editor.error.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [
    title,
    context,
    decision,
    consequences,
    alternatives,
    isNew,
    id,
    navigate,
    t,
  ]);

  // Duplicate
  const handleDuplicate = async () => {
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
  };

  // Request signatures
  const handleRequestSignatures = async (userIds: string[]) => {
    if (!id || userIds.length === 0) return;
    setRequestingSignatures(true);
    try {
      const updated = await api.post<ArchitectureDecision>(
        `/adr/${id}/request-signatures`,
        { user_ids: userIds },
      );
      setSignatories(updated.signatories || []);
      setStatus(updated.status);
      setSignDialogOpen(false);
      setSnackbar(t("adr.editor.signatureRequestsSent"));
    } catch {
      setError(t("adr.editor.error.requestSignaturesFailed"));
    } finally {
      setRequestingSignatures(false);
    }
  };

  // Sign
  const handleSign = async () => {
    if (!id) return;
    try {
      const updated = await api.post<ArchitectureDecision>(
        `/adr/${id}/sign`,
        {},
      );
      setSignatories(updated.signatories || []);
      setStatus(updated.status);
      setSignedAt(updated.signed_at);
      setSnackbar(
        updated.status === "signed"
          ? t("adr.editor.documentFullySigned")
          : t("adr.editor.signatureRecorded"),
      );
    } catch {
      setError(t("adr.editor.error.signFailed"));
    }
  };

  // Revise
  const handleRevise = async () => {
    if (!id) return;
    try {
      const rev = await api.post<ArchitectureDecision>(
        `/adr/${id}/revise`,
        {},
      );
      navigate(`/ea-delivery/adr/${rev.id}`);
      setSnackbar(t("adr.editor.revised"));
    } catch {
      setError(t("adr.editor.error.reviseFailed"));
    }
  };

  // Card linking
  const openCardLink = () => {
    setCardLinkOpen(true);
    setCardSearch("");
    setSearchResults([]);
  };

  const searchCards = async (q: string) => {
    setCardSearch(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await api.get<{ items: Card[] }>(
        `/cards?search=${encodeURIComponent(q)}&page_size=20`,
      );
      setSearchResults(res.items);
    } catch {
      /* ignore */
    }
  };

  const handleLinkCard = async (cardId: string) => {
    if (!id) return;
    try {
      const updated = await api.post<ArchitectureDecision>(
        `/adr/${id}/cards`,
        { card_id: cardId },
      );
      setLinkedCards(updated.linked_cards || []);
      setCardLinkOpen(false);
    } catch {
      setError(t("resources.error.linkFailed"));
    }
  };

  const handleUnlinkCard = async (cardId: string) => {
    if (!id) return;
    try {
      await api.delete(`/adr/${id}/cards/${cardId}`);
      setLinkedCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch {
      setError(t("resources.error.unlinkFailed"));
    }
  };

  const currentUserSignatory = signatories.find(
    (s) => s.status === "pending",
  );
  const signedCount = signatories.filter((s) => s.status === "signed").length;

  if (loading) {
    return (
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
    );
  }

  return (
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
          <IconButton onClick={() => navigate("/ea-delivery")}>
            <MaterialSymbol icon="arrow_back" size={24} />
          </IconButton>
        </Tooltip>

        {referenceNumber && (
          <Chip
            label={referenceNumber}
            variant="outlined"
            size="small"
            sx={{ fontWeight: 700 }}
          />
        )}

        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          {isNew ? t("adr.editor.newTitle") : title || t("adr.editor.untitled")}
        </Typography>

        {revisionNumber > 1 && (
          <Chip
            label={t("adr.editor.revisionLabel", { number: revisionNumber })}
            size="small"
            color="info"
          />
        )}

        <Chip
          label={status.replace("_", " ")}
          color={STATUS_COLORS[status] || "default"}
          size="small"
        />
      </Box>

      {/* ── Signed Banner ── */}
      {isSigned && signedAt && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("adr.editor.signedBanner", {
            date: new Date(signedAt).toLocaleDateString(),
          })}
          {revisionNumber > 1 &&
            t("adr.editor.signedBannerRevision", { number: revisionNumber })}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* ── Action Buttons ── */}
      <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
        {!isSigned && (
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
            onClick={() => setSignDialogOpen(true)}
            sx={{ textTransform: "none" }}
          >
            {t("adr.editor.requestSignatures")}
          </Button>
        )}
        {!isNew && status === "in_review" && currentUserSignatory && (
          <Button
            variant="contained"
            color="success"
            startIcon={<MaterialSymbol icon="draw" size={18} />}
            onClick={handleSign}
            sx={{ textTransform: "none" }}
          >
            {t("adr.editor.sign")}
          </Button>
        )}
        {isSigned && (
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="edit_note" size={18} />}
            onClick={handleRevise}
            sx={{ textTransform: "none" }}
          >
            {t("adr.editor.newRevision")}
          </Button>
        )}
        {!isNew && (
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="content_copy" size={18} />}
            onClick={handleDuplicate}
            sx={{ textTransform: "none" }}
          >
            {t("adr.editor.duplicate")}
          </Button>
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
          disabled={isSigned}
          sx={{ mb: 2 }}
        />
      </Paper>

      {/* ── Context ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("adr.context")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.contextHint")}
        </Typography>
        <RichTextEditor
          content={context}
          onChange={setContext}
          readOnly={isSigned}
          placeholder={t("adr.contextHint")}
        />
      </Paper>

      {/* ── Decision ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("adr.decision")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.decisionHint")}
        </Typography>
        <RichTextEditor
          content={decision}
          onChange={setDecision}
          readOnly={isSigned}
          placeholder={t("adr.decisionHint")}
        />
      </Paper>

      {/* ── Alternatives Considered ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("adr.alternativesConsidered")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.alternativesHint")}
        </Typography>
        <RichTextEditor
          content={alternatives}
          onChange={setAlternatives}
          readOnly={isSigned}
          placeholder={t("adr.alternativesHint")}
        />
      </Paper>

      {/* ── Consequences ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          {t("adr.consequences")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("adr.consequencesHint")}
        </Typography>
        <RichTextEditor
          content={consequences}
          onChange={setConsequences}
          readOnly={isSigned}
          placeholder={t("adr.consequencesHint")}
        />
      </Paper>

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
            {!isSigned && (
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
              {t("resources.emptyAdr")}
            </Typography>
          ) : (
            <List dense>
              {linkedCards.map((card) => (
                <ListItem
                  key={card.id}
                  secondaryAction={
                    !isSigned ? (
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
        </Paper>
      )}

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
                    color={sig.status === "signed" ? "#4caf50" : "#ff9800"}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={sig.display_name}
                  secondary={
                    sig.status === "signed" && sig.signed_at
                      ? t("adr.editor.sigSignedAt", {
                          date: new Date(sig.signed_at).toLocaleDateString(),
                        })
                      : t("adr.editor.sigPending")
                  }
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      {/* ── Sign Dialog ── */}
      <SignatureRequestDialog
        open={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onRequest={handleRequestSignatures}
        title={t("adr.editor.signDialog.title")}
        description={t("adr.editor.signDialog.description")}
        requesting={requestingSignatures}
      />

      {/* ── Card Link Dialog ── */}
      <Dialog
        open={cardLinkOpen}
        onClose={() => setCardLinkOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("adr.editor.linkCard")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            placeholder={t("adr.editor.searchCards")}
            fullWidth
            size="small"
            value={cardSearch}
            onChange={(e) => searchCards(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <List dense>
            {searchResults.map((card) => {
              const alreadyLinked = linkedCards.some((lc) => lc.id === card.id);
              return (
                <ListItemButton
                  key={card.id}
                  onClick={() => !alreadyLinked && handleLinkCard(card.id)}
                  disabled={alreadyLinked}
                >
                  <ListItemText
                    primary={card.name}
                    secondary={card.type}
                  />
                  {alreadyLinked && (
                    <Chip
                      label={t("resources.linkAdrDialog.alreadyLinked")}
                      size="small"
                      variant="outlined"
                    />
                  )}
                </ListItemButton>
              );
            })}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCardLinkOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar ── */}
      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar("")}
        message={snackbar}
      />
    </Box>
  );
}
