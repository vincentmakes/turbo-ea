import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import {
  USERS,
  ADMIN_USER,
  MEMBER_USER,
  VIEWER_USER,
  INACTIVE_USER,
} from "@/test/fixtures/metamodel";
import SignatureRequestDialog from "./SignatureRequestDialog";

function renderDialog(props: Partial<React.ComponentProps<typeof SignatureRequestDialog>> = {}) {
  const onClose = vi.fn();
  const onRequest = vi.fn(async () => {});
  const utils = render(
    <SignatureRequestDialog
      open
      onClose={onClose}
      onRequest={onRequest}
      title="Request signatures"
      description="Pick who must sign this decision."
      requesting={false}
      {...props}
    />,
  );
  return { ...utils, onClose, onRequest };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/users", USERS);
});

describe("SignatureRequestDialog", () => {
  it("renders title, description and the search prompt, and loads the user list when opened", async () => {
    renderDialog();
    expect(screen.getByText("Request signatures")).toBeInTheDocument();
    expect(screen.getByText("Pick who must sign this decision.")).toBeInTheDocument();
    // The prompt appears as the placeholder and as the empty-results hint.
    expect(screen.getAllByText("Search users...").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Request 0 Signatures" })).toBeDisabled();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
  });

  it("filters active users by name or email, selects them as chips and requests their ids", async () => {
    const user = userEvent.setup();
    const { onRequest } = renderDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    const search = screen.getByPlaceholderText("Search users...");
    await user.type(search, "test");
    // Active users whose name or email contains "test"; the inactive one is dropped.
    expect(await screen.findByText(ADMIN_USER.display_name)).toBeInTheDocument();
    expect(screen.getByText(MEMBER_USER.display_name)).toBeInTheDocument();
    expect(screen.queryByText(INACTIVE_USER.display_name)).not.toBeInTheDocument();

    await user.click(screen.getByText(MEMBER_USER.display_name));
    // Selecting clears the search and shows the chip; the list goes back to the prompt.
    expect(search).toHaveValue("");
    expect(screen.getByText(MEMBER_USER.display_name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request 1 Signature" })).toBeEnabled();

    // A selected user no longer appears in the results, matching by email works.
    await user.type(search, "admin@");
    expect(await screen.findByText(ADMIN_USER.display_name)).toBeInTheDocument();
    expect(screen.getAllByText(MEMBER_USER.display_name)).toHaveLength(1);
    await user.click(screen.getByText(ADMIN_USER.display_name));
    expect(screen.getByRole("button", { name: "Request 2 Signatures" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Request 2 Signatures" }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(1));
    expect(onRequest.mock.calls[0][0]).toEqual([MEMBER_USER.id, ADMIN_USER.id]);
  });

  it("reports no results for a query matching nobody and lets a chip be removed", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    const search = screen.getByPlaceholderText("Search users...");
    await user.type(search, "zzz-nobody");
    expect(await screen.findByText("No users found")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "viewer");
    await user.click(await screen.findByText("Test Viewer"));
    expect(screen.getByRole("button", { name: "Request 1 Signature" })).toBeEnabled();

    const chip = screen.getByText("Test Viewer").closest(".MuiChip-root");
    if (!chip) throw new Error("chip not rendered");
    await user.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
    expect(screen.queryByText("Test Viewer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request 0 Signatures" })).toBeDisabled();
  });

  it("shows Sending… and disables the submit while a request is in flight", () => {
    renderDialog({ requesting: true });
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
  });

  it("survives a failed user load and Cancel calls onClose", async () => {
    mockApi.fail("get", "/users", 500);
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    await user.type(screen.getByPlaceholderText("Search users..."), "test");
    expect(await screen.findByText("No users found")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("paints an empty search and the prompt before any effect runs", () => {
    // MUI portals render nothing on the server; keep the dialog inline.
    const theme = createTheme({ components: { MuiModal: { defaultProps: { disablePortal: true } } } });
    const html = renderToStaticMarkup(
      <ThemeProvider theme={theme}>
        <SignatureRequestDialog
          open
          onClose={vi.fn()}
          onRequest={vi.fn(async () => {})}
          title="Request signatures"
          description="Pick who must sign this decision."
          requesting={false}
        />
      </ThemeProvider>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("input")).toHaveValue("");
    expect(within(host).queryByText("Search users...")).not.toBeNull();
    expect(within(host).queryByText("No users found")).toBeNull();
  });

  it("does not load users while closed, and loads them once it opens", async () => {
    const user = userEvent.setup();
    const props = {
      onClose: vi.fn(),
      onRequest: vi.fn(async () => {}),
      title: "Request signatures",
      description: "Pick who must sign this decision.",
      requesting: false,
    };
    const { rerender } = render(<SignatureRequestDialog open={false} {...props} />);
    expect(mockApi.callsOf("get", "/users")).toHaveLength(0);

    rerender(<SignatureRequestDialog open {...props} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    await user.type(screen.getByPlaceholderText("Search users..."), "test");
    expect(await screen.findByText(ADMIN_USER.display_name)).toBeInTheDocument();
  });

  it("starts with no signatories when reopened", async () => {
    const user = userEvent.setup();
    const props = {
      onClose: vi.fn(),
      onRequest: vi.fn(async () => {}),
      title: "Request signatures",
      description: "Pick who must sign this decision.",
      requesting: false,
    };
    const { rerender } = render(<SignatureRequestDialog open {...props} />);
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    await user.type(screen.getByPlaceholderText("Search users..."), "viewer");
    await user.click(await screen.findByText(VIEWER_USER.display_name));
    expect(screen.getByRole("button", { name: "Request 1 Signature" })).toBeEnabled();

    rerender(<SignatureRequestDialog open={false} {...props} />);
    rerender(<SignatureRequestDialog open {...props} />);
    expect(screen.queryByText(VIEWER_USER.display_name)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request 0 Signatures" })).toBeDisabled();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(2));
  });

  it("matches a display name regardless of case", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    // "test a" is in the admin's name, not in any email.
    await user.type(screen.getByPlaceholderText("Search users..."), "TEST A");
    expect(await screen.findByText(ADMIN_USER.display_name)).toBeInTheDocument();
    expect(screen.queryByText(MEMBER_USER.display_name)).not.toBeInTheDocument();
  });

  it("treats a whitespace-only search as no search", async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));

    const search = screen.getByPlaceholderText("Search users...");
    // The field carries a search icon.
    const field = search.closest(".MuiInputBase-root") as HTMLElement;
    expect(within(field).getByText("search")).toBeInTheDocument();
    await user.type(search, "   ");
    // The prompt stays in the results area; nothing is reported as missing.
    expect(screen.getByText("Search users...", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("No users found")).not.toBeInTheDocument();
  });
});
