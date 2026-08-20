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
      thresholds: {
        statements: 0,
      },
    },
  },
});
