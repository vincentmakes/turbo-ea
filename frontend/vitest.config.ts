/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-test"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: false,
    // Resets every vi.mock()'d module's call history/implementation between
    // tests automatically, so a test can never read state a previous test in
    // the same file left on a shared mock (the recurring cause of flaky runs
    // before files were made to do this by hand with a per-file
    // `beforeEach(() => vi.clearAllMocks())`). Does not reset modules
    // themselves (`mockReset`) or restore spies to their original
    // implementation (`restoreMocks`) — neither has been needed so far.
    clearMocks: true,
    // The heaviest dialog/grid tests legitimately take 2–4s of test time
    // locally; on a loaded CI runner with V8 coverage instrumentation they
    // cross vitest's 5s default and time out as false failures
    // (StakeholdersTab, CreateComplianceFindingDialog were the recurring
    // ones). 15s keeps genuine hangs failing while giving slow-runner
    // headroom.
    testTimeout: 15_000,
    server: { deps: { external: [/scripts[\\/].*\.mjs$/] } },
    // scripts/: the tooling CI runs (e2e-coverage.mjs, merge-lcov.mjs, pr-test-scope.mjs).
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // scripts/e2e-coverage.mjs mirrors this include/exclude for the browser
      // suite's report (`isMeasured`); change both together — the parity test
      // in scripts/e2e-coverage.test.ts pins these two lists. The coverage
      // tooling CI runs is measured too, named file by file: a `scripts/**`
      // glob would also take in the untested generator scripts (gen-*.mjs),
      // and the next PR to touch one would fail the diff gate on them.
      include: [
        "src/**/*.{ts,tsx}",
        "scripts/app-asset.mjs",
        "scripts/e2e-coverage.mjs",
        "scripts/merge-lcov.mjs",
        "scripts/pr-test-scope.mjs",
      ],
      exclude: ["src/test/**", "src/**/*.test.{ts,tsx}", "src/main.tsx"],
      // `text` is what the CI log shows; `lcov` feeds the diff-coverage gate
      // on changed lines and `json-summary` the job summary (ci.yml).
      // diff-cover reads an `SF:` path as absolute or relative to the git
      // root, so the LCOV report is rooted at the repository, not at
      // frontend/ — otherwise no changed line ever matches and the gate
      // passes vacuously.
      reporter: [
        "text",
        ["lcov", { projectRoot: path.resolve(__dirname, "..") }],
        "json-summary",
      ],
      // Floors just under the measured totals (lines 89.7, statements 88.4,
      // branches 83.4, functions 86.2 on 2026-10-16, ArchiMate modeler in;
      // read on Windows with two script suites and a few locale-bound tests
      // failing, so CI reads a little higher). Raise them in any PR
      // that lifts the number; never lower them. The published figure (unit
      // + browser suite, lines only) has its own floor in package.json,
      // config.coverageFloorMergedLines, read by scripts/merge-lcov.mjs.
      thresholds: {
        lines: 88,
        statements: 87,
        branches: 82,
        functions: 85,
      },
    },
  },
});
