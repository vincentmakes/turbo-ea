/**
 * BpmnTemplateChooser: list the starter templates when opened, hand the
 * chosen one's XML to the caller, or read a .bpmn file the user imports.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import type { BpmnTemplate } from "@/types";
import BpmnTemplateChooser from "./BpmnTemplateChooser";

const TEMPLATES: BpmnTemplate[] = [
  { key: "blank", name: "Blank", description: "Start from scratch", category: "basic" },
  { key: "order-to-cash", name: "Order to Cash", description: "Sell and bill", category: "core" },
  { key: "custom-thing", name: "Custom", description: "No icon of its own", category: "x" },
];

function renderChooser(open = true) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const view = render(<BpmnTemplateChooser open={open} onClose={onClose} onSelect={onSelect} />);
  return { user, onClose, onSelect, view };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/bpm/templates", TEMPLATES);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("BpmnTemplateChooser", () => {
  it("fetches nothing while closed", () => {
    renderChooser(false);
    expect(mockApi.callsOf("get")).toEqual([]);
  });

  it("fetches when a mounted, closed chooser is opened", async () => {
    const { view, onClose, onSelect } = renderChooser(false);
    view.rerender(<BpmnTemplateChooser open onClose={onClose} onSelect={onSelect} />);
    expect(await screen.findByText("Blank")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/bpm/templates")).toHaveLength(1);
  });

  it("lists the templates with their icons once opened", async () => {
    renderChooser();
    expect(screen.getByRole("dialog", { name: "Start your process diagram" })).toBeVisible();
    expect(await screen.findByText("Order to Cash")).toBeInTheDocument();
    expect(screen.getByText("Sell and bill")).toBeInTheDocument();
    expect(screen.getByText("note_add")).toBeInTheDocument(); // blank
    expect(screen.getByText("shopping_cart")).toBeInTheDocument(); // order-to-cash
    expect(screen.getByText("description")).toBeInTheDocument(); // unknown key
  });

  it("creates from the picked template's XML", async () => {
    mockApi.on("get", "/bpm/templates/order-to-cash", {
      ...TEMPLATES[1],
      bpmn_xml: "<definitions id='o2c' />",
    });
    const { user, onSelect } = renderChooser();
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    await user.click(await screen.findByText("Order to Cash"));
    expect(create).toBeEnabled();
    await user.click(create);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("<definitions id='o2c' />"));
  });

  it("hands nothing over for a template without XML", async () => {
    mockApi.on("get", "/bpm/templates/blank", TEMPLATES[0]);
    const { user, onSelect } = renderChooser();
    await user.click(await screen.findByText("Blank"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsOf("get", "/bpm/templates/blank")).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeEnabled());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows loading while the template comes and recovers from a failure", async () => {
    let fail!: (e: Error) => void;
    mockApi.on(
      "get",
      "/bpm/templates/blank",
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    const { user, onSelect } = renderChooser();
    await user.click(await screen.findByText("Blank"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("button", { name: "Loading..." })).toBeDisabled();
    fail(new Error("gone"));
    expect(await screen.findByRole("button", { name: "Create" })).toBeEnabled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Failed to load template:", expect.any(Error));
  });

  it("logs a failed template list and shows none", async () => {
    mockApi.reset();
    mockApi.fail("get", "/bpm/templates");
    renderChooser();
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.queryByText("Blank")).not.toBeInTheDocument();
  });

  it("imports a .bpmn or .xml file the user picks", async () => {
    const realCreate = document.createElement.bind(document);
    let input: HTMLInputElement | undefined;
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "input") {
        input = el as HTMLInputElement;
        vi.spyOn(input, "click").mockImplementation(() => {});
      }
      return el;
    });
    const { user, onSelect } = renderChooser();
    await user.click(screen.getByRole("button", { name: /Import existing BPMN file/ }));
    spy.mockRestore();
    expect(input).toBeDefined();
    expect(input!.type).toBe("file");
    expect(input!.accept).toBe(".bpmn,.xml");
    expect(input!.click).toHaveBeenCalled();

    // Nothing picked: nothing handed over.
    Object.defineProperty(input!, "files", { value: [], configurable: true });
    await input!.onchange!({ target: input } as unknown as Event);
    expect(onSelect).not.toHaveBeenCalled();

    // jsdom's File has no text(); the component only reads that.
    const file = { name: "mine.bpmn", text: async () => "<definitions id='mine' />" };
    Object.defineProperty(input!, "files", { value: [file], configurable: true });
    await input!.onchange!({ target: input } as unknown as Event);
    expect(onSelect).toHaveBeenCalledWith("<definitions id='mine' />");
  });

  it("closes on Cancel", async () => {
    const { user, onClose } = renderChooser();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
