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
 * At most two — a third does not fit at this width, and a tile with three
 * equal-weight buttons has no primary action at all. Which two depends on
 * what is actually on offer:
 *
 * - **A trial is available** → *Try free* and *Buy*. A no-card trial is the
 *   strongest path for someone who has not bought yet, so it earns the slot;
 *   Install drops to the drawer because on an unlicensed paid item it only
 *   serves somebody who already holds a licence file.
 * - **Otherwise** → *Buy* and *Install*. Buy is the revenue path, Install is
 *   how that licence-file holder reaches the paste dialog.
 *
 * The demo, and whichever of these lost its slot, are one click away in the
 * drawer — nothing becomes unreachable.
 */
export type TileAction = "trial" | "buy" | "install";

export function tileActions(item: StoreItem, claimingKey: string | null): TileAction[] {
  const trial = canTrial(item, claimingKey);
  const actions: TileAction[] = [];
  if (trial) actions.push("trial");
  if (canBuy(item, claimingKey)) actions.push("buy");
  if (!trial && canInstall(item)) actions.push("install");
  return actions;
}

