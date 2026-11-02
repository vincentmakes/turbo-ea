/**
 * CardTypePill fills itself with the card type's own colour, and falls back to
 * a neutral grey for a type the metamodel no longer has.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTheme } from "@mui/material/styles";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import CardTypePill from "./CardTypePill";

const APP = makeCardType({ key: "Application", label: "Application", color: "#123456" });

beforeEach(() => {
  hookState.reset();
  withMetamodel([APP]);
});

describe("CardTypePill", () => {
  it.each([
    ["a known type in its own colour", "Application", "Application", APP.color],
    ["an unknown type in grey, under its raw key", "Ghost", "Ghost", createTheme().palette.grey[600]],
  ])("fills %s", (_label, typeKey, text, colour) => {
    render(<CardTypePill typeKey={typeKey} />);
    expect(screen.getByText(text).closest(".MuiChip-root")).toHaveStyle({ backgroundColor: colour });
  });
});
