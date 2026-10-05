import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { SoAW } from "@/types";
import CreateSoAWDialog from "./CreateSoAWDialog";

const INITIATIVES = [
  { id: "init-1", name: "Cloud Migration" },
  { id: "init-2", name: "ERP Replacement" },
];

const CREATED: SoAW = {
  id: "soaw-1",
  name: "Migration SoAW",
  initiative_id: "init-1",
  status: "draft",
  document_info: {} as SoAW["document_info"],
  version_history: [],
  sections: {},
  revision_number: 1,
  parent_id: null,
  signatories: [],
  signed_at: null,
};

function renderDialog(props: Partial<React.ComponentProps<typeof CreateSoAWDialog>> = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const utils = render(
    <CreateSoAWDialog
      open
      onClose={onClose}
      onCreated={onCreated}
      initiatives={INITIATIVES}
      {...props}
    />,
  );
  return { ...utils, onClose, onCreated };
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", "/soaw", (_path, body) => ({ ...CREATED, ...(body as object) }));
});

describe("CreateSoAWDialog", () => {
  it("renders the title, the name field and the initiative picker, with Create disabled until a name is typed", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New Statement of Architecture Work")).toBeInTheDocument();
    expect(screen.getByLabelText("Document name")).toBeInTheDocument();
    expect(screen.getByText("Link this document to an initiative (optional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("posts the name with the chosen initiative, then reports the created document and closes", async () => {
    const user = userEvent.setup();
    const { onClose, onCreated } = renderDialog();

    await user.type(screen.getByLabelText("Document name"), "  Migration SoAW  ");
    await user.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "None" })).toBeInTheDocument();
    await user.click(within(listbox).getByRole("option", { name: "ERP Replacement" }));

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockApi.callsOf("post", "/soaw")[0].body).toEqual({
      name: "Migration SoAW",
      initiative_id: "init-2",
    });
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: "soaw-1", initiative_id: "init-2" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends a null initiative when None is kept and submits on Enter", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Document name"), "Standalone{Enter}");

    await waitFor(() => expect(mockApi.callsOf("post", "/soaw")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/soaw")[0].body).toEqual({
      name: "Standalone",
      initiative_id: null,
    });
  });

  it("hides the picker and pins the initiative when fixedInitiativeId is given", async () => {
    const user = userEvent.setup();
    renderDialog({ fixedInitiativeId: "init-1", initiatives: undefined });

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Document name"), "Pinned");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/soaw")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/soaw")[0].body).toEqual({
      name: "Pinned",
      initiative_id: "init-1",
    });
  });

  it("shows the API error as the field's helper text and keeps the dialog open", async () => {
    mockApi.fail("post", "/soaw", 400, "name taken");
    const user = userEvent.setup();
    const { onClose, onCreated } = renderDialog();

    await user.type(screen.getByLabelText("Document name"), "Dup");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("POST /soaw failed")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Create is available again once the request has settled.
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("resets the form each time it reopens and Cancel calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <CreateSoAWDialog open onClose={onClose} onCreated={vi.fn()} initiatives={INITIATIVES} />,
    );
    await user.type(screen.getByLabelText("Document name"), "Draft text");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <CreateSoAWDialog open={false} onClose={onClose} onCreated={vi.fn()} initiatives={INITIATIVES} />,
    );
    rerender(
      <CreateSoAWDialog open onClose={onClose} onCreated={vi.fn()} initiatives={INITIATIVES} />,
    );
    expect(screen.getByLabelText("Document name")).toHaveValue("");
  });

  it("paints an empty name and no initiative before any effect runs", () => {
    // MUI portals render nothing on the server; keep the dialog inline.
    const theme = createTheme({ components: { MuiModal: { defaultProps: { disablePortal: true } } } });
    const html = renderToStaticMarkup(
      <ThemeProvider theme={theme}>
        <CreateSoAWDialog open onClose={vi.fn()} onCreated={vi.fn()} initiatives={INITIATIVES} />
      </ThemeProvider>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const inputs = host.querySelectorAll("input");
    // The document name, then the select's hidden value input.
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue("");
    expect(inputs[1]).toHaveValue("");
    expect(within(host).queryByText("Creating...")).toBeNull();
  });

  it("labels the initiative picker and offers only None when no initiatives are given", async () => {
    const user = userEvent.setup();
    renderDialog({ initiatives: undefined });

    expect(screen.getByText("Initiative", { selector: "label" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(within(listbox).getByRole("option", { name: "None" })).toBeInTheDocument();
  });

  it("does not submit a blank or whitespace-only name, by button or by Enter", async () => {
    const user = userEvent.setup();
    renderDialog();

    const field = screen.getByLabelText("Document name");
    await user.type(field, "{Enter}");
    await user.type(field, "   ");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await user.type(field, "{Enter}");

    expect(mockApi.callsOf("post", "/soaw")).toHaveLength(0);
  });

  it("marks the name field invalid only while an error is shown", async () => {
    mockApi.fail("post", "/soaw", 400, "name taken");
    const user = userEvent.setup();
    renderDialog();

    const field = screen.getByLabelText("Document name");
    expect(field).toHaveAttribute("aria-invalid", "false");
    await user.type(field, "Dup");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("POST /soaw failed");
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    mockApi.on("post", "/soaw", () => Promise.reject("nope"));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("Document name"), "Odd failure");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Failed to create")).toBeInTheDocument();
  });

  it("shows Creating... while in flight and clears the previous error on retry", async () => {
    mockApi.fail("post", "/soaw", 400, "name taken");
    const user = userEvent.setup();
    const { onCreated } = renderDialog();

    await user.type(screen.getByLabelText("Document name"), "Retry me");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("POST /soaw failed");

    let release: (v: SoAW) => void = () => {};
    mockApi.on("post", "/soaw", () => new Promise<SoAW>((resolve) => (release = resolve)));
    await user.click(screen.getByRole("button", { name: "Create" }));

    const busy = await screen.findByRole("button", { name: "Creating..." });
    expect(busy).toBeDisabled();
    expect(screen.queryByText("POST /soaw failed")).not.toBeInTheDocument();

    release(CREATED);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("clears an error when the dialog is reopened", async () => {
    mockApi.fail("post", "/soaw", 400, "name taken");
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onCreated: vi.fn(), initiatives: INITIATIVES };
    const { rerender } = render(<CreateSoAWDialog open {...props} />);

    await user.type(screen.getByLabelText("Document name"), "Dup");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("POST /soaw failed");

    rerender(<CreateSoAWDialog open={false} {...props} />);
    rerender(<CreateSoAWDialog open {...props} />);
    expect(screen.queryByText("POST /soaw failed")).not.toBeInTheDocument();
  });

  it("does not wipe the form while the dialog animates closed", async () => {
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onCreated: vi.fn(), initiatives: INITIATIVES };
    const { rerender } = render(<CreateSoAWDialog open {...props} />);

    await user.type(screen.getByLabelText("Document name"), "Half typed");
    rerender(<CreateSoAWDialog open={false} {...props} />);

    // The exit transition still shows the form; the reset is for the next open.
    expect(screen.getByLabelText("Document name")).toHaveValue("Half typed");
  });
});
