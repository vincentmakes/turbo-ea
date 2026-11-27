// The race probe's sweep mode (`npm run test:race:sweep`): the nightly's view
// of the suite. Plain `vitest run` and the CI job's 2 ms probe never read it.
//
// The 2 ms probe (vitest.race.config.ts) forces one race every time: a
// `waitFor` already true on its first check, then a synchronous read. A wait
// that turns true LATER (a callback called before the state beside it
// commits) is only lost when React's work is held back longer than
// Testing Library's 50 ms poll, so this mode holds it 60 ms. It also loads
// what Stryker's dry run loads (vitest.stryker.config.ts): the mutation
// sandbox's 5 s wait, after the base setup file, and MUTATION_SANDBOX=1. That
// is what separates a wait that merely ran out of the suite's 1 s budget
// (every React step is slower here) from a wrong order: the nightly allows
// 5 s, so only a wrong order fails here as it fails there.
//
// The suites that pin a timezone are NOT left out, as Stryker must: they run
// fine under Vitest's own pool. A test that fails here and passes under the
// 2 ms probe is classified in .claude/rules/testing-ci.md.
import { defineConfig, mergeConfig } from "vitest/config";
import race from "./vitest.race.config";

export const SWEEP_DELAY_MS = "60";

export default mergeConfig(
  race,
  defineConfig({
    test: {
      env: { RACE_PROBE_DELAY_MS: SWEEP_DELAY_MS, MUTATION_SANDBOX: "1" },
      // mergeConfig concatenates arrays: after the probe and the base setup file.
      setupFiles: ["./src/test/mutationSandbox.ts"],
    },
  }),
);
