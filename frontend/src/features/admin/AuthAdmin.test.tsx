/**
 * Authentication settings: the self-registration toggle and the SSO form with
 * its per-provider fields, loaded from and saved to the settings endpoints
 * through the shared api kit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import AuthAdmin from "./AuthAdmin";

const SSO = "/settings/sso";
const REGISTRATION = "/settings/registration";

const SSO_OFF = {
  enabled: false,
  provider: "",
  client_id: "",
  client_secret: "",
  tenant_id: "organizations",
  domain: "",
  issuer_url: "",
  authorization_endpoint: "",
  token_endpoint: "",
  jwks_uri: "",
};

const SSO_OKTA = {
  ...SSO_OFF,
  enabled: true,
  provider: "okta",
  client_id: "okta-client",
  client_secret: "okta-secret",
  domain: "dev-12345.okta.com",
};

async function renderPage(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<AuthAdmin />);
  await screen.findByText("Self-Registration");
  return user;
}

async function pickProvider(user: UserEvent, option: string) {
  await user.click(screen.getByRole("combobox"));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", SSO, SSO_OFF);
  mockApi.on("get", REGISTRATION, { enabled: true });
});

describe("AuthAdmin loading", () => {
  it("shows a spinner, then both sections with their state chips", async () => {
    render(<AuthAdmin />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await screen.findByText("Self-Registration");
    expect(screen.getByLabelText("Users can self-register")).toBeChecked();
    expect(screen.getByLabelText("SSO is disabled")).not.toBeChecked();
    expect(screen.getAllByText("Enabled")).toHaveLength(1);
    expect(screen.getAllByText("Disabled")).toHaveLength(1);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("reports a failed load", async () => {
    mockApi.fail("get", REGISTRATION);
    render(<AuthAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${REGISTRATION} failed`);
  });

  it("renders a stored provider's own fields with their values", async () => {
    mockApi.on("get", SSO, SSO_OKTA);
    await renderPage();

    expect(screen.getByLabelText("SSO is enabled")).toBeChecked();
    expect(screen.getByLabelText("Client ID")).toHaveValue("okta-client");
    expect(screen.getByLabelText("Client Secret")).toHaveValue("okta-secret");
    expect(screen.getByLabelText("Okta Domain")).toHaveValue("dev-12345.okta.com");
    expect(screen.queryByLabelText("Tenant ID")).not.toBeInTheDocument();
    // Registration is handed to the IdP while SSO is on.
    const registration = screen.getByLabelText("Registration is managed by SSO");
    expect(registration).toBeDisabled();
  });
});

describe("AuthAdmin registration", () => {
  it("saves the toggle, relabels the switch and confirms in a snackbar", async () => {
    mockApi.on("patch", REGISTRATION, {});
    const user = await renderPage();

    await user.click(screen.getByLabelText("Users can self-register"));

    await waitFor(() => expect(mockApi.callsOf("patch", REGISTRATION)).toHaveLength(1));
    expect(mockApi.callsOf("patch", REGISTRATION)[0].body).toEqual({ enabled: false });
    expect(await screen.findByText("Self-registration disabled")).toBeInTheDocument();
    expect(screen.getByLabelText("Only admins can create users")).not.toBeChecked();
    expect(screen.getAllByText("Disabled")).toHaveLength(2);
  });

  it("keeps the old value and shows the error when the save fails", async () => {
    mockApi.fail("patch", REGISTRATION);
    const user = await renderPage();

    await user.click(screen.getByLabelText("Users can self-register"));

    expect(await screen.findByRole("alert")).toHaveTextContent(`PATCH ${REGISTRATION} failed`);
    expect(screen.getByLabelText("Users can self-register")).toBeChecked();
  });
});

describe("AuthAdmin SSO", () => {
  it("reveals the provider form when enabled and swaps the provider-specific fields", async () => {
    const user = await renderPage();

    await user.click(screen.getByLabelText("SSO is disabled"));
    expect(screen.getByLabelText("SSO is enabled")).toBeChecked();
    expect(screen.getByLabelText("Registration is managed by SSO")).toBeDisabled();

    // Microsoft is the default provider.
    expect(screen.getByLabelText("Tenant ID")).toHaveValue("organizations");
    expect(screen.getByText("From your Azure App Registration")).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/auth/callback`)).toBeInTheDocument();

    await pickProvider(user, "Google Workspace");
    expect(screen.getByLabelText("Hosted Domain (optional)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tenant ID")).not.toBeInTheDocument();
    expect(screen.getByText(/In Google Cloud Console, create an OAuth 2.0 Client ID/)).toBeInTheDocument();

    await pickProvider(user, "Okta");
    expect(screen.getByLabelText("Okta Domain")).toBeInTheDocument();
    expect(screen.getByText(/In Okta Admin, create a Web Application integration/)).toBeInTheDocument();

    await pickProvider(user, "Generic OIDC");
    expect(screen.getByLabelText("Issuer URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Authorization Endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Token Endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("JWKS URI")).toBeInTheDocument();
    expect(screen.getByText(/Configure an OpenID Connect application/)).toBeInTheDocument();
  });

  it("saves every SSO field and confirms in a snackbar", async () => {
    mockApi.on("patch", SSO, {});
    const user = await renderPage();

    await user.click(screen.getByLabelText("SSO is disabled"));
    await pickProvider(user, "Generic OIDC");
    await user.type(screen.getByLabelText("Client ID"), "cid");
    await user.type(screen.getByLabelText("Client Secret"), "shh");
    await user.type(screen.getByLabelText("Issuer URL"), "https://idp.example.com");
    await user.type(screen.getByLabelText("Authorization Endpoint"), "https://idp.example.com/auth");
    await user.type(screen.getByLabelText("Token Endpoint"), "https://idp.example.com/token");
    await user.type(screen.getByLabelText("JWKS URI"), "https://idp.example.com/certs");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(mockApi.callsOf("patch", SSO)).toHaveLength(1));
    expect(mockApi.callsOf("patch", SSO)[0].body).toEqual({
      enabled: true,
      provider: "oidc",
      client_id: "cid",
      client_secret: "shh",
      tenant_id: "organizations",
      domain: "",
      issuer_url: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/auth",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/certs",
    });
    expect(await screen.findByText("SSO settings saved")).toBeInTheDocument();
  });

  it("reports a failed save", async () => {
    mockApi.fail("patch", SSO);
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(`PATCH ${SSO} failed`);
    expect(screen.queryByText("SSO settings saved")).not.toBeInTheDocument();
  });
});
