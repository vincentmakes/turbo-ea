/**
 * When each store action applies.
 *
 * Pure predicates, in their own module so the tile and the drawer share one
 * answer: the tile shows exactly one action and the drawer shows all of them,
 * and "a trialing customer may still convert" is precisely the kind of rule
 * that drifts when it is written twice.
 */
import type { StoreItem } from "./types";

export function canTrial(item: StoreItem, claimingKey: string | null): boolean {
  return (
    !item.free &&
    Boolean(item.trial_link) &&
    item.entitlement_state === "unlicensed" &&
    claimingKey !== item.key
  );
}

export function canBuy(item: StoreItem, claimingKey: string | null): boolean {
  return (
    !item.free &&
    Boolean(item.payment_link) &&
    // Unlicensed, or on a trial (active or expired) — a trialing customer
    // converts in-product; the claim flow replaces the trial entitlement with
    // the paid one automatically.
    (item.entitlement_state === "unlicensed" || Boolean(item.entitlement_trial)) &&
    claimingKey !== item.key
  );
}

export function canInstall(item: StoreItem): boolean {
  return !item.installed_version || item.update_available;
}

/**
 * The actions a compact tile shows, in render order.
 *
 * At most two, because an unlicensed paid item genuinely has two different
 * next steps and burying either costs something real: Buy is the revenue
 * path, and Install is how somebody who already holds a licence file gets to
 * the paste dialog. Everything else — the trial, the demo — is one click
 * away in the drawer.
 */
export function tileActions(item: StoreItem, claimingKey: string | null): ("buy" | "install")[] {
  const actions: ("buy" | "install")[] = [];
  if (canBuy(item, claimingKey)) actions.push("buy");
  if (canInstall(item)) actions.push("install");
  return actions;
}

