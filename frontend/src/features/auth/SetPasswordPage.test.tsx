/**
 * SetPasswordPage — an invited user sets their first password.
 *
 * Pins the token round-trip (`/auth/validate-setup-token`), the invalid-link
 * screen, the two client-side checks (length, match), the hand-off to
 * `onSetPassword` and the landing on `/` afterwards.
 */
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useNavigate, useNavigationType } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import SetPasswordPage from "./SetPasswordPage";

const TOKEN = "tok/abc+123";
const VALIDATE = `/auth/validate-setup-token?token=${encodeURIComponent(TOKEN)}`;

/** The landing page; says whether the router pushed or replaced to get here. */
function Home() {
  return <div>home page ({useNavigationType()})</div>;
}

/** Follows a second invitation link without remounting the page. */
function FollowLink({ token }: { token: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/auth/set-password?token=${encodeURIComponent(token)}`)}>
      follow link
    </button>
  );
}

function renderPage(
  query = `?token=${encodeURIComponent(TOKEN)}`,
  onSetPassword = vi.fn(async (_t: string, _p: string) => {}),
  extra: ReactNode = null,
) {
  const utils = renderWithProviders(
    <>
      <SetPasswordPage onSetPassword={onSetPassword} />
      {extra}
    </>,
    {
      route: `/auth/set-password${query}`,
      routes: [{ path: "/auth/set-password" }, { path: "/", element: <Home /> }],
      user: null,
    },
  );
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
    // Nothing has been submitted yet, so there is nothing to complain about.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-validates when the page is reached again with another invitation token", async () => {
    const other = "second-token";
    const otherValidate = `/auth/validate-setup-token?token=${other}`;
    mockApi.on("get", otherValidate, {
      email: "bob@example.com",
      display_name: "Bob",
    });
    const { user } = renderPage(undefined, undefined, <FollowLink token={other} />);
    expect(await screen.findByText("Welcome, Ada! Set a password for ada@example.com.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "follow link" }));
    expect(await screen.findByText("Welcome, Bob! Set a password for bob@example.com.")).toBeInTheDocument();
    expect(mockApi.callsOf("get").map((c) => c.path)).toEqual([VALIDATE, otherValidate]);
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
    // The dead link is replaced in the history, not stacked under the login page.
    expect(await screen.findByText("home page (REPLACE)")).toBeInTheDocument();
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

  it("accepts a password of exactly six characters", async () => {
    const { user, onSetPassword } = renderPage();
    await fill(user, "abcdef");
    await waitFor(() => expect(onSetPassword).toHaveBeenCalledWith(TOKEN, "abcdef"));
    expect(screen.queryByText("Password must be at least 6 characters.")).not.toBeInTheDocument();
  });

  it("handles the submit in the page instead of letting the browser post the form", async () => {
    const { onSetPassword } = renderPage();
    const field = await screen.findByLabelText(/^New Password/);
    const form = field.closest("form") as HTMLFormElement;
    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.submit(form)).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent("Password must be at least 6 characters.");
    expect(onSetPassword).not.toHaveBeenCalled();
  });

  it("clears the previous error as soon as the corrected form is resubmitted", async () => {
    const pending = deferred<void>();
    const onSetPassword = vi.fn((_t: string, _p: string) => pending.promise);
    const { user } = renderPage(undefined, onSetPassword);
    await fill(user, "abc");
    expect(await screen.findByRole("alert")).toHaveTextContent("Password must be at least 6 characters.");

    await user.clear(screen.getByLabelText(/^New Password/));
    await user.clear(screen.getByLabelText(/^Confirm Password/));
    await fill(user, "s3cret-pass");
    expect(await screen.findByRole("button", { name: "Setting password..." })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    pending.resolve();
    expect(await screen.findByText("home page (REPLACE)")).toBeInTheDocument();
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
    // The used setup link is replaced in the history, so Back cannot return to it.
    expect(await screen.findByText("home page (REPLACE)")).toBeInTheDocument();
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
    expect(await screen.findByText(/^home page/)).toBeInTheDocument();
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
