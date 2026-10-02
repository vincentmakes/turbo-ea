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
    // The heaviest dialog/grid tests legitimately take 2–4s of test time
    // locally; on a loaded CI runner with V8 coverage instrumentation they
    // cross vitest's 5s default and time out as false failures
    // (StakeholdersTab, CreateComplianceFindingDialog were the recurring
    // ones). 15s keeps genuine hangs failing while giving slow-runner
    // headroom.
    testTimeout: 15_000,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
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
      // Floors just under the measured totals (lines 50.0, statements 48.9,
      // branches 43.2, functions 41.6 on 2026-10-01). Raise them in any PR
      // that lifts the number; never lower them.
      thresholds: {
        lines: 49,
        statements: 48,
        branches: 42,
        functions: 40,
      },
    },
  },
});
