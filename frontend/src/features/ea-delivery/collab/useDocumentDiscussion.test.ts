import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { api } from "@/api/client";
import type { DocumentDiscussion, DocumentOwner, DocumentThread } from "@/types";
import { useDocumentDiscussion } from "./useDocumentDiscussion";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  isAbortError: (err: unknown) => err instanceof DOMException && err.name === "AbortError",
}));

const OWNER: DocumentOwner = { kind: "adr", id: "1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02" };

describe("useDocumentDiscussion", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("has no threads and asks for nothing without a document", () => {
    const { result } = renderHook(() => useDocumentDiscussion(null, { scope: "document" }));
    expect(result.current.threads).toEqual([]);
    expect(result.current.discussion).toBeUndefined();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("has no threads while the discussion is still loading", async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDocumentDiscussion(OWNER, { scope: "document" }));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(vi.mocked(api.get).mock.calls[0][0]).toBe(`/adr/${OWNER.id}/comments`);
    expect(result.current.discussion).toBeUndefined();
    expect(result.current.threads).toEqual([]);
  });

  it("returns the threads of the loaded discussion", async () => {
    const thread = { id: "t1" } as unknown as DocumentThread;
    const payload: DocumentDiscussion = {
      can: { comment: true, moderate: false },
      open_count: 1,
      threads: [thread],
    };
    vi.mocked(api.get).mockResolvedValue(payload);
    const { result } = renderHook(() => useDocumentDiscussion(OWNER, { scope: "document" }));
    await waitFor(() => expect(result.current.discussion).toBe(payload));
    expect(result.current.threads).toEqual([thread]);
  });
});
