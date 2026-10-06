// Tests that read `src/` as text (route tables parsed out of App.tsx, every
// literal t() key, per-field label pins) cannot run inside a StrykerJS
// sandbox: there the files being mutated are instrumented copies, so a scan
// sees mutant switches instead of the source and fails Stryker's initial test
// run, which aborts the whole mutation run. `vitest.stryker.config.ts` sets
// MUTATION_SANDBOX, and a scan wrapped in these skips itself there. It keeps
// running in the normal suite, and a scan of text could never kill a runtime
// mutant anyway. backend/tests/services/test_ci_workflow_mutation.py fails
// any test that reads files off disk without importing this module (or being
// allowlisted there with a reason).
import { describe, it } from "vitest";

export const inMutationSandbox = process.env.MUTATION_SANDBOX === "1";

export const describeSourceScan = describe.skipIf(inMutationSandbox);
export const itSourceScan = it.skipIf(inMutationSandbox);
