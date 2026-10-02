/**
 * A scripted stand-in for `@/api/client`.
 *
 * `vi.mock()` factories are hoisted above every import and may not close over
 * test-scope variables, so this module is used in two halves: the factory
 * returns the module shape, and the test configures the singleton in
 * `beforeEach`:
 *
 * ```ts
 * vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
 * import { mockApi } from "@/test/apiMock";
 *
 * beforeEach(() => {
 *   mockApi.reset();
 *   mockApi.on("get", "/users?include_inactive=true", USERS);
 *   mockApi.on("patch", /^\/users\//, (path, body) => ({ ...USERS[0], ...body }));
 * });
 * ```
 *
 * Routes are matched last-registered-first, so a test overrides a default by
 * registering again. A matcher is an exact path, a `"/prefix*"` prefix or a
 * RegExp. An unmatched call rejects with a real `ApiError` (status 404,
 * message `unmocked GET /x`) so a page reaching an endpoint the test did not
 * script fails loudly instead of rendering `undefined`; `mockApi.lenient(value)`
 * opts a test into answering unmatched calls with `value` instead.
 *
 * `ApiError` and `isAbortError` stay the real ones (`vi.importActual`), so the
 * request hooks' abort handling and the pages' `err instanceof ApiError` keep
 * working.
 *
 * A test that calls `vi.resetModules()` (to restart a singleton hook's cache
 * per test) must also import `@/api/client` statically. The mock factory runs
 * once, on the first import of `@/api/client`, and its result survives the
 * reset while this module is re-evaluated by it; without the static import the
 * factory first runs inside a test, after a reset, and captures a fresh
 * `mockApi` that the one the test configured can never reach. Guard with
 * `expect(api).toBe(mockApi.api)`.
 */
import { vi } from "vitest";

export type ApiMethod = "get" | "getRaw" | "post" | "patch" | "put" | "delete" | "upload";
export type RouteMatcher = string | RegExp;
export type RouteReply<T = unknown> = T | ((path: string, body: unknown) => T | Promise<T>);

export interface RecordedCall {
  method: ApiMethod;
  path: string;
  body: unknown;
}

interface Route {
  method: ApiMethod;
  matcher: RouteMatcher;
  reply?: RouteReply;
  fail?: { status: number; detail: unknown; message?: string };
  abort?: boolean;
}

interface ApiErrorLike extends Error {
  status: number;
  detail: unknown;
}

type ApiErrorCtor = new (message: string, status: number, detail: unknown) => ApiErrorLike;

/** The real class once `apiClientModule()` has run; a lookalike before that. */
let ApiErrorClass: ApiErrorCtor = class FallbackApiError extends Error implements ApiErrorLike {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
};

function matches(matcher: RouteMatcher, path: string): boolean {
  if (matcher instanceof RegExp) return matcher.test(path);
  if (matcher.endsWith("*")) return path.startsWith(matcher.slice(0, -1));
  return matcher === path;
}

function abortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

class MockApi {
  private routes: Route[] = [];
  private lenientValue: { enabled: boolean; value: unknown } = { enabled: false, value: undefined };

  /** Every call the component made, in order. */
  calls: RecordedCall[] = [];

  /** Answer `method` requests whose path matches `matcher` with `reply`. */
  on<T>(method: ApiMethod, matcher: RouteMatcher, reply: RouteReply<T>): this {
    this.routes.push({ method, matcher, reply });
    return this;
  }

  /** Reject matching requests with a real `ApiError`. */
  fail(method: ApiMethod, matcher: RouteMatcher, status = 500, detail: unknown = "boom"): this {
    this.routes.push({ method, matcher, fail: { status, detail } });
    return this;
  }

  /** Reject matching requests the way an aborted fetch does. */
  abort(method: ApiMethod, matcher: RouteMatcher): this {
    this.routes.push({ method, matcher, abort: true });
    return this;
  }

  /** Answer every unmatched call with `value` instead of rejecting. */
  lenient(value: unknown = {}): this {
    this.lenientValue = { enabled: true, value };
    return this;
  }

  /** The recorded calls for one method, optionally narrowed by path. */
  callsOf(method: ApiMethod, matcher?: RouteMatcher): RecordedCall[] {
    return this.calls.filter(
      (c) => c.method === method && (matcher === undefined || matches(matcher, c.path)),
    );
  }

  /** Drop every route, every recorded call and the lenient mode. */
  reset(): void {
    this.routes = [];
    this.calls = [];
    this.lenientValue = { enabled: false, value: undefined };
    for (const fn of Object.values(this.api)) fn.mockClear();
    for (const fn of Object.values(this.auth)) fn.mockClear();
  }

  private async dispatch(method: ApiMethod, path: string, body: unknown): Promise<unknown> {
    this.calls.push({ method, path, body });
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const route = this.routes[i];
      if (route.method !== method || !matches(route.matcher, path)) continue;
      if (route.abort) throw abortError();
      if (route.fail) {
        const message = route.fail.message ?? `${method.toUpperCase()} ${path} failed`;
        throw new ApiErrorClass(message, route.fail.status, route.fail.detail);
      }
      return typeof route.reply === "function"
        ? (route.reply as (p: string, b: unknown) => unknown)(path, body)
        : route.reply;
    }
    if (this.lenientValue.enabled) return this.lenientValue.value;
    throw new ApiErrorClass(`unmocked ${method.toUpperCase()} ${path}`, 404, null);
  }

  /** The `api` object a page imports; every member is a `vi.fn` over the route table. */
  api = {
    get: vi.fn((path: string, _opts?: unknown) => this.dispatch("get", path, undefined)),
    getRaw: vi.fn((path: string, _opts?: unknown) => this.dispatch("getRaw", path, undefined)),
    post: vi.fn((path: string, body?: unknown) => this.dispatch("post", path, body)),
    patch: vi.fn((path: string, body?: unknown) => this.dispatch("patch", path, body)),
    put: vi.fn((path: string, body?: unknown) => this.dispatch("put", path, body)),
    delete: vi.fn((path: string, body?: unknown) => this.dispatch("delete", path, body)),
    upload: vi.fn((path: string, body?: unknown) => this.dispatch("upload", path, body)),
  };

  /** The `auth` object; plain `vi.fn`s a test scripts directly. */
  auth = {
    login: vi.fn(),
    register: vi.fn(),
    me: vi.fn(),
    refresh: vi.fn(),
    impersonate: vi.fn(),
    stopImpersonating: vi.fn(),
    logout: vi.fn(),
    ssoConfig: vi.fn(),
    ssoCallback: vi.fn(),
    proxySession: vi.fn(),
    setPassword: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    validateResetToken: vi.fn(),
  };
}

export const mockApi = new MockApi();

/**
 * The module a `vi.mock("@/api/client", …)` factory returns: the real module
 * with `api` and `auth` replaced by the scripted ones.
 */
export async function apiClientModule(): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  ApiErrorClass = actual.ApiError as unknown as ApiErrorCtor;
  return { ...actual, api: mockApi.api, auth: mockApi.auth };
}
