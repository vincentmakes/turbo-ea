import { useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker, { type CardOption } from "@/components/CardPicker";
import { api } from "@/api/client";
import type { ArchitectureDecision } from "@/types";

interface LinkedCard {
  id: string;
  name: string;
  type: string;
}

interface CreateAdrDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (adr: ArchitectureDecision) => void;
  preLinkedCards?: LinkedCard[];
}

export default function CreateAdrDialog({
  open,
  onClose,
  onCreated,
  preLinkedCards = [],
}: CreateAdrDialogProps) {
  const { t } = useTranslation(["delivery", "common"]);

  const [title, setTitle] = useState("");
  const [linkedCards, setLinkedCards] = useState<LinkedCard[]>(preLinkedCards);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // Once the decision exists, a failed card link must never lead to a second
  // create: a retry only links the cards still missing.
  const [created, setCreated] = useState<ArchitectureDecision | null>(null);
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());
  // The parent hears about the created decision once, however the dialog is
  // left — even when Cancel lands while the links are still in flight.
  const reportedRef = useRef(false);

  // Card picker
  const [showSearch, setShowSearch] = useState(false);

  // Reset state when dialog opens. preLinkedCards is intentionally omitted
  // from the deps — callers that don't pass it get a fresh `[]` default on
  // every render, which would re-fire this effect and clobber the user's
  // input on every keystroke (#618).
  useEffect(() => {
    if (open) {
      setTitle("");
      setLinkedCards(preLinkedCards);
      setCreating(false);
      setError("");
      setShowSearch(false);
      setCreated(null);
      setDoneIds(new Set());
      reportedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addCard = (card: CardOption | null) => {
    if (!card || linkedCards.some((c) => c.id === card.id)) return;
    setLinkedCards((prev) => [...prev, { id: card.id, name: card.name, type: card.type }]);
    setShowSearch(false);
  };

  const removeCard = (cardId: string) => {
    setLinkedCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const reportCreated = (adr: ArchitectureDecision) => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    onCreated(adr);
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError("");
    let adr = created;
    if (!adr) {
      try {
        adr = await api.post<ArchitectureDecision>("/adr", {
          title: title.trim(),
        });
      } catch {
        setError(t("adr.createDialog.error"));
        setCreating(false);
        return;
      }
      setCreated(adr);
    }
    // Link cards sequentially; one refused link does not stop the others.
    const linked = new Set(doneIds);
    const failed: LinkedCard[] = [];
    for (const card of linkedCards) {
      if (linked.has(card.id)) continue;
      try {
        await api.post(`/adr/${adr.id}/cards`, { card_id: card.id });
        linked.add(card.id);
      } catch {
        failed.push(card);
      }
    }
    setDoneIds(linked);
    setCreating(false);
    if (failed.length > 0) {
      setError(
        t("adr.createDialog.linkError", { cards: failed.map((c) => c.name).join(", ") }),
      );
      return;
    }
    reportCreated(adr);
    onClose();
  };

  // While the decision itself is being created there is nothing to hand the
  // parent yet, and a parent told about it later navigates to it — so the
  // dialog cannot be left until the create has answered.
  const createPending = creating && !created;

  // Leaving after a failed link still leaves a decision behind: the parent
  // hears about it, so its list shows the decision rather than going stale.
  const handleClose = () => {
    if (createPending) return;
    if (created) reportCreated(created);
    onClose();
  };

  const linkedIds = new Set(linkedCards.map((c) => c.id));

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("adr.createDialog.title")}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        <TextField
          autoFocus
          label={t("adr.createDialog.decisionTitle")}
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!!created}
          sx={{ mt: 1, mb: 2 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim() && !creating) handleCreate();
          }}
        />

        {/* ── Linked Cards ── */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t("adr.createDialog.linkedCards")}
        </Typography>

        {linkedCards.length > 0 && (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {linkedCards.map((card) => (
              <Chip
                key={card.id}
                label={card.name}
                size="small"
                onDelete={doneIds.has(card.id) ? undefined : () => removeCard(card.id)}
              />
            ))}
          </Box>
        )}

        {showSearch ? (
          <Box sx={{ mb: 1 }}>
            <CardPicker
              value={null}
              onChange={addCard}
              excludeIds={linkedIds}
              fullWidth
              autoFocus
              placeholder={t("adr.createDialog.searchCards")}
            />
          </Box>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setShowSearch(true)}
            sx={{ textTransform: "none", mb: 1 }}
          >
            {t("adr.createDialog.addCard")}
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={createPending}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          variant="contained"
          disabled={!title.trim() || creating}
          onClick={handleCreate}
        >
          {creating ? t("adr.createDialog.creating") : t("common:actions.create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
