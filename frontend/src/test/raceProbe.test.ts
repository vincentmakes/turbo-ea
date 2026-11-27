// @vitest-environment node
import {
  clearImmediate as nodeClearImmediate,
  setImmediate as nodeSetImmediate,
  setTimeout as nodeSetTimeout,
} from "node:timers";

import { afterEach, describe, expect, it, vi } from "vitest";

import raceConfig, { RACE_PROBE_SETUP } from "../../vitest.race.config";
import { RACE_PROBE_DELAY_MS, installRaceProbe, probeDelay } from "./raceProbe";

// Node's own functions: importing ./raceProbe already replaced the globals in
// this file, and vi.useFakeTimers() replaces globals, never node:timers.
const realSetTimeout = nodeSetTimeout;
const realSetImmediate = nodeSetImmediate;
const realClearImmediate = nodeClearImmediate;
const sleep = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

type Target = Parameters<typeof installRaceProbe>[0] & object;

/** A stand-in for globalThis: the real functions, on an object of its own. */
function probed(delayMs = 30): Target {
  const target = { setImmediate: realSetImmediate, clearImmediate: realClearImmediate } as unknown as Target;
  expect(installRaceProbe(target, delayMs)).toBe(true);
  return target;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the race probe", () => {
  it("hands each callback to the timer with its delay and arguments, and runs nothing itself", () => {
    // No clock: a recording timer, so the assertion cannot depend on speed.
    const posted: { run: () => void; ms: number; handle: object }[] = [];
    const timers = {
      setTimeout: (run: () => void, ms: number) => {
        const handle = { id: posted.length };
        posted.push({ run, ms, handle });
        return handle;
      },
      clearTimeout: vi.fn(),
    };
    const target = { setImmediate: realSetImmediate, clearImmediate: realClearImmediate } as unknown as Target;
    expect(installRaceProbe(target, 7, timers)).toBe(true);
    const cb = vi.fn();
    const handle = target.setImmediate(cb, "a", 2);
    expect(posted.map((p) => p.ms)).toEqual([7]);
    expect(handle).toBe(posted[0].handle);
    expect(cb).not.toHaveBeenCalled();
    posted[0].run();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("a", 2);
    // Its own handle goes back to the timer it came from.
    target.clearImmediate(handle);
    expect(timers.clearTimeout).toHaveBeenCalledWith(handle);
  });

  it("defaults to the real clock: the callback runs once its timer expires", async () => {
    const target = probed(5);
    const cb = vi.fn();
    target.setImmediate(cb, "b");
    expect(cb).not.toHaveBeenCalled();
    // A timer posted later with a longer delay expires later: Node runs timers
    // in expiry order and start times only grow, so this holds at any speed.
    await sleep(40);
    expect(cb).toHaveBeenCalledWith("b");
  });

  it("cancels a deferred callback, and hands any other handle to the real clearImmediate", async () => {
    const target = probed(5);
    const cancelled = vi.fn();
    target.clearImmediate(target.setImmediate(cancelled));
    const foreign = vi.fn();
    target.clearImmediate(realSetImmediate(foreign));
    target.clearImmediate(undefined);
    await sleep(30);
    expect(cancelled).not.toHaveBeenCalled();
    expect(foreign).not.toHaveBeenCalled();
  });

  it("runs on the real clock, so fake timers can neither freeze nor fire it", async () => {
    const target = probed(5);
    vi.useFakeTimers();
    const cb = vi.fn();
    target.setImmediate(cb);
    vi.advanceTimersByTime(10_000);
    vi.runAllTimers();
    expect(cb).not.toHaveBeenCalled();
    await sleep(40);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("installs once, so the delay never compounds", () => {
    const target = probed();
    const wrapped = target.setImmediate;
    expect(installRaceProbe(target)).toBe(false);
    expect(target.setImmediate).toBe(wrapped);
    // Importing the module installed it on this file's globalThis already.
    expect(installRaceProbe()).toBe(false);
    expect(globalThis.setImmediate).not.toBe(realSetImmediate);
  });

  it("holds React's work back past Testing Library's zero-delay timer, and no longer", () => {
    // Node clamps setTimeout(…, 0) to 1 ms, and the probe moves each callback
    // from the check phase into the timer queue; 2 ms also orders a callback
    // posted just before Testing Library's timer behind it.
    expect(RACE_PROBE_DELAY_MS).toBe(2);
  });

  it("takes a whole-millisecond delay from RACE_PROBE_DELAY_MS, and the default otherwise", () => {
    expect(probeDelay({})).toBe(RACE_PROBE_DELAY_MS);
    expect(probeDelay({ RACE_PROBE_DELAY_MS: "60" })).toBe(60);
    expect(probeDelay({ RACE_PROBE_DELAY_MS: " 0 " })).toBe(0);
    for (const bad of ["", " ", "-5", "1.5", "60ms", "1e3", "x60"]) {
      expect(probeDelay({ RACE_PROBE_DELAY_MS: bad })).toBe(RACE_PROBE_DELAY_MS);
    }
  });
});

describe("vitest.race.config.ts", () => {
  it("loads the probe first, before the setup file that could load React, and nothing else", () => {
    // Not the mutation sandbox's 5 s wait: mutationSandbox.test.ts pins the
    // suite's 1 s default, and the probe must not break a correct test.
    expect(raceConfig.test?.setupFiles).toEqual([RACE_PROBE_SETUP, "./src/test/setup.ts"]);
    expect(RACE_PROBE_SETUP).toBe("./src/test/raceProbe.ts");
  });

  it("measures no coverage and keeps the suite's include", () => {
    expect(raceConfig.test?.coverage?.enabled).toBe(false);
    expect(raceConfig.test?.include).toEqual(["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"]);
  });
});
