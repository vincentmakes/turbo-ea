import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { PROBLEM_LABEL_KEYS, problemCodes, problemMessage } from "./decisionProblems";

const t = i18n.getFixedT("en", "delivery");
const err = (detail: unknown) => Object.assign(new Error("x"), { detail });

describe("problemCodes", () => {
  it("reads `problems` first, then `error`, and nothing from anything else", () => {
    expect(problemCodes({ error: "not_draft", problems: ["valid_until_past", 3] })).toEqual([
      "valid_until_past",
    ]);
    expect(problemCodes({ error: "not_draft" })).toEqual(["not_draft"]);
    expect(problemCodes({ error: 42 })).toEqual([]);
    expect(problemCodes("Decision is already signed")).toEqual([]);
    expect(problemCodes(null)).toEqual([]);
    expect(problemCodes(undefined)).toEqual([]);
  });
});

describe("problemMessage", () => {
  it("translates each known code once, in order, joined by a space", () => {
    expect(
      problemMessage(
        err({ error: "decided_on_future", problems: ["decided_on_future", "no_decision_maker", "decided_on_future"] }),
        t,
      ),
    ).toBe("Decided on cannot be in the future. Name at least one decision maker.");
  });

  it("maps a missing reference and a missing target to the same message", () => {
    expect(problemMessage(err({ error: "decision_not_found", value: "ADR-9" }), t)).toBe(
      "A linked decision could not be found.",
    );
    expect(PROBLEM_LABEL_KEYS.decision_not_found).toBe(PROBLEM_LABEL_KEYS.target_missing);
  });

  it("returns null when no code is known, or there is no detail", () => {
    expect(problemMessage(err({ error: "something_else" }), t)).toBeNull();
    expect(problemMessage(new Error("plain"), t)).toBeNull();
    expect(problemMessage(null, t)).toBeNull();
  });

  it("has an English string for every code", () => {
    for (const key of Object.values(PROBLEM_LABEL_KEYS)) {
      expect(t(key)).not.toBe(key);
    }
  });
});
