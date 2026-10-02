import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";

import ResetPasswordPage from "./ResetPasswordPage";

const t = (key: string, opts?: Record<string, unknown>) => String(i18n.t(`auth:${key}`, opts as never));

const TOKEN = "tok-abc123";
const EMAIL = "ada@example.com";
const STRONG = "correct-horse-battery";

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage(query = `?token=${TOKEN}`) {
  return renderWithProviders(<ResetPasswordPage />, {
    route: `/auth/reset-password${query}`,
    routes: [
      { path: "/auth/reset-password" },
      { path: "/", element: <div>login page</div> },
    ],
    user: null,
  });
}

/** Fill both password boxes and submit the form. */
async function submit(
  user: ReturnType<typeof renderPage>["user"],
  password: string,
  confirm = password,
) {
  await user.type(screen.getByLabelText(new RegExp(`^${t("resetPassword.newPassword")}`)), password);
  await user.type(screen.getByLabelText(new RegExp(`^${t("resetPassword.confirmPassword")}`)), confirm);
  await user.click(screen.getByRole("button", { name: t("resetPassword.button") }));
}

beforeEach(() => {
  mockApi.reset();
  mockApi.auth.validateResetToken.mockResolvedValue({ email: EMAIL });
  mockApi.auth.resetPassword.mockResolvedValue({ ok: true });
});

describe("ResetPasswordPage — token validation on mount", () => {
  it("shows a spinner until the token has been validated", async () => {
    const pending = deferred<{ email: string }>();
    mockApi.auth.validateResetToken.mockReturnValue(pending.promise);
    renderPage();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(mockApi.auth.validateResetToken).toHaveBeenCalledWith(TOKEN);

    pending.resolve({ email: EMAIL });
    expect(await screen.findByText(t("resetPassword.title"))).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders the form addressed to the token's email once validated", async () => {
    renderPage();
    expect(await screen.findByText(t("resetPassword.welcomeUser", { email: EMAIL }))).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(`^${t("resetPassword.newPassword")}`))).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(new RegExp(`^${t("resetPassword.confirmPassword")}`))).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: t("resetPassword.button") })).toBeEnabled();
  });

  it("treats a missing token as an invalid link without asking the server", async () => {
    renderPage("");
    expect(await screen.findByText(t("resetPassword.invalidLink.title"))).toBeInTheDocument();
    expect(screen.getByText(t("resetPassword.invalidLink.description"))).toBeInTheDocument();
    expect(mockApi.auth.validateResetToken).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(new RegExp(`^${t("resetPassword.newPassword")}`))).not.toBeInTheDocument();
  });

  it("shows the invalid-link state when the server rejects the token", async () => {
    mockApi.auth.validateResetToken.mockRejectedValue(new Error("expired"));
    renderPage("?token=stale");
    expect(await screen.findByText(t("resetPassword.invalidLink.title"))).toBeInTheDocument();
    expect(mockApi.auth.validateResetToken).toHaveBeenCalledWith("stale");
  });

  it("links an invalid page back to the login page", async () => {
    const { user } = renderPage("");
    await user.click(await screen.findByRole("button", { name: t("resetPassword.goToLogin") }));
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });
});

describe("ResetPasswordPage — client-side validation", () => {
  it("rejects a password shorter than ten characters before calling the server", async () => {
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, "short1");

    expect(await screen.findByRole("alert")).toHaveTextContent(t("resetPassword.minLength"));
    expect(mockApi.auth.resetPassword).not.toHaveBeenCalled();
  });

  it("rejects a confirmation that does not match", async () => {
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, STRONG, `${STRONG}-typo`);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("resetPassword.passwordMismatch"));
    expect(mockApi.auth.resetPassword).not.toHaveBeenCalled();
  });

  it("checks length before the match, so a short mismatched pair reports the length", async () => {
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, "short1", "short2");

    expect(await screen.findByRole("alert")).toHaveTextContent(t("resetPassword.minLength"));
  });
});

describe("ResetPasswordPage — submitting", () => {
  it("resets the password with the token and shows the success state", async () => {
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, STRONG);

    expect(await screen.findByText(t("resetPassword.successTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("resetPassword.successDescription"))).toBeInTheDocument();
    expect(mockApi.auth.resetPassword).toHaveBeenCalledTimes(1);
    expect(mockApi.auth.resetPassword).toHaveBeenCalledWith(TOKEN, STRONG);
    // The form is gone; only the way to the login page remains.
    expect(screen.queryByLabelText(new RegExp(`^${t("resetPassword.newPassword")}`))).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("resetPassword.goToLogin") }));
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("disables the button and relabels it while the request is in flight", async () => {
    const pending = deferred<unknown>();
    mockApi.auth.resetPassword.mockReturnValue(pending.promise);
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, STRONG);

    const busy = await screen.findByRole("button", { name: t("resetPassword.submitting") });
    expect(busy).toBeDisabled();

    pending.resolve({ ok: true });
    expect(await screen.findByText(t("resetPassword.successTitle"))).toBeInTheDocument();
  });

  it("shows the server's message when the reset fails and keeps the form", async () => {
    mockApi.auth.resetPassword.mockRejectedValue(new Error("Token already used"));
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, STRONG);

    expect(await screen.findByRole("alert")).toHaveTextContent("Token already used");
    expect(screen.getByRole("button", { name: t("resetPassword.button") })).toBeEnabled();
    expect(screen.queryByText(t("resetPassword.successTitle"))).not.toBeInTheDocument();
  });

  it("falls back to the generic message when the failure is not an Error", async () => {
    mockApi.auth.resetPassword.mockRejectedValue("nope");
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, STRONG);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("resetPassword.failedToReset"));
  });

  it("clears a previous validation error when a later submit succeeds", async () => {
    const { user } = renderPage();
    await screen.findByText(t("resetPassword.title"));

    await submit(user, "short1");
    expect(await screen.findByRole("alert")).toHaveTextContent(t("resetPassword.minLength"));

    const pw = screen.getByLabelText(new RegExp(`^${t("resetPassword.newPassword")}`));
    const confirm = screen.getByLabelText(new RegExp(`^${t("resetPassword.confirmPassword")}`));
    await user.clear(pw);
    await user.clear(confirm);
    await user.type(pw, STRONG);
    await user.type(confirm, STRONG);
    await user.click(screen.getByRole("button", { name: t("resetPassword.button") }));

    await waitFor(() => expect(screen.queryByText(t("resetPassword.minLength"))).not.toBeInTheDocument());
    expect(await screen.findByText(t("resetPassword.successTitle"))).toBeInTheDocument();
  });
});
