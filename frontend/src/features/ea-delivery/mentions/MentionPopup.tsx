/**
 * The "@" popup of the rich-text editor: one listbox with up to three groups,
 * anchored at the caret.
 *
 * - Cards: the app-wide `useCardSearch` engine (a sanctioned direct user, see
 *   `.claude/rules/frontend-patterns.md`), the server query debounced, the
 *   loaded page re-ranked on the raw query. A role that may not search cards
 *   gets a 403: the group is hidden and one line says why.
 * - Decisions: the decision pickers' shared register list
 *   (`fetchDecisionOptions`), filtered and ranked on the raw query.
 * - People: the shared user list, only where users may be mentioned
 *   (comments).
 *
 * Focus never leaves the editor: the suggestion plugin hands the keys over
 * through the store (ArrowUp / ArrowDown wrap, Enter / Tab pick; Escape is the
 * plugin's own exit), and a click on a row does not blur the editor. Once
 * every group has answered with nothing, the popup tells the store, which ends
 * the suggestion if the user types on.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import List from "@mui/material/List";
import ListSubheader from "@mui/material/ListSubheader";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";

import { fetchDecisionOptions } from "@/components/DecisionPicker";
import { fetchUserOptions, type UserOption } from "@/components/UserMultiSelect";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import type { MentionKind } from "@/lib/mentionHtml";
import type { ArchitectureDecision } from "@/types";
import {
  MENTION_GROUP_LIMIT,
  cardMentionItems,
  decisionMentionItems,
  flattenGroups,
  groupMentionItems,
  nextIndex,
  userMentionItems,
  type MentionItem,
} from "./mentionModel";
import { useMentionSuggestion, type MentionSuggestionStore } from "./mentionSuggestionStore";

const ALL_TYPES: string[] = [];

const GROUP_TITLE_KEYS: Record<MentionKind, string> = {
  card: "mention.group.cards",
  decision: "mention.group.decisions",
  user: "mention.group.people",
};

interface Props {
  store: MentionSuggestionStore;
  /** What may be mentioned here. */
  kinds: MentionKind[];
}

export default function MentionPopup({ store, kinds }: Props) {
  const { t } = useTranslation("delivery");
  const listId = useId();
  const state = useMentionSuggestion(store);
  const { open, query, clientRect, command } = state;

  const wantCards = open && kinds.includes("card");
  const wantDecisions = open && kinds.includes("decision");
  const wantUsers = open && kinds.includes("user");

  const [debounced, pending] = useDebouncedValue(query, 300);
  const cards = useCardSearch({
    types: ALL_TYPES,
    search: debounced,
    enabled: wantCards,
    pageSize: MENTION_GROUP_LIMIT,
  });
  const cardsForbidden = wantCards && cards.errorStatus === 403;
  // The query the card search last answered: its rows are replaced (a new
  // array, empty or not, refusal included) only by the reply to the current
  // search; a superseded reply is dropped.
  const answeredRows = useRef(cards.items);
  const [cardsAnsweredFor, setCardsAnsweredFor] = useState<string | null>(null);
  useEffect(() => {
    if (cards.items === answeredRows.current) return;
    answeredRows.current = cards.items;
    setCardsAnsweredFor(debounced);
  }, [cards.items, debounced]);

  // null until loaded.
  const [decisions, setDecisions] = useState<ArchitectureDecision[] | null>(null);
  useAbortableEffect(
    async ({ isCurrent }) => {
      if (!wantDecisions) return;
      try {
        const rows = await fetchDecisionOptions();
        if (isCurrent()) setDecisions(rows);
      } catch {
        // A role without the decisions register simply gets no decision group.
        if (isCurrent()) setDecisions([]);
      }
    },
    [wantDecisions],
  );

  const [users, setUsers] = useState<UserOption[] | null>(null);
  useAbortableEffect(
    async ({ isCurrent }) => {
      if (!wantUsers) return;
      try {
        const rows = await fetchUserOptions();
        if (isCurrent()) setUsers(rows);
      } catch {
        if (isCurrent()) setUsers([]);
      }
    },
    [wantUsers],
  );

  const groups = groupMentionItems({
    card: wantCards && !cardsForbidden ? cardMentionItems(cards.items, query) : [],
    decision: wantDecisions ? decisionMentionItems(decisions ?? [], query, t) : [],
    user: wantUsers ? userMentionItems(users ?? [], query) : [],
  });
  const flat = flattenGroups(groups);
  const searching = wantCards && !cardsForbidden && (cards.loading || pending);
  // Every group has answered for this very query: the card search has
  // finished a request for it (not merely "not loading" between a keystroke
  // and the request it starts), and the decision and people lists are in.
  const settled =
    (!wantCards || cardsAnsweredFor === query) &&
    !searching &&
    (!wantDecisions || decisions !== null) &&
    (!wantUsers || users !== null);
  const nothingFound = open && settled && flat.length === 0;

  // Tell the store, so typing on past a query that found nothing ends the suggestion.
  useEffect(() => {
    if (nothingFound && query.trim()) store.reportNoResults(query);
  }, [nothingFound, query, store]);

  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
  }, [query, open]);
  const activeIndex = flat.length > 0 ? Math.min(active, flat.length - 1) : -1;

  const pick = (item: MentionItem) => command?.({ kind: item.kind, id: item.id, label: item.label });

  useEffect(() => {
    store.setKeyHandler((event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setActive(nextIndex(activeIndex, flat.length, event.key));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = flat[activeIndex];
        if (!item) return false;
        pick(item);
        return true;
      }
      return false;
    });
    return () => store.setKeyHandler(null);
  });

  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () => clientRect?.() ?? new DOMRect(),
    }),
    [clientRect],
  );

  if (!open) return null;

  const optionId = (i: number) => `${listId}-option-${i}`;
  let index = -1;

  return (
    <Popper
      open
      anchorEl={anchor}
      placement="bottom-start"
      sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
    >
      <Paper elevation={6} sx={{ width: 320, maxHeight: 360, overflowY: "auto" }}>
        <List
          dense
          id={listId}
          role="listbox"
          aria-label={t("mention.listLabel")}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        >
          {groups.map((group) => (
            <li key={group.kind} role="presentation">
              <ul role="group" aria-label={t(GROUP_TITLE_KEYS[group.kind])} style={{ padding: 0 }}>
                <ListSubheader role="presentation" sx={{ lineHeight: 2.5 }}>
                  {t(GROUP_TITLE_KEYS[group.kind])}
                </ListSubheader>
                {group.items.map((item) => {
                  index += 1;
                  const i = index;
                  return (
                    <ListItemButton
                      component="li"
                      key={`${item.kind}:${item.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === activeIndex}
                      selected={i === activeIndex}
                      // Keep the caret in the editor: picking must not blur it.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(item)}
                    >
                      <ListItemText primary={item.label} secondary={item.secondary} />
                    </ListItemButton>
                  );
                })}
              </ul>
            </li>
          ))}
        </List>
        {flat.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1.5 }}>
            {searching ? t("mention.searching") : t("mention.noMatches")}
          </Typography>
        )}
        {cardsForbidden && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            sx={{ px: 2, pb: 1.5 }}
            data-testid="mention-cards-forbidden"
          >
            {t("mention.cardsForbidden")}
          </Typography>
        )}
      </Paper>
    </Popper>
  );
}
