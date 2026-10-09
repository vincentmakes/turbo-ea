/**
 * CreateCardDialog regressions: an AI suggestion still in flight when the
 * dialog closes, or when another type, name or subtype is picked, belongs to
 * the session and card that asked for it, and must not land after them; the
 * type picker is named by its label; and a failed end-of-life auto-search
 * clears once a search for the current name succeeds.
 *
 * `EolLinkDialog`, `VendorField` and `TagPicker` are stubbed down to the
 * callbacks the dialog wires — each has its own tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

vi.mock("@/hooks/useAiStatus", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus");
  return {
    ...actual,
    useAiStatus: () => ({
      aiStatus: { enabled: true, configured: true, enabled_types: [], running_models: [] },
      loaded: true,
    }),
  };
});

vi.mock("@/components/EolLinkSection", () => ({ EolLinkDialog: () => null }));
vi.mock("@/components/VendorField", () => ({ default: () => null }));
vi.mock("@/components/TagPicker", () => ({ default: () => null }));

import CreateCardDialog from "./CreateCardDialog";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeSubtype } from "@/test/fixtures/metamodel";
import { wrapWithProviders } from "@/test/render";

const APP = makeCardType({ key: "Application", label: "Application" });
const ITC = makeCardType({ key: "ITComponent", label: "IT Component" });

const onClose = vi.fn();
const onCreate = vi.fn<ComponentProps<typeof CreateCardDialog>["onCreate"]>(async () => "new-id");

function dialog(open: boolean, initialType = "Application") {
  return wrapWithProviders(
    <CreateCardDialog open={open} onClose={onClose} onCreate={onCreate} initialType={initialType} />,
  );
}

function renderDialog(initialType = "Application") {
  const user = userEvent.setup();
  const r = render(dialog(true, initialType));
  return { ...r, user, setOpen: (open: boolean) => r.rerender(dialog(open, initialType)) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const nameBox = () => screen.getByRole("textbox", { name: /^Name/ });
const suggestButton = () => screen.queryByRole("button", { name: /Suggest with AI/ });

/** MUI's Select does not name its combobox after the InputLabel; go via the label. */
function typeSelect(): HTMLElement {
  const formControl = screen.getByText("Type", { selector: "label" }).closest(".MuiFormControl-root");
  return within(formControl as HTMLElement).getByRole("combobox");
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  onClose.mockClear();
  onCreate.mockReset();
  onCreate.mockImplementation(async () => "new-id");
  withMetamodel([APP, ITC]);
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/eol\/products\/fuzzy/, []);
});

