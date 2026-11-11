/**
 * "Browse…": the standard pickers for people who do not know "@" or want
 * several mentions at once. Opened from the "@" popup's last row (it then
 * replaces the "@query" text) or from the editor's toolbar (at the caret).
 *
 * - Cards: the standard `CardMultiPicker` (type rail, hierarchy, search, a
 *   selection that survives filtering), opened from the tab; a role that may
 *   not search cards gets the popup's explanation instead.
 * - Decisions: the shared register list (`fetchDecisionOptions`), filtered
 *   and ranked on the raw input, ticked in a list.
 * - People (only where users may be mentioned): `UserMultiSelect`.
 *
 * Insert hands the picks back in the order they were made (`reconcilePicks`);
 * Cancel hands nothing. The editor puts the focus back.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import CardMultiPicker, { type PickedCard } from "@/components/CardMultiPicker";
import { fetchDecisionOptions, filterAndRankDecisions } from "@/components/DecisionPicker";
import MaterialSymbol from "@/components/MaterialSymbol";
import { canReadAnyCardType } from "@/components/RequirePermission";
import UserMultiSelect, { type UserOption } from "@/components/UserMultiSelect";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import type { MentionKind } from "@/lib/mentionHtml";
import type { ArchitectureDecision } from "@/types";
import MentionRow from "./MentionRow";
import {
  decisionMentionItem,
  reconcilePicks,
  togglePick,
  type MentionPick,
} from "./mentionModel";

const TAB_KEYS: Record<MentionKind, string> = {
  card: "mention.group.cards",
  decision: "mention.group.decisions",
  user: "mention.group.people",
};
const TAB_ORDER: MentionKind[] = ["card", "decision", "user"];

interface Props {
  open: boolean;
  /** What may be mentioned here: one tab each. */
  kinds: MentionKind[];
  onCancel: () => void;
  /** The picks, in pick order. */
  onInsert: (picks: MentionPick[]) => void;
}

function DecisionTab({
  picks,
  onToggle,
}: {
  picks: MentionPick[];
  onToggle: (pick: MentionPick) => void;
}) {
  const { t } = useTranslation("delivery");
  const [rows, setRows] = useState<ArchitectureDecision[] | null>(null);
  const [query, setQuery] = useState("");
  useAbortableEffect(async ({ isCurrent }) => {
    try {
      const all = await fetchDecisionOptions();
      if (isCurrent()) setRows(all);
    } catch {
      if (isCurrent()) setRows([]);
    }
  }, []);
  const picked = new Set(picks.filter((p) => p.kind === "decision").map((p) => p.id));
  const items = filterAndRankDecisions(rows ?? [], query).map((row) => decisionMentionItem(row, t));
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0 }}>
      <TextField
        size="small"
        autoFocus
        label={t("mention.browseDialog.searchDecisions")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {rows !== null && items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          {t("mention.noMatches")}
        </Typography>
      ) : (
        <List dense sx={{ overflowY: "auto", maxHeight: 360 }} aria-label={t("mention.group.decisions")}>
          {items.map((item) => {
            const checked = picked.has(item.id);
            return (
              <ListItemButton
                key={item.id}
                selected={checked}
                onClick={() => onToggle({ kind: "decision", id: item.id, label: item.label })}
              >
                <Checkbox
                  edge="start"
                  size="small"
                  checked={checked}
                  tabIndex={-1}
                  inputProps={{ "aria-label": item.label }}
                  sx={{ p: 0.5, mr: 1 }}
                />
                <MentionRow item={item} />
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Box>
  );
}

export default function MentionBrowseDialog({ open, kinds, onCancel, onInsert }: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const user = useOptionalAuthUser();
  const tabs = TAB_ORDER.filter((k) => kinds.includes(k));
  const [tab, setTab] = useState<MentionKind>(tabs[0] ?? "card");
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  // People a pick was made from, so the select shows them again.
  const [people, setPeople] = useState<UserOption[]>([]);

  // Outside an auth provider (no user) nothing is withheld.
  const cardsForbidden = user ? !canReadAnyCardType(user) : false;
  const cardPicks = picks.filter((p) => p.kind === "card");
  const pickedCards: PickedCard[] = cardPicks.map((p) => ({ id: p.id, name: p.label, type: "" }));

  const reset = () => {
    setPicks([]);
    setPeople([]);
    setTab(tabs[0] ?? "card");
  };
  const cancel = () => {
    reset();
    onCancel();
  };
  const insert = () => {
    const chosen = picks;
    reset();
    onInsert(chosen);
  };

  return (
    <>
      <Dialog open={open} onClose={cancel} maxWidth="sm" fullWidth disableRestoreFocus>
        <DialogTitle>{t("mention.browseDialog.title")}</DialogTitle>
        {tabs.length > 1 && (
          <Tabs value={tab} onChange={(_, v: MentionKind) => setTab(v)} sx={{ px: 3 }}>
            {tabs.map((k) => (
              <Tab key={k} value={k} label={t(TAB_KEYS[k])} />
            ))}
          </Tabs>
        )}
        <DialogContent dividers sx={{ minHeight: 280 }}>
          {tab === "card" &&
            (cardsForbidden ? (
              <Typography variant="body2" color="text.secondary" data-testid="mention-cards-forbidden">
                {t("mention.cardsForbidden")}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "flex-start" }}>
                <Button
                  variant="outlined"
                  startIcon={<MaterialSymbol icon="manage_search" size={18} />}
                  onClick={() => setCardPickerOpen(true)}
                >
                  {t("mention.browseDialog.chooseCards")}
                </Button>
                {cardPicks.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {t("mention.browseDialog.noCards")}
                  </Typography>
                ) : (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {cardPicks.map((p) => (
                      <Chip
                        key={p.id}
                        size="small"
                        label={p.label}
                        onDelete={() => setPicks((prev) => togglePick(prev, p))}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            ))}
          {tab === "decision" && (
            <DecisionTab picks={picks} onToggle={(p) => setPicks((prev) => togglePick(prev, p))} />
          )}
          {tab === "user" && (
            <UserMultiSelect
              value={people}
              label={t("mention.browseDialog.people")}
              onChange={(next) => {
                setPeople(next);
                setPicks((prev) =>
                  reconcilePicks(
                    prev,
                    "user",
                    next.map((u) => ({ kind: "user", id: u.id, label: u.display_name })),
                  ),
                );
              }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cancel}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={insert} disabled={picks.length === 0}>
            {t("mention.browseDialog.insert")}
          </Button>
        </DialogActions>
      </Dialog>
      {!cardsForbidden && (
        <CardMultiPicker
          open={cardPickerOpen}
          onClose={() => setCardPickerOpen(false)}
          value={cardPicks.map((p) => p.id)}
          initialOptions={pickedCards}
          onChange={(_ids, cards) =>
            setPicks((prev) =>
              reconcilePicks(
                prev,
                "card",
                cards.map((c) => ({ kind: "card", id: c.id, label: c.name })),
              ),
            )
          }
        />
      )}
    </>
  );
}
