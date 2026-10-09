/**
 * Mass EOL linking admin, regression tests: the cycle picker's "latest
 * version" note is translated, not hardcoded English.
 *
 * Same harness as `EolAdmin.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import type { EolCycle, MassEolResult } from "@/types";
import EolAdmin from "./EolAdmin";

const SEARCH_ITC = "/eol/mass-search?type_key=ITComponent";

const MATCHED: MassEolResult = {
  card_id: "c2",
  card_name: "Ubuntu LTS",
  card_type: "ITComponent",
  candidates: [
    { card_id: "c2", card_name: "Ubuntu LTS", card_type: "ITComponent", eol_product: "ubuntu", score: 0.9 },
  ],
};

const CYCLES: EolCycle[] = [{ cycle: "24.04", eol: "2099-01-01", latest: "24.04.1" }];

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", SEARCH_ITC, [MATCHED]);
  mockApi.on("get", "/eol/products/ubuntu", CYCLES);
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("EolAdmin cycle picker — the latest version note", () => {
  it("is translated in another locale", async () => {
    const user = userEvent.setup();
    render(<EolAdmin />);
    await user.click(screen.getByRole("button", { name: /Search EOL Data/ }));
    await screen.findByText("Ubuntu LTS");
    await user.click(screen.getByText("ubuntu"));
    const dialog = await screen.findByRole("dialog");

    await act(async () => {
      await i18n.changeLanguage("de");
    });
    await user.click(await within(dialog).findByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    const option = within(listbox).getByRole("option", { name: /^24\.04/ });
    expect(within(option).getByText("(aktuell: 24.04.1)")).toBeInTheDocument();
    expect(within(option).queryByText(/latest/)).not.toBeInTheDocument();
  });
});
