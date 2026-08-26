import { describe, it, expect } from "vitest";
import { tileActions } from "./storeActionRules";
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
});
