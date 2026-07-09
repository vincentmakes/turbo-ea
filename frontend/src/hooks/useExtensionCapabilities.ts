import { useEffect, useState } from "react";

import { api } from "@/api/client";

/**
 * Core capabilities unlocked by installed, enabled, licensed extensions
 * (their manifest `grants`). Drives whether advanced metamodel authoring
 * affordances (field help text, custom field types) appear — the free core
 * never shows them. Rendering of already-authored values is unconditional and
 * does NOT depend on this hook (see cardDetailUtils / extensionHost).
 *
 * Boot-time singleton with the inflight-promise guard (per CLAUDE.md) so
 * concurrent mounts share one `GET /extensions/status`.
 */
interface ExtensionStatus {
  key: string;
  version: string;
  entitlement_state: string;
  grants?: string[];
}

let _cache: Set<string> | null = null;
let _inflight: Promise<Set<string>> | null = null;

async function fetchCapabilities(): Promise<Set<string>> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = api
    .get<ExtensionStatus[]>("/extensions/status")
    .then((rows) => {
      const set = new Set<string>();
      for (const r of rows) for (const g of r.grants ?? []) set.add(g);
      _cache = set;
      return set;
    })
    .catch(() => {
      _cache = new Set<string>();
      return _cache;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/** Drop the cache after an extension mutation (install / enable / license). */
export function invalidateExtensionCapabilities(): void {
  _cache = null;
  _inflight = null;
}

export interface ExtensionCapabilities {
  has: (capability: string) => boolean;
  loaded: boolean;
}

export function useExtensionCapabilities(): ExtensionCapabilities {
  const [caps, setCaps] = useState<Set<string> | null>(_cache);
  useEffect(() => {
    let alive = true;
    fetchCapabilities().then((s) => {
      if (alive) setCaps(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { has: (capability: string) => !!caps?.has(capability), loaded: caps !== null };
}
