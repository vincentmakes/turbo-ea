import { render, screen } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { brand } from "@/theme";
import SponsorshipDialog from "./SponsorshipDialog";

/** The declarations emotion emitted for `el`'s classes under `:hover`, whitespace stripped. */
function hoverCss(el: Element): string {
  const css = Array.from(document.querySelectorAll("style"), (s) => s.textContent).join("");
  return Array.from(el.classList)
    .flatMap((cls) => Array.from(css.matchAll(new RegExp(`\\.${cls}:hover\\{([^}]*)\\}`, "g")), (m) => m[1]))
    .join(";")
    .replace(/\s/g, "");
}

// A theme whose contained buttons would otherwise be black on the gradient.
const darkText = createTheme({ palette: { primary: { main: "#ffeb3b", contrastText: "#000" } } });

describe("SponsorshipDialog colours", () => {
  it.each(["sponsorship.oneTime", "sponsorship.monthly"])(
    "paints the %s button white on the sponsor gradient, dimmed on hover",
    (key) => {
      render(
        <ThemeProvider theme={darkText}>
          <SponsorshipDialog open onClose={() => {}} />
        </ThemeProvider>,
      );
      const label = i18n.t(key, { ns: "nav" }) as string;
      const button = screen.getByRole("link", { name: (name) => name.endsWith(label) });
      expect(button).toHaveStyle({ color: darkText.palette.common.white });
      const gradient = `linear-gradient(135deg,${brand.sponsorFrom},${brand.sponsorTo})`;
      expect(hoverCss(button)).toContain(`background:${gradient}`);
      expect(hoverCss(button)).toContain("filter:brightness(0.95)");
    },
  );
});
