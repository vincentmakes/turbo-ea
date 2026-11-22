import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { expandScopeIds } from "@/hooks/useCardScope";
import type { CardSearchSource } from "@/hooks/useCardSearch";
import { useAbortableEffect } from "@/hooks/useLatestRequest";

export const costScopeSource: CardSearchSource = (params) =>
  api.get(`/reports/cost-scope?${params.toString()}`);

type ScopeCard = Awaited<ReturnType<CardSearchSource>>["items"][number];

export function useCostReportScope(activeTypes: string[]) {
  const [scopeIds, setRoots] = useState<string[]>([]);
  const [nodes, setNodes] = useState<ScopeCard[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const activeKey = activeTypes.join(",");

  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!scopeIds.length) {
        setNodes(null);
        setError(false);
        return;
      }
      setNodes(null);
      setError(false);
      try {
        const all: ScopeCard[] = [];
        const seen = new Set<string>();
        let total: number | undefined;
        let page = 1;
        do {
          const params = new URLSearchParams({
            type: "Application,ITComponent",
            page: String(page++),
            page_size: "1000",
          });
          const result = await api.get<Awaited<ReturnType<CardSearchSource>>>(
            `/reports/cost-scope?${params}`,
            { signal },
          );
          if (!isCurrent()) return;
          if (
            (total !== undefined && total !== result.total) ||
            (!result.items.length && all.length < result.total)
          )
            throw new Error("Incomplete hierarchy");
          for (const item of result.items) {
            if (seen.has(item.id)) throw new Error("Overlapping hierarchy pages");
            seen.add(item.id);
          }
          all.push(...result.items);
          total = result.total;
          if (all.length > total) throw new Error("Incomplete hierarchy");
        } while (all.length < total);
        if (isCurrent()) setNodes(all);
      } catch {
        if (isCurrent()) setError(true);
      }
    },
    [scopeIds.length > 0, attempt],
  );

  const activeNodes = useMemo(
    () => (nodes ?? []).filter((node) => activeKey.split(",").includes(node.type)),
    [nodes, activeKey],
  );
  const effectiveScopeIds = useMemo(() => {
    const ids = new Set(activeNodes.map((node) => node.id));
    return scopeIds.filter((id) => ids.has(id));
  }, [activeNodes, scopeIds]);
  const closure = useMemo(
    () => (effectiveScopeIds.length ? expandScopeIds(effectiveScopeIds, activeNodes) : null),
    [effectiveScopeIds, activeNodes],
  );
  const setScopeIds = useCallback(
    (ids: string[]) => {
      if (nodes && ids.some((id) => !nodes.some((node) => node.id === id))) {
        setNodes(null);
        setAttempt((n) => n + 1);
      }
      setRoots((previous) => {
        const activeIds = new Set(activeNodes.map((node) => node.id));
        return [...new Set([...previous.filter((id) => !activeIds.has(id)), ...ids])];
      });
    },
    [activeNodes, nodes],
  );
  const restore = useCallback((ids: string[]) => {
    const current = nodesRef.current;
    if (current && ids.some((id) => !current.some((node) => node.id === id))) {
      setNodes(null);
      setAttempt((n) => n + 1);
    }
    setRoots(ids);
  }, []);
  const clear = useCallback(() => {
    setNodes(null);
    setRoots([]);
  }, []);
  return {
    scopeIds,
    effectiveScopeIds,
    closure,
    setScopeIds,
    restore,
    clear,
    loading: scopeIds.length > 0 && nodes === null && !error,
    error,
    retry: () => {
      setError(false);
      setNodes(null);
      setAttempt((n) => n + 1);
    },
  };
}
