import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
// Evaluated at file load on purpose: the mock factory runs once, on the first
// import of `@/api/client`, and its result survives `vi.resetModules()`, so a
// static import pins it to the same module generation as the `mockApi` below.
// Otherwise the factory would first run inside a test, after a reset, against
// a fresh copy of the kit whose routes nothing here could reach.
import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";

const PATH = "/extensions/status";

interface StatusRow {
  key: string;
  version: string;
  entitlement_state: string;
  grants?: string[];
}

function row(key: string, grants?: string[]): StatusRow {
  return { key, version: "1.0.0", entitlement_state: "active", grants };
}

/** A promise the test resolves by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The module keeps a process-wide cache, so every test re-imports it fresh.
async function load() {
  return import("./useExtensionCapabilities");
}

describe("useExtensionCapabilities", () => {
  beforeEach(() => {
    mockApi.reset();
    vi.resetModules();
  });

  it("is wired to the scripted client (guards the mock plumbing itself)", () => {
    expect(api).toBe(mockApi.api);
  });

  it("reports nothing loaded until the status arrives, then the union of every grant", async () => {
    mockApi.on("get", PATH, [
      row("regulatory", ["metamodel.field_help", "core.cards.read"]),
      row("connector", ["core.todos.write", "core.cards.read"]),
    ]);
    const { useExtensionCapabilities } = await load();

    const { result } = renderHook(() => useExtensionCapabilities());
    expect(result.current.loaded).toBe(false);
    expect(result.current.has("metamodel.field_help")).toBe(false);

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.has("metamodel.field_help")).toBe(true);
    expect(result.current.has("core.todos.write")).toBe(true);
    expect(result.current.has("core.cards.read")).toBe(true);
    expect(result.current.has("metamodel.custom_field_types")).toBe(false);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("tolerates rows that declare no grants at all", async () => {
    mockApi.on("get", PATH, [row("content-pack"), row("ui-only", [])]);
    const { useExtensionCapabilities } = await load();

    const { result } = renderHook(() => useExtensionCapabilities());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.has("metamodel.field_help")).toBe(false);
  });

  it("answers `has` with an exact match, never a prefix or wildcard", async () => {
    mockApi.on("get", PATH, [row("x", ["metamodel.field_help"])]);
    const { useExtensionCapabilities } = await load();

    const { result } = renderHook(() => useExtensionCapabilities());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.has("metamodel")).toBe(false);
    expect(result.current.has("metamodel.*")).toBe(false);
    expect(result.current.has("")).toBe(false);
  });

  it("shares one in-flight request between hooks mounting in the same tick", async () => {
    const gate = deferred<StatusRow[]>();
    mockApi.on("get", PATH, () => gate.promise);
    const { useExtensionCapabilities } = await load();

    const a = renderHook(() => useExtensionCapabilities());
    const b = renderHook(() => useExtensionCapabilities());
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);

    await act(async () => {
      gate.resolve([row("x", ["metamodel.custom_field_types"])]);
    });
    await waitFor(() => {
      expect(a.result.current.loaded).toBe(true);
      expect(b.result.current.loaded).toBe(true);
    });
    expect(a.result.current.has("metamodel.custom_field_types")).toBe(true);
    expect(b.result.current.has("metamodel.custom_field_types")).toBe(true);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("serves a later mount from the cache, loaded on the first render", async () => {
    mockApi.on("get", PATH, [row("x", ["metamodel.field_help"])]);
    const { useExtensionCapabilities } = await load();

    const first = renderHook(() => useExtensionCapabilities());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();

    const second = renderHook(() => useExtensionCapabilities());
    expect(second.result.current.loaded).toBe(true);
    expect(second.result.current.has("metamodel.field_help")).toBe(true);
    // Still just the one request from the first mount.
    expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
  });

  it("falls back to no capabilities when the request fails, without remembering that answer", async () => {
    mockApi.fail("get", PATH, 500);
    const { useExtensionCapabilities } = await load();

    const first = renderHook(() => useExtensionCapabilities());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    expect(first.result.current.has("metamodel.field_help")).toBe(false);
    first.unmount();

    // A transient error at boot must not hide the authoring affordances for
    // the whole session: the next mount asks again, and gets the answer.
    mockApi.on("get", PATH, [{ key: "plus", version: "1", entitlement_state: "active", grants: ["metamodel.field_help"] }]);
    const second = renderHook(() => useExtensionCapabilities());
    expect(second.result.current.loaded).toBe(false);
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(second.result.current.has("metamodel.field_help")).toBe(true);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(2);
  });

  it("invalidateExtensionCapabilities drops the cache so the next mount refetches", async () => {
    mockApi.on("get", PATH, []);
    const { useExtensionCapabilities, invalidateExtensionCapabilities } = await load();

    const first = renderHook(() => useExtensionCapabilities());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    expect(first.result.current.has("metamodel.field_help")).toBe(false);
    first.unmount();

    // The install landed: the admin page invalidates, and the next consumer
    // sees the new grant.
    invalidateExtensionCapabilities();
    mockApi.on("get", PATH, [row("x", ["metamodel.field_help"])]);

    const second = renderHook(() => useExtensionCapabilities());
    expect(second.result.current.loaded).toBe(false);
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(second.result.current.has("metamodel.field_help")).toBe(true);
    expect(mockApi.callsOf("get", PATH)).toHaveLength(2);
  });

  it("does not update a hook that unmounted before the response landed", async () => {
    const gate = deferred<StatusRow[]>();
    mockApi.on("get", PATH, () => gate.promise);
    const { useExtensionCapabilities } = await load();

    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result, unmount } = renderHook(() => useExtensionCapabilities());
      unmount();
      await act(async () => {
        gate.resolve([row("x", ["metamodel.field_help"])]);
      });
      // The last rendered value stays as it was; React logged no complaint.
      expect(result.current.loaded).toBe(false);
      expect(warn).not.toHaveBeenCalled();

      // …but the cache was filled, so the next consumer is served from it.
      const next = renderHook(() => useExtensionCapabilities());
      expect(next.result.current.loaded).toBe(true);
      expect(next.result.current.has("metamodel.field_help")).toBe(true);
      expect(mockApi.callsOf("get", PATH)).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
