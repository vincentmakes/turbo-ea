import { describe, expect, it } from "vitest";
import {
  CARD_TAB_KEYS,
  CARD_TAB_LABEL_KEYS,
  cardTabKeys,
  extensionTabValue,
  hasItemsOrLoading,
  isCardTabKey,
  notesVisit,
  resolveCardTab,
  visibleExtensionTabs,
  type CardTabInputs,
} from "./cardTabs";

function inputs(over: Partial<CardTabInputs> = {}): CardTabInputs {
  return {
    cardType: "Application",
    showBpmTabs: true,
    showPpmTab: true,
    ppmEnabled: true,
    grcEnabled: false,
    canViewRisks: false,
    risksCount: 0,
    canViewCompliance: false,
    complianceCount: 0,
    canViewAdr: false,
    adrCount: 0,
    canManageAdrLinks: false,
    ...over,
  };
}

describe("hasItemsOrLoading", () => {
  it("shows a tab while its count loads and while it has items", () => {
    expect(hasItemsOrLoading(null)).toBe(true);
    expect(hasItemsOrLoading(1)).toBe(true);
    expect(hasItemsOrLoading(0)).toBe(false);
  });
});

describe("cardTabKeys", () => {
  it("gives a plain card the six tabs every card has", () => {
    expect(cardTabKeys(inputs())).toEqual([
      "card",
      "comments",
      "todos",
      "stakeholders",
      "resources",
      "history",
    ]);
  });

  it("puts a process's flow and assessments right after the Card tab", () => {
    expect(cardTabKeys(inputs({ cardType: "BusinessProcess" })).slice(0, 4)).toEqual([
      "card",
      "processFlow",
      "assessments",
      "comments",
    ]);
  });

  it("leaves the process tabs out where the host hides them", () => {
    expect(
      cardTabKeys(inputs({ cardType: "BusinessProcess", showBpmTabs: false })),
    ).not.toContain("processFlow");
  });

  it("gives an initiative its SoAW tab after Card and its PPM tab last", () => {
    const keys = cardTabKeys(inputs({ cardType: "Initiative" }));
    expect(keys[1]).toBe("soaw");
    expect(keys.slice(-2)).toEqual(["history", "ppm"]);
  });

  it("keeps an initiative's SoAW tab but drops PPM when PPM is off or hosted", () => {
    expect(cardTabKeys(inputs({ cardType: "Initiative", ppmEnabled: false }))).toEqual([
      "card",
      "soaw",
      "comments",
      "todos",
      "stakeholders",
      "resources",
      "history",
    ]);
    expect(cardTabKeys(inputs({ cardType: "Initiative", showPpmTab: false }))).not.toContain(
      "ppm",
    );
  });

  it("orders ADRs, risks and compliance between Resources and History", () => {
    const keys = cardTabKeys(
      inputs({
        grcEnabled: true,
        canViewAdr: true,
        adrCount: 2,
        canViewRisks: true,
        risksCount: 1,
        canViewCompliance: true,
        complianceCount: 3,
      }),
    );
    expect(keys).toEqual([
      "card",
      "comments",
      "todos",
      "stakeholders",
      "resources",
      "adrs",
      "risks",
      "compliance",
      "history",
    ]);
  });

  it("shows the ADR tab with no decisions only to someone who can link one", () => {
    expect(cardTabKeys(inputs({ canViewAdr: true, adrCount: 0 }))).not.toContain("adrs");
    expect(
      cardTabKeys(inputs({ canViewAdr: true, adrCount: 0, canManageAdrLinks: true })),
    ).toContain("adrs");
    expect(cardTabKeys(inputs({ canViewAdr: true, adrCount: null }))).toContain("adrs");
    expect(
      cardTabKeys(inputs({ canViewAdr: false, adrCount: 5, canManageAdrLinks: true })),
    ).not.toContain("adrs");
  });

  it("shows risks and compliance only with GRC on, the permission, and items", () => {
    const grc = { grcEnabled: true, canViewRisks: true, canViewCompliance: true };
    expect(cardTabKeys(inputs({ ...grc, risksCount: null, complianceCount: null }))).toEqual(
      expect.arrayContaining(["risks", "compliance"]),
    );
    const none = cardTabKeys(inputs({ ...grc, risksCount: 0, complianceCount: 0 }));
    expect(none).not.toContain("risks");
    expect(none).not.toContain("compliance");
    const off = cardTabKeys(
      inputs({ ...grc, grcEnabled: false, risksCount: 4, complianceCount: 4 }),
    );
    expect(off).not.toContain("risks");
    expect(off).not.toContain("compliance");
    const noRiskView = cardTabKeys(
      inputs({ ...grc, canViewRisks: false, risksCount: 4, complianceCount: 0 }),
    );
    expect(noRiskView).not.toContain("risks");
    const noComplianceView = cardTabKeys(
      inputs({ ...grc, canViewCompliance: false, risksCount: 0, complianceCount: 4 }),
    );
    expect(noComplianceView).not.toContain("compliance");
  });
});

