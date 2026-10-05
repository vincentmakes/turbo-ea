/**
 * PpmHome — the /ppm tab container (Portfolio + EA Delivery).
 *
 * Both tab bodies are lazy and heavy, so they are stubbed: what is pinned is
 * which one renders for a given `?tab=`, that switching tabs rewrites the URL
 * (and drops `tab` for the default), and that the active tab names the page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("./PpmPortfolio", () => ({ default: () => <div data-testid="ppm-portfolio" /> }));
vi.mock("@/features/reports/EaDeliveryReport", () => ({
  default: () => <div data-testid="ea-delivery" />,
}));

import { renderWithProviders } from "@/test/render";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import PpmHome from "./PpmHome";

function Probe() {
  const location = useLocation();
  const { section } = usePageTitleSlots();
  return (
    <>
      <div data-testid="search">{location.search}</div>
      <div data-testid="section">{section?.text ?? ""}</div>
    </>
  );
}

function renderHome(route = "/ppm") {
  return renderWithProviders(
    <>
      <PpmHome />
      <Probe />
    </>,
    { route, routes: [{ path: "/ppm" }] },
  );
}

beforeEach(() => {
  resetPageTitle();
});

describe("PpmHome", () => {
  it("opens on the Portfolio tab by default", async () => {
    renderHome();
    expect(await screen.findByTestId("ppm-portfolio")).toBeInTheDocument();
    expect(screen.queryByTestId("ea-delivery")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Portfolio/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("section")).toHaveTextContent("Portfolio");
  });

  it("opens the tab named in the URL", async () => {
    renderHome("/ppm?tab=ea-delivery");
    expect(await screen.findByTestId("ea-delivery")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /EA Delivery/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("section")).toHaveTextContent("EA Delivery");
  });

  it("ignores an unknown tab and falls back to Portfolio", async () => {
    renderHome("/ppm?tab=nope");
    expect(await screen.findByTestId("ppm-portfolio")).toBeInTheDocument();
  });

  it("writes the tab into the URL, and removes it again for the default tab", async () => {
    const { user } = renderHome("/ppm?groupBy=Organization");
    await screen.findByTestId("ppm-portfolio");

    await user.click(screen.getByRole("tab", { name: /EA Delivery/ }));
    expect(await screen.findByTestId("ea-delivery")).toBeInTheDocument();
    expect(screen.getByTestId("search")).toHaveTextContent("?groupBy=Organization&tab=ea-delivery");
    await waitFor(() => expect(screen.getByTestId("section")).toHaveTextContent("EA Delivery"));

    await user.click(screen.getByRole("tab", { name: /Portfolio/ }));
    expect(await screen.findByTestId("ppm-portfolio")).toBeInTheDocument();
    expect(screen.getByTestId("search")).toHaveTextContent("?groupBy=Organization");
    expect(screen.getByTestId("search")).not.toHaveTextContent("tab=");
  });
});
