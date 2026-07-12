import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { isHexColor } from "@/lib/color";
import { NAVBAR_DEFAULTS } from "@/theme/tokens";

export interface NavbarStyle {
  bg: string;
  fg: string;
}

export const DEFAULT_NAVBAR_STYLE: NavbarStyle = { ...NAVBAR_DEFAULTS };

// Persist the last known colors so a page load paints the customised navbar
// immediately instead of flashing the default navy and then swapping. We
// still refetch on mount (or get primed by bootstrap), so a style changed
// elsewhere self-corrects on next load.
const STORAGE_KEY = "turboea_navbar_style";

function sanitize(value: Partial<NavbarStyle> | null | undefined): NavbarStyle {
  return {
    bg: isHexColor(value?.bg) ? value.bg : DEFAULT_NAVBAR_STYLE.bg,
    fg: isHexColor(value?.fg) ? value.fg : DEFAULT_NAVBAR_STYLE.fg,
  };
}

function readStored(): NavbarStyle | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NavbarStyle>;
    if (!isHexColor(parsed?.bg) || !isHexColor(parsed?.fg)) return null;
    return { bg: parsed.bg, fg: parsed.fg };
  } catch {
    return null;
  }
}

function writeStored(style: NavbarStyle) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
  } catch {
    // localStorage unavailable (private mode etc.) — non-fatal.
  }
}

let _cache: NavbarStyle | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(style: NavbarStyle) => void>();

function notify(style: NavbarStyle) {
  _cache = style;
  writeStored(style);
  for (const fn of _listeners) fn(style);
}

function loadOnce() {
  if (_cache !== null) return;
  if (_inflight) return;
  _inflight = api
    .get<{ navbar_bg: string; navbar_fg: string }>("/settings/navbar-style")
    .then((r) => {
      notify(sanitize({ bg: r.navbar_bg, fg: r.navbar_fg }));
    })
    .catch(() => {
      notify(DEFAULT_NAVBAR_STYLE);
    })
    .finally(() => {
      _inflight = null;
    });
}

/**
 * Subscribe to the instance-wide navbar colors. Returns the default navy/white
 * until the first fetch resolves (seeded from localStorage to avoid a flash).
 * Admin screens should call `invalidateNavbarStyle(new)` after a successful
 * PATCH to broadcast the new value to all consumers.
 */
export function useNavbarStyle(): NavbarStyle {
  const [style, setStyle] = useState<NavbarStyle>(
    () => _cache || readStored() || DEFAULT_NAVBAR_STYLE,
  );

  useEffect(() => {
    _listeners.add(setStyle);
    loadOnce();
    return () => {
      _listeners.delete(setStyle);
    };
  }, []);

  return style;
}

/** Broadcast freshly saved navbar colors to all mounted consumers. */
export function invalidateNavbarStyle(style: Partial<NavbarStyle>) {
  const base = _cache || readStored() || DEFAULT_NAVBAR_STYLE;
  notify(sanitize({ ...base, ...style }));
}

/** Test-only: reset the module-level cache between tests. */
export function _resetNavbarStyleCache() {
  _cache = null;
  _inflight = null;
  _listeners.clear();
}
