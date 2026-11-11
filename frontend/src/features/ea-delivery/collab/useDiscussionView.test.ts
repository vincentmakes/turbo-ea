import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import type { DocumentOwner } from "@/types";
import { mockApi } from "@/test/apiMock";
import { useDiscussionView } from "./useDiscussionView";

const EMPTY = { can: { comment: true, moderate: false }, open_count: 0, threads: [] };

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", /^\/adr\/\w+\/comments/, () => ({ ...EMPTY }));
});

type Args = { owner: DocumentOwner | null; focusThreadId?: string | null; refreshKey?: string };

describe("useDiscussionView", () => {
  it("reads this revision's discussion, then every revision's on request", async () => {
    const { result } = renderHook(() => useDiscussionView({ kind: "adr", id: "a1" }, {}));
    expect(result.current.scope).toBe("document");
    await waitFor(() => expect(result.current.discussion.discussion).toBeDefined());
    act(() => result.current.setScope("chain"));
    await waitFor(() => expect(mockApi.callsOf("get", "/adr/a1/comments?scope=chain")).toHaveLength(1));
    expect(result.current.scope).toBe("chain");
  });

  it("reads nothing for a document not saved yet", async () => {
    const { result } = renderHook(() => useDiscussionView(null, {}));
    await act(async () => {});
    expect(result.current.discussion.discussion).toBeUndefined();
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("keeps the filter for the document, and empties it for another document or another notification's thread", () => {
    const { result, rerender } = renderHook((args: Args) => useDiscussionView(args.owner, args), {
      initialProps: { owner: { kind: "adr", id: "a1" } } as Args,
    });
    act(() => result.current.setFilter(["context"]));
    expect(result.current.filter).toEqual(["context"]);
    rerender({ owner: { kind: "adr", id: "a1" }, refreshKey: "v2" });
    expect(result.current.filter).toEqual(["context"]);
    rerender({ owner: { kind: "adr", id: "a1" }, refreshKey: "v2", focusThreadId: "t7" });
    expect(result.current.filter).toEqual([]);
    act(() => result.current.setFilter(["decision"]));
    rerender({ owner: { kind: "adr", id: "b2" }, refreshKey: "v2", focusThreadId: "t7" });
    expect(result.current.filter).toEqual([]);
    act(() => result.current.setFilter(["decision"]));
    rerender({ owner: { kind: "soaw", id: "b2" }, refreshKey: "v2", focusThreadId: "t7" });
    expect(result.current.filter).toEqual([]);
  });

  it("keeps the resolved threads unfolded for the document, and folds them for another one", () => {
    const { result, rerender } = renderHook((args: Args) => useDiscussionView(args.owner, args), {
      initialProps: { owner: { kind: "adr", id: "a1" } } as Args,
    });
    expect(result.current.showResolved).toBe(false);
    act(() => result.current.setShowResolved(true));
    rerender({ owner: { kind: "adr", id: "a1" }, refreshKey: "v2" });
    expect(result.current.showResolved).toBe(true);
    rerender({ owner: { kind: "adr", id: "b2" }, refreshKey: "v2" });
    expect(result.current.showResolved).toBe(false);
    act(() => result.current.setShowResolved(true));
    rerender({ owner: { kind: "adr", id: "b2" }, refreshKey: "v2", focusThreadId: "t7" });
    expect(result.current.showResolved).toBe(false);
  });

  it("numbers each request for the composer anew, the same section twice included, and clears it", () => {
    const { result } = renderHook(() => useDiscussionView({ kind: "adr", id: "a1" }, {}));
    expect(result.current.composeSection).toBeNull();
    act(() => result.current.requestComposeSection("context"));
    expect(result.current.composeSection).toEqual({ section: "context", request: 1 });
    act(() => result.current.requestComposeSection("context"));
    expect(result.current.composeSection).toEqual({ section: "context", request: 2 });
    const clear = result.current.clearComposeSection;
    act(() => clear());
    expect(result.current.composeSection).toBeNull();
    // The same function on every render (the composer calls it from an effect).
    expect(result.current.clearComposeSection).toBe(clear);
    act(() => result.current.requestComposeSection("decision"));
    expect(result.current.composeSection).toEqual({ section: "decision", request: 3 });
  });

  it("drops a pending request for the composer with the document, and keeps numbering after it", () => {
    const { result, rerender } = renderHook((args: Args) => useDiscussionView(args.owner, args), {
      initialProps: { owner: { kind: "adr", id: "a1" } } as Args,
    });
    act(() => result.current.requestComposeSection("context"));
    rerender({ owner: { kind: "adr", id: "a1" }, refreshKey: "v2" });
    expect(result.current.composeSection).toEqual({ section: "context", request: 1 });
    rerender({ owner: { kind: "adr", id: "b2" }, refreshKey: "v2" });
    expect(result.current.composeSection).toBeNull();
    act(() => result.current.requestComposeSection("context"));
    expect(result.current.composeSection).toEqual({ section: "context", request: 2 });
    rerender({ owner: { kind: "adr", id: "b2" }, refreshKey: "v2", focusThreadId: "t7" });
    expect(result.current.composeSection).toBeNull();
  });
});
