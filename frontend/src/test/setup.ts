import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import i18n from "@/i18n";
// AG Grid module registration (mandatory since v33) for every test that
// mounts a real <AgGridReact> — same side-effect import the grid pages use.
import "@/lib/agGridSetup";

// Provide a minimal sessionStorage for tests (jsdom includes one, but
// this ensures it's always clean between test files).
beforeEach(() => {
  sessionStorage.clear();
});

// Drain pending async work after each test, so nothing lands after Vitest has
// torn jsdom down and deleted `window`. The symptom is an unhandled
// "ReferenceError: window is not defined" — typically AG Grid's
// `LocalEventService.dispatchAsync`, reached from a late `RowRenderer` redraw
// — which fails the run even though every test passed, and only on loaded CI
// runners.
//
// Two queues matter, and they are drained separately because neither drains
// the other:
//   - the timer queue (`setTimeout`), which is what AG Grid itself schedules;
//   - Node's check phase (`setImmediate`), which is what React 19's scheduler
//     posts its work through. jsdom's teardown calls `window.close()` and so
//     cancels every `window.setTimeout`/rAF, but it has no say over
//     `setImmediate` — that is the queue a late React commit rides in on.
//
// Hooks run in reverse registration order, so Testing Library's auto-cleanup
// (registered by the test file's imports) has already unmounted by the time
// this runs; the drain therefore also catches work scheduled during unmount.
//
// This is defence in depth, NOT a guarantee: React re-posts itself whenever it
// yields, so a fixed number of drains narrows the window rather than closing
// it. The deterministic fix for any one file is to leave nothing in flight —
// either stub the grid (`InventoryDragFill.test.tsx`) or end the test by
// awaiting the grid's own DOM (`InventoryFreezePersistence.test.tsx`,
// `InventoryOrderPersistence.test.tsx`). A test that mounts a real AG Grid and
// does neither will eventually trip this again.
//
// Skipped under fake timers: mocked timeouts die with the mock clock and never
// reach the real event loop.
afterEach(async () => {
  if (vi.isFakeTimers()) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
});

// Ensure i18n is set to English for all tests so t() returns English text.
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
