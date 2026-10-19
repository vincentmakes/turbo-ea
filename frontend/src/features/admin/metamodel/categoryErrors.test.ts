import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ApiError } from "@/api/client";
import { categoryErrorCode, categoryErrorMessage } from "./categoryErrors";

const t = i18n.t.bind(i18n);

describe("categoryErrorMessage", () => {
  it("translates a known code and fills its placeholders", () => {
    const err = new ApiError("raw", 409, {
      error: "types_present",
      message: "raw",
      types: ["Alpha", "Zulu", 3],
    });
    expect(categoryErrorCode(err)).toBe("types_present");
    expect(categoryErrorMessage(err, t)).toBe("This category is still used by: Alpha, Zulu.");
  });

  it("names the unknown category", () => {
    const err = new ApiError("raw", 400, { error: "unknown_category", category: "Typo" });
    expect(categoryErrorMessage(err, t)).toContain("“Typo”");
  });

  it("falls back to the error's message for another code", () => {
    const err = new ApiError("Something else", 400, { error: "other" });
    expect(categoryErrorCode(err)).toBeNull();
    expect(categoryErrorMessage(err, t)).toBe("Something else");
  });

  it("falls back to the generic sentence for a non-error", () => {
    expect(categoryErrorCode("nope")).toBeNull();
    expect(categoryErrorMessage(null, t)).toBe("The category could not be saved.");
  });

  it("ignores a string detail", () => {
    const err = new ApiError("Plain", 400, "Plain");
    expect(categoryErrorCode(err)).toBeNull();
    expect(categoryErrorMessage(err, t)).toBe("Plain");
  });
});
