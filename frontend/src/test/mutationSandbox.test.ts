import { getConfig } from "@testing-library/dom";
import { describe, expect, it } from "vitest";

import { inMutationSandbox } from "./sourceScan";

describe("the mutation sandbox's wait budget", () => {
  it("is longer than the suite's default and only set by the sandbox setup file", async () => {
    if (inMutationSandbox) {
      // A sandbox run (vitest.stryker.config.ts, or the race probe's sweep,
      // vitest.race-sweep.config.ts) loaded the sandbox setup file before this
      // file, so its budget already holds, and importing it changes nothing.
      expect(getConfig().asyncUtilTimeout).toBe(5000);
      const sandbox = await import("./mutationSandbox");
      expect(sandbox.SANDBOX_ASYNC_UTIL_TIMEOUT_MS).toBe(5000);
      expect(getConfig().asyncUtilTimeout).toBe(sandbox.SANDBOX_ASYNC_UTIL_TIMEOUT_MS);
      return;
    }
    // This file runs in the normal suite, where the default still holds...
    expect(getConfig().asyncUtilTimeout).toBe(1000);
    // ...and the sandbox setup file, run by vitest.stryker.config.ts, raises it.
    const sandbox = await import("./mutationSandbox");
    expect(sandbox.SANDBOX_ASYNC_UTIL_TIMEOUT_MS).toBe(5000);
    expect(getConfig().asyncUtilTimeout).toBe(sandbox.SANDBOX_ASYNC_UTIL_TIMEOUT_MS);
  });
});