describe("CreateCardDialog — an AI suggestion from a closed session", () => {
  it("does not land in the dialog once it has been closed and reopened", async () => {
    const reply = deferred<unknown>();
    mockApi.on("post", "/ai/suggest", () => reply.promise);
    const { user, setOpen } = renderDialog();
    fireEvent.change(nameBox(), { target: { value: "Salesforce" } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();

    setOpen(false);
    setOpen(true);
    await act(async () => {
      reply.resolve({
        suggestions: { description: { value: "A CRM platform.", confidence: 0.9 } },
        sources: [],
      });
    });

    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("Generating description...")).not.toBeInTheDocument();
    // The new session is free to ask for its own suggestion.
    fireEvent.change(nameBox(), { target: { value: "Workday" } });
    expect(suggestButton()).toBeInTheDocument();
  });

  it("does not show its failure in the next session either", async () => {
    const reply = deferred<unknown>();
    mockApi.on("post", "/ai/suggest", () => reply.promise);
    const { user, setOpen } = renderDialog();
    fireEvent.change(nameBox(), { target: { value: "Salesforce" } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();

    setOpen(false);
    setOpen(true);
    await act(async () => {
      reply.reject(new Error("LLM timed out"));
    });

    expect(screen.queryByText("AI Suggestion Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("LLM timed out")).not.toBeInTheDocument();
  });

  // Closing alone ends the session: a reply that lands while the dialog is
  // still fading out must not pop into it. (Reopening resets the name, so the
  // name's own cancel covers a reply still pending at the reopen; this is the
  // one moment only the close can cover.)
  it("does not land in the dialog while it fades out after closing", async () => {
    const reply = deferred<unknown>();
    mockApi.on("post", "/ai/suggest", () => reply.promise);
    const { user, setOpen } = renderDialog();
    fireEvent.change(nameBox(), { target: { value: "Salesforce" } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();

    // Hold the exit transition's timer, so the closing dialog stays mounted
    // for as long as the test looks at it, however slow the run.
    vi.useFakeTimers();
    try {
      setOpen(false);
      await act(async () => {
        reply.resolve({
          suggestions: { description: { value: "A CRM platform.", confidence: 0.9 } },
          sources: [],
        });
      });

      // Still on screen, fading out, with what it held at the close...
      expect(nameBox()).toHaveValue("Salesforce");
      // ...and nothing that arrived after it.
      expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
      expect(screen.queryByText("A CRM platform.")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not end the next session's own suggestion when it lands", async () => {
    const replies = [deferred<unknown>(), deferred<unknown>()];
    let call = 0;
    mockApi.on("post", "/ai/suggest", () => replies[call++].promise);
    const { user, setOpen } = renderDialog();
    fireEvent.change(nameBox(), { target: { value: "Salesforce" } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();

    setOpen(false);
    setOpen(true);
    fireEvent.change(nameBox(), { target: { value: "Workday" } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/ai/suggest")).toHaveLength(2);

    // The first session's reply lands while the second one is still waiting.
    await act(async () => {
      replies[0].resolve({
        suggestions: { description: { value: "A CRM platform.", confidence: 0.9 } },
        sources: [],
      });
    });
    expect(screen.getByText("Generating description...")).toBeInTheDocument();
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();

    await act(async () => {
      replies[1].resolve({
        suggestions: { description: { value: "An HR platform.", confidence: 0.9 } },
        sources: [],
      });
    });
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.getByText("An HR platform.")).toBeInTheDocument();
    expect(screen.queryByText("A CRM platform.")).not.toBeInTheDocument();
  });

  it("still lands the reply of the session that asked for it", async () => {
    const reply = deferred<unknown>();
    mockApi.on("post", "/ai/suggest", () => reply.promise);
    const { user } = renderDialog();
    fireEvent.change(nameBox(), { target: { value: "Salesforce" } });
    await user.click(suggestButton()!);
    await act(async () => {
      reply.resolve({
        suggestions: { description: { value: "A CRM platform.", confidence: 0.9 } },
        sources: [],
      });
    });
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.queryByText("Generating description...")).not.toBeInTheDocument();
  });
});

describe("CreateCardDialog — an AI suggestion for the type picked before", () => {
  async function askThenSwitchType(reply: Promise<unknown>) {
    mockApi.on("post", "/ai/suggest", () => reply);
    const { user } = renderDialog();
    fireEvent.change(nameBox(), { target: { value: "Salesforce" } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();

    await user.click(typeSelect());
    await user.click(await screen.findByRole("option", { name: /IT Component/ }));
    await waitFor(() => expect(typeSelect()).toHaveTextContent("IT Component"));
    return user;
  }

  it("stops waiting for it once another type is picked", async () => {
    await askThenSwitchType(deferred<unknown>().promise);
    await waitFor(() =>
      expect(screen.queryByText("Generating description...")).not.toBeInTheDocument(),
    );
    // The new type may ask for its own suggestion straight away.
    expect(suggestButton()).toBeInTheDocument();
  });

  it("does not land once another type is picked", async () => {
    const reply = deferred<unknown>();
    await askThenSwitchType(reply.promise);
    await act(async () => {
      reply.resolve({
        suggestions: { description: { value: "A CRM platform.", confidence: 0.9 } },
        sources: [],
      });
    });
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("A CRM platform.")).not.toBeInTheDocument();
  });

  it("does not show its failure for the new type either", async () => {
    const reply = deferred<unknown>();
    await askThenSwitchType(reply.promise);
    await act(async () => {
      reply.reject(new Error("LLM timed out"));
    });
    expect(screen.queryByText("AI Suggestion Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("LLM timed out")).not.toBeInTheDocument();
  });
});

describe("CreateCardDialog — an AI suggestion for the name or subtype asked before", () => {
  const SUGGESTION = {
    suggestions: { description: { value: "A CRM platform.", confidence: 0.9 } },
    sources: [],
  };

  async function ask(reply: Promise<unknown>) {
    mockApi.on("post", "/ai/suggest", () => reply);
    const r = renderDialog();
    fireEvent.change(nameBox(), { target: { value: "Salesforce" } });
    await r.user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();
    return r;
  }

  it("does not land once the name has changed", async () => {
    const reply = deferred<unknown>();
    await ask(reply.promise);
    fireEvent.change(nameBox(), { target: { value: "Workday" } });
    await waitFor(() =>
      expect(screen.queryByText("Generating description...")).not.toBeInTheDocument(),
    );
    // The new name may ask for its own suggestion straight away.
    expect(suggestButton()).toBeInTheDocument();

    await act(async () => reply.resolve(SUGGESTION));
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("A CRM platform.")).not.toBeInTheDocument();
  });

  it("does not show its failure for the new name either", async () => {
    const reply = deferred<unknown>();
    await ask(reply.promise);
    fireEvent.change(nameBox(), { target: { value: "Workday" } });
    await act(async () => reply.reject(new Error("LLM timed out")));
    expect(screen.queryByText("AI Suggestion Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("LLM timed out")).not.toBeInTheDocument();
  });

  it("still lands when only spaces around the name changed", async () => {
    // The request asked for the trimmed name, which is still the one typed.
    const reply = deferred<unknown>();
    await ask(reply.promise);
    fireEvent.change(nameBox(), { target: { value: "Salesforce " } });
    await act(async () => reply.resolve(SUGGESTION));
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.getByText("A CRM platform.")).toBeInTheDocument();
  });

  it("does not land once another subtype is picked", async () => {
    withMetamodel([
      makeCardType({
        key: "Application",
        label: "Application",
        subtypes: [makeSubtype({ key: "saas", label: "SaaS" })],
      }),
      ITC,
    ]);
    const reply = deferred<unknown>();
    const { user } = await ask(reply.promise);

    const subtypeControl = screen
      .getByText("Subtype", { selector: "label" })
      .closest(".MuiFormControl-root") as HTMLElement;
    await user.click(within(subtypeControl).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "SaaS" }));
    await waitFor(() =>
      expect(screen.queryByText("Generating description...")).not.toBeInTheDocument(),
    );

    await act(async () => reply.resolve(SUGGESTION));
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("A CRM platform.")).not.toBeInTheDocument();
  });
});

describe("CreateCardDialog — the type picker", () => {
  it("is named by its label", () => {
    renderDialog();
    expect(screen.getByRole("combobox", { name: /^Type/ })).toHaveTextContent("Application");
  });

  it("names the subtype picker and every required select field by its own label", () => {
    withMetamodel([
      makeCardType({
        key: "Application",
        label: "Application",
        subtypes: [makeSubtype({ key: "saas", label: "SaaS" })],
        fields_schema: [
          {
            section: "Details",
            fields: [
              {
                key: "criticality",
                label: "Criticality",
                type: "single_select",
                required: true,
                options: [{ key: "high", label: "High" }],
              },
              {
                key: "hostingModel",
                label: "Hosting Model",
                type: "multiple_select",
                required: true,
                options: [{ key: "cloud", label: "Cloud" }],
              },
            ],
          },
        ],
      }),
      ITC,
    ]);
    renderDialog();
    expect(screen.getByRole("combobox", { name: /^Subtype/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Criticality/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Hosting Model/ })).toBeInTheDocument();
    // Each combobox has a label of its own, not a shared one.
    expect(screen.getAllByRole("combobox", { name: /^Type/ })).toHaveLength(1);
  });
});

describe("CreateCardDialog — a failed end-of-life auto-search", () => {
  it("is cleared by a later search that succeeds", async () => {
    let fail = true;
    mockApi.on("get", /^\/eol\/products\/fuzzy/, (path: string) => {
      if (fail) return Promise.reject(new Error("endoflife.date unreachable"));
      return path.includes("search=Python") ? [{ name: "python", score: 0.9 }] : [];
    });
    const { user } = renderDialog("ITComponent");
    await user.type(nameBox(), "Pyth");
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      "endoflife.date unreachable",
    );

    fail = false;
    await user.type(nameBox(), "on");
    expect(
      await screen.findByText("Suggested matches from endoflife.date:", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("endoflife.date unreachable")).not.toBeInTheDocument();
  });

  it("names a failure that carries no message", async () => {
    mockApi.on("get", /^\/eol\/products\/fuzzy/, () => Promise.reject("offline"));
    const { user } = renderDialog("ITComponent");
    await user.type(nameBox(), "Python");
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      "Failed to fetch EOL data",
    );
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
  });

  it("is not claimed for a name typed after the search that failed", async () => {
    mockApi.on("get", /^\/eol\/products\/fuzzy/, () => Promise.reject(new Error("unreachable")));
    const { user } = renderDialog("ITComponent");
    await user.type(nameBox(), "Python");
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("unreachable");
    fireEvent.change(nameBox(), { target: { value: "Python 3" } });
    await waitFor(() => expect(screen.queryByText("unreachable")).not.toBeInTheDocument());
  });
});
