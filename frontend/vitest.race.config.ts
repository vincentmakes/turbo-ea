// The Vitest configuration of the race probe (`npm run test:race`; CI's
// "Frontend Race Probe" job runs it on the test files a pull request reaches).
// Plain `vitest run` never reads it.
//
// It is the normal suite with src/test/raceProbe.ts loaded FIRST, before the
// base setup file imports anything that could pull React in: React's
// scheduler takes `setImmediate` when it loads, so the probe must replace it
// before then. mergeConfig concatenates arrays (the base's entries first), so
// the probe is merged in as the BASE of the merge, which puts it ahead of
// src/test/setup.ts. Nothing else changes — the same files, the same 1 s wait
// budget for `findBy*` / `waitFor` as `vitest run` (the mutation sandbox's
// 5 s is deliberately not loaded: src/test/mutationSandbox.test.ts pins the
// suite's default, and the probe must not break a correct test) — and no
// coverage: this run judges races, not lines.
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export const RACE_PROBE_SETUP = "./src/test/raceProbe.ts";

export default mergeConfig(
  mergeConfig(defineConfig({ test: { setupFiles: [RACE_PROBE_SETUP] } }), base),
  defineConfig({ test: { coverage: { enabled: false } } }),
);
