// The Vitest configuration StrykerJS runs (stryker.config.json →
// vitest.configFile). Plain `vitest run` never reads it.
//
// Stryker's Vitest runner only supports the `threads` pool, and a worker
// thread cannot change the process timezone: `vi.stubEnv("TZ", …)` is
// silently ignored there. The suites that pin a zone that way therefore fail
// in Stryker's initial test run, which aborts the whole mutation run. They are
// found by scanning for the stub, so a new one is left out without anyone
// having to remember this file, and they keep running in the normal suite.
//
// It also sets MUTATION_SANDBOX: a test that reads src/ as text would read the
// instrumented copy of whatever this run mutates, so the scans wrapped in
// `describeSourceScan` / `itSourceScan` (src/test/sourceScan.ts) skip here.
//
// And it adds src/test/mutationSetup.ts, which gives Testing Library's async
// queries the headroom a four-process instrumented run needs.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

const src = path.resolve(__dirname, "src");

export const pinsTimeZone = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((file) => /\.test\.tsx?$/.test(file))
  .filter((file) =>
    /stubEnv\(\s*["']TZ["']/.test(readFileSync(path.join(src, file), "utf8")),
  )
  .map((file) => `src/${file.split(path.sep).join("/")}`)
  .sort();

export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, ...pinsTimeZone],
      env: { MUTATION_SANDBOX: "1" },
      // Appended to the base config's setup.ts, which still runs first.
      setupFiles: ["./src/test/mutationSetup.ts"],
    },
  }),
);
