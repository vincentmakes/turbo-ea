import { describe, it, expect } from "vitest";
import { makeCardType, makeRelationType } from "@/test/fixtures/metamodel";
import type { CardQuery } from "@/types";
import { PATH_SEPARATOR, compactPath, hopIsReverse, hopRelationType, hopVerb } from "./queryPath";

const ORG = makeCardType({
  key: "Organization",
  label: "Organization",
  translations: { label: { de: "Organisation" } },
});
const APP = makeCardType({ key: "Application", label: "Application" });
const INIT = makeCardType({ key: "Initiative", label: "Initiative" });
const TYPES = [ORG, APP, INIT];

const REL_ORG_TO_APP = makeRelationType({
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
  translations: { label: { de: "nutzt" }, reverse_label: { de: "wird genutzt von" } },
});
const REL_INIT_TO_APP = makeRelationType({
  key: "relInitiativeToApp",
  label: "affects",
  reverse_label: "is affected by",
  source_type_key: "Initiative",
  target_type_key: "Application",
});
const REL_APP_TO_APP = makeRelationType({
  key: "relAppToApp",
  label: "calls",
  reverse_label: "is called by",
  source_type_key: "Application",
  target_type_key: "Application",
});
const REL_TYPES = [REL_ORG_TO_APP, REL_INIT_TO_APP, REL_APP_TO_APP];

describe("hopIsReverse / hopVerb", () => {
  it("reads the forward verb when the node is the relation's source", () => {
    expect(hopIsReverse(REL_ORG_TO_APP, "Organization", "relOrgToApp")).toBe(false);
    expect(hopVerb(REL_ORG_TO_APP, "Organization", "en", "relOrgToApp")).toBe("uses");
  });

  it("reads the reverse verb when the node is the relation's target", () => {
    expect(hopIsReverse(REL_INIT_TO_APP, "Application", "relInitiativeToApp")).toBe(true);
    expect(hopVerb(REL_INIT_TO_APP, "Application", "en", "relInitiativeToApp")).toBe(
      "is affected by",
    );
    expect(hopVerb(REL_ORG_TO_APP, "Application", "en", "relOrgToApp")).toBe("is used by");
  });

  it("resolves the verb in the requested locale", () => {
    expect(hopVerb(REL_ORG_TO_APP, "Organization", "de", "relOrgToApp")).toBe("nutzt");
    expect(hopVerb(REL_ORG_TO_APP, "Application", "de", "relOrgToApp")).toBe("wird genutzt von");
  });

  it("takes the side of a self-referencing type from its __out / __in key", () => {
    expect(hopIsReverse(REL_APP_TO_APP, "Application", "relAppToApp__out")).toBe(false);
    expect(hopIsReverse(REL_APP_TO_APP, "Application", "relAppToApp__in")).toBe(true);
    expect(hopVerb(REL_APP_TO_APP, "Application", "en", "relAppToApp__out")).toBe("calls");
    expect(hopVerb(REL_APP_TO_APP, "Application", "en", "relAppToApp__in")).toBe("is called by");
    // A bare key on a self-pair reads forward (the node is both ends).
    expect(hopIsReverse(REL_APP_TO_APP, "Application", "relAppToApp")).toBe(false);
  });

  it("names nothing for a relation type it does not know", () => {
    expect(hopVerb(undefined, "Application", "en", "relGone")).toBe("");
  });

  it("finds the relation type behind a side key", () => {
    expect(hopRelationType({ relation: "relAppToApp__in" }, REL_TYPES)).toBe(REL_APP_TO_APP);
    expect(hopRelationType({ relation: "relOrgToApp" }, REL_TYPES)).toBe(REL_ORG_TO_APP);
    expect(hopRelationType({ relation: "relGone" }, REL_TYPES)).toBeUndefined();
  });
});

const CHAIN: CardQuery = {
  type: "Organization",
  related: [
    {
      relation: "relOrgToApp",
      type: "Application",
      where: { lifecycle_phase: ["active"] },
      related: [{ relation: "relInitiativeToApp", type: "Initiative" }],
    },
  ],
};

/** The connective words, as `inventory:queryView.connectiveAnd` / `connectiveOr` give them. */
const WORDS = { and: "AND", or: "OR" };

describe("compactPath", () => {
  it("reads a chain as type › verb type › verb type", () => {
    expect(PATH_SEPARATOR).toBe(" › ");
    expect(compactPath(CHAIN, { types: TYPES, relationTypes: REL_TYPES, locale: "en", ...WORDS })).toBe(
      "Organization › uses Application › is affected by Initiative",
    );
  });

  it("resolves type and verb labels in the locale", () => {
    expect(compactPath(CHAIN, { types: TYPES, relationTypes: REL_TYPES, locale: "de", ...WORDS })).toBe(
      "Organisation › nutzt Application › is affected by Initiative",
    );
  });

  it("is just the start type for a query without hops", () => {
    expect(
      compactPath({ type: "Application" }, { types: TYPES, relationTypes: REL_TYPES, ...WORDS }),
    ).toBe("Application");
  });

  it("shows the first hop of a level and +N for the others", () => {
    const branched: CardQuery = {
      type: "Application",
      related: [
        { relation: "relAppToApp__in", type: "Application" },
        { relation: "relOrgToApp", type: "Organization" },
        { relation: "relInitiativeToApp", type: "Initiative" },
      ],
    };
    expect(compactPath(branched, { types: TYPES, relationTypes: REL_TYPES, locale: "en", ...WORDS })).toBe(
      "Application › is called by Application +2",
    );
  });

  it("prefixes a negated hop with the has-no word when given one", () => {
    const negated: CardQuery = {
      type: "Application",
      related: [{ relation: "relInitiativeToApp", type: "Initiative", negate: true }],
    };
    const opts = { types: TYPES, relationTypes: REL_TYPES, locale: "en", ...WORDS };
    expect(compactPath(negated, { ...opts, hasNo: "has no" })).toBe(
      "Application › has no is affected by Initiative",
    );
    expect(compactPath(negated, opts)).toBe("Application › is affected by Initiative");
  });

  it("falls back to the query's own keys for what the metamodel does not hold", () => {
    const unknown: CardQuery = {
      type: "Ghost",
      related: [{ relation: "relGone", type: "Phantom" }],
    };
    expect(compactPath(unknown, { types: TYPES, relationTypes: REL_TYPES, ...WORDS })).toBe(
      "Ghost › relGone Phantom",
    );
  });

  it("joins a group's lines with the AND word and groups with the OR word", () => {
    const opts = { types: TYPES, relationTypes: REL_TYPES, locale: "en", and: "UND", or: "ODER" };
    const app: CardQuery = {
      type: "Application",
      related: [{ relation: "relInitiativeToApp", type: "Initiative" }],
    };
    expect(compactPath({ all_of: [app, { type: "Application" }] }, opts)).toBe(
      "Application › is affected by Initiative UND Application",
    );
    expect(compactPath({ any_of: [app, CHAIN] }, opts)).toBe(
      "Application › is affected by Initiative ODER Organization › uses Application › is affected by Initiative",
    );
  });

  it("spells out two lines and counts the rest as +N", () => {
    const opts = { types: TYPES, relationTypes: REL_TYPES, locale: "en", ...WORDS };
    const app: CardQuery = { type: "Application" };
    expect(
      compactPath({ any_of: [{ all_of: [app, app, app] }, { type: "Organization" }] }, opts),
    ).toBe("Application AND Application +2");
    expect(compactPath({ any_of: [app, { type: "Organization" }, { type: "Initiative" }] }, opts)).toBe(
      "Application OR Organization +1",
    );
  });
});
