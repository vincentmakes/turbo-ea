/**
 * CardLogoMenu regressions with the real brand-icon picker: a failed pick must
 * be visible where the user is looking. The picker is a modal, so an error the
 * caller shows on the page behind it is hidden from the user (and from
 * assistive technology) for as long as the picker stays open.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import Alert from "@mui/material/Alert";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import CardLogoMenu from "./CardLogoMenu";

const ICONS = [{ ref: "logos:sap", slug: "sap", title: "SAP", pack: "logos" }];

/** A caller like card detail: the error is shown on the page, beside the card. */
function Harness() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  return (
    <>
      <button onClick={(e) => setAnchor(e.currentTarget)}>Change logo</button>
      {error && <Alert severity="error">{error}</Alert>}
      <span data-testid="logo">{logo ?? "none"}</span>
      <CardLogoMenu
        cardId="card-1"
        hasLogo={false}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onChanged={(_id, at) => {
          setError("");
          setLogo(at);
        }}
        onError={setError}
      />
    </>
  );
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/card-logos/brand-icons?*", { items: ICONS, total: 1 });
});

async function pickSap(user: ReturnType<typeof renderWithProviders>["user"]) {
  await user.click(screen.getByRole("button", { name: "Change logo" }));
  await user.click(await screen.findByRole("menuitem", { name: /Choose a brand icon/ }));
  await user.click(await screen.findByRole("button", { name: "SAP" }));
}

describe("CardLogoMenu — a failed brand-icon pick", () => {
  it("is visible to the user instead of hidden behind the open picker", async () => {
    mockApi.fail("upload", "/cards/card-1/logo", 404, "Unknown icon");
    const { user } = renderWithProviders(<Harness />);
    await pickSap(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("UPLOAD /cards/card-1/logo failed");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("logo")).toHaveTextContent("none");
  });

  it("closes the picker once the icon is set", async () => {
    mockApi.on("upload", "/cards/card-1/logo", { logo_updated_at: "2026-10-09T00:00:00Z" });
    const { user } = renderWithProviders(<Harness />);
    await pickSap(user);

    await waitFor(() =>
      expect(screen.getByTestId("logo")).toHaveTextContent("2026-10-09T00:00:00Z"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
