import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError, setToken, clearToken, auth } from "./client";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  });
}

function emptyResponse(status = 204) {
  return Promise.resolve({
    ok: true,
    status,
    statusText: "No Content",
    json: () => Promise.resolve(undefined),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

describe("setToken / clearToken", () => {
  it("stores token in sessionStorage", () => {
    setToken("my-jwt");
    expect(sessionStorage.getItem("token")).toBe("my-jwt");
  });

  it("removes token from sessionStorage", () => {
    setToken("my-jwt");
    clearToken();
    expect(sessionStorage.getItem("token")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// JWT injection
// ---------------------------------------------------------------------------

describe("Authorization header", () => {
  it("includes Bearer token when set", async () => {
    setToken("test-token");
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));

    await api.get("/test");

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer test-token");
  });

  it("omits Authorization when no token", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true }));

    await api.get("/test");

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// api.get
// ---------------------------------------------------------------------------

describe("api.get", () => {
  it("calls GET with correct URL", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ items: [] }));

    const result = await api.get("/cards");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/cards",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result).toEqual({ items: [] });
  });

  it("sets Content-Type to application/json", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));

    await api.get("/test");

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Content-Type"]).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// api.post / api.patch / api.put / api.delete
// ---------------------------------------------------------------------------

describe("api.post", () => {
  it("sends JSON body with POST method", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: "1" }, 201));

    await api.post("/cards", { name: "Test" });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ name: "Test" });
  });
});

describe("api.patch", () => {
  it("sends PATCH method", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: "1" }));

    await api.patch("/cards/1", { name: "Updated" });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("PATCH");
  });
});

describe("api.put", () => {
  it("sends PUT method", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ id: "1" }));

    await api.put("/cards/1", { data: "xml" });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("PUT");
  });
});

describe("api.delete", () => {
  it("sends DELETE method", async () => {
    mockFetch.mockReturnValueOnce(emptyResponse());

    await api.delete("/cards/1");

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// 204 empty responses
// ---------------------------------------------------------------------------

describe("204 handling", () => {
  it("returns undefined for 204 No Content", async () => {
    mockFetch.mockReturnValueOnce(emptyResponse());

    const result = await api.delete("/cards/1");

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("throws ApiError with status and detail for error responses", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ detail: "Not found" }, 404)
    );

    try {
      await api.get("/missing");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(404);
      expect(err.detail).toBe("Not found");
      expect(err.message).toBe("Not found");
    }
  });

  it("formats 422 validation errors as semicolon-separated messages", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse(
        {
          detail: [
            { msg: "Field required", loc: ["body", "name"] },
            { msg: "Invalid email", loc: ["body", "email"] },
          ],
        },
        422
      )
    );

    await expect(api.post("/auth/register", {})).rejects.toThrow(
      "Field required; Invalid email"
    );
  });

  it("handles object detail with message field", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse(
        { detail: { message: "Custom error", key: "app_to_itc" } },
        409
      )
    );

    await expect(api.delete("/relation-types/x")).rejects.toThrow("Custom error");
  });

  it("falls back to statusText when response is not JSON", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("not json")),
      })
    );

    await expect(api.get("/fail")).rejects.toThrow("Internal Server Error");
  });
});

// ---------------------------------------------------------------------------
// auth helpers
// ---------------------------------------------------------------------------

describe("auth helpers", () => {
  it("auth.login calls POST /auth/login", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ access_token: "jwt-123" })
    );

    const result = await auth.login("user@test.com", "pass");

    expect(result.access_token).toBe("jwt-123");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/auth/login");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      email: "user@test.com",
      password: "pass",
    });
  });

  it("auth.register calls POST /auth/register", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ access_token: "jwt-456" })
    );

    const result = await auth.register("u@t.com", "User", "pass");

    expect(result.access_token).toBe("jwt-456");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.email).toBe("u@t.com");
    expect(body.display_name).toBe("User");
  });

  it("auth.me calls GET /auth/me", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ id: "1", email: "a@b.com", role: "admin" })
    );

    const user = await auth.me();

    expect(user.email).toBe("a@b.com");
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/auth/me");
  });
});
