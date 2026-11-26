/**
 * Which cards the Dependencies view shows from its centred card, and in which
 * state, when relations carry dates of their own.
 *
 * The rule is about CARDS, not lines: a card the view reaches only through
 * relations that are not in effect at the viewed date behaves exactly as a
 * card that is itself planned or retired there — hidden by default, shown
 * ghosted and badged when "preview planned" / "keep retired" keeps it, and
 * arriving / leaving on the timeline mark where the relation starts / ends.
 * The principle is relative to the viewpoint: a card is never hidden globally
 * because one of its relations is not in effect, only from the cards it would
 * be reached from.
 *
 * The view is built hop by hop — the centre's neighbours, then the neighbours
 * of each expanded card — and each hop is read as follows:
 *  - between two cards, the BEST relation decides (in effect > planned >
 *    ended), so a second relation type in effect keeps the neighbour present;
 *  - a neighbour reached from a card gets no better state than that card
 *    (`hopReach`: the lower of the two);
 *  - over several paths, the best path wins (`bestReach`);
 *  - the card's OWN lifecycle still applies, and the less-present of the two
 *    wins (`combineChangeState`: present > planned > retired; when both are
 *    present, "arriving" from either side is kept).
 * Only the relation-derived state travels along a path: a card's own
 * lifecycle is combined where it is drawn and never handed on to its
 * neighbours, so a landscape without dated relations reads exactly as it did.
 *
 * Hierarchy reveals are not relations: a revealed card is placed in effect and
 * nothing is expanded through it, as before.
 */
import { isAliveAtDate, parseDate, type Lifecycle } from "@/lib/lifecycleAtDate";
import { hasLifecycleDates, relationLifecycleState } from "@/lib/relationLifecycle";
import type { TimelineChange, TimelineVisibility } from "./timelineRange";

/** Where the view's path to a card stands at a date, by relation dates alone. */
export type ReachState = "inEffect" | "planned" | "ended";

export interface Reach {
  state: ReachState;
  /** Ended, and the relation that ended it ends inside the transition mark the
   *  slider stands on — the card stays drawn there, like a card retiring at it. */
  atMark: boolean;
}

/** Shared so an undated hop keeps one object all the way down. */
export const IN_EFFECT: Reach = Object.freeze({ state: "inEffect", atMark: false }) as Reach;

const RANK: Record<ReachState, number> = { inEffect: 2, planned: 1, ended: 0 };

/** One relation as this module reads it: two cards and, when dated, its lifecycle. */
export interface ViewEdge {
  source: string;
  target: string;
  lifecycle?: Lifecycle;
}

export interface Span {
  from: number;
  to: number;
}

/** A relation's own state at `dateMs`. Undated is in effect. */
export function relationReach(lifecycle: Lifecycle, dateMs: number, span: Span | null = null): Reach {
  if (!lifecycle) return IN_EFFECT;
  const state = relationLifecycleState(lifecycle, dateMs);
  if (state === "inEffect") return IN_EFFECT;
  if (state === "planned") return { state, atMark: false };
  const eol = parseDate(lifecycle.endOfLife) as number;
  return { state, atMark: span != null && eol >= span.from && eol <= span.to };
}

/** The better of two ways of reaching a card. Equal states: still at the mark
 *  if either path leaves there. Returns `a` itself when nothing improves. */
export function bestReach(a: Reach | undefined, b: Reach): Reach {
  if (!a) return b;
  if (RANK[a.state] !== RANK[b.state]) return RANK[a.state] > RANK[b.state] ? a : b;
  if (a.atMark || !b.atMark) return a;
  return { state: a.state, atMark: true };
}

/** A neighbour reached from `from` through `link`: no better than either. Equal
 *  ended states leave at the mark only if both do. */
