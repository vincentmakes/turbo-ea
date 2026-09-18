import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  encodeState,
  parsePublicSsoMessage,
  parseState,
  PUBLIC_SSO_MESSAGE_TYPE,
  type PublicResourceState,
} from "./publicSso";

const SSO = {
  provider: "microsoft",
  provider_name: "Microsoft",
  client_id: "client-1",
  authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  scopes: "openid email profile",
};

const STATE: PublicResourceState = { t: "diagram", slug: "abc", nonce: "n1" };

describe("buildAuthorizeUrl", () => {
  it("targets the shared login callback and encodes the state", () => {
    const url = new URL(buildAuthorizeUrl(SSO, STATE)!);
    expect(url.origin + url.pathname).toBe(SSO.authorization_endpoint);
    expect(url.searchParams.get("redirect_uri")).toBe(`${window.location.origin}/auth/callback`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(parseState(url.searchParams.get("state"))).toEqual(STATE);
  });

  it("adds prompt=none only for a silent attempt", () => {
    const loud = new URL(buildAuthorizeUrl(SSO, STATE)!);
    expect(loud.searchParams.has("prompt")).toBe(false);
    const silent = new URL(buildAuthorizeUrl(SSO, { ...STATE, silent: true })!);
    expect(silent.searchParams.get("prompt")).toBe("none");
  });

  it("lets provider extra params win over the defaults", () => {
    const url = new URL(
      buildAuthorizeUrl({ ...SSO, extra_auth_params: { hd: "corp.com", scope: "openid" } }, STATE)!,
    );
    expect(url.searchParams.get("hd")).toBe("corp.com");
    expect(url.searchParams.get("scope")).toBe("openid");
  });

  it("is null when the gate config is incomplete", () => {
    expect(buildAuthorizeUrl({ ...SSO, client_id: "" }, STATE)).toBeNull();
    expect(buildAuthorizeUrl({ ...SSO, authorization_endpoint: undefined }, STATE)).toBeNull();
  });
});

describe("parseState", () => {
  it("round-trips a public-resource state, popup flag included", () => {
    const s: PublicResourceState = { ...STATE, popup: true };
    expect(parseState(encodeState(s))).toEqual(s);
  });

  it("is null for a normal login state or garbage", () => {
    expect(parseState("opaque-csrf-token")).toBeNull();
    expect(parseState(btoa(JSON.stringify({ t: "other", slug: "x", nonce: "n" })))).toBeNull();
    expect(parseState(btoa(JSON.stringify({ t: "diagram", slug: "x" })))).toBeNull();
    expect(parseState(null)).toBeNull();
  });
});

describe("parsePublicSsoMessage", () => {
  const ok = { type: PUBLIC_SSO_MESSAGE_TYPE, t: "diagram", slug: "abc", nonce: "n1", code: "c" };

  it("accepts a well-formed relay and normalises the optional fields", () => {
    expect(parsePublicSsoMessage(ok)).toEqual({ ...ok, error: null });
    expect(parsePublicSsoMessage({ ...ok, code: undefined, error: "access_denied" })).toEqual({
      ...ok,
      code: null,
      error: "access_denied",
    });
  });

  it("rejects anything else on the message bus", () => {
    expect(parsePublicSsoMessage(null)).toBeNull();
    expect(parsePublicSsoMessage("string")).toBeNull();
    expect(parsePublicSsoMessage({ ...ok, type: "something-else" })).toBeNull();
    expect(parsePublicSsoMessage({ ...ok, t: "user" })).toBeNull();
    expect(parsePublicSsoMessage({ ...ok, nonce: 42 })).toBeNull();
  });
});