describe("resolveCardTab", () => {
  const values = ["card", "processFlow", "assessments", "comments", "resources", "ext:x:y"];

  it("opens a tab named by its key", () => {
    expect(resolveCardTab("resources", values)).toBe("resources");
    expect(resolveCardTab("ext:x:y", values)).toBe("ext:x:y");
  });

  it("opens a tab named by an index, as a number or digits", () => {
    expect(resolveCardTab(1, values)).toBe("processFlow");
    expect(resolveCardTab("2", values)).toBe("assessments");
    expect(resolveCardTab(0, values)).toBe("card");
  });

  it("falls back to the Card tab for anything it cannot place", () => {
    expect(resolveCardTab(undefined, values)).toBe("card");
    expect(resolveCardTab("", values)).toBe("card");
    expect(resolveCardTab("risks", values)).toBe("card");
    expect(resolveCardTab(99, values)).toBe("card");
    expect(resolveCardTab("1a", values)).toBe("card");
    expect(resolveCardTab("-1", values)).toBe("card");
  });
});

describe("notesVisit", () => {
  it("records a visit to a built-in tab opened in place", () => {
    expect(notesVisit("comments")).toBe(true);
    expect(notesVisit("card")).toBe(true);
  });

  it("does not record PPM, which navigates away, or an extension tab", () => {
    expect(notesVisit("ppm")).toBe(false);
    expect(notesVisit("ext:acme:summary")).toBe(false);
  });
});

describe("tab keys and labels", () => {
  it("knows every key and labels each from the cards namespace", () => {
    expect(isCardTabKey("history")).toBe(true);
    expect(isCardTabKey("nope")).toBe(false);
    expect(CARD_TAB_KEYS.map((k) => CARD_TAB_LABEL_KEYS[k])).toEqual([
      "tabs.card",
      "tabs.processFlow",
      "tabs.assessments",
      "tabs.soaw",
      "tabs.comments",
      "tabs.todos",
      "tabs.stakeholders",
      "tabs.resources",
      "tabs.adrs",
      "tabs.risks",
      "tabs.compliance",
      "tabs.history",
      "tabs.ppm",
    ]);
  });
});

describe("visibleExtensionTabs", () => {
  it("keeps a tab for this card type and the user's permissions, in order", () => {
    const extensions = [
      {
        key: "acme",
        plugin: {
          cardTabs: [
            { id: "all", label: "All" },
            { id: "apps", label: "Apps", appliesTo: ["Application"] },
            { id: "procs", label: "Procs", appliesTo: ["BusinessProcess"] },
            { id: "secret", label: "Secret", permission: "ext.acme.secret" },
            { id: "open", label: "Open", permission: "ext.acme.open" },
          ],
        },
      },
      { key: "bare", plugin: {} },
    ];
    const can = (p: string) => p === "ext.acme.open";
    expect(
      visibleExtensionTabs(extensions, "Application", can).map((x) => [x.extKey, x.def.id, x.value]),
    ).toEqual([
      ["acme", "all", "ext:acme:all"],
      ["acme", "apps", "ext:acme:apps"],
      ["acme", "open", "ext:acme:open"],
    ]);
  });

  it("names an extension tab after its extension and id", () => {
    expect(extensionTabValue("acme", "summary")).toBe("ext:acme:summary");
  });
});