export function hopReach(from: Reach, link: Reach): Reach {
  if (RANK[from.state] !== RANK[link.state]) return RANK[from.state] < RANK[link.state] ? from : link;
  if (!from.atMark || link.atMark) return from;
  return link;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** The best relation between two cards, per unordered pair, at `dateMs`. */
export function pairReaches(
  edges: readonly ViewEdge[],
  dateMs: number,
  span: Span | null = null,
): (a: string, b: string) => Reach | undefined {
  const m = new Map<string, Reach>();
  for (const e of edges) {
    const k = pairKey(e.source, e.target);
    m.set(k, bestReach(m.get(k), relationReach(e.lifecycle, dateMs, span)));
  }
  return (a, b) => m.get(pairKey(a, b));
}

/** Whether a card reached this way is drawn: in effect always; planned with
 *  "preview planned"; ended with "keep retired", or while the slider stands on
 *  the mark where it leaves. */
export function isReachShown(reach: Reach, visibility: TimelineVisibility): boolean {
  if (reach.state === "inEffect") return true;
  if (reach.state === "planned") return visibility.previewPlanned;
  return visibility.persistRetired || reach.atMark;
}

/** How the view grows from its centre. */
export interface ViewpointHops {
  center: string;
  /** Cards whose neighbours the view shows too, in the order they were expanded. */
  expanded?: Iterable<string>;
  /** Cards placed by something other than a relation (hierarchy reveals):
   *  in effect, and never expanded through. */
  placed?: Iterable<string>;
}

export interface ViewpointOptions {
  /** The cards a hop may land on (the cards on the graph by their own
   *  lifecycle). Omitted: every card the edges name. */
  eligible?: ReadonlySet<string> | null;
  /** Expand only through cards this visibility draws. Omitted: through every
   *  reached card. */
  visibility?: TimelineVisibility | null;
  span?: Span | null;
}

/**
 * Every card the view reaches from its centre at `dateMs`, with the state of
 * its best path. A reached card is not necessarily drawn — `isReachShown`
 * decides that — but a card absent from the result is not in the view at all.
 *
 * Expansion runs in the order given and only through a card that is already
 * reached (and drawn, with `visibility`) when its turn comes, exactly as the
 * view always grew; then the states settle over those same expansions, so a
 * later, better path lifts a card reached earlier through a worse one.
 */
export function viewpointReach(
  edges: readonly ViewEdge[],
  hops: ViewpointHops,
  dateMs: number,
  { eligible = null, visibility = null, span = null }: ViewpointOptions = {},
): Map<string, Reach> {
  const ok = (id: string) => id === hops.center || !eligible || eligible.has(id);
  const adj = new Map<string, Map<string, Reach>>();
  const link = (a: string, b: string, r: Reach) => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    m.set(b, bestReach(m.get(b), r));
  };
  for (const e of edges) {
    if (e.source === e.target || !ok(e.source) || !ok(e.target)) continue;
    const r = relationReach(e.lifecycle, dateMs, span);
    link(e.source, e.target, r);
    link(e.target, e.source, r);
  }

  const reach = new Map<string, Reach>([[hops.center, IN_EFFECT]]);
  const relax = (s: string): boolean => {
    const from = reach.get(s) as Reach;
    let changed = false;
    for (const [nb, r] of adj.get(s) ?? []) {
      if (nb === hops.center) continue;
      const cur = reach.get(nb);
      const next = bestReach(cur, hopReach(from, r));
      if (next !== cur) {
        reach.set(nb, next);
        changed = true;
      }
    }
    return changed;
  };

  const active: string[] = [];
  for (const s of [hops.center, ...(hops.expanded ?? [])]) {
    const r = reach.get(s);
    if (!r || active.includes(s)) continue;
    if (visibility && !isReachShown(r, visibility)) continue;
    active.push(s);
    relax(s);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of active) if (relax(s)) changed = true;
  }

  for (const id of hops.placed ?? []) if (ok(id)) reach.set(id, IN_EFFECT);
  return reach;
}

const PRESENCE: Record<string, number> = { planned: 1, retired: 0 };
const presence = (s: TimelineChange | undefined) => PRESENCE[s ?? ""] ?? 2;

/**
 * The state a card is drawn in: its own lifecycle's (`classifyTimelineChange`)
 * combined with its path's. The less-present wins (present > planned >
 * retired); between two present states, "arriving" from either side is kept.
 *
 * The path is "arriving" when it is in effect at a future `dateMs` but was not
 * today (`today`), mirroring a card whose own go-live lies between the two.
 */
export function combineChangeState(
  own: TimelineChange | undefined,
  at: Reach,
  today: Reach | null | undefined,
  dateMs: number,
  todayMs: number,
): TimelineChange | undefined {
  const path: TimelineChange | undefined =
    at.state === "planned"
      ? "planned"
      : at.state === "ended"
        ? "retired"
        : dateMs > todayMs && today != null && today.state !== "inEffect"
          ? "arriving"
          : undefined;
  if (presence(own) !== presence(path)) return presence(own) < presence(path) ? own : path;
  return own ?? path;
}

/* ------------------------------------------------------------------ */
/*  Timeline marks                                                     */
/* ------------------------------------------------------------------ */

interface ScopeCard {
  id: string;
  name: string;
  lifecycle?: Lifecycle;
}

export interface ViewTransitions<T extends ScopeCard> {
  /** One entry per change, in the shape `cardsChangingBetween` and
   *  `computeTimelineMilestones` read: a card arriving carries only the date
   *  it arrives (`active`), one leaving only the date it leaves (`endOfLife`).
   *  Without a dated relation in scope this is the scope itself. */
  cards: (T | ScopeCard)[];
  /** The relation lifecycles the marks count as `linking` / `unlinking`: only
   *  a start or an end between two cards that are both in the view before and
   *  after it. */
  links: Lifecycle[];
}

