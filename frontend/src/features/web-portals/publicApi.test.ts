import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publicGet, publicPost, type ApiError } from "./publicApi";

// This module deliberately bypasses `@/api/client` (a portal visitor has no
// app session; the httpOnly portal cookie does the work), so the stand-in is
// the global `fetch` itself, answering with real `Response` objects.
const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200, statusText = "") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    return err as ApiError;
  }
  throw new Error("expected the call to reject");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publicGet", () => {
  it("GETs the /api/v1 path with the session cookie and returns the JSON body", async () => {
    const payload = { name: "Acme portal", cards: [{ id: "c1" }] };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));

    const result = await publicGet<typeof payload>("/web-portals/public/acme");

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/web-portals/public/acme", {
      credentials: "same-origin",
    });
  });

  it("merges a caller's init onto the cookie default", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const controller = new AbortController();

    await publicGet("/web-portals/public/acme/cards", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/web-portals/public/acme/cards", {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  });

  it("lets an explicit credentials option in init win over the default", async () => {
    // `{ credentials: "same-origin", ...init }` — the spread comes last.
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await publicGet("/web-portals/public/acme", { credentials: "omit" });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/web-portals/public/acme", {
      credentials: "omit",
    });
  });

  it("throws an Error carrying the status and the JSON detail on a non-2xx reply", async () => {
    // The 401 `portal_locked` is what the SSO gate keys on: the message is the
    // backend's machine-readable detail, the status is kept on the error.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "portal_locked" }, 401, "Unauthorized"),
    );

    const err = await rejection(publicGet("/web-portals/public/acme"));

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("portal_locked");
    expect(err.status).toBe(401);
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    // An edge nginx 502 page is HTML, so `res.json()` rejects.
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      }),
    );

    const err = await rejection(publicGet("/web-portals/public/acme"));

    expect(err.message).toBe("Bad Gateway");
    expect(err.status).toBe(502);
  });

  it("falls back to the status text when the JSON error body has no detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "x" }, 404, "Not Found"));

    const err = await rejection(publicGet("/web-portals/public/missing"));

    expect(err.message).toBe("Not Found");
    expect(err.status).toBe(404);
  });

  it("rejects on a 204 because an empty body is not JSON", async () => {
    // Current behaviour: a 2xx reply is always parsed with `res.json()`, so a
    // body-less 204 rejects with the parser's SyntaxError (no `status` set)
    // rather than resolving to `undefined`. No public route returns 204 today.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const err = await rejection(publicGet("/web-portals/public/acme"));

    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.status).toBeUndefined();
  });

  it("propagates a network failure untouched, without a status", async () => {
    const failure = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(failure);

    const err = await rejection(publicGet("/web-portals/public/acme"));

    expect(err).toBe(failure);
    expect(err.status).toBeUndefined();
  });
});

describe("publicPost", () => {
  it("POSTs a JSON body with the session cookie and returns the JSON reply", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const body = { code: "auth-code", nonce: "n0nce" };

    const result = await publicPost<{ ok: boolean }>("/diagrams/public/d1/sso/exchange", body);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/diagrams/public/d1/sso/exchange", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("throws an Error carrying the status and detail on a non-2xx reply", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "domain_not_allowed" }, 403, "Forbidden"),
    );

    const err = await rejection(publicPost("/diagrams/public/d1/sso/exchange", { code: "c" }));

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("domain_not_allowed");
    expect(err.status).toBe(403);
  });

  it("falls back to the status text when the error body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("gateway timeout", { status: 504, statusText: "Gateway Timeout" }),
    );

    const err = await rejection(publicPost("/diagrams/public/d1/sso/exchange", {}));

    expect(err.message).toBe("Gateway Timeout");
    expect(err.status).toBe(504);
  });

  it("falls back to the status text when the JSON error body has no detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 400, "Bad Request"));

    const err = await rejection(publicPost("/diagrams/public/d1/sso/exchange", {}));

    expect(err.message).toBe("Bad Request");
    expect(err.status).toBe(400);
  });

  it("rejects on a 204 because an empty body is not JSON", async () => {
    // Same current behaviour as publicGet: see the GET case above.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const err = await rejection(publicPost("/diagrams/public/d1/sso/exchange", {}));

    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.status).toBeUndefined();
  });

  it("propagates a network failure untouched", async () => {
    const failure = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(failure);

    const err = await rejection(publicPost("/diagrams/public/d1/sso/exchange", {}));

    expect(err).toBe(failure);
    expect(err.status).toBeUndefined();
  });
});
