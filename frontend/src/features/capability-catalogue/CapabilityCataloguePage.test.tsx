/**
 * The capability catalogue page is the shared catalogue browser configured
 * for capabilities; this pins that configuration.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import type { CatalogueKindConfig } from "@/features/reference-catalogue/types";

const seen: CatalogueKindConfig[] = [];
vi.mock("@/features/reference-catalogue/CataloguePage", () => ({
  default: ({ config }: { config: CatalogueKindConfig }) => {
    seen.push(config);
    return <div>catalogue</div>;
  },
}));

import CapabilityCataloguePage from "./CapabilityCataloguePage";

describe("CapabilityCataloguePage", () => {
  it("browses business capabilities", () => {
    render(<CapabilityCataloguePage />);
    const config = seen.at(-1)!;
    expect(config).toMatchObject({
      kind: "capability",
      basePath: "/capability-catalogue",
      payloadKey: "capabilities",
      idPrefix: "BC-",
      i18nNamespace: "catalogue",
      inventoryCardType: "BusinessCapability",
      accentColor: "#003399",
      selectionColor: "#D63384",
      heroIcon: "account_tree",
    });
  });

  it("calls level 0 Macro and the rest L1, L2, …", () => {
    render(<CapabilityCataloguePage />);
    const { levelLabel } = seen.at(-1)!;
    expect(levelLabel(0)).toBe("Macro");
    expect(levelLabel(1)).toBe("L1");
    expect(levelLabel(5)).toBe("L5");
  });
});