/**
 * What the slider's marks and pills say for the centred view: when each card
 * enters it and leaves it. A card enters on its own go-live while a path in
 * effect reaches it, or the day a relation brings it in while it is alive; it
 * leaves on its own end of life while reached, or the day the last relation
 * reaching it ends. A relation's start or end between two cards that both
 * stay is a connection change, counted apart.
 *
 * With no dated relation in scope nothing changes: the cards are returned as
 * they are and every scope relation's lifecycle is passed on, which is what
 * the marks were computed from before relations had dates.
 */
export function viewTransitions<T extends ScopeCard>(
  scope: readonly T[],
  edges: readonly ViewEdge[],
  hops: ViewpointHops,
): ViewTransitions<T> {
  const ids = new Set(scope.map((c) => c.id));
  const scopeEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  if (!scopeEdges.some((e) => hasLifecycleDates(e.lifecycle))) {
    return { cards: [...scope], links: scopeEdges.map((e) => e.lifecycle) };
  }

  const memo = new Map<number, Set<string>>();
  const hidden: TimelineVisibility = { persistRetired: false, previewPlanned: false };
  const reached = (x: number): Set<string> => {
    let s = memo.get(x);
    if (!s) {
      const r = viewpointReach(scopeEdges, hops, x, { eligible: ids, visibility: hidden });
      s = new Set([...r].filter(([, v]) => v.state === "inEffect").map(([k]) => k));
      memo.set(x, s);
    }
    return s;
  };
  const byId = new Map(scope.map((c) => [c.id, c]));
  const present = (id: string, x: number) =>
    reached(x).has(id) && isAliveAtDate(byId.get(id)?.lifecycle, x);

  const cards: ScopeCard[] = [];
  for (const c of scope) {
    const lc = c.lifecycle;
    const active = parseDate(lc?.active);
    const eol = parseDate(lc?.endOfLife);
    if (active != null && eol != null && eol <= active) continue;
    if (active != null && reached(active).has(c.id))
      cards.push({ id: c.id, name: c.name, lifecycle: { active: lc!.active } });
    if (eol != null && reached(eol - 1).has(c.id))
      cards.push({ id: c.id, name: c.name, lifecycle: { endOfLife: lc!.endOfLife } });
  }

  const relationDates = new Map<number, string>();
  for (const e of scopeEdges) {
    for (const s of [e.lifecycle?.active, e.lifecycle?.endOfLife]) {
      const d = parseDate(s);
      if (d != null && !relationDates.has(d)) relationDates.set(d, s as string);
    }
  }
  for (const [d, s] of relationDates) {
    const before = reached(d - 1);
    const after = reached(d);
    for (const c of scope) {
      if (before.has(c.id) === after.has(c.id)) continue;
      const lc = c.lifecycle;
      // Its own lifecycle changing the same day already says so.
      if (!isAliveAtDate(lc, d - 1) || !isAliveAtDate(lc, d)) continue;
      cards.push({
        id: c.id,
        name: c.name,
        lifecycle: after.has(c.id) ? { active: s } : { endOfLife: s },
      });
    }
  }

  const links: Lifecycle[] = [];
  for (const e of scopeEdges) {
    const lc = e.lifecycle;
    const active = parseDate(lc?.active);
    const eol = parseDate(lc?.endOfLife);
    if (active != null && eol != null && eol <= active) continue;
    const stays = (d: number) =>
      present(e.source, d - 1) && present(e.source, d) && present(e.target, d - 1) && present(e.target, d);
    const out: Record<string, string> = {};
    if (active != null && stays(active)) out.active = lc!.active;
    if (eol != null && stays(eol)) out.endOfLife = lc!.endOfLife;
    if (Object.keys(out).length) links.push(out);
  }
  return { cards, links };
}

/** The cards entering and leaving the view inside a mark's span, with the
 *  date each does — what `computeConnectionChanges` takes as `moves`. */
export function viewMovesBetween(
  cards: readonly ScopeCard[],
  from: number,
  to: number,
): { arriving: Map<string, number>; leaving: Map<string, number> } {
  const arriving = new Map<string, number>();
  const leaving = new Map<string, number>();
  for (const c of cards) {
    const a = parseDate(c.lifecycle?.active);
    const e = parseDate(c.lifecycle?.endOfLife);
    if (a != null && a >= from && a <= to) arriving.set(c.id, a);
    if (e != null && e >= from && e <= to) leaving.set(c.id, e);
  }
  return { arriving, leaving };
}
