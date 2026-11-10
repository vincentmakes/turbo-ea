/**
 * The "This decision…" block: the typed links a decision holds to other
 * decisions (replaces / amends / revokes / relates to, and the consolidation a
 * revision carries), and, read-only, the links other decisions hold to it.
 *
 * Editable, it works on the write shape (`{decision_id, kind, note?}[]`, the
 * replace-set `POST /adr` / `PATCH /adr/{id}` take); the loaded `links` only
 * name the targets it already holds. Read-only, it renders the loaded links.
 */
import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router";
import { useTranslation } from "react-i18next";

import DecisionPicker, { type DecisionPickerValue } from "@/components/DecisionPicker";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  ArchitectureDecision,
  DecisionLinkEntry,
  DecisionLinkInput,
  DecisionLinkKind,
  DecisionLinks,
} from "@/types";
import { DecisionStateChip } from "./DecisionStandingChip";
import { decisionHref } from "./DecisionBanners";
import { LINK_KIND_LABEL_KEYS, decisionRefLabel, type Translate } from "./decisionStanding";

/** The kinds a person may add by hand; `consolidates` is set by "Create consolidated revision". */
export const MANUAL_LINK_KINDS: readonly DecisionLinkKind[] = [
  "replaces",
  "amends",
  "revokes",
  "relates",
];

export const LINK_NOTE_MAX = 1000;

/** A target the decision should not be linked to any more: its chain is closed. */
export function isClosedTarget(target: Pick<DecisionPickerValue, "standing"> | undefined): boolean {
  return target?.standing === "superseded" || target?.standing === "revoked";
}

/** The kinds a row's select offers: the manual ones, plus its own when it is not one of them. */
export function kindOptions(current: DecisionLinkKind): DecisionLinkKind[] {
  return MANUAL_LINK_KINDS.includes(current) ? [...MANUAL_LINK_KINDS] : [...MANUAL_LINK_KINDS, current];
}

/** Ids a row's picker hides: the decision's own chain and the targets of the other rows. */
export function excludedFor(value: DecisionLinkInput[], index: number, ownIds: string[]): string[] {
  const others = value.filter((_, i) => i !== index).map((l) => l.decision_id);
  return [...ownIds, ...others.filter((id) => id !== "")];
}

/** "Replaces ADR-012 · Rev 2" for an entry, in the reading direction asked for. */
export function linkVerb(entry: DecisionLinkEntry, direction: "outgoing" | "incoming", t: Translate) {
  return `${t(LINK_KIND_LABEL_KEYS[direction][entry.kind])} ${decisionRefLabel(entry.decision, t)}`;
}

function ReadOnlyRow({
  entry,
  direction,
}: {
  entry: DecisionLinkEntry;
  direction: "outgoing" | "incoming";
}) {
  const { t } = useTranslation("delivery");
  const target = entry.decision;
  const current = target.current && target.current.id !== target.id ? target.current : null;
  return (
    <Box
      data-testid={`link-${direction}-${target.id}`}
      sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}
    >
      <Link component={RouterLink} to={decisionHref(target.id)} sx={{ fontWeight: 600 }}>
        {linkVerb(entry, direction, t)}
      </Link>
      <Typography variant="body2" component="span">
        {`— ${target.title}`}
      </Typography>
      <DecisionStateChip adr={target} />
      {entry.note && (
        <Typography variant="body2" component="span" color="text.secondary">
          {`— ${entry.note}`}
        </Typography>
      )}
      {current && (
        <Link component={RouterLink} to={decisionHref(current.id)} variant="body2">
          {t("adr.links.currentRevision", { reference: decisionRefLabel(current, t) })}
        </Link>
      )}
    </Box>
  );
}

export interface DecisionLinksBlockProps {
  /** The loaded links: the read-only content, and the labels of held targets. */
  links?: DecisionLinks;
  /** The editable value, in the write shape. */
  value?: DecisionLinkInput[];
  onChange?: (next: DecisionLinkInput[]) => void;
  /** Ids of the decision's own chain, never offered as targets. */
  ownIds?: string[];
  readOnly?: boolean;
}

