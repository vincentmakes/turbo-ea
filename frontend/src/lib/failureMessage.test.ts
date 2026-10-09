import { describe, expect, it } from "vitest";
import { failureMessage, wordFailure } from "./failureMessage";

const t = (key: string) => `[${key}]`;

describe("failureMessage / wordFailure", () => {
  it("keeps an Error's own message and shows it as is", () => {
    const stored = failureMessage(new Error("GET /x failed"), "common:errors.generic");
    expect(stored).toBe("GET /x failed");
    expect(wordFailure(stored, t)).toBe("GET /x failed");
  });

  it("stores the fallback key for a rejection that is not an Error, or an Error with no message", () => {
    for (const err of ["offline", {}, undefined, new Error("")]) {
      const stored = failureMessage(err, "common:errors.generic");
      expect(stored).not.toBe("");
      expect(wordFailure(stored, t)).toBe("[common:errors.generic]");
    }
  });

  it("words the key with whatever t it is handed, so a language switch re-words it", () => {
    const stored = failureMessage(null, "navigator.loadElementsFailed");
    expect(wordFailure(stored, (k) => `de:${k}`)).toBe("de:navigator.loadElementsFailed");
    expect(wordFailure(stored, (k) => `en:${k}`)).toBe("en:navigator.loadElementsFailed");
  });
});
