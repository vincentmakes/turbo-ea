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
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  describe("details", () => {
    // The published view always carries info notes, which are alerts too.
    const INFO_NOTES = [/Embedding in another site/, /visitors sign in through a small pop-up/];
    const errorAlerts = () =>
      screen.queryAllByRole("alert").filter((a) => !INFO_NOTES.some((r) => r.test(a.textContent ?? "")));
    const SSO_PUBLISHED: PublishState = {
      ...PUBLISHED,
      access_mode: "sso",
      allowed_email_domains: ["acme.com", "partner.org"],
    };

    it("explains what publishing does and shows no error at first", () => {
      renderDialog();
      expect(
        screen.getByText(
          "Publish a read-only link that renders without signing in, so the diagram can be embedded in a wiki page.",
        ),
      ).toBeInTheDocument();
      expect(errorAlerts()).toHaveLength(0);
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("shows the embed note, but the SSO pop-up note only in SSO mode", () => {
      renderDialog({ initial: PUBLISHED });
      expect(
        screen.getByText(/Embedding in another site also requires an administrator/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/visitors sign in through a small pop-up window/)).not.toBeInTheDocument();
    });

    it("renders the link fields read-only", () => {
      renderDialog({ initial: PUBLISHED });
      expect(screen.getByRole("textbox", { name: "Link" })).toHaveAttribute("readonly");
      expect(screen.getByRole("textbox", { name: "Embed code" })).toHaveAttribute("readonly");
    });

    it("leaves both fields empty while the server has not assigned a slug", () => {
      renderDialog({ initial: { ...PUBLISHED, public_slug: null } });
      expect(screen.getByRole("textbox", { name: "Link" })).toHaveValue("");
      expect(screen.getByRole("textbox", { name: "Embed code" })).toHaveValue("");
    });

    it("lists the stored domains comma-separated with no pending change", () => {
      renderDialog({ initial: SSO_PUBLISHED });
      expect(screen.getByRole("textbox", { name: "Allowed email domains" })).toHaveValue(
        "acme.com, partner.org",
      );
      expect(
        screen.getByText("Comma-separated. Leave empty to allow anyone your identity provider authenticates."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Apply access changes" })).not.toBeInTheDocument();
    });

    it("offers Apply as soon as only the domain list changed", async () => {
      const { user } = renderDialog({ initial: SSO_PUBLISHED });
      await user.type(screen.getByRole("textbox", { name: "Allowed email domains" }), ", other.io");
      expect(screen.getByRole("button", { name: "Apply access changes" })).toBeInTheDocument();
    });

    it("disables the toggle and shows progress while the request runs", async () => {
      let release: () => void = () => {};
      mockApi.on("post", PUBLISH, () => new Promise((resolve) => (release = () => resolve(PUBLISHED))));
      const { user } = renderDialog();
      await user.click(publishSwitch());
      await waitFor(() => expect(publishSwitch()).toBeDisabled());
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      release();
      await waitFor(() => expect(publishSwitch()).toBeChecked());
      expect(publishSwitch()).toBeEnabled();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(errorAlerts()).toHaveLength(0);
    });

    it("re-enables the toggle and clears the error on a successful retry", async () => {
      mockApi.fail("post", PUBLISH, 500, "boom");
      const { user } = renderDialog();
      await user.click(publishSwitch());
      expect(await screen.findByText(`POST ${PUBLISH} failed`)).toBeInTheDocument();
      expect(publishSwitch()).toBeEnabled();
      mockApi.on("post", PUBLISH, PUBLISHED);
      await user.click(publishSwitch());
      await waitFor(() => expect(publishSwitch()).toBeChecked());
      expect(errorAlerts()).toHaveLength(0);
    });

    it("falls back to the generic message for a non-Error failure", async () => {
      mockApi.on("post", PUBLISH, () => {
        throw "nope";
      });
      const { user } = renderDialog();
      await user.click(publishSwitch());
      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("works without an onChange callback", async () => {
      const { user } = renderDialog({ onChange: undefined });
      await user.click(publishSwitch());
      await waitFor(() => expect(publishSwitch()).toBeChecked());
      expect(errorAlerts()).toHaveLength(0);
    });

    it("takes the mode the server returns, so a re-publish after unpublishing starts public", async () => {
      const { user } = renderDialog({ initial: SSO_PUBLISHED });
      await user.click(publishSwitch());
      await waitFor(() => expect(publishSwitch()).not.toBeChecked());
      await user.click(publishSwitch());
      await waitFor(() => expect(publishSwitch()).toBeChecked());
      expect(mockApi.callsOf("post", PUBLISH)[0].body).toEqual({
        access_mode: "public",
        allowed_email_domains: [],
      });
    });

    it("follows a new initial state while open", () => {
      const props = { diagramId: DIAGRAM_ID, diagramName: "Landscape", onClose: vi.fn() };
      const { rerender } = renderDialog();
      expect(publishSwitch()).not.toBeChecked();
      rerender(<ShareDiagramDialog open initial={PUBLISHED} {...props} />);
      expect(publishSwitch()).toBeChecked();
      expect(screen.getByRole("textbox", { name: "Link" })).toHaveValue(EMBED_URL);
    });

    it("clears the copied mark and a stale error when reopened", async () => {
      const props = { diagramId: DIAGRAM_ID, diagramName: "Landscape", onClose: vi.fn() };
      mockApi.fail("delete", PUBLISH, 500, "boom");
      const { user, rerender } = renderDialog({ initial: PUBLISHED });
      const [copyLink] = screen.getAllByRole("button", { name: "Copy" });
      await user.click(copyLink);
      await waitFor(() => expect(copyLink).toHaveTextContent("check"));
      await user.click(publishSwitch());
      expect(await screen.findByText(`DELETE ${PUBLISH} failed`)).toBeInTheDocument();
      rerender(<ShareDiagramDialog open={false} initial={PUBLISHED} {...props} />);
      rerender(<ShareDiagramDialog open initial={PUBLISHED} {...props} />);
      expect(screen.getAllByRole("button", { name: "Copy" })[0]).toHaveTextContent("content_copy");
      expect(errorAlerts()).toHaveLength(0);
    });

    it("drops the previous copied mark when a later copy is refused", async () => {
      const { user, writeText } = renderDialog({ initial: PUBLISHED });
      const [copyLink, copySnippet] = screen.getAllByRole("button", { name: "Copy" });
      await user.click(copyLink);
      await waitFor(() => expect(copyLink).toHaveTextContent("check"));
      writeText.mockRejectedValueOnce(new Error("denied"));
      await user.click(copySnippet);
      await waitFor(() => expect(copyLink).toHaveTextContent("content_copy"));
      expect(copySnippet).toHaveTextContent("content_copy");
    });

    it("does nothing on Copy when the clipboard API is unavailable", () => {
      renderDialog({ initial: PUBLISHED });
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => {
        errors.push(e.error);
        e.preventDefault();
      };
      window.addEventListener("error", onError);
      try {
        fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
      } finally {
        window.removeEventListener("error", onError);
      }
      expect(errors).toEqual([]);
      expect(screen.getAllByRole("button", { name: "Copy" })[0]).toHaveTextContent("content_copy");
    });
  });
});
