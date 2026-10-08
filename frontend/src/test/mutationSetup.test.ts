import { getConfig } from "@testing-library/react";

// vitest.stryker.config.ts sets MUTATION_SANDBOX and appends mutationSetup.ts
// to the base setup file; the normal suite runs with neither. A merge that
// replaced setup.ts instead of appending would lose every global the suite
// relies on, and one that dropped mutationSetup.ts would bring back the 1s
// waits that aborted Stryker's initial run.
describe("Testing Library's async timeout", () => {
  it("is the 1s default in a normal run and 5s under Stryker", () => {
    const sandbox = process.env.MUTATION_SANDBOX === "1";
    expect(getConfig().asyncUtilTimeout).toBe(sandbox ? 5000 : 1000);
  });

  it("keeps the base setup file under both configs", () => {
    // setup.ts installs matchMedia; without it this is undefined in jsdom.
    expect(typeof window.matchMedia).toBe("function");
  });
});
