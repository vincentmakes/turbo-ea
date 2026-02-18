import { useState, useEffect } from "react";
import { api } from "@/api/client";
import type { CalculatedFieldsMap } from "@/types";

let _cache: CalculatedFieldsMap | null = null;
let _fetching = false;
const _listeners = new Set<(m: CalculatedFieldsMap) => void>();

function notify(m: CalculatedFieldsMap) {
  _cache = m;
  for (const fn of _listeners) fn(m);
}

export function invalidateCalculatedFields() {
  _cache = null;
  _fetching = false;
}

export function useCalculatedFields() {
  const [fields, setFields] = useState<CalculatedFieldsMap>(_cache || {});
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setFields);
    if (!_cache && !_fetching) {
      _fetching = true;
      api
        .get<CalculatedFieldsMap>("/calculations/calculated-fields")
        .then((r) => notify(r))
        .catch(() => notify({}))
        .finally(() => {
          _fetching = false;
          setLoading(false);
        });
    } else if (_cache) {
      setLoading(false);
    }
    return () => {
      _listeners.delete(setFields);
    };
  }, []);

  const isCalculated = (typeKey: string, fieldKey: string): boolean => {
    return (fields[typeKey] || []).includes(fieldKey);
  };

  return { calculatedFields: fields, loading, isCalculated };
}
