/**
 * Shared types for the Extensions admin page and its store components.
 *
 * These live beside the feature rather than in `src/types/index.ts` because
 * they describe one page's API payloads and nothing else consumes them;
 * moving eight interfaces into the global barrel would be churn with no
 * reader. They were previously inline in `ExtensionsAdmin.tsx` — the store
 * tile and its detail drawer both need them, so they moved up one level.
 */

export interface EntitlementInfo {
  state: "active" | "grace" | "expired" | "unlicensed" | "free";
  expires_at?: string | null;
  grace_until?: string | null;
  // Whether the backing store subscription renews at period end; null/absent
  // on manual/offline licenses and licenses issued before the flag existed.
  auto_renew?: boolean | null;
  // Store-issued trial entitlement — no grace window, labelled "Trial".
  trial?: boolean | null;
}

export interface ExtensionInfo {
  key: string;
  name: string;
  version: string;
  status: string;
  enabled: boolean;
  capabilities: string[];
  last_error?: string | null;
  entitlement: EntitlementInfo;
  // Same-origin URL of the bundle's own logo artwork, when it ships one.
  // Available for a disabled or unlicensed extension too — artwork is not
  // code, and the Installed tab lists both.
  logo_url?: string | null;
}

export interface LicenseInfo {
  licensee: string;
  customer_id: string;
  grace_days: number;
  entitlements: {
    extension_key: string;
    expires_at?: string | null;
    auto_renew?: boolean | null;
  }[];
  uploaded_at?: string | null;
  // Why the stored license is not in effect (bound to another instance,
  // failed verification) — null/absent when everything is fine.
  problem?: string | null;
  // True when the subscription can be managed via the store billing portal
  // (store-issued license). The credential itself never reaches the browser.
  store_managed?: boolean;
}

export interface InstallReport {
  dry_run?: boolean;
  sections?: {
    sheet: string;
    created: number;
    updated: number;
    skipped: number;
    conflict: number;
    failed: number;
    errors: string[];
  }[];
  totals?: {
    created: number;
    updated: number;
    skipped: number;
    conflict: number;
    failed: number;
  };
  downgrade?: { from: string; to: string };
}

export interface ExtensionInstall {
  id: string;
  filename: string;
  status: string;
  extension_key?: string | null;
  extension_version?: string | null;
  diff?: InstallReport | null;
  result?: InstallReport | null;
  error_message?: string | null;
}

export interface StoreItem {
  key: string;
  name: string;
  description: string;
  long_description?: string;
  price: string;
  payment_link: string;
  // Optional no-card trial checkout link; opened through the same
  // claim-token flow as payment_link.
  trial_link?: string;
  demo_url?: string;
  homepage?: string;
  license?: string;
  license_url?: string;
  screenshots?: string[];
  // Absolute, same-origin store URL of the listing's logo. Shown before the
  // extension is installed, when there is no bundle on disk to read one from.
  logo?: string;
  // Category slugs; the first is the commercial-model tag ("free"/"commercial")
  // the catalogue derives at publish time, the rest are topical.
  tags?: string[];
  // Store section slug. The vocabulary, its order and the labels are
  // STORE_CATEGORIES / storeCategories.ts on this side; a slug the catalogue
  // sends that this build does not know files under the trailing "Other"
  // section, so a newer catalogue never hides an item from an older core.
  category?: string;
  version: string;
  installed_version?: string | null;
  update_available: boolean;
  entitlement_state: EntitlementInfo["state"];
  // Entitlement is a trial (active or expired) — Buy stays visible so a
  // trialing customer can convert in-product.
  entitlement_trial?: boolean;
  // Expiry/renewal info for the item's entitlement chip ("Trial until …" /
  // "Renews on …") — present even for licensed-but-not-installed items.
  entitlement_expires_at?: string | null;
  entitlement_grace_until?: string | null;
  entitlement_auto_renew?: boolean | null;
  free?: boolean;
}

export interface StoreCatalog {
  configured: boolean;
  reachable: boolean;
  // "blocked" = the store answered and refused us (bot protection, WAF, proxy);
  // "offline" = no route to it at all. Only the second one means air-gapped.
  reason?: "" | "blocked" | "offline";
  status_code?: number | null;
  store_url: string;
  items: StoreItem[];
}

export interface ClaimResult {
  status: "applied" | "pending";
  license?: LicenseInfo | null;
}

/** Cached result of the daily store-catalogue probe. */
export interface StoreCheckStatus {
  checked_at?: string | null;
  error?: string | null;
  seeded: boolean;
  known_count: number;
  pending_updates: Record<string, string>;
  enabled: boolean;
  last_new: number;
  last_updates: number;
  last_notified: number;
}

/** What an on-demand run of the probe found. */
export interface StoreCheckRun {
  configured: boolean;
  disabled?: boolean;
  new?: number;
  updates?: number;
  notified?: number;
  error?: string | null;
  checked_at?: string | null;
}

// The commercial-model tags always sort ahead of topical ones in the filter bar.
export const MODEL_TAGS = ["free", "commercial"];

// The store's sections, in display order. Labels are the i18n keys
// `extensions.store.category.<slug>`; grouping lives in storeCategories.ts.
export const STORE_CATEGORIES = ["strategy", "integrations", "regulations"] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];
// Where an item with no recognised category lands — always the last section.
export const OTHER_CATEGORY = "other";

export const ENTITLEMENT_COLOR: Record<
  EntitlementInfo["state"],
  "success" | "warning" | "error" | "default" | "info"
> = {
  active: "success",
  grace: "warning",
  expired: "error",
  unlicensed: "default",
  free: "info",
};

export const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  installed: "success",
  needs_restart: "warning",
  disabled: "default",
  failed: "error",
};

/**
 * The entitlement a catalogue item carries, in the shape the chip renders.
 *
 * A store item spreads its entitlement across four flat fields while an
 * installed extension nests one object; this is the single adapter between
 * them, so the tile and the drawer cannot drift apart.
 */
export function storeEntitlement(item: StoreItem): EntitlementInfo {
  return {
    state: item.entitlement_state,
    expires_at: item.entitlement_expires_at,
    grace_until: item.entitlement_grace_until,
    auto_renew: item.entitlement_auto_renew,
    trial: item.entitlement_trial,
  };
}