export default function DecisionLinksBlock({
  links,
  value = [],
  onChange,
  ownIds = [],
  readOnly = false,
}: DecisionLinksBlockProps) {
  const { t } = useTranslation("delivery");
  // Targets picked in this session, by id, beside the ones the loaded links name.
  const [picked, setPicked] = useState<Map<string, DecisionPickerValue>>(new Map());
  const known = useMemo(() => {
    const map = new Map<string, DecisionPickerValue>();
    for (const entry of links?.outgoing ?? []) map.set(entry.decision.id, entry.decision);
    for (const [id, row] of picked) map.set(id, row);
    return map;
  }, [links, picked]);

  if (readOnly) {
    const outgoing = links?.outgoing ?? [];
    const incoming = links?.incoming ?? [];
    if (outgoing.length === 0 && incoming.length === 0) return null;
    return (
      <Stack spacing={0.75} data-testid="decision-links">
        {outgoing.map((entry) => (
          <ReadOnlyRow key={`o-${entry.decision.id}`} entry={entry} direction="outgoing" />
        ))}
        {incoming.map((entry) => (
          <ReadOnlyRow key={`i-${entry.decision.id}`} entry={entry} direction="incoming" />
        ))}
      </Stack>
    );
  }

  const update = (index: number, patch: Partial<DecisionLinkInput>) =>
    onChange?.(value.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const remove = (index: number) => onChange?.(value.filter((_, i) => i !== index));
  const add = () => onChange?.([...value, { decision_id: "", kind: "relates", note: null }]);

  const pick = (index: number, adr: ArchitectureDecision | null) => {
    if (adr) setPicked((prev) => new Map(prev).set(adr.id, adr));
    update(index, { decision_id: adr?.id ?? "" });
  };

  return (
    <Stack spacing={2} data-testid="decision-links">
      {value.map((link, index) => {
        const target = link.decision_id ? known.get(link.decision_id) : undefined;
        const note = link.note ?? "";
        return (
          <Box key={index} data-testid={`link-row-${index}`}>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1 }}>
              <TextField
                select
                size="small"
                label={t("adr.links.kind")}
                value={link.kind}
                onChange={(e) => update(index, { kind: e.target.value as DecisionLinkKind })}
                sx={{ minWidth: 180 }}
              >
                {kindOptions(link.kind).map((kind) => (
                  <MenuItem
                    key={kind}
                    value={kind}
                    disabled={!MANUAL_LINK_KINDS.includes(kind)}
                  >
                    {t(LINK_KIND_LABEL_KEYS.outgoing[kind])}
                  </MenuItem>
                ))}
              </TextField>
              <DecisionPicker
                value={target ?? null}
                onChange={(adr) => pick(index, adr)}
                excludeIds={excludedFor(value, index, ownIds)}
                label={t("adr.links.decision")}
                sx={{ flex: 1, minWidth: 240 }}
              />
              <Tooltip title={t("adr.links.remove")}>
                <IconButton aria-label={t("adr.links.remove")} onClick={() => remove(index)}>
                  <MaterialSymbol icon="delete" size={20} />
                </IconButton>
              </Tooltip>
            </Box>
            <TextField
              size="small"
              fullWidth
              label={t("adr.links.note")}
              placeholder={t("adr.links.notePlaceholder")}
              value={note}
              onChange={(e) => update(index, { note: e.target.value })}
              error={note.length > LINK_NOTE_MAX}
              helperText={
                note.length > LINK_NOTE_MAX
                  ? t("adr.links.noteTooLong", { max: LINK_NOTE_MAX })
                  : undefined
              }
              sx={{ mt: 1 }}
            />
            {isClosedTarget(target) && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {t("adr.links.targetClosed")}
              </Alert>
            )}
          </Box>
        );
      })}
      <Box>
        <Button
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={add}
          sx={{ textTransform: "none" }}
        >
          {t("adr.links.add")}
        </Button>
      </Box>
      {(links?.incoming ?? []).map((entry) => (
        <ReadOnlyRow key={`i-${entry.decision.id}`} entry={entry} direction="incoming" />
      ))}
    </Stack>
  );
}
