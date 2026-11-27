// The race probe: a setup file that makes a "read too early" test fail every
// time instead of once in twenty runs (vitest.race.config.ts lists it FIRST in
// `setupFiles`; `npm run test:race` runs it).
//
// The race. React 19's scheduler (node_modules/scheduler, `localSetImmediate`)
// takes `setImmediate` at module load and posts all of its work through it,
// yielding back after 5 ms and re-posting. Testing Library's `waitFor` /
// `findBy*` (`asyncWrapper` in @testing-library/react) resolves its callback
// and then lets exactly one `setTimeout(0)` pass before the test continues. So
// a `waitFor` whose condition is already true on its first check — typically
// `expect(api.get).toHaveBeenCalled()`, which proves the request was SENT —
// followed by a synchronous query for what the RESPONSE renders, depends on
// React committing within that one timer. On a quick run it usually does; in
// Stryker's instrumented runs (several times slower) it lost often enough to
// turn the mutation nightly red on run 68 (RelationsSection.lifecycle).
//
// The probe. It replaces `setImmediate` before React is loaded, so React's
// scheduler captures this wrapper, which runs every callback RACE_PROBE_DELAY_MS
// later on the REAL `setTimeout` captured here at load — so a test's
// `vi.useFakeTimers()` cannot freeze React's work (React's scheduler never saw
// the fake clock without the probe either). React's work moves from Node's
// check phase into the timer queue, behind Testing Library's zero-delay timer:
// a correct test, which waits for the DOM it reads, passes as before; one that
// reads before React committed fails every time (RelationsSection.lifecycle
// .test.tsx at 5ad9c27: its five early reads fail 5 runs of 5, at 0, 1 and
// 2 ms alike). `clearImmediate` is wrapped to match.
//
// The delay is 2 ms. Node clamps a 0 ms timer to 1, so 0 and 1 are the same
// timer; 2 also orders a commit posted just before Testing Library's timer
// behind it. The whole suite costs about what `vitest run` does.
//
// What it does not force. A `waitFor` that turns true LATER (a callback called
// mid-way through a save, a `finally` that re-enables a button) is judged by
// whichever check — its 50 ms poll, or a DOM mutation — comes first after the
// call. Only a delay above that poll interval makes React lose that race too,
// and even then not every run (60 ms: the failing set varied run to run, the
// suite took twice as long). For a sweep, raise it from the environment:
// `RACE_PROBE_DELAY_MS=60 npm run test:race -- <file>`. Run 60's test (a
// callback asserted, unwaited, after the commit whose passive effect calls it:
// DocumentSidePanel.test.tsx before f67254f) fails 3 runs of 5 here, not 5.
// Timing that goes through `requestAnimationFrame` (run 61: TipTap focuses a
// frame late) is not touched at all.
//
// A test that fails under the probe has a race to fix in the test (wait on
// the element the assertion reads, or put the assertion inside `waitFor`),
// never a timeout to raise (.claude/rules/testing-ci.md). A correct test the
// probe breaks is a bug in the probe.

/** How long each `setImmediate` callback is held back, in milliseconds. */
export const RACE_PROBE_DELAY_MS = 2;

const INSTALLED = Symbol.for("turbo-ea.raceProbe");

// Taken when this module loads — before any test can call vi.useFakeTimers().
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

type Immediate = ReturnType<typeof setTimeout>;

interface ProbeGlobal {
  setImmediate: (callback: (...args: unknown[]) => void, ...args: unknown[]) => unknown;
  clearImmediate: (handle: unknown) => void;
  [INSTALLED]?: true;
}

/** The delay to use: `RACE_PROBE_DELAY_MS` from the environment when it is a
 *  whole number of milliseconds, the default otherwise. */
export function probeDelay(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RACE_PROBE_DELAY_MS?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : RACE_PROBE_DELAY_MS;
}

/** The timer the probe defers through: the real one by default (taken at
 *  load); a test passes its own to check the deferral without a clock. */
export interface ProbeTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: never) => void;
}

const REAL_TIMERS: ProbeTimers = {
  setTimeout: (callback, ms) => realSetTimeout(callback, ms),
  clearTimeout: (handle) => realClearTimeout(handle as Immediate),
};

/** Install the wrapper on `target` (globalThis by default). Idempotent: a
 *  second call (an isolate-off worker re-running setup files) changes nothing,
 *  so the delay never compounds. Returns whether it installed. */
export function installRaceProbe(
  target: ProbeGlobal = globalThis as unknown as ProbeGlobal,
  delayMs: number = probeDelay(),
  timers: ProbeTimers = REAL_TIMERS,
): boolean {
  if (target[INSTALLED]) return false;
  const realClearImmediate = target.clearImmediate;
  const deferred = new WeakSet<object>();

  target.setImmediate = (callback, ...args) => {
    const handle = timers.setTimeout(() => callback(...args), delayMs);
    if (handle && typeof handle === "object") deferred.add(handle);
    return handle;
  };
  target.clearImmediate = (handle) => {
    if (handle && typeof handle === "object" && deferred.has(handle)) {
      timers.clearTimeout(handle as never);
    } else {
      realClearImmediate(handle);
    }
  };
  target[INSTALLED] = true;
  return true;
}

/**
 * Hold back React's scheduler only. The wrapper is installed on globalThis,
 * React (react-dom and the scheduler it requires) is loaded so the scheduler
 * captures the wrapper (it takes
 * `setImmediate` once, when its module is evaluated; react-dom requires the
 * same cached instance later), and the real functions are put back for
 * everyone else. Without that, every other user of `setImmediate` paid the
 * delay too — fake timers' async ticks, a test's own `setImmediate` drain,
 * setup.ts's afterEach — and at 60 ms a test that walks a fake clock through
 * a few hundred timers ran out of its 15 s (ExtensionsAdmin, CommitInitiative
 * Dialog): a failure of the probe, not of the test.
 */
export async function probeReactScheduler(
  target: ProbeGlobal = globalThis as unknown as ProbeGlobal,
  // react-dom requires the scheduler (one cached copy in node_modules), and is
  // a dependency of this package, which `scheduler` itself is not.
  loadScheduler: () => Promise<unknown> = () => import("react-dom/client"),
  delayMs: number = probeDelay(),
): Promise<boolean> {
  const { setImmediate: realSet, clearImmediate: realClear } = target;
  const installed = installRaceProbe(target, delayMs);
  try {
    await loadScheduler();
  } finally {
    if (installed) {
      target.setImmediate = realSet;
      target.clearImmediate = realClear;
    }
  }
  return installed;
}

await probeReactScheduler();
