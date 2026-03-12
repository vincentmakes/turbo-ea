import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { Card, SoAW, DiagramSummary, ArchitectureDecision } from "@/types";

export interface InitiativeGroup {
  initiative: Card;
  diagrams: DiagramSummary[];
  soaws: SoAW[];
  adrs: ArchitectureDecision[];
}

export interface InitiativeTreeNode {
  initiative: Card;
  children: InitiativeTreeNode[];
  level: number;
  diagrams: DiagramSummary[];
  soaws: SoAW[];
  adrs: ArchitectureDecision[];
}

type StatusFilter = "ACTIVE" | "ARCHIVED" | "";
type ArtefactFilter = "" | "with" | "without";

const FILTERS_STORAGE_KEY = "turboea-delivery-filters";

interface StoredFilters {
  statusFilter?: StatusFilter;
  subtypeFilter?: string;
  artefactFilter?: ArtefactFilter;
}

function readFiltersFromStorage(): StoredFilters {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeFiltersToStorage(filters: StoredFilters) {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // localStorage unavailable
  }
}

interface UseInitiativeDataResult {
  tree: InitiativeTreeNode[];
  flatGroups: InitiativeGroup[];
  loading: boolean;
  error: string;
  setError: (e: string) => void;
  refetch: () => Promise<void>;
  initiatives: Card[];
  diagrams: DiagramSummary[];
  soaws: SoAW[];
  adrs: ArchitectureDecision[];
  filteredInitiatives: Card[];
  search: string;
  setSearch: (s: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (s: StatusFilter) => void;
  subtypeFilter: string;
  setSubtypeFilter: (s: string) => void;
  artefactFilter: ArtefactFilter;
  setArtefactFilter: (f: ArtefactFilter) => void;
  unlinkedSoaws: SoAW[];
  unlinkedDiagrams: DiagramSummary[];
  unlinkedAdrs: ArchitectureDecision[];
}

function buildTree(
  initiatives: Card[],
  diagrams: DiagramSummary[],
  soaws: SoAW[],
  adrs: ArchitectureDecision[],
): InitiativeTreeNode[] {
  const initIds = new Set(initiatives.map((i) => i.id));
  const nodeMap = new Map<string, InitiativeTreeNode>();

  for (const init of initiatives) {
    nodeMap.set(init.id, {
      initiative: init,
      children: [],
      level: 0,
      diagrams: diagrams.filter((d) => d.card_ids.includes(init.id)),
      soaws: soaws.filter((s) => s.initiative_id === init.id),
      adrs: adrs.filter((a) => (a.linked_cards ?? []).some((c) => c.id === init.id)),
    });
  }

  const roots: InitiativeTreeNode[] = [];
  for (const init of initiatives) {
    const node = nodeMap.get(init.id)!;
    if (init.parent_id && initIds.has(init.parent_id)) {
      const parent = nodeMap.get(init.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Set levels via BFS
  const queue = [...roots];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const child of node.children) {
      child.level = node.level + 1;
      queue.push(child);
    }
  }

  return roots;
}

/** Flatten tree to depth-first ordered list for table rendering. */
export function flattenTree(nodes: InitiativeTreeNode[]): InitiativeTreeNode[] {
  const result: InitiativeTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenTree(node.children));
  }
  return result;
}

export function useInitiativeData(): UseInitiativeDataResult {
  const { t } = useTranslation("delivery");

  const [initiatives, setInitiatives] = useState<Card[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [soaws, setSoaws] = useState<SoAW[]>([]);
  const [adrs, setAdrs] = useState<ArchitectureDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");

  const storedFilters = useMemo(readFiltersFromStorage, []);
  const [statusFilter, setStatusFilterRaw] = useState<StatusFilter>(
    storedFilters.statusFilter ?? "ACTIVE",
  );
  const [subtypeFilter, setSubtypeFilterRaw] = useState(storedFilters.subtypeFilter ?? "");
  const [artefactFilter, setArtefactFilterRaw] = useState<ArtefactFilter>(
    storedFilters.artefactFilter ?? "",
  );

  const setStatusFilter = useCallback((v: StatusFilter) => {
    setStatusFilterRaw(v);
    writeFiltersToStorage({ ...readFiltersFromStorage(), statusFilter: v });
  }, []);
  const setSubtypeFilter = useCallback((v: string) => {
    setSubtypeFilterRaw(v);
    writeFiltersToStorage({ ...readFiltersFromStorage(), subtypeFilter: v });
  }, []);
  const setArtefactFilter = useCallback((v: ArtefactFilter) => {
    setArtefactFilterRaw(v);
    writeFiltersToStorage({ ...readFiltersFromStorage(), artefactFilter: v });
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const statusParam = statusFilter ? `&status=${statusFilter}` : "&status=ACTIVE,ARCHIVED";
      const [initRes, diagRes, soawRes, adrRes] = await Promise.all([
        api.get<{ items: Card[] }>(`/cards?type=Initiative&page_size=500${statusParam}`),
        api.get<DiagramSummary[]>("/diagrams"),
        api.get<SoAW[]>("/soaw"),
        api.get<ArchitectureDecision[]>("/adr"),
      ]);
      setInitiatives(initRes.items);
      setDiagrams(diagRes);
      setSoaws(soawRes);
      setAdrs(adrRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.loadData"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filteredInitiatives = useMemo(() => {
    let list = initiatives;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.description ?? "").toLowerCase().includes(q),
      );
    }
    if (subtypeFilter) {
      list = list.filter((i) => i.subtype === subtypeFilter);
    }
    if (artefactFilter) {
      list = list.filter((init) => {
        const hasSoaw = soaws.some((s) => s.initiative_id === init.id);
        const hasDiagram = diagrams.some((d) => d.card_ids.includes(init.id));
        const hasAdr = adrs.some((a) =>
          (a.linked_cards ?? []).some((c) => c.id === init.id),
        );
        const hasAny = hasSoaw || hasDiagram || hasAdr;
        return artefactFilter === "with" ? hasAny : !hasAny;
      });
    }
    return list;
  }, [initiatives, search, subtypeFilter, artefactFilter, soaws, diagrams, adrs]);

  const tree = useMemo(
    () => buildTree(filteredInitiatives, diagrams, soaws, adrs),
    [filteredInitiatives, diagrams, soaws, adrs],
  );

  const flatGroups: InitiativeGroup[] = useMemo(
    () =>
      filteredInitiatives.map((init) => ({
        initiative: init,
        diagrams: diagrams.filter((d) => d.card_ids.includes(init.id)),
        soaws: soaws.filter((s) => s.initiative_id === init.id),
        adrs: adrs.filter((a) => (a.linked_cards ?? []).some((c) => c.id === init.id)),
      })),
    [filteredInitiatives, diagrams, soaws, adrs],
  );

  const unlinkedSoaws = useMemo(
    () => soaws.filter((s) => !s.initiative_id),
    [soaws],
  );
  const unlinkedDiagrams = useMemo(
    () => diagrams.filter((d) => d.card_ids.length === 0),
    [diagrams],
  );
  const unlinkedAdrs = useMemo(
    () => adrs.filter((a) => !(a.linked_cards ?? []).some((c) => c.type === "Initiative")),
    [adrs],
  );

  return {
    tree,
    flatGroups,
    loading,
    error,
    setError,
    refetch: fetchAll,
    initiatives,
    diagrams,
    soaws,
    adrs,
    filteredInitiatives,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    subtypeFilter,
    setSubtypeFilter,
    artefactFilter,
    setArtefactFilter,
    unlinkedSoaws,
    unlinkedDiagrams,
    unlinkedAdrs,
  };
}
