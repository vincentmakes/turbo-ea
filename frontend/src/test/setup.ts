import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import i18n from "@/i18n";

// Provide a minimal sessionStorage for tests (jsdom includes one, but
// this ensures it's always clean between test files).
beforeEach(() => {
  sessionStorage.clear();
});

// AG Grid schedules async event flushes via window.setTimeout (e.g.
// RowRenderer's displayedRowsChanged). When the last test of a file finishes
// while such a timeout is pending, it fires after jsdom is torn down and
// throws "window is not defined" — Vitest reports that as an unhandled error
// and fails the run even though every test passed (flaky on slow CI runners).
// Drain the macrotask queue after each test. Hooks run in reverse
// registration order, so Testing Library's auto-cleanup (registered by the
// test file's imports) has already unmounted by the time this runs — the
// drain also catches flushes scheduled during grid destroy. Two ticks cover
// a flush that schedules a follow-up. Skipped under fake timers: mocked
// timeouts die with the mock clock and never reach the real event loop.
afterEach(async () => {
  if (vi.isFakeTimers()) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

// Ensure i18n is set to English for all tests so t() returns English text.
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
