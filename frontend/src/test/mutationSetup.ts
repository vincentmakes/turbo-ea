// Loaded after setup.ts, and only by vitest.stryker.config.ts: plain
// `vitest run` never reads it.
//
// Stryker's initial test run executes every test related to the mutated files
// in one worker thread, with those files instrumented: each statement goes
// through Stryker's per-test coverage counter and active-mutant switch. On a CI
// runner a big page re-rendering after a click then outlasts Testing Library's
// 1s default for `findBy*` / `waitFor`, so a test that passes in every normal
// run fails here, and one failure in the initial run aborts the whole mutation
// job (ADREditor's "confirms a duplicate" did, twice, while passing locally
// under the same Stryker run). An element that is already there still resolves
// at once; the headroom costs a test nothing unless it is waiting for something
// that never comes.
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 5000 });
