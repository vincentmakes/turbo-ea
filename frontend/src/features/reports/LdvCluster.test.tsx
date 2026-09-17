/**
 * The box a group of cards sits in when relations are aggregated.
 *
 * Only the box is mounted, never `LayeredDependencyView`: React Flow cannot lay
 * out under jsdom, and none of what matters here — the title, the count, the
 * card type's own glyph and colour — depends on it. Its handles read React
 * Flow's store, so they are stubbed, exactly as `LdvNode.test.tsx` does.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CardType } from "@/types";
import type { LdvClusterData } from "./ldvAggregate";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  Handle: () => null,
}));

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));

import { useMetamodel } from "@/hooks/useMetamodel";
import LdvCluster from "./LdvCluster";

const APP_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  category: "Application & Data",
  subtypes: [{ key: "microservice", label: "Microservice" }],
  translations: {},
} as unknown as CardType;

beforeEach(() => {
  vi.mocked(useMetamodel).mockReturnValue({
    types: [APP_TYPE],
    relationTypes: [],
    loading: false,
  } as unknown as ReturnType<typeof useMetamodel>);
});

function makeData(overrides: Partial<LdvClusterData> = {}): LdvClusterData {
  return {
    groupKey: "cluster:type:Application",
    label: "Application",
    color: "#0f7eb5",
    icon: "apps",
    category: "Application & Data",
    count: 8,
    memberIds: ["a1", "a2"],
    typeKey: "Application",
    ...overrides,
  };
}

function renderCluster(data: Partial<LdvClusterData> = {}) {
  return render(
    <LdvCluster
      id={makeData(data).groupKey}
      type="ldvCluster"
      data={makeData(data)}
      selected={false}
      zIndex={0}
      isConnectable={false}
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      dragging={false}
      {...({} as never)}
    />,
  );
}

describe("LdvCluster", () => {
  it("titles the box with its group and how many cards it holds", () => {
    renderCluster();
    expect(screen.getByText("Application (8)")).toBeInTheDocument();
  });

  it("names the subtype alongside its type when grouping by subtype", () => {
    renderCluster({ subtypeKey: "microservice", count: 3 });
    expect(screen.getByText("Application · Microservice (3)")).toBeInTheDocument();
  });

  it("carries the card type's own glyph, as its cards do", () => {
    const { container } = renderCluster();
    expect(container.textContent).toContain("apps");
  });

  it("drops the glyph from image exports, which cannot embed the icon font", () => {
    const { container } = renderCluster();
    expect(container.querySelector(".ldv-type-icon")).not.toBeNull();
  });

  it("falls back to the builder's own label for a type no longer in the metamodel", () => {
    renderCluster({ typeKey: "Ghost", label: "Ghost", count: 1 });
    expect(screen.getByText("Ghost (1)")).toBeInTheDocument();
  });

  it("uses the layer name when grouping by layer, where there is no card type", () => {
    renderCluster({
      groupKey: "cluster:layer:Application & Data",
      label: "Application & Data",
      typeKey: undefined,
      count: 12,
    });
    expect(screen.getByText("Application & Data (12)")).toBeInTheDocument();
  });
});
