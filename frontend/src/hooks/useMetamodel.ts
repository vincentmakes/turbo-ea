import { useState, useEffect } from "react";
import { api } from "@/api/client";
import type { FactSheetType, RelationType } from "@/types";

let _cache: { types: FactSheetType[]; relationTypes: RelationType[] } | null = null;

export function useMetamodel() {
  const [types, setTypes] = useState<FactSheetType[]>(_cache?.types || []);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>(_cache?.relationTypes || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) return;
    (async () => {
      try {
        const [t, r] = await Promise.all([
          api.get<FactSheetType[]>("/metamodel/types"),
          api.get<RelationType[]>("/metamodel/relation-types"),
        ]);
        _cache = { types: t, relationTypes: r };
        setTypes(t);
        setRelationTypes(r);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const getType = (key: string) => types.find((t) => t.key === key);

  const getRelationsForType = (typeKey: string) =>
    relationTypes.filter(
      (r) => r.source_type_key === typeKey || r.target_type_key === typeKey
    );

  const invalidateCache = () => {
    _cache = null;
  };

  return { types, relationTypes, loading, getType, getRelationsForType, invalidateCache };
}
