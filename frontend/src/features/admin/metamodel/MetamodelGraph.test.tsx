import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { invalidateCardTypeCategories } from "@/hooks/useCardTypeCategories";
import { makeCardType } from "@/test/fixtures/metamodel";
import type { CardTypeCategory } from "@/types";
import MetamodelGraph from "./MetamodelGraph";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const cat = (over: Partial<CardTypeCategory> & { key: string }): CardTypeCategory => ({
  id: over.key,
  label: over.key,
  color: "#999999",
  sort_order: 0,
  built_in: false,
  translations: {},
  ...over,
});

const TYPES = [
  makeCardType({ key: "Application", label: "Application", category: "Application & Data" }),
  makeCardType({ key: "Firewall", label: "Firewall", category: "Security" }),
  makeCardType({ key: "Objective", label: "Objective", category: "Strategy & Transformation" }),
  makeCardType({ key: "Loose", label: "Loose", category: null }),
  makeCardType({ key: "Ghost", label: "Ghost", category: "Security", is_hidden: true }),
];

/** The layer labels, top to bottom. */
function layerLabels(): string[] {
  return Array.from(document.querySelectorAll('svg > g > text[x="16"]')).map((n) => n.textContent ?? "");
}

beforeEach(() => {
  mockApi.reset();
});

afterEach(() => {
  invalidateCardTypeCategories([]);
});

describe("MetamodelGraph layers", () => {
  it("gives a custom category its own layer, in registry order", () => {
    invalidateCardTypeCategories([
      cat({ key: "Strategy & Transformation", sort_order: 0, built_in: true }),
      cat({ key: "Security", label: "Security Layer", sort_order: 1 }),
      cat({ key: "Application & Data", sort_order: 2, built_in: true }),
    ]);
    render(<MetamodelGraph types={TYPES} relationTypes={[]} onNodeClick={() => {}} />);
    expect(layerLabels()).toEqual([
      "Strategy & Transformation",
      "Security Layer",
      "Application & Data",
      "Uncategorized",
    ]);
    // Hidden types are not drawn.
    expect(screen.queryByText("Ghost")).not.toBeInTheDocument();
  });

  it("translates the layer names", async () => {
    invalidateCardTypeCategories([
      cat({
        key: "Application & Data",
        sort_order: 0,
        built_in: true,
        translations: { fr: "Application et données" },
      }),
    ]);
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    try {
      render(
        <MetamodelGraph types={TYPES.slice(0, 1)} relationTypes={[]} onNodeClick={() => {}} />,
      );
      expect(layerLabels()).toEqual(["Application et données"]);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("falls back to the built-in order without a registry, keeping unknown layers", () => {
    invalidateCardTypeCategories([]);
    render(<MetamodelGraph types={TYPES} relationTypes={[]} onNodeClick={() => {}} />);
    expect(layerLabels()).toEqual([
      "Strategy & Transformation",
      "Application & Data",
      "Security",
      "Uncategorized",
    ]);
  });

  it("says so when there is nothing to draw", () => {
    render(<MetamodelGraph types={[]} relationTypes={[]} onNodeClick={() => {}} />);
    expect(screen.getByText(i18n.t("admin:metamodel.graph.noTypes"))).toBeInTheDocument();
  });
});
