/**
 * Field labels are static — UI_GUIDELINES.md §3.5.
 *
 * The theme floats every InputLabel and keeps every outlined notch open, so
 * the outline never has to re-open after mount (the WebKit relayout bug that
 * drew the border through a label whose value arrived asynchronously —
 * mui/material-ui#44988, #46891). These tests pin the theme defaults, prove
 * they reach the three shapes the app uses (TextField, multiline TextField,
 * hand-composed FormControl + InputLabel + Select), keep the explicit opt-out
 * working, and scan the source so nobody re-introduces a per-field
 * `shrink` / `notched` pin — the theme is the only owner of label placement.
 */
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { buildTheme } from "./index";

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);
}

function labelOf(container: HTMLElement) {
  const label = container.querySelector("label");
  expect(label).not.toBeNull();
  return label as HTMLLabelElement;
}

function notchTextOf(container: HTMLElement) {
  const span = container.querySelector(".MuiOutlinedInput-notchedOutline legend > span");
  expect(span).not.toBeNull();
  return (span as HTMLElement).textContent;
}

describe("static field labels (theme defaults)", () => {
  it.each(["light", "dark"] as const)("%s theme floats labels and notches outlines", (mode) => {
    const theme = buildTheme(mode);
    expect(theme.components?.MuiInputLabel?.defaultProps?.shrink).toBe(true);
    expect(theme.components?.MuiOutlinedInput?.defaultProps?.notched).toBe(true);
  });

  it("floats the label of an EMPTY TextField and sizes the notch by its text", () => {
    const { container } = renderWithTheme(
      <TextField label="Description" value="" onChange={() => {}} />,
    );
    expect(labelOf(container).getAttribute("data-shrink")).toBe("true");
    expect(notchTextOf(container)).toBe("Description");
  });

  it("does the same for an empty multiline TextField (the Safari trigger)", () => {
    const { container } = renderWithTheme(
      <TextField label="Description" multiline minRows={2} value="" onChange={() => {}} />,
    );
    expect(labelOf(container).getAttribute("data-shrink")).toBe("true");
    expect(notchTextOf(container)).toBe("Description");
  });

  it("does the same for a hand-composed FormControl + InputLabel + Select", () => {
    const { container } = renderWithTheme(
      <FormControl>
        <InputLabel>Kind</InputLabel>
        <Select label="Kind" value="" displayEmpty onChange={() => {}}>
          <MenuItem value="">All</MenuItem>
        </Select>
      </FormControl>,
    );
    expect(labelOf(container).getAttribute("data-shrink")).toBe("true");
    expect(notchTextOf(container)).toBe("Kind");
  });

  it("keeps the explicit per-field opt-out working (a default, not a lock)", () => {
    const { container } = renderWithTheme(
      <TextField
        label="Search"
        value=""
        onChange={() => {}}
        slotProps={{ inputLabel: { shrink: false } }}
      />,
    );
    expect(labelOf(container).getAttribute("data-shrink")).toBe("false");
  });
});

describe("no per-field shrink / notched pins in src", () => {
  const SRC = path.resolve(__dirname, "..");
  const THEME = path.resolve(__dirname, "index.ts");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full, out);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  // `<InputLabel shrink>`, `InputLabelProps={{ shrink: … }}`,
  // `slotProps={{ inputLabel: { shrink: … } }}`, `shrink={cond}` and any
  // `notched` prop. A literal `shrink: false` / `shrink={false}` is the
  // sanctioned opt-out and passes. Prose ("shrink on xs") and the CSS class
  // `.MuiInputLabel-shrink` do not match.
  const PIN =
    /<InputLabel\b[^>]*\bshrink\b(?!\s*=\s*\{?\s*false\b)|\bshrink\s*[:=]\s*(?!\{?\s*false\b)|\bnotched\b/s;

  it("the theme is the only place label placement is decided", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file === THEME) continue;
      const source = fs.readFileSync(file, "utf8");
      const match = PIN.exec(source);
      if (match) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${path.relative(SRC, file)}:${line}: ${match[0].trim()}`);
      }
    }
    expect(
      offenders,
      "Per-field `shrink` / `notched` pins are not allowed: the theme floats every label " +
        "and notches every outline (UI_GUIDELINES.md §3.5). Remove the pin; if a field " +
        "genuinely needs a label inside the box, opt out with " +
        "`slotProps={{ inputLabel: { shrink: false } }}` and say why.",
    ).toEqual([]);
  });
});
