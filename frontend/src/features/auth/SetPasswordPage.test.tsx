/**
 * SetPasswordPage — an invited user sets their first password.
 *
 * Pins the token round-trip (`/auth/validate-setup-token`), the invalid-link
 * screen, the two client-side checks (length, match), the hand-off to
 * `onSetPassword` and the landing on `/` afterwards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import SetPasswordPage from "./SetPasswordPage";

const TOKEN = "tok/abc+123";
const VALIDATE = `/auth/validate-setup-token?token=${encodeURIComponent(TOKEN)}`;

function renderPage(
  query = `?token=${encodeURIComponent(TOKEN)}`,
  onSetPassword = vi.fn(async (_t: string, _p: string) => {}),
) {
  const utils = renderWithProviders(<SetPasswordPage onSetPassword={onSetPassword} />, {
    route: `/auth/set-password${query}`,
    routes: [{ path: "/auth/set-password" }, { path: "/", element: <div>home page</div> }],
    user: null,
  });
  return { ...utils, onSetPassword };
}

async function fill(user: ReturnType<typeof renderPage>["user"], password: string, confirm = password) {
  await user.type(await screen.findByLabelText(/^New Password/), password);
  await user.type(screen.getByLabelText(/^Confirm Password/), confirm);
  await user.click(screen.getByRole("button", { name: "Set Password & Sign In" }));
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", VALIDATE, { email: "ada@example.com", display_name: "Ada" });
});

describe("SetPasswordPage — token validation", () => {
  it("shows a spinner while the token is checked, then greets the invitee by name", async () => {
    renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("Set Your Password")).toBeInTheDocument();
    expect(screen.getByText("Welcome, Ada! Set a password for ada@example.com.")).toBeInTheDocument();
    expect(mockApi.callsOf("get")).toEqual([{ method: "get", path: VALIDATE, body: undefined }]);
  });

  it("greets by email alone when the invite carries no display name", async () => {
    mockApi.on("get", VALIDATE, { email: "ada@example.com", display_name: "" });
    renderPage();
    expect(await screen.findByText("Welcome! Set a password for ada@example.com.")).toBeInTheDocument();
  });

  it("shows the invalid-link screen without calling the API when the URL has no token", async () => {
    const { user } = renderPage("");
    expect(await screen.findByText("Invalid Setup Link")).toBeInTheDocument();
    expect(mockApi.calls).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Go to Login" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("shows the invalid-link screen when the server rejects the token", async () => {
    mockApi.fail("get", VALIDATE, 400, "invalid token");
    renderPage();
    expect(await screen.findByText("Invalid Setup Link")).toBeInTheDocument();
    expect(
      screen.getByText("This password setup link is invalid or has already been used."),
    ).toBeInTheDocument();
  });
});

describe("SetPasswordPage — submitting", () => {
  it("rejects a password shorter than six characters", async () => {
    const { user, onSetPassword } = renderPage();
    await fill(user, "abc");
    expect(await screen.findByRole("alert")).toHaveTextContent("Password must be at least 6 characters.");
    expect(onSetPassword).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    const { user, onSetPassword } = renderPage();
    await fill(user, "longenough", "different1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(onSetPassword).not.toHaveBeenCalled();
  });

  it("hands the token and password over and lands on the home page", async () => {
    const pending = deferred<void>();
    const onSetPassword = vi.fn((_t: string, _p: string) => pending.promise);
    const { user } = renderPage(undefined, onSetPassword);
    await fill(user, "s3cret-pass");

    expect(onSetPassword).toHaveBeenCalledWith(TOKEN, "s3cret-pass");
    expect(await screen.findByRole("button", { name: "Setting password..." })).toBeDisabled();

    pending.resolve();
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("shows the error the setter throws and lets the user retry", async () => {
    const onSetPassword = vi
      .fn<(t: string, p: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Token already used"))
      .mockResolvedValueOnce(undefined);
    const { user } = renderPage(undefined, onSetPassword);
    await fill(user, "s3cret-pass");

    expect(await screen.findByRole("alert")).toHaveTextContent("Token already used");
    const button = screen.getByRole("button", { name: "Set Password & Sign In" });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(await screen.findByText("home page")).toBeInTheDocument();
    expect(onSetPassword).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    const onSetPassword = vi.fn(async () => {
      throw "nope";
    });
    const { user } = renderPage(undefined, onSetPassword);
    await fill(user, "s3cret-pass");
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to set password");
    await waitFor(() => expect(screen.getByRole("button", { name: "Set Password & Sign In" })).toBeEnabled());
  });
});
