/**
 * Publishing a diagram as an account-less read-only link (discussion #905).
 *
 * The toggle is the publish/unpublish call itself (`POST` / `DELETE
 * /diagrams/{id}/publish`); the access mode and the domain allowlist are only
 * sent when the user applies them, and the two strings a publisher pastes —
 * the embed URL and an iframe snippet — are derived from the slug the server
 * returned, never typed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { installClipboard } from "@/test/dom";
import ShareDiagramDialog from "./ShareDiagramDialog";

type Props = React.ComponentProps<typeof ShareDiagramDialog>;
type PublishState = Props["initial"];

const DIAGRAM_ID = "d1a60000-0000-4000-8000-000000000001";
const PUBLISH = `/diagrams/${DIAGRAM_ID}/publish`;

const UNPUBLISHED: PublishState = {
  is_published: false,
  public_slug: null,
  access_mode: "public",
  allowed_email_domains: [],
};

const PUBLISHED: PublishState = {
  is_published: true,
  public_slug: "landscape-abc123",
  access_mode: "public",
  allowed_email_domains: [],
};

const EMBED_URL = `${window.location.origin}/embed/diagram/landscape-abc123`;

let clipboard: ReturnType<typeof installClipboard>;

function renderDialog(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onChange = vi.fn();
  // The kit's stub must be in place before `userEvent.setup()`, which then
  // swaps in its own clipboard — so the spy is taken on whatever is live after.
  clipboard = installClipboard();
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  const result = render(
    <ShareDiagramDialog
      open
      diagramId={DIAGRAM_ID}
      diagramName="Landscape"
      initial={UNPUBLISHED}
      onClose={onClose}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...result, user, onClose, onChange, writeText };
}

const publishSwitch = () => screen.getByRole("checkbox", { name: "Publish this diagram" });
const modeSelect = () => screen.getByRole("combobox", { name: "Who can open the link" });

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", PUBLISH, (_p, body) => {
    const b = body as { access_mode: "public" | "sso"; allowed_email_domains: string[] };
    return { ...PUBLISHED, access_mode: b.access_mode, allowed_email_domains: b.allowed_email_domains };
  });
  mockApi.on("delete", PUBLISH, UNPUBLISHED);
});

afterEach(() => {
  vi.restoreAllMocks();
  clipboard?.();
});

describe("ShareDiagramDialog", () => {
  it("starts unpublished with only the toggle shown", () => {
    renderDialog();
    expect(screen.getByText("Share this diagram")).toBeInTheDocument();
    expect(publishSwitch()).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Link" })).not.toBeInTheDocument();
  });

  it("publishes with the current mode and shows the link and embed snippet", async () => {
    const { user, onChange } = renderDialog();
    await user.click(publishSwitch());
    expect(mockApi.callsOf("post", PUBLISH)[0].body).toEqual({
      access_mode: "public",
      allowed_email_domains: [],
    });
    await waitFor(() => expect(publishSwitch()).toBeChecked());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ public_slug: "landscape-abc123" }));
    expect(screen.getByRole("textbox", { name: "Link" })).toHaveValue(EMBED_URL);
    expect(screen.getByRole("textbox", { name: "Embed code" })).toHaveValue(
      `<iframe src="${EMBED_URL}" width="100%" height="600" style="border:none" title="Landscape"></iframe>`,
    );
    expect(modeSelect()).toHaveTextContent("Anyone with the link");
    expect(screen.getByText(/Treat the link as the password/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Allowed email domains" })).not.toBeInTheDocument();
  });

  it("escapes double quotes in the iframe title", () => {
    renderDialog({ initial: PUBLISHED, diagramName: 'The "big" picture' });
    const snippet = screen.getByRole("textbox", { name: "Embed code" }) as HTMLInputElement;
    expect(snippet.value).toContain('title="The &quot;big&quot; picture"');
  });

  it("unpublishes through DELETE and hides the link again", async () => {
    const { user, onChange } = renderDialog({ initial: PUBLISHED });
    expect(screen.getByRole("textbox", { name: "Link" })).toBeInTheDocument();
    await user.click(publishSwitch());
    expect(mockApi.callsOf("delete", PUBLISH)).toHaveLength(1);
    await waitFor(() => expect(publishSwitch()).not.toBeChecked());
    expect(onChange).toHaveBeenCalledWith(UNPUBLISHED);
    expect(screen.queryByRole("textbox", { name: "Link" })).not.toBeInTheDocument();
  });

  it("copies the link and the snippet, marking the row that was copied", async () => {
    const { user, writeText } = renderDialog({ initial: PUBLISHED });
    const [copyLink, copySnippet] = screen.getAllByRole("button", { name: "Copy" });
    await user.click(copyLink);
    expect(writeText).toHaveBeenCalledWith(EMBED_URL);
    await waitFor(() => expect(copyLink).toHaveTextContent("check"));
    expect(copySnippet).toHaveTextContent("content_copy");

    await user.click(copySnippet);
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("<iframe"));
    await waitFor(() => expect(copySnippet).toHaveTextContent("check"));
    expect(copyLink).toHaveTextContent("content_copy");
  });

  it("clears the copied mark when the clipboard write is refused", async () => {
    const { user, writeText } = renderDialog({ initial: PUBLISHED });
    writeText.mockRejectedValueOnce(new Error("denied"));
    const [copyLink] = screen.getAllByRole("button", { name: "Copy" });
    await user.click(copyLink);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copyLink).toHaveTextContent("content_copy");
  });

  it("switches to SSO, takes a domain allowlist and applies it in one request", async () => {
    const { user, onChange } = renderDialog({ initial: PUBLISHED });
    expect(screen.queryByRole("button", { name: "Apply access changes" })).not.toBeInTheDocument();

    await user.click(modeSelect());
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Only people who sign in" }));
    expect(screen.getByText(/Visitors authenticate with your identity provider/)).toBeInTheDocument();
    expect(screen.getByText(/visitors sign in through a small pop-up window/)).toBeInTheDocument();

    const domains = screen.getByRole("textbox", { name: "Allowed email domains" });
    await user.type(domains, " acme.com , partner.org,, ");
    await user.click(screen.getByRole("button", { name: "Apply access changes" }));

    expect(mockApi.callsOf("post", PUBLISH)[0].body).toEqual({
      access_mode: "sso",
      allowed_email_domains: ["acme.com", "partner.org"],
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ access_mode: "sso", allowed_email_domains: ["acme.com", "partner.org"] }),
      ),
    );
    // Applied: the pending-changes button goes away and the field shows the normalised list.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Apply access changes" })).not.toBeInTheDocument(),
    );
    expect(domains).toHaveValue("acme.com, partner.org");
  });

  it("surfaces a failed publish as an error and leaves the toggle off", async () => {
    mockApi.fail("post", PUBLISH, 403, "forbidden");
    const { user, onChange } = renderDialog();
    await user.click(publishSwitch());
    expect(await screen.findByRole("alert")).toHaveTextContent(`POST ${PUBLISH} failed`);
    expect(publishSwitch()).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes through the Close button", async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-reads the initial state every time it opens", async () => {
    const { user, rerender } = renderDialog({ initial: PUBLISHED });
    await user.click(modeSelect());
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Only people who sign in" }),
    );
    expect(screen.getByRole("button", { name: "Apply access changes" })).toBeInTheDocument();
    const props = { diagramId: DIAGRAM_ID, diagramName: "Landscape", onClose: vi.fn() };
    rerender(<ShareDiagramDialog open={false} initial={PUBLISHED} {...props} />);
    rerender(<ShareDiagramDialog open initial={PUBLISHED} {...props} />);
    expect(screen.queryByRole("button", { name: "Apply access changes" })).not.toBeInTheDocument();
    expect(modeSelect()).toHaveTextContent("Anyone with the link");
  });
});
