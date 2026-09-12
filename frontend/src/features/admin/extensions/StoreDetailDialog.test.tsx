import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StoreDetailDialog, { changelogPath } from "./StoreDetailDialog";
import type { StoreActionHandlers } from "./StoreActions";
import type { StoreItem } from "./types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";

const mockGet = api.get as ReturnType<typeof vi.fn>;

const SHOTS = [
  "https://store/screenshots/esg-pack/01.png",
  "https://store/screenshots/esg-pack/02.png",
  "https://store/screenshots/esg-pack/03.png",
];

const ITEM: StoreItem = {
  key: "esg-pack",
  name: "ESG Content Pack",
  description: "Short.",
  long_description: "The long story.",
  price: "990 EUR / year",
  payment_link: "https://buy.stripe.test/pl_1",
  version: "1.2.0",
  update_available: false,
  entitlement_state: "unlicensed",
  screenshots: SHOTS,
  tags: ["commercial", "esg"],
  homepage: "https://h",
};

const handlers: StoreActionHandlers = {
  onInstall: vi.fn(),
  onBuy: vi.fn(),
  onTrial: vi.fn(),
  busyKey: null,
  isWorking: false,
  claimingKey: null,
};

function renderDialog(
  item: StoreItem | null = ITEM,
  extra: Partial<Parameters<typeof StoreDetailDialog>[0]> = {},
) {
  const onClose = vi.fn();
  const onToggleTag = vi.fn();
  const utils = render(
    <StoreDetailDialog
      item={item}
      handlers={handlers}
      onClose={onClose}
      onToggleTag={onToggleTag}
      {...extra}
    />,
  );
  return { ...utils, onClose, onToggleTag };
}

const heroImg = () =>
  screen.getByRole("button", { name: /ESG Content Pack screenshot/ });

describe("StoreDetailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockRejectedValue(new Error("store offline"));
  });

  it("shows one screenshot large with a thumbnail per screenshot", async () => {
    renderDialog();
    expect(await screen.findByText("The long story.")).toBeInTheDocument();
    expect(heroImg()).toHaveAttribute("src", SHOTS[0]);
    expect(
      screen.getAllByRole("button", { name: /Show screenshot/ }),
    ).toHaveLength(3);
    expect(screen.getByText("Screenshot 1 of 3")).toBeInTheDocument();
  });

  it("steps through the gallery with the arrows, wrapping at both ends", async () => {
    renderDialog();
    await screen.findByText("The long story.");
    await userEvent.click(
      screen.getByRole("button", { name: "Next screenshot" }),
    );
    expect(heroImg()).toHaveAttribute("src", SHOTS[1]);
    await userEvent.click(
      screen.getByRole("button", { name: "Next screenshot" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Next screenshot" }),
    );
    expect(heroImg()).toHaveAttribute("src", SHOTS[0]);
    await userEvent.click(
      screen.getByRole("button", { name: "Previous screenshot" }),
    );
    expect(heroImg()).toHaveAttribute("src", SHOTS[2]);
    expect(screen.getByText("Screenshot 3 of 3")).toBeInTheDocument();
    // a thumbnail jumps straight to its screenshot
    await userEvent.click(
      screen.getByRole("button", { name: "Show screenshot 2" }),
    );
    expect(heroImg()).toHaveAttribute("src", SHOTS[1]);
    expect(
      screen.getByRole("button", { name: "Show screenshot 2" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the full-size view from the large screenshot", async () => {
    renderDialog();
    await screen.findByText("The long story.");
    await userEvent.click(heroImg());
    await waitFor(() =>
      expect(
        document.querySelectorAll(`img[src="${SHOTS[0]}"]`).length,
      ).toBeGreaterThan(1),
    );
  });

  it("renders no gallery for a listing without screenshots", async () => {
    renderDialog({ ...ITEM, screenshots: [] });
    expect(await screen.findByText("The long story.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Show screenshot/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Screenshot 1 of/)).not.toBeInTheDocument();
    expect(screen.getByText("Source").closest("a")).toHaveAttribute(
      "href",
      "https://h",
    );
  });

  it("shows What's new from the store's release notes for the listed version", async () => {
    mockGet.mockResolvedValue({
      key: "esg-pack",
      version: "1.2.0",
      from_version: null,
      notes: "### Added\n- A shiny new thing",
      source: "store",
    });
    renderDialog();
    expect(await screen.findByText("What's new")).toBeInTheDocument();
    expect(screen.getByText("A shiny new thing")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(
      "/admin/extensions/store/changelog/esg-pack?version=1.2.0",
      expect.anything(),
    );
  });

  it("offers the store's Full changelog link under the notes when the store answered", async () => {
    mockGet.mockResolvedValue({
      key: "esg-pack",
      version: "1.2.0",
      from_version: null,
      notes: "### Added\n- A shiny new thing",
      source: "store",
      changelog_url: "https://store.test/ext/esg-pack/#whats-new",
    });
    renderDialog();
    const link = await screen.findByRole("link", { name: /Full changelog/ });
    expect(link).toHaveAttribute("href", "https://store.test/ext/esg-pack/#whats-new");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("has no Full changelog link when the notes came from the bundle alone", async () => {
    mockGet.mockResolvedValue({
      key: "esg-pack",
      version: "1.2.0",
      from_version: null,
      notes: "### Added\n- A shiny new thing",
      source: "bundle",
      changelog_url: null,
    });
    renderDialog();
    expect(await screen.findByText("A shiny new thing")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Full changelog/ })).not.toBeInTheDocument();
  });

  it("asks for the notes since the installed version when an update is offered", () => {
    expect(
      changelogPath({
        ...ITEM,
        installed_version: "1.0.0",
        update_available: true,
      }),
    ).toBe(
      "/admin/extensions/store/changelog/esg-pack?version=1.2.0&from_version=1.0.0",
    );
    expect(changelogPath({ ...ITEM, installed_version: "1.2.0" })).toBe(
      "/admin/extensions/store/changelog/esg-pack?version=1.2.0",
    );
    expect(changelogPath(null)).toBeNull();
  });

  it("has no What's new section when the store cannot answer", async () => {
    renderDialog();
    await screen.findByText("The long story.");
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByText("What's new")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("starts over on the first screenshot when a different listing opens", async () => {
    const { rerender } = renderDialog();
    await screen.findByText("The long story.");
    await userEvent.click(
      screen.getByRole("button", { name: "Next screenshot" }),
    );
    expect(heroImg()).toHaveAttribute("src", SHOTS[1]);
    const other: StoreItem = {
      ...ITEM,
      key: "other",
      name: "Other Ext",
      long_description: "Other story.",
      screenshots: ["https://store/o/1.png", "https://store/o/2.png"],
    };
    rerender(
      <StoreDetailDialog
        item={other}
        handlers={handlers}
        onClose={vi.fn()}
        onToggleTag={vi.fn()}
      />,
    );
    expect(await screen.findByText("Other story.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Other Ext screenshot/ }),
    ).toHaveAttribute("src", "https://store/o/1.png");
  });

  it("filters the grid by a tag and closes, since the grid sits behind the dialog", async () => {
    const { onClose, onToggleTag } = renderDialog();
    await screen.findByText("The long story.");
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByText("esg"));
    expect(onToggleTag).toHaveBeenCalledWith("esg");
    expect(onClose).toHaveBeenCalled();
    // the derived commercial-model pill is not a topical tag
    expect(within(dialog).queryByText("commercial")).not.toBeInTheDocument();
  });
});
