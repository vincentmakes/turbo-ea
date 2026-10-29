import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { BACKEND_PROBLEMS, problemOfError, queryErrorMessage } from "./queryProblems";

const t = i18n.getFixedT("en", "common");

describe("queryProblems", () => {
  it("has an English message for every backend code", () => {
    for (const key of Object.values(BACKEND_PROBLEMS)) {
      expect(i18n.exists(`common:dashboard.config.problem.${key}`), key).toBe(true);
    }
  });

  it("finds the code in the message, a validation message or the detail", () => {
    expect(problemOfError(new Error("unknown_flag"))).toBe("unknownFlag");
    expect(problemOfError(new Error("Value error, stacked_column_needs_two_dimensions"))).toBe(
      "stackedColumnNeedsTwoDimensions",
    );
    expect(problemOfError({ message: "x", detail: { code: "relation_type_conflict" } })).toBe("relationTypeConflict");
    expect(problemOfError({ message: "", detail: "unknown_phase" })).toBe("unknownPhase");
    expect(problemOfError({ message: "x", detail: { code: "invalid_show_values" } })).toBe("invalidShowValues");
    // A code is matched whole, never inside a longer word.
    expect(problemOfError(new Error("my_unknown_flags"))).toBeNull();
    expect(problemOfError(null)).toBeNull();
    expect(problemOfError("unknown_flag")).toBeNull();
  });

  it("says the problem, else the server's message, else the generic error", () => {
    expect(queryErrorMessage(new Error("share_needs_filter"), t)).toBe(t("dashboard.config.problem.shareNeedsFilter"));
    expect(queryErrorMessage(new Error("boom"), t)).toBe("boom");
    expect(queryErrorMessage(new Error(""), t)).toBe(t("errors.generic"));
    expect(queryErrorMessage(undefined, t)).toBe(t("errors.generic"));
  });
});
