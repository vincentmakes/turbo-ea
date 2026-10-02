import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { api, ApiError, isAbortError } from "@/api/client";

import { mockApi } from "./apiMock";

describe("mockApi", () => {
  beforeEach(() => mockApi.reset());

  it("matches an exact path, a prefix and a RegExp", async () => {
    mockApi.on("get", "/users", ["exact"]);
    mockApi.on("get", "/cards*", ["prefix"]);
    mockApi.on("get", /^\/risks\/[^/]+$/, ["regex"]);

    expect(await api.get("/users")).toEqual(["exact"]);
    expect(await api.get("/cards?type=Application")).toEqual(["prefix"]);
    expect(await api.get("/risks/r1")).toEqual(["regex"]);
  });

  it("lets a later registration override an earlier one", async () => {
    mockApi.on("get", "/users", "first");
    mockApi.on("get", "/users", "second");
    expect(await api.get("/users")).toBe("second");
  });

  it("hands a reply function the path and the body", async () => {
    mockApi.on("post", "/cards", (path, body) => ({ path, echoed: body }));
    expect(await api.post("/cards", { name: "A" })).toEqual({ path: "/cards", echoed: { name: "A" } });
  });

  it("rejects an unmocked call with a real 404 ApiError", async () => {
    const err = await api.get("/nowhere").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("unmocked GET /nowhere");
  });

  it("answers unmocked calls with the lenient value when asked", async () => {
    mockApi.lenient({ items: [] });
    expect(await api.get("/anything")).toEqual({ items: [] });
  });

  it("fails a route with the status and detail given", async () => {
    mockApi.fail("patch", "/users/u1", 409, { code: "conflict" });
    const err = await api.patch("/users/u1", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).detail).toEqual({ code: "conflict" });
  });

  it("aborts a route the way an aborted fetch does", async () => {
    mockApi.abort("get", "/slow");
    const err = await api.get("/slow").catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
  });

  it("records every call and narrows them by method and path", async () => {
    mockApi.lenient(null);
    await api.get("/a");
    await api.post("/b", { x: 1 });
    await api.delete("/c");
    expect(mockApi.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["get /a", "post /b", "delete /c"]);
    expect(mockApi.callsOf("post")).toEqual([{ method: "post", path: "/b", body: { x: 1 } }]);
    expect(mockApi.callsOf("get", /^\/a/)).toHaveLength(1);
    expect(mockApi.callsOf("get", "/zzz")).toHaveLength(0);
  });

  it("reset drops routes, calls and the lenient mode", async () => {
    mockApi.on("get", "/users", 1).lenient(2);
    await api.get("/users");
    mockApi.reset();
    expect(mockApi.calls).toEqual([]);
    await expect(api.get("/users")).rejects.toBeInstanceOf(ApiError);
    expect(vi.mocked(api.get).mock.calls).toHaveLength(1);
  });

  it("keeps the api members as mocks a test can spy on", () => {
    expect(vi.isMockFunction(api.get)).toBe(true);
    expect(vi.isMockFunction(api.upload)).toBe(true);
    expect(vi.isMockFunction(mockApi.auth.login)).toBe(true);
  });
});
