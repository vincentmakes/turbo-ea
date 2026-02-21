import "@testing-library/jest-dom/vitest";

// Provide a minimal sessionStorage for tests (jsdom includes one, but
// this ensures it's always clean between test files).
beforeEach(() => {
  sessionStorage.clear();
});
