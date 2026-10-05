/**
 * The AI suggestion panel is a pure presenter: it renders whatever the
 * `/ai/suggest` response carried, lets the user edit the description and
 * override extra field suggestions, and hands the result to `onApply`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeField, makeOption, makeSection } from "@/test/fixtures/metamodel";
import type { AiSuggestResponse, SectionDef } from "@/types";
import AiSuggestPanel from "./AiSuggestPanel";

const SCHEMA: SectionDef[] = [
  makeSection({
    section: "Business",
    fields: [
      makeField({ key: "isCloud", label: "Cloud Hosted", type: "boolean" }),
      makeField({
        key: "criticality",
        label: "Criticality",
        type: "single_select",
        options: [
          makeOption({ key: "high", label: "High" }),
          makeOption({ key: "low", label: "Low" }),
        ],
      }),
    ],
  }),
];

const DESCRIPTION_ONLY: AiSuggestResponse = {
  suggestions: {
    description: { value: "An ERP system of record.", confidence: 0.85, source: "vendor site" },
  },
  sources: [
    { title: "SAP", url: "https://sap.example" },
    { title: "Wikipedia" },
    { url: "https://untitled.example" },
  ],
  model: "gemma3:4b",
};

const WITH_FIELDS: AiSuggestResponse = {
  suggestions: {
    description: { value: "A CRM.", confidence: 0.6 },
    isCloud: { value: true, confidence: 0.3 },
    criticality: { value: "high", confidence: 0.9 },
    unknownField: { value: 42, confidence: 0.5 },
  },
  sources: [],
};

function renderPanel(props: Partial<React.ComponentProps<typeof AiSuggestPanel>> = {}) {
  const onApply = vi.fn();
  const onDismiss = vi.fn();
  const utils = render(
    <AiSuggestPanel
      response={DESCRIPTION_ONLY}
      loading={false}
      error=""
      onApply={onApply}
      onDismiss={onDismiss}
      {...props}
    />,
  );
  return { ...utils, onApply, onDismiss };
}

describe("AiSuggestPanel", () => {
  it("shows the searching state while loading", () => {
    renderPanel({ loading: true, response: null });
    expect(screen.getByText("Generating description...")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
  });

  it("shows the error with a Close button that dismisses", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderPanel({ error: "Provider unreachable", response: null });
    expect(screen.getByText("AI Suggestion Failed")).toBeInTheDocument();
    expect(screen.getByText("Provider unreachable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a response or without any suggestion", () => {
    const { container, rerender } = renderPanel({ response: null });
    expect(container).toBeEmptyDOMElement();
    rerender(
      <AiSuggestPanel
        response={{ suggestions: {}, sources: [] }}
        loading={false}
        error=""
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the description with its confidence, source, model and sources", () => {
    renderPanel();
    expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("vendor site")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("An ERP system of record.");
    expect(screen.getByText("gemma3:4b")).toBeInTheDocument();
    // A source with a URL is a new-tab link; one without is plain text; one
    // without a title is dropped.
    const link = screen.getByRole("link", { name: "SAP" });
    expect(link).toHaveAttribute("href", "https://sap.example");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/Wikipedia/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /untitled/ })).not.toBeInTheDocument();
  });

  it("applies the edited description and no fields", async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel();
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "Edited text");
    await user.click(screen.getByRole("button", { name: /Apply description/ }));
    expect(onApply).toHaveBeenCalledWith({ description: "Edited text", fields: undefined });
  });

  it("disables Apply once the description is emptied", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.clear(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: /Apply description/ })).toBeDisabled();
  });

  it("calls onDismiss from the Dismiss button", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders extra field suggestions from the schema and applies overrides", async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel({ response: WITH_FIELDS, fieldsSchema: SCHEMA });

    // Medium / Low / High confidence badges all render.
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("Cloud Hosted")).toBeInTheDocument();
    expect(screen.getByText("Criticality")).toBeInTheDocument();
    // A suggestion for a key the schema does not carry gets no editor.
    expect(screen.queryByText("unknownField")).not.toBeInTheDocument();

    // Boolean: starts "Yes", switch flips it to "No".
    expect(screen.getByText("Yes")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByText("No")).toBeInTheDocument();

    // Single select: change High → Low.
    const select = screen.getByRole("combobox");
    expect(select).toHaveTextContent("High");
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Low" }));

    await user.click(screen.getByRole("button", { name: /Apply suggestions/ }));
    expect(onApply).toHaveBeenCalledWith({
      description: "A CRM.",
      // The unknown key is still forwarded with the suggested value.
      fields: { isCloud: false, criticality: "low", unknownField: 42 },
    });
  });

  it("renders only the extra fields when there is no description suggestion", () => {
    renderPanel({
      response: { suggestions: { isCloud: { value: false, confidence: 0.7 } }, sources: [] },
      fieldsSchema: SCHEMA,
    });
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.getByText("Cloud Hosted")).toBeInTheDocument();
    // Without a description there is nothing to require, so Apply stays enabled.
    expect(screen.getByRole("button", { name: /Apply suggestions/ })).toBeEnabled();
  });

  it("drops the edits when a new response arrives", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "Edited");
    rerender(
      <AiSuggestPanel
        response={{ ...DESCRIPTION_ONLY, suggestions: { description: { value: "Fresh", confidence: 0.5 } } }}
        loading={false}
        error=""
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("Fresh");
    const panel = screen.getByText("AI Suggestions").closest(".MuiPaper-root") as HTMLElement;
    expect(within(panel).getByText("50%")).toBeInTheDocument();
  });
});

describe("AiSuggestPanel — details", () => {
  it("explains the wait while loading", () => {
    renderPanel({ loading: true, response: null });
    expect(
      screen.getByText(
        "Searching the web and generating a description with AI. This may take a few seconds.",
      ),
    ).toBeInTheDocument();
  });

  it("names each confidence chip with its percentage", () => {
    renderPanel({
      response: {
        ...WITH_FIELDS,
        suggestions: {
          ...WITH_FIELDS.suggestions,
          isCloud: { value: true, confidence: 0.3, source: "inventory scan" },
        },
      },
      fieldsSchema: SCHEMA,
    });
    // MUI hands a string tooltip title to its child as the accessible name.
    expect(screen.getByLabelText("Confidence: 60%")).toHaveTextContent("60%");
    expect(screen.getByLabelText("Confidence: 30%")).toHaveTextContent("30%");
    expect(screen.getByLabelText("Confidence: 90%")).toHaveTextContent("90%");
    // An extra field's own source is shown next to it.
    expect(screen.getByText("inventory scan")).toBeInTheDocument();
  });

  it("forwards extra suggestions without editors when no schema is given", async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel({ response: WITH_FIELDS });
    expect(screen.queryByText("Cloud Hosted")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apply suggestions/ }));
    expect(onApply).toHaveBeenCalledWith({
      description: "A CRM.",
      fields: { isCloud: true, criticality: "high", unknownField: 42 },
    });
  });

  it("drops field overrides when a new response arrives", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const { rerender } = render(
      <AiSuggestPanel
        response={WITH_FIELDS}
        loading={false}
        error=""
        onApply={onApply}
        onDismiss={vi.fn()}
        fieldsSchema={SCHEMA}
      />,
    );
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByText("No")).toBeInTheDocument();
    rerender(
      <AiSuggestPanel
        response={{ ...WITH_FIELDS }}
        loading={false}
        error=""
        onApply={onApply}
        onDismiss={vi.fn()}
        fieldsSchema={SCHEMA}
      />,
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    await user.click(screen.getByRole("button", { name: /Apply suggestions/ }));
    expect(onApply).toHaveBeenCalledWith({
      description: "A CRM.",
      fields: { isCloud: true, criticality: "high", unknownField: 42 },
    });
  });

  it("renders nothing for a response that carries no suggestions object", () => {
    const { container } = renderPanel({
      response: { sources: [], model: "gemma3:4b" } as unknown as AiSuggestResponse,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the titled sources comma-separated, at most five", () => {
    renderPanel({
      response: {
        ...DESCRIPTION_ONLY,
        sources: [
          { title: "One", url: "https://one.example" },
          { url: "https://untitled.example" },
          { title: "Two" },
          { title: "Three" },
          { title: "Four" },
          { title: "Five" },
          { title: "Six" },
        ],
      },
    });
    const line = screen.getByText(/^Sources:/);
    expect(line.textContent).toBe("Sources: One, Two, Three, Four, Five");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("prints the sources line exactly for the default response", () => {
    renderPanel();
    expect(screen.getByText(/^Sources:/).textContent).toBe("Sources: SAP, Wikipedia");
  });

  it("shows the sources without a model chip when no model is reported", () => {
    renderPanel({ response: { ...DESCRIPTION_ONLY, model: undefined } });
    expect(screen.getByText(/^Sources:/)).toBeInTheDocument();
    // The model chip carries the smart_toy glyph.
    expect(screen.queryByText("smart_toy")).not.toBeInTheDocument();
  });

  it("shows the model chip without a sources line when there are no sources", () => {
    const { rerender } = renderPanel({
      response: { ...DESCRIPTION_ONLY, sources: [] },
    });
    expect(screen.getByText("gemma3:4b")).toBeInTheDocument();
    expect(screen.getByText("smart_toy")).toBeInTheDocument();
    expect(screen.queryByText(/Sources/)).not.toBeInTheDocument();

    // A response without any sources array at all is tolerated the same way.
    rerender(
      <AiSuggestPanel
        response={{ ...DESCRIPTION_ONLY, sources: undefined } as unknown as AiSuggestResponse}
        loading={false}
        error=""
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("gemma3:4b")).toBeInTheDocument();
    expect(screen.queryByText(/Sources/)).not.toBeInTheDocument();
  });

  it("shows neither model nor sources when the response reports none", () => {
    renderPanel({ response: { ...DESCRIPTION_ONLY, sources: [], model: undefined } });
    expect(screen.queryByText("smart_toy")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sources/)).not.toBeInTheDocument();
    // Nothing renders a stray "0" for the empty sources list.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("keeps Apply disabled for a whitespace-only description", async () => {
    const user = userEvent.setup();
    renderPanel();
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "   ");
    expect(screen.getByRole("button", { name: /Apply description/ })).toBeDisabled();
  });

  it("offers a select only for a single_select field that has options", () => {
    const schema: SectionDef[] = [
      makeSection({
        fields: [
          makeField({ key: "tier", label: "Tier", type: "single_select" }),
          makeField({
            key: "isCloud",
            label: "Cloud Hosted",
            type: "boolean",
            options: [makeOption({ key: "x", label: "X" })],
          }),
        ],
      }),
    ];
    renderPanel({
      response: {
        suggestions: {
          tier: { value: "gold", confidence: 0.7 },
          isCloud: { value: true, confidence: 0.7 },
        },
        sources: [],
      },
      fieldsSchema: schema,
    });
    expect(screen.getByText("Tier")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

