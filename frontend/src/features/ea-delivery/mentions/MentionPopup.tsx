/**
 * The "@" popup of the rich-text editor: one listbox with up to three groups,
 * anchored at the caret.
 *
 * - Cards: the app-wide `useCardSearch` engine (a sanctioned direct user, see
 *   `.claude/rules/frontend-patterns.md`), the server query debounced, the
 *   loaded page re-ranked on the raw query. The document's linked cards
 *   (`context.linkedCardIds`, fetched by id once while the editor lives and
 *   again only when that list changes) come first with an empty query and
 *   first within their rank tier with one. Card rows never shift once shown:
 *   none is shown before the linked cards have answered, nor, on an empty
 *   query, before the search page has (`cardRowsReady`). A row shows the type's colour
 *   and icon, its type and subtype, and its parent's name: the parents of the
 *   rows offered are fetched by id, each once while the popup lives, and the
 *   name appears when it arrives (a withheld or failed parent shows nothing;
 *   the order never depends on it). A role that may not search cards gets a
 *   403: the group is hidden and one line says why.
 * - Decisions: the decision pickers' shared register list
 *   (`fetchDecisionOptions`), filtered and ranked on the raw query; a row
 *   shows the reference, the title and the standing.
 * - People: the shared user list, only where users may be mentioned
 *   (comments); the document's people (`context.priorityUserIds`) first.
 * - A last "Browse…" row (and the editor's toolbar button) opens the standard
 *   pickers (`MentionBrowseDialog`) through the store. It is pinned below the
 *   scrolling groups, so it is always in sight, and is still the last option
 *   of the listbox.
 *
 * The highlight follows the row, not its place (`resolveActive`), and a row
 * highlighted by key is scrolled into view.
 *
 * Focus never leaves the editor: the suggestion plugin hands the keys over
 * through the store (ArrowUp / ArrowDown wrap, Enter / Tab pick; Escape is the
 * plugin's own exit), and a click on a row does not blur the editor. Once
 * every group has answered with nothing, the popup tells the store, which ends
 * the suggestion if the user types on.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import List from "@mui/material/List";
import ListSubheader from "@mui/material/ListSubheader";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListItemIcon from "@mui/material/ListItemIcon";
import Typography from "@mui/material/Typography";

import { fetchCardsByIds } from "@/api/cardsByIds";
import { fetchDecisionOptions } from "@/components/DecisionPicker";
import MaterialSymbol from "@/components/MaterialSymbol";
import { fetchUserOptions, type UserOption } from "@/components/UserMultiSelect";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import type { MentionKind } from "@/lib/mentionHtml";
import type { ArchitectureDecision, Card } from "@/types";
import MentionRow from "./MentionRow";
import {
  BROWSE_HIGHLIGHT,
  MENTION_GROUP_LIMIT,
  cardMentionItems,
  cardRowsReady,
  decisionMentionItems,
  flattenGroups,
  groupMentionItems,
  highlightAfterKey,
  mentionItemKey,
  parentIdsToFetch,
  resolveActive,
  userMentionItems,
  withParentNames,
  type MentionContext,
  type MentionHighlight,
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
  /** What the document knows: its linked cards and its people come first. */
  context?: MentionContext;
  /**
   * The browse dialog is open: the popup shows nothing and takes no key, but
   * keeps what it has read (it lives as long as the editor).
   */
  hidden?: boolean;
}

const NONE: string[] = [];

