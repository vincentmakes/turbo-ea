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

describe("AuthAdmin — what the first pass missed", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  const SSO_MICROSOFT = {
    ...SSO_OFF,
    enabled: true,
    provider: "microsoft",
    client_id: "ms-client",
    client_secret: "ms-secret",
    tenant_id: "contoso",
  };

  const SSO_OIDC = {
    ...SSO_OFF,
    enabled: true,
    provider: "oidc",
    client_id: "oidc-client",
    client_secret: "oidc-secret",
    issuer_url: "https://idp.example.com",
    authorization_endpoint: "https://idp.example.com/auth",
    token_endpoint: "https://idp.example.com/token",
    jwks_uri: "https://idp.example.com/certs",
  };

  it("renders both section headings and their intro copy, with no alert", async () => {
    await renderPage();
    expect(screen.getByText("User Registration")).toBeInTheDocument();
    expect(screen.getByText("Single Sign-On (SSO)")).toBeInTheDocument();
    expect(screen.getByText("Single Sign-On")).toBeInTheDocument();
    expect(
      screen.getByText(/Allow new users to create accounts themselves from the login page/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enable Single Sign-On with an external identity provider/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to the defaults when the settings cannot be loaded", async () => {
    mockApi.fail("get", SSO);
    mockApi.on("patch", SSO, {});
    const user = userEvent.setup();
    render(<AuthAdmin />);

    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${SSO} failed`);
    expect(screen.getByLabelText("Users can self-register")).toBeChecked();

    await user.click(screen.getByLabelText("SSO is disabled"));
    expect(screen.getByRole("combobox")).toHaveTextContent("Microsoft Entra ID (Azure AD)");
    expect(screen.getByLabelText("Tenant ID")).toHaveValue("organizations");
    expect(screen.getByLabelText("Client ID")).toHaveValue("");
    expect(screen.getByLabelText("Client Secret")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", SSO)).toHaveLength(1));
    expect(mockApi.callsOf("patch", SSO)[0].body).toEqual({
      enabled: true,
      provider: "microsoft",
      client_id: "",
      client_secret: "",
      tenant_id: "organizations",
      domain: "",
      issuer_url: "",
      authorization_endpoint: "",
      token_endpoint: "",
      jwks_uri: "",
    });
    expect(await screen.findByText("SSO settings saved")).toBeInTheDocument();
    // The load error is cleared by the save: the redirect hint and the snackbar remain.
    expect(screen.queryByText(`GET ${SSO} failed`)).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("reports a load failure that is not an Error generically", async () => {
    mockApi.on("get", SSO, () => Promise.reject("down"));
    render(<AuthAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("loads a Microsoft tenant, the registration state and only Microsoft's fields", async () => {
    mockApi.on("get", SSO, SSO_MICROSOFT);
    mockApi.on("get", REGISTRATION, { enabled: false });
    mockApi.on("patch", SSO, {});
    const user = await renderPage();

    // SSO chip on, registration chip off.
    expect(screen.getAllByText("Enabled")).toHaveLength(1);
    expect(screen.getAllByText("Disabled")).toHaveLength(1);
    expect(screen.getByLabelText("Registration is managed by SSO")).not.toBeChecked();

    expect(screen.getByRole("combobox", { name: /^Identity Provider/ })).toHaveTextContent(
      "Microsoft Entra ID (Azure AD)",
    );
    expect(
      screen.getByText("Select the SSO identity provider your organization uses."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toHaveAccessibleDescription(
      "From your Azure App Registration > Certificates & secrets",
    );
    const tenant = screen.getByLabelText("Tenant ID");
    expect(tenant).toHaveValue("contoso");
    expect(tenant).toHaveAccessibleDescription(
      'Use "organizations" for multi-tenant (any Azure AD), or a specific tenant ID to restrict access.',
    );
    expect(screen.queryByLabelText("Hosted Domain (optional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Okta Domain")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Issuer URL")).not.toBeInTheDocument();
    expect(screen.queryByText(/In Google Cloud Console/)).not.toBeInTheDocument();
    expect(screen.queryByText(/In Okta Admin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Configure an OpenID Connect application/)).not.toBeInTheDocument();

    const redirect = screen.getByText("Redirect URI").closest("p");
    expect(redirect?.textContent).toBe(
      `Redirect URI: Configure this in your identity provider's application settings: ${window.location.origin}/auth/callback`,
    );

    await user.clear(tenant);
    await user.type(tenant, "fabrikam");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", SSO)).toHaveLength(1));
    expect(mockApi.callsOf("patch", SSO)[0].body).toMatchObject({
      provider: "microsoft",
      client_id: "ms-client",
      client_secret: "ms-secret",
      tenant_id: "fabrikam",
    });
  });

  it("loads a generic OIDC configuration with its manual endpoints", async () => {
    mockApi.on("get", SSO, SSO_OIDC);
    await renderPage();

    const issuer = screen.getByLabelText("Issuer URL");
    expect(issuer).toHaveValue("https://idp.example.com");
    expect(issuer).toHaveAccessibleDescription(
      "The OIDC issuer URL. A .well-known/openid-configuration endpoint must be available at this URL.",
    );
    expect(screen.getByText(/Manual endpoints \(optional\)/)).toBeInTheDocument();
    const auth = screen.getByLabelText("Authorization Endpoint");
    expect(auth).toHaveValue("https://idp.example.com/auth");
    expect(auth).toHaveAccessibleDescription(
      "The URL where users are redirected to authenticate (e.g. /protocol/openid-connect/auth).",
    );
    const token = screen.getByLabelText("Token Endpoint");
    expect(token).toHaveValue("https://idp.example.com/token");
    expect(token).toHaveAccessibleDescription(
      "The URL used to exchange the authorization code for tokens (e.g. /protocol/openid-connect/token).",
    );
    const jwks = screen.getByLabelText("JWKS URI");
    expect(jwks).toHaveValue("https://idp.example.com/certs");
    expect(jwks).toHaveAccessibleDescription(
      "The URL serving the JSON Web Key Set for verifying token signatures (e.g. /protocol/openid-connect/certs).",
    );
    expect(screen.queryByLabelText("Tenant ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Okta Domain")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hosted Domain (optional)")).not.toBeInTheDocument();
    expect(screen.queryByText(/In Google Cloud Console/)).not.toBeInTheDocument();
    expect(screen.queryByText(/In Okta Admin/)).not.toBeInTheDocument();
  });

  it("edits the Google hosted domain", async () => {
    mockApi.on("patch", SSO, {});
    const user = await renderPage();
    await user.click(screen.getByLabelText("SSO is disabled"));
    await pickProvider(user, "Google Workspace");

    const domain = screen.getByLabelText("Hosted Domain (optional)");
    expect(domain).toHaveAccessibleDescription(
      "Restrict sign-in to a specific Google Workspace domain (e.g. yourcompany.com). Leave empty to allow any Google account.",
    );
    expect(screen.queryByLabelText("Okta Domain")).not.toBeInTheDocument();
    await user.type(domain, "acme.com");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(mockApi.callsOf("patch", SSO)).toHaveLength(1));
    expect(mockApi.callsOf("patch", SSO)[0].body).toMatchObject({
      provider: "google",
      domain: "acme.com",
    });
  });

  it("edits the Okta domain", async () => {
    mockApi.on("get", SSO, SSO_OKTA);
    mockApi.on("patch", SSO, {});
    const user = await renderPage();

    const domain = screen.getByLabelText("Okta Domain");
    expect(domain).toHaveAccessibleDescription(
      "Your Okta organization domain (e.g. dev-12345.okta.com).",
    );
    expect(screen.queryByLabelText("Hosted Domain (optional)")).not.toBeInTheDocument();
    expect(screen.queryByText(/In Google Cloud Console/)).not.toBeInTheDocument();
    await user.clear(domain);
    await user.type(domain, "acme.okta.com");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(mockApi.callsOf("patch", SSO)).toHaveLength(1));
    expect(mockApi.callsOf("patch", SSO)[0].body).toMatchObject({
      provider: "okta",
      domain: "acme.okta.com",
    });
  });

  it("locks the registration switch while saving and confirms the enable", async () => {
    mockApi.on("get", REGISTRATION, { enabled: false });
    const gate = deferred<unknown>();
    mockApi.on("patch", REGISTRATION, () => gate.promise);
    const user = await renderPage();

    const toggle = screen.getByLabelText("Only admins can create users");
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    await waitFor(() => expect(mockApi.callsOf("patch", REGISTRATION)).toHaveLength(1));
    expect(screen.getByLabelText("Only admins can create users")).toBeDisabled();

    gate.resolve({});
    expect(await screen.findByText("Self-registration enabled")).toBeInTheDocument();
    expect(mockApi.callsOf("patch", REGISTRATION)[0].body).toEqual({ enabled: true });
    expect(screen.getByLabelText("Users can self-register")).toBeChecked();
    expect(screen.getByLabelText("Users can self-register")).toBeEnabled();
  });

  it("clears a registration error on the next successful save", async () => {
    mockApi.fail("patch", REGISTRATION);
    const user = await renderPage();

    await user.click(screen.getByLabelText("Users can self-register"));
    expect(await screen.findByText(`PATCH ${REGISTRATION} failed`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Users can self-register")).toBeEnabled());

    mockApi.on("patch", REGISTRATION, {});
    await user.click(screen.getByLabelText("Users can self-register"));
    expect(await screen.findByText("Self-registration disabled")).toBeInTheDocument();
    expect(screen.queryByText(`PATCH ${REGISTRATION} failed`)).not.toBeInTheDocument();
    // Only the snackbar is left.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("lets the user dismiss an error", async () => {
    mockApi.fail("patch", REGISTRATION);
    const user = await renderPage();

    await user.click(screen.getByLabelText("Users can self-register"));
    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("reports a registration failure that is not an Error generically", async () => {
    mockApi.on("patch", REGISTRATION, () => Promise.reject("nope"));
    const user = await renderPage();

    await user.click(screen.getByLabelText("Users can self-register"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("shows a loading label on the SSO save button while saving", async () => {
    const gate = deferred<unknown>();
    mockApi.on("patch", SSO, () => gate.promise);
    const user = await renderPage();

    // The name carries the icon's ligature text ("save") ahead of the label.
    const save = screen.getByRole("button", { name: /Save$/ });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByRole("button", { name: /Loading\.\.\.$/ })).toBeDisabled();

    gate.resolve({});
    expect(await screen.findByText("SSO settings saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save$/ })).toBeEnabled();
  });

  it("reports an SSO save failure that is not an Error generically", async () => {
    mockApi.on("patch", SSO, () => Promise.reject("nope"));
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("closes the confirmation snackbar on Escape", async () => {
    mockApi.on("patch", SSO, {});
    const user = await renderPage();

    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(await screen.findByText("SSO settings saved")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
