import { describe, expect, it } from "vitest";
import { NAMES_SEPARATOR, VIA_MORE_MARK, viaCellText } from "./matchedCells";

describe("viaCellText", () => {
  it("is empty without a cell or cards", () => {
    expect(viaCellText(undefined)).toBe("");
    expect(viaCellText({ cards: [], more: true })).toBe("");
  });

  it("joins the names as the server ordered them", () => {
    expect(NAMES_SEPARATOR).toBe("; ");
    expect(
      viaCellText({
        cards: [
          { id: "a", name: "CRM" },
          { id: "b", name: "ERP" },
        ],
        more: false,
      }),
    ).toBe("CRM; ERP");
  });

  it("ends with the more mark when the list was cut", () => {
    expect(VIA_MORE_MARK).toBe("…");
    expect(viaCellText({ cards: [{ id: "a", name: "CRM" }], more: true })).toBe("CRM; …");
  });
});
