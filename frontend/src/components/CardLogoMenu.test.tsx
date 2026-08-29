import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CardLogoMenu from "./CardLogoMenu";

vi.mock("@/api/client", () => ({
  api: { upload: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/BrandIconPicker", () => ({
  default: ({ open, onPick }: { open: boolean; onPick: (slug: string) => void }) =>
    open ? (
      <button data-testid="pick-icon" onClick={() => onPick("logos:sap")}>
        pick
      </button>
    ) : null,
}));

import { api } from "@/api/client";

function renderMenu(props: Partial<React.ComponentProps<typeof CardLogoMenu>> = {}) {
  const anchor = document.createElement("div");
  document.body.appendChild(anchor);
  const onChanged = vi.fn();
  const onError = vi.fn();
  const onNotify = vi.fn();
  const utils = render(
    <CardLogoMenu
      cardId="card-1"
      hasLogo
      anchorEl={anchor}
      onClose={() => {}}
      onChanged={onChanged}
      onNotify={onNotify}
      onError={onError}
      {...props}
    />,
  );
  return { ...utils, onChanged, onError, onNotify };
}

beforeEach(() => vi.clearAllMocks());

describe("CardLogoMenu", () => {
  it("offers Replace and Remove for a card that already has a logo", () => {
    renderMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("offers no Remove for a card with no logo", () => {
    renderMenu({ hasLogo: false });
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("posts a brand-icon slug rather than image bytes", async () => {
    const user = userEvent.setup();
    vi.mocked(api.upload).mockResolvedValue({ logo_updated_at: "2026-08-29T09:00:00Z" });
    const { onChanged } = renderMenu();

    await user.click(screen.getAllByRole("menuitem")[1]);
    await user.click(await screen.findByTestId("pick-icon"));

    await waitFor(() =>
      expect(vi.mocked(api.upload)).toHaveBeenCalledWith("/cards/card-1/logo", undefined, "file", {
        icon_slug: "logos:sap",
      }),
    );
    expect(onChanged).toHaveBeenCalledWith("card-1", "2026-08-29T09:00:00Z");
  });

  it("removes the logo and reports it gone", async () => {
    const user = userEvent.setup();
    vi.mocked(api.delete).mockResolvedValue(undefined);
    const { onChanged } = renderMenu();

    await user.click(screen.getAllByRole("menuitem")[2]);

    await waitFor(() => expect(vi.mocked(api.delete)).toHaveBeenCalledWith("/cards/card-1/logo"));
    expect(onChanged).toHaveBeenCalledWith("card-1", null);
  });

  it("surfaces a refused upload instead of swallowing it", async () => {
    vi.mocked(api.upload).mockRejectedValue(new Error("Image exceeds maximum size of 1 MB"));
    const { container, onError, onChanged } = renderMenu();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "big.png", {
      type: "image/png",
    });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Image exceeds maximum size of 1 MB"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("still writes to the card the menu was opened on after the caller drops it", async () => {
    // The file dialog is browser-modal: the Inventory's target can be cleared
    // (menu closed) long before the picked file comes back.
    const user = userEvent.setup();
    vi.mocked(api.upload).mockResolvedValue({ logo_updated_at: "2026-08-29T09:00:00Z" });
    const { rerender, container, onChanged } = renderMenu();

    await user.click(screen.getAllByRole("menuitem")[0]); // Replace logo…
    rerender(
      <CardLogoMenu
        cardId={null}
        hasLogo={false}
        anchorEl={null}
        onClose={() => {}}
        onChanged={onChanged}
      />,
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sap.png", {
      type: "image/png",
    });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() =>
      expect(vi.mocked(api.upload)).toHaveBeenCalledWith("/cards/card-1/logo", file),
    );
    expect(onChanged).toHaveBeenCalledWith("card-1", "2026-08-29T09:00:00Z");
  });
});
