import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // .stryker-tmp is StrykerJS's sandbox (instrumented copies of src/), reports/ its output.
  { ignores: ["dist", ".stryker-tmp", "reports"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "prefer-const": "warn",
      "prefer-rest-params": "warn",
      // `toISOString()` is UTC, so slicing a calendar day off it yields the
      // wrong day for every user west of UTC — a PPM status report saved on
      // 27 Aug displayed as 26 Aug in California (#1016). Three private copies
      // of the workaround had grown before `@/lib/dates` existed; this rule is
      // what stops a fourth. Same posture as `components/DateField.tsx` (#865).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.callee.property.name='toISOString'][callee.property.name=/^(slice|split|substring)$/]",
          message:
            "toISOString() is UTC and yields the wrong calendar day west of UTC. Use todayIsoDate() / toIsoDate() from @/lib/dates.",
        },
      ],
      // Icons are Google Material Symbols through the `MaterialSymbol`
      // component (CLAUDE.md, Frontend Conventions). `@mui/icons-material` is
      // still installed, so an auto-import would quietly pull a second icon
      // set into the bundle; this rule is what keeps the count at zero.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mui/icons-material", "@mui/icons-material/*"],
              message:
                "Icons use the MaterialSymbol component (Google Material Symbols), not @mui/icons-material — CLAUDE.md Frontend Conventions.",
            },
          ],
        },
      ],
    },
  },
  {
    // The browser smoke suite runs under Node (Playwright), not in the page;
    // so do the coverage scripts and their tests.
    files: ["e2e/**/*.ts", "playwright.config.ts", "scripts/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