export default function MentionPopup({ store, kinds, context, hidden = false }: Props) {
  const { t } = useTranslation("delivery");
  const state = useMentionSuggestion(store);
  const { query, clientRect, command } = state;
  const open = state.open && !hidden;

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
  // The query the card search last answered in this opening: its rows are
  // replaced (a new array, empty or not, refusal included) only by the reply
  // to the current search; a superseded reply is dropped. Closing clears the
  // rows, which is no answer.
  const answeredRows = useRef(cards.items);
  const [cardsAnsweredFor, setCardsAnsweredFor] = useState<string | null>(null);
  useEffect(() => {
    if (cards.items === answeredRows.current) return;
    answeredRows.current = cards.items;
    setCardsAnsweredFor(wantCards ? debounced : null);
  }, [cards.items, debounced, wantCards]);

  // The document's linked cards, by id: read once while the editor lives, and
  // again when the list of ids changes; a card the reader may not see is
  // simply absent. Kept with the ids they answer.
  const linkedIds = context?.linkedCardIds ?? NONE;
  const linkedKey = linkedIds.join(",");
  const wantLinked = wantCards && linkedIds.length > 0;
  const [linkedRead, setLinkedRead] = useState<{ key: string; cards: Card[] } | null>(null);
  const linked = linkedRead?.key === linkedKey ? linkedRead.cards : null;
  const readLinked = wantLinked && linked === null;
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!readLinked) return;
      let rows: Card[] = [];
      try {
        rows = (await fetchCardsByIds(linkedKey.split(","), { signal })).filter((c) => !c.archived_at);
      } catch {
        // Nothing to list first.
      }
      if (isCurrent()) setLinkedRead({ key: linkedKey, cards: rows });
    },
    [readLinked, linkedKey],
  );

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

  const cardsReady = cardRowsReady({
    query,
    answeredFor: cardsAnsweredFor,
    pending,
    wantLinked,
    linkedLoaded: linked !== null,
  });
  const cardItems =
    wantCards && !cardsForbidden && cardsReady ? cardMentionItems(cards.items, query, linked ?? []) : [];

  // The parents' names of the card rows offered: id → name, or null when the
  // parent is withheld or failed to load. Kept while the popup lives, so a
  // parent is asked for once.
  const [parents, setParents] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const missingParents = parentIdsToFetch(cardItems, parents).join(",");
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!missingParents) return;
      const ids = missingParents.split(",");
      let found: Card[] = [];
      try {
        found = await fetchCardsByIds(ids, { signal });
      } catch {
        // Nothing to show: the row keeps its type and subtype.
      }
      if (!isCurrent()) return;
      setParents((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.set(id, found.find((c) => c.id === id)?.name ?? null);
        return next;
      });
    },
    [missingParents],
  );

  const groups = groupMentionItems({
    card: withParentNames(cardItems, parents),
    decision: wantDecisions ? decisionMentionItems(decisions ?? [], query, t) : [],
    user: wantUsers ? userMentionItems(users ?? [], query, context?.priorityUserIds) : [],
  });
  const flat = flattenGroups(groups);
  const searching = wantCards && !cardsForbidden && (cards.loading || pending || !cardsReady);
  // Every group has answered for this very query: the card search has
  // finished a request for it (not merely "not loading" between a keystroke
  // and the request it starts), and the decision and people lists are in.
  const settled =
    (!wantCards || cardsAnsweredFor === query) &&
    !searching &&
    (!wantLinked || linked !== null) &&
    (!wantDecisions || decisions !== null) &&
    (!wantUsers || users !== null);
  const nothingFound = open && settled && flat.length === 0;

  // Tell the store, so typing on past a query that found nothing ends the suggestion.
  useEffect(() => {
    if (nothingFound && query.trim()) store.reportNoResults(query);
  }, [nothingFound, query, store]);

  // The highlighted row by identity (null: the default, the first item).
  // The rows are the items and a last "Browse…" row at index `flat.length`.
  const [highlight, setHighlight] = useState<MentionHighlight>(null);
  useEffect(() => {
    setHighlight(null);
  }, [query, open]);
  const keys = flat.map(mentionItemKey);
  const activeIndex = resolveActive(highlight, keys);
  const browseIndex = flat.length;

  // A row highlighted by key is scrolled into view (not one under the mouse).
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;
  const activeId = activeIndex >= 0 ? optionId(activeIndex) : null;
  const scrollOnKey = useRef(false);
  useEffect(() => {
    if (!scrollOnKey.current || !activeId) return;
    scrollOnKey.current = false;
    const row = document.getElementById(activeId);
    // jsdom has no layout, hence no scrollIntoView.
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [activeId, highlight]);

  const pick = (item: MentionItem) => command?.({ kind: item.kind, id: item.id, label: item.label });

  // The editor's keys arrive through a native listener, outside React, so
  // they can land between a commit and its passive effects. The handler is
  // therefore set in a layout effect, inside the commit: it always acts on
  // the rows on the page, never on the rows of the render before (a row the
  // server's answer has just taken away must not be picked by Enter).
  useLayoutEffect(() => {
    store.setKeyHandler((event) => {
      if (!open) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        scrollOnKey.current = true;
        setHighlight(highlightAfterKey(highlight, keys, event.key));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (activeIndex === browseIndex) {
          store.browse();
          return true;
        }
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

  let index = -1;

  return (
    <Popper
      open
      anchorEl={anchor}
      placement="bottom-start"
      sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
    >
      <Paper elevation={6} sx={{ width: 320 }}>
        <List
          dense
          id={listId}
          role="listbox"
          aria-label={t("mention.listLabel")}
          aria-activedescendant={activeId ?? undefined}
          sx={{ display: "flex", flexDirection: "column", maxHeight: 360, py: 0 }}
        >
          {/* The groups scroll; the "Browse…" row below them stays in sight. */}
          <Box
            component="li"
            role="presentation"
            data-testid="mention-scroll"
            sx={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", py: 1 }}
          >
            <Box component="ul" role="presentation" sx={{ m: 0, p: 0, listStyle: "none" }}>
              {groups.map((group) => (
                <li key={group.kind} role="presentation">
                  <ul role="group" aria-label={t(GROUP_TITLE_KEYS[group.kind])} style={{ padding: 0 }}>
                    <ListSubheader role="presentation" sx={{ lineHeight: 2.5 }}>
                      {t(GROUP_TITLE_KEYS[group.kind])}
                    </ListSubheader>
                    {group.items.map((item) => {
                      index += 1;
                      const i = index;
                      const key = mentionItemKey(item);
                      return (
                        <ListItemButton
                          component="li"
                          key={key}
                          id={optionId(i)}
                          role="option"
                          aria-selected={i === activeIndex}
                          selected={i === activeIndex}
                          // Keep the caret in the editor: picking must not blur it.
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlight(key)}
                          onClick={() => pick(item)}
                        >
                          <MentionRow item={item} />
                        </ListItemButton>
                      );
                    })}
                  </ul>
                </li>
              ))}
              {flat.length === 0 && (
                <Typography
                  component="li"
                  role="presentation"
                  variant="body2"
                  color="text.secondary"
                  sx={{ px: 2, py: 1 }}
                >
                  {searching ? t("mention.searching") : t("mention.noMatches")}
                </Typography>
              )}
            </Box>
          </Box>
          <ListItemButton
            component="li"
            id={optionId(browseIndex)}
            role="option"
            aria-selected={activeIndex === browseIndex}
            selected={activeIndex === browseIndex}
            sx={{ flexShrink: 0, borderTop: 1, borderColor: "divider" }}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHighlight(BROWSE_HIGHLIGHT)}
            onClick={() => store.browse()}
            data-testid="mention-browse"
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <MaterialSymbol icon="manage_search" size={18} />
            </ListItemIcon>
            <ListItemText primary={t("mention.browse")} />
          </ListItemButton>
        </List>
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
