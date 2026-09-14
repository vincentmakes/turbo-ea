import { describe, it, expect } from "vitest";
import { canBuyMonthly, isUpdate, tileActions } from "./storeActionRules";
import type { StoreItem } from "./types";

const PAID: StoreItem = {
  key: "a-ext",
  name: "Alpha Ext",
  description: "",
  price: "990 EUR / year",
  payment_link: "https://buy.test/pl_1",
  version: "1.0.0",
  installed_version: null,
  update_available: false,
  entitlement_state: "unlicensed",
};

describe("tileActions", () => {
  it("leads with the trial when one is on offer", () => {
    // A no-card trial is the strongest path for somebody who has not bought,
    // so it takes a slot; Install drops to the drawer because on an unlicensed
    // paid item it only serves someone who already holds a licence file.
    expect(tileActions({ ...PAID, trial_link: "https://buy.test/trial" }, null)).toEqual([
      "trial",
      "buy",
    ]);
  });

  it("falls back to buy + install when there is no trial", () => {
    expect(tileActions(PAID, null)).toEqual(["buy", "install"]);
  });

  it("never shows more than two actions", () => {
    // Three equal-weight buttons do not fit the tile, and a tile with three
    // has no primary action at all.
    const everything = { ...PAID, trial_link: "https://buy.test/trial", demo_url: "https://d" };
    expect(tileActions(everything, null).length).toBeLessThanOrEqual(2);
  });

  it("offers only install for a free extension", () => {
    expect(tileActions({ ...PAID, free: true, payment_link: "" }, null)).toEqual(["install"]);
  });

  it("offers nothing once an up-to-date paid extension is installed", () => {
    expect(
      tileActions({ ...PAID, installed_version: "1.0.0", entitlement_state: "active" }, null),
    ).toEqual([]);
  });

  it("drops the trial and buy while that item's purchase is being claimed", () => {
    const item = { ...PAID, trial_link: "https://buy.test/trial" };
    expect(tileActions(item, "a-ext")).toEqual(["install"]);
  });

  it("offers only buy for a service listing — there is nothing to install", () => {
    // A service is sold and licensed like an extension but has no bundle:
    // the purchase is confirmed by the licence reaching the instance, so an
    // Install button would only ever dead-end.
    expect(tileActions({ ...PAID, service: true, version: "" }, null)).toEqual(["buy"]);
  });

  it("offers nothing on a licensed service listing", () => {
    expect(
      tileActions({ ...PAID, service: true, version: "", entitlement_state: "active" }, null),
    ).toEqual([]);
  });
});

describe("isUpdate", () => {
  it("is false for an extension that is not installed", () => {
    // Nothing to update FROM: a plain Install downloads whatever the
    // catalogue publishes. The backend never sets the flag without an
    // installed version, and the label must not depend on it doing so.
    expect(isUpdate({ ...PAID, installed_version: null, update_available: true })).toBe(false);
  });

  it("is true only when an installed extension has a newer catalogue version", () => {
    expect(isUpdate({ ...PAID, installed_version: "1.0.0", update_available: true })).toBe(true);
    expect(isUpdate({ ...PAID, installed_version: "1.0.0", update_available: false })).toBe(false);
  });

  it("is never true for a service listing, whatever the catalogue says", () => {
    expect(
      isUpdate({ ...PAID, service: true, installed_version: "1.0.0", update_available: true }),
    ).toBe(false);
  });
});

describe("a second billing plan", () => {
  const MONTHLY = { ...PAID, monthly_payment_link: "https://buy.test/pl_month" };

  it("is offered only when the catalogue carries the second link", () => {
    expect(canBuyMonthly(MONTHLY, null)).toBe(true);
    expect(canBuyMonthly(PAID, null)).toBe(false);
  });

  it("never applies where a plain Buy would not", () => {
    // licensed, free, or mid-claim — the monthly plan is Buy plus a link,
    // never a way around the rules Buy already answers
    expect(canBuyMonthly({ ...MONTHLY, entitlement_state: "active" }, null)).toBe(false);
    expect(canBuyMonthly({ ...MONTHLY, free: true }, null)).toBe(false);
    expect(canBuyMonthly(MONTHLY, MONTHLY.key)).toBe(false);
  });

  it("does NOT become a third tile action", () => {
    // The tile shows at most two buttons; a plan choice is not worth
    // evicting Try free or Install, so it lives in the drawer.
    expect(tileActions(MONTHLY, null)).toEqual(tileActions(PAID, null));
  });
});
