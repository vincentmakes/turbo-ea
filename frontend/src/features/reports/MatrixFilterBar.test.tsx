/**
 * MatrixFilterBar: the Matrix report's relation filter. Its controls come from
 * the metamodel — a relation-type picker only when several types connect the
 * axes, one filter per flag or select dimension of the types in scope — and
 * every change goes back as a whole new filter state.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FieldDef, RelationType } from "@/types";
import type { MatrixDimension, MatrixValue } from "./matrixDimensions";
import MatrixFilterBar, { type MatrixFilterState } from "./MatrixFilterBar";

const EMPTY: MatrixFilterState = { relationTypes: [], attrValues: {}, direction: "any" };

const rt = (key: string, label: string) =>
  ({ key, label, source_type_key: "App", target_type_key: "Cap" }) as RelationType;

const dim = (
  relationTypeKey: string,
  key: string,
  label: string,
  kind: MatrixDimension["kind"] = "enum",
): MatrixDimension => ({
  id: `${relationTypeKey}.${key}`,
  relationTypeKey,
  field: { key, label, type: kind === "flag" ? "boolean" : "single_select" } as FieldDef,
  kind,
});

const option = (dimensionId: string, optionKey: string, label: string): MatrixValue => ({
  id: `${dimensionId}:${optionKey}`,
  dimensionId,
  relationTypeKey: dimensionId.split(".")[0],
  fieldKey: dimensionId.split(".")[1],
  optionKey,
  kind: "enum",
  code: label[0],
  label,
  color: "#123456",
});

const OWNS = rt("relOwns", "owns");
const USES = rt("relUses", "uses");
const USAGE = dim("relOwns", "usage", "Usage");
const CRITICAL = dim("relOwns", "critical", "Critical", "flag");
const NOTE = dim("relOwns", "note", "Note", "scalar");
const SINCE = dim("relUses", "since", "Since");
const VALUES = [
  option("relOwns.usage", "primary", "Primary"),
  option("relOwns.usage", "backup", "Backup"),
  option("relUses.since", "old", "Old"),
];

type Props = React.ComponentProps<typeof MatrixFilterBar>;

function setup(over: Partial<Props> = {}, initial: MatrixFilterState = EMPTY) {
  const onChange = vi.fn();
  function Harness() {
    const [state, setState] = useState(initial);
    return (
      <MatrixFilterBar
        relationTypes={[OWNS]}
        dimensions={[USAGE, CRITICAL, NOTE]}
        values={VALUES}
        activeCount={0}
        state={state}
        onChange={(next) => {
          onChange(next);
          setState(next);
        }}
        {...over}
      />
    );
  }
  const user = userEvent.setup();
  const view = render(<Harness />);
  return { user, onChange, view };
}

const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0] as MatrixFilterState;
const filterBoxes = () =>
  screen.queryAllByRole("combobox").map((c) => c.closest(".MuiAutocomplete-root")!);
const filterLabels = () =>
  screen
    .queryAllByRole("combobox")
    .map((c) => c.closest(".MuiFormControl-root")!.querySelector("label")!.textContent);

async function pick(user: ReturnType<typeof userEvent.setup>, label: string, choice: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: choice }));
  await user.keyboard("{Escape}");
}

describe("MatrixFilterBar", () => {
  it("renders nothing when no relation type connects the axes", () => {
    const { view } = setup({ relationTypes: [] });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("offers one filter per flag or select dimension, named by its field alone", () => {
    setup();
    expect(screen.getByText("Relation filter")).toBeInTheDocument();
    expect(filterLabels()).toEqual(["Usage", "Critical"]);
    expect(filterBoxes()).toHaveLength(2);
  });

  it("offers a select's options and a flag's yes and no, each after the empty choice", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("combobox", { name: "Usage" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "(empty)",
      "Primary",
      "Backup",
    ]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("combobox", { name: "Critical" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "(empty)",
      "Yes",
      "No",
    ]);
  });

  it("filters by a value, and drops the key once its last value goes", async () => {
    const { user, onChange } = setup();
    await pick(user, "Usage", "Backup");
    expect(last(onChange)).toEqual({ ...EMPTY, attrValues: { "relOwns.usage": ["backup"] } });
    await pick(user, "Critical", "Yes");
    expect(last(onChange).attrValues).toEqual({
      "relOwns.usage": ["backup"],
      "relOwns.critical": ["true"],
    });
    const usage = screen.getByRole("combobox", { name: "Usage" }).closest(".MuiAutocomplete-root")!;
    await user.click(within(usage as HTMLElement).getByTestId("CancelIcon"));
    expect(last(onChange).attrValues).toEqual({ "relOwns.critical": ["true"] });
  });

  it("filters by direction, and ignores a click on the one already chosen", async () => {
    const { user, onChange } = setup();
    const any = screen.getByRole("button", { name: "Any direction" });
    const forward = screen.getByRole("button", { name: "Row is the source" });
    const reverse = screen.getByRole("button", { name: "Row is the target" });
    expect(any).toHaveAttribute("aria-pressed", "true");
    await user.click(reverse);
    expect(last(onChange)).toEqual({ ...EMPTY, direction: "reverse" });
    onChange.mockClear();
    await user.click(reverse);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(forward);
    expect(last(onChange).direction).toBe("forward");
    await user.click(any);
    expect(last(onChange).direction).toBe("any");
  });

  it("filters a flag by off as well as on", async () => {
    const { user, onChange } = setup();
    await pick(user, "Critical", "No");
    expect(last(onChange).attrValues).toEqual({ "relOwns.critical": ["false"] });
  });

  describe("with several relation types", () => {
    const several = { relationTypes: [OWNS, USES], dimensions: [USAGE, CRITICAL, NOTE, SINCE] };

    it("offers a relation-type filter and names each dimension with its verb", () => {
      setup(several);
      expect(filterLabels()).toEqual([
        "Relation type",
        "owns · Usage",
        "owns · Critical",
        "uses · Since",
      ]);
    });

    it("narrows the attribute filters to the relation types picked", async () => {
      const { user, onChange } = setup(several);
      await pick(user, "Relation type", "uses");
      expect(last(onChange)).toEqual({ ...EMPTY, relationTypes: ["relUses"] });
      expect(filterLabels()).toEqual(["Relation type", "uses · Since"]);
    });

    it("names a dimension of an unknown relation type by its field", () => {
      setup(
        { ...several, dimensions: [dim("relGone", "x", "Ghost")] },
        {
          ...EMPTY,
          relationTypes: ["relGone"],
        },
      );
      expect(filterLabels()).toEqual(["Relation type", "Ghost"]);
    });
  });

  it("shows three filters until asked for the rest", async () => {
    const dims = ["a", "b", "c", "d", "e"].map((k) => dim("relOwns", k, k.toUpperCase()));
    const { user } = setup({ dimensions: dims });
    expect(filterLabels()).toEqual(["A", "B", "C"]);
    await user.click(screen.getByText("+2 more"));
    expect(filterLabels()).toEqual(["A", "B", "C", "D", "E"]);
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  it("shows no more-chip when everything fits", () => {
    const dims = ["a", "b", "c"].map((k) => dim("relOwns", k, k.toUpperCase()));
    setup({ dimensions: dims });
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  it("counts the active filters and clears them all", async () => {
    const { user, onChange } = setup(
      { activeCount: 2 },
      {
        relationTypes: ["relOwns"],
        attrValues: { "relOwns.usage": ["primary"] },
        direction: "forward",
      },
    );
    expect(screen.getByText("2 filters active")).toBeInTheDocument();
    await user.click(screen.getByText("Clear all"));
    expect(last(onChange)).toEqual(EMPTY);
  });

  it("says one filter is active", () => {
    setup({ activeCount: 1 });
    expect(screen.getByText("1 filter active")).toBeInTheDocument();
  });

  it("offers no clear when no filter is active", () => {
    setup();
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
    expect(screen.queryByText(/active$/)).not.toBeInTheDocument();
  });
});
