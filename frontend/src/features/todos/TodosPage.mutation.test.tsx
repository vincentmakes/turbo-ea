/**
 * TodosPage — the branches the main suite runs but does not pin: first paint,
 * the request each control sends, stale replies, the per-row icons, metadata
 * and dates, the view toggles and the Surveys sub-panel's loading and empty
 * states. Every mock uses the `@/` alias.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTheme } from "@mui/material/styles";
import { MemoryRouter, useLocation } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";
import { invalidateDateFormat } from "@/hooks/useDateFormat";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import { brand, STATUS_COLORS } from "@/theme/tokens";
import type { MySurveyItem, Todo } from "@/types";
import { ORIGIN_META } from "@/features/todos/originMeta";
import TodosPage from "./TodosPage";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const PREFS = "turboea.todos.prefs";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface Routes {
  todos?: (query: string) => Todo[] | Promise<Todo[]>;
  surveys?: () => Promise<unknown>;
  badges?: { open_todos: number; pending_surveys: number };
}

function route({ todos = () => [], surveys = () => Promise.resolve([]), badges }: Routes) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/notifications/badge-counts") {
      return (badges ?? { open_todos: 0, pending_surveys: 0 }) as never;
    }
    if (path.startsWith("/todos?")) return (await todos(path.split("?")[1])) as never;
    if (path === "/surveys/my") return (await surveys()) as never;
    return {} as never;
  });
}

function Probe() {
  const loc = useLocation();
  const { section } = usePageTitleSlots();
  return (
    <>
      <div data-testid="location">{loc.pathname + loc.search}</div>
      <div data-testid="page-section">{section?.text ?? ""}</div>
    </>
  );
}

function renderAt(path = "/todos") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TodosPage />
      <Probe />
    </MemoryRouter>,
  );
}

const flat = () =>
  localStorage.setItem(PREFS, JSON.stringify({ sort: "dueDate", grouped: false, collapsed: [] }));
const rowOf = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
const headers = () => screen.getAllByRole("button").filter((el) => el.hasAttribute("aria-expanded"));
const headerOf = (label: string) => headers().find((h) => h.textContent?.includes(label)) as HTMLElement;
const chipOf = (label: string) => screen.getByText(label).closest(".MuiChip-root") as HTMLElement;
const storedPrefs = () => JSON.parse(localStorage.getItem(PREFS) ?? "{}");

const MANUAL: Todo = { id: "m1", description: "Write onboarding doc", status: "open", origin: "manual" };
const RISK: Todo = {
  id: "k1",
  description: "Check access rights",
  status: "open",
  origin: "risk",
  is_system: true,
  link: "/grc/risks/r1",
  creator_name: "Sam Moss",
};
const BPM: Todo = {
  id: "b1",
  description: "Approve process flow",
  status: "open",
  origin: "bpm",
  is_system: true,
  link: "/bpm/processes/p1/flow",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetPageTitle();
  invalidateDateFormat("YYYY-MM-DD");
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.patch).mockResolvedValue({} as never);
});

// ---------------------------------------------------------------------------
// Page frame and first paint
// ---------------------------------------------------------------------------

describe("TodosPage — page frame", () => {
  it("titles the page, shows the badge counts and names the section", async () => {
    route({ todos: () => [MANUAL], badges: { open_todos: 3, pending_surveys: 2 } });
    renderAt();
    expect(screen.getByRole("heading", { name: "My Tasks" })).toBeInTheDocument();
    expect(screen.getByTestId("page-section")).toHaveTextContent("Todos");
    expect(api.get).toHaveBeenCalledWith("/notifications/badge-counts");
    await waitFor(() =>
      expect(within(screen.getByRole("tab", { name: /^Todos/ })).getByText("3")).toBeInTheDocument(),
    );
    expect(within(screen.getByRole("tab", { name: /^Surveys/ })).getByText("2")).toBeInTheDocument();
    expect(await screen.findByText("Write onboarding doc")).toBeInTheDocument();
  });

  it("paints no rows before the list arrives, then asks for the open tasks with an abort signal", async () => {
    const list = deferred<Todo[]>();
    route({ todos: () => list.promise });
    renderAt();

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("tab", { name: "Assigned to me" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "false");
    expect(api.get).toHaveBeenCalledWith(
      "/todos?assigned_only=true&status=open",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    list.resolve([MANUAL, RISK]);
    expect(await screen.findByText("Write onboarding doc")).toBeInTheDocument();
    expect(screen.queryByText("No tasks match the current filters.")).toBeNull();
    expect(screen.queryByText("No todos found.")).toBeNull();
  });

  it("puts a search icon in the search box", async () => {
    route({ todos: () => [MANUAL] });
    renderAt();
    await screen.findByText("Write onboarding doc");
    const box = screen.getByPlaceholderText("Search tasks…").closest(".MuiInputBase-root") as HTMLElement;
    expect(within(box).getByText("search")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

describe("TodosPage — requests", () => {
  it("drops a late reply for a filter the user has already left", async () => {
    const stale = deferred<Todo[]>();
    route({
      todos: (q) =>
        q.includes("status=open")
          ? stale.promise
          : [{ id: "d1", description: "Finished review", status: "done", origin: "manual" }],
    });
    const user = userEvent.setup();
    renderAt();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Finished review")).toBeInTheDocument();

    await act(async () => {
      stale.resolve([MANUAL]);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText("Write onboarding doc")).toBeNull();
    expect(screen.getByText("Finished review")).toBeInTheDocument();
  });

  it("on Created by me, the status toggles drive that tab's own filter", async () => {
    route({ todos: () => [MANUAL] });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    await user.click(screen.getByRole("tab", { name: "Created by me" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/todos?created_only=true&status=open", expect.anything()),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/todos?created_only=true&status=done", expect.anything()),
    );
    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
  });
});

// ---------------------------------------------------------------------------
// Row actions and row state
// ---------------------------------------------------------------------------

describe("TodosPage — row state", () => {
  beforeEach(flat);

  it("completing one task leaves the others alone", async () => {
    route({
      todos: () => [
        { id: "a", description: "First task", status: "open", origin: "manual" },
        { id: "b", description: "Second task", status: "open", origin: "manual" },
      ],
    });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("First task");

    await user.click(within(rowOf("First task")).getByRole("button", { name: /radio_button_unchecked/ }));
    expect(api.patch).toHaveBeenCalledWith("/todos/a", { status: "done" });
    await waitFor(() => expect(rowOf("First task")).toHaveTextContent("check_circle"));
    expect(rowOf("Second task")).toHaveTextContent("radio_button_unchecked");
    expect(rowOf("Second task")).not.toHaveTextContent("check_circle");
  });

  it("activating a scheduled occurrence opens that one only, and it can then be completed", async () => {
    route({
      todos: () => [
        { id: "s", description: "Quarterly review", status: "scheduled", origin: "manual" },
        { id: "d", description: "Old review", status: "done", origin: "manual" },
      ],
    });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Quarterly review");

    await user.click(screen.getByTitle("Activate now"));
    expect(api.post).toHaveBeenCalledWith("/todos/s/promote", {});
    await waitFor(() => expect(rowOf("Quarterly review")).toHaveTextContent("radio_button_unchecked"));
    expect(rowOf("Quarterly review")).not.toHaveTextContent("Scheduled");
    expect(rowOf("Old review")).toHaveTextContent("check_circle");

    await user.click(within(rowOf("Quarterly review")).getByRole("button", { name: /radio_button_unchecked/ }));
    expect(api.patch).toHaveBeenCalledWith("/todos/s", { status: "done" });
  });

  it("draws each manual state with its own icon, colour and strike-through", async () => {
    route({
      todos: () => [
        { id: "s", description: "Upcoming check", status: "scheduled", origin: "manual" },
        { id: "d", description: "Done check", status: "done", origin: "manual" },
        { id: "o", description: "Open check", status: "open", origin: "manual" },
      ],
    });
    renderAt();
    await screen.findByText("Upcoming check");

    expect(screen.getByTitle("Activate now")).toHaveTextContent("event_upcoming");
    expect(rowOf("Upcoming check")).not.toHaveTextContent("radio_button_unchecked");

    const doneIcon = within(rowOf("Done check")).getByText("check_circle");
    expect(doneIcon).toHaveStyle({ color: STATUS_COLORS.success });
    expect(screen.getByText("Done check")).toHaveStyle({ textDecoration: "line-through" });

    const openIcon = within(rowOf("Open check")).getByText("radio_button_unchecked");
    expect(openIcon).toHaveStyle({ color: STATUS_COLORS.neutral });
    expect(screen.getByText("Open check")).toHaveStyle({ textDecoration: "none" });
  });

  it("draws a done system task with a check and an open one with the link icon", async () => {
    route({
      todos: () => [
        { id: "x", description: "Signed already", status: "done", origin: "adr", is_system: true, card_id: "c1" },
        { id: "y", description: "Sign this", status: "open", origin: "adr", is_system: true, card_id: "c2" },
      ],
    });
    renderAt();
    await screen.findByText("Signed already");

    const done = within(rowOf("Signed already")).getByRole("button", { name: "check_circle" });
    expect(within(done).getByText("check_circle")).toHaveStyle({ color: STATUS_COLORS.success });
    const open = within(rowOf("Sign this")).getByRole("button", { name: "open_in_new" });
    expect(within(open).getByText("open_in_new")).toHaveStyle({ color: brand.primary });
  });

  it("spells out overdue and upcoming due dates", async () => {
    route({
      todos: () => [
        { id: "late", description: "Late task", status: "open", origin: "manual", due_date: "2020-01-01" },
        { id: "soon", description: "Future task", status: "open", origin: "manual", due_date: "2099-01-15" },
      ],
    });
    renderAt();
    await screen.findByText("Late task");

    const overdue = screen.getByText("Overdue · 2020-01-01");
    expect(overdue).toHaveStyle({ color: STATUS_COLORS.error, fontWeight: "600" });
    const due = screen.getByText("Due: 2099-01-15");
    expect(due).toHaveStyle({ color: createTheme().palette.text.secondary });
  });

  it("names no source on a mirrored task that does not say where it is mirrored", async () => {
    route({
      todos: () => [
        {
          id: "e",
          description: "Mirrored task",
          status: "open",
          origin: "manual",
          external_ref: "EXT-1",
          external_url: "https://tracker.example/EXT-1",
        },
      ],
    });
    renderAt();
    await screen.findByText("Mirrored task");
    expect(
      screen.getByRole("button", { name: /^Mirrored to\s+— complete this task in Turbo EA$/ }),
    ).toHaveTextContent("EXT-1");
  });
});

// ---------------------------------------------------------------------------
// The metadata line
// ---------------------------------------------------------------------------

describe("TodosPage — metadata line", () => {
  it("a bare manual task carries no metadata line at all", async () => {
    flat();
    route({ todos: () => [{ id: "p", description: "Plain task", status: "open", origin: "manual" }] });
    renderAt();
    const title = await screen.findByText("Plain task");
    const row = rowOf("Plain task");
    expect(row.textContent).toBe("radio_button_uncheckedPlain task");
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    expect(title.parentElement?.childElementCount).toBe(1);
  });

  it("joins the items with one separator each, and says nothing about a non-recurrence", async () => {
    flat();
    route({
      todos: () => [
        {
          id: "c",
          description: "Card task",
          status: "open",
          origin: "manual",
          card_id: "card-9",
          card_name: "SAP S/4HANA",
          creator_name: "Dana Lee",
          recurrence_unit: "none",
        },
        { ...RISK, description: "Flat risk" },
      ],
    });
    renderAt();
    await screen.findByText("Card task");
    const meta = screen.getByRole("button", { name: "SAP S/4HANA" }).parentElement as HTMLElement;
    expect(meta.textContent).toBe("SAP S/4HANA·From: Dana Lee");
    // A non-manual task names its origin in the flat view.
    const riskMeta = screen.getByText("From: Sam Moss").parentElement as HTMLElement;
    expect(riskMeta.textContent).toBe("policyRisk·From: Sam Moss");
  });

  it("inside a group, a row does not repeat the origin its header names", async () => {
    route({ todos: () => [MANUAL, RISK] });
    renderAt();
    await screen.findByText("Check access rights");
    expect(headers()).toHaveLength(2);
    const meta = screen.getByText("From: Sam Moss").parentElement as HTMLElement;
    expect(meta.textContent).toBe("From: Sam Moss");
  });
});

// ---------------------------------------------------------------------------
// Origin chips and the view toggles
// ---------------------------------------------------------------------------

describe("TodosPage — chips and view controls", () => {
  it("keeps the chip row while a selection is active, even when one origin remains", async () => {
    route({
      todos: (q) =>
        q.includes("status=done")
          ? [{ id: "md", description: "Finished doc", status: "done", origin: "manual" }]
          : [MANUAL, RISK],
    });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    expect(chipOf("All · 2")).toHaveClass("MuiChip-filled", "MuiChip-colorPrimary");
    expect(chipOf("Risk · 1")).toHaveStyle({ color: ORIGIN_META.risk.color });

    await user.click(screen.getByText("Risk · 1"));
    expect(chipOf("All · 2")).toHaveClass("MuiChip-outlined");
    expect(chipOf("All · 2")).not.toHaveClass("MuiChip-colorPrimary");
    // Selected: white text on the origin colour (the fill itself is masked by focus here).
    expect(chipOf("Risk · 1")).toHaveStyle({ color: "#fff" });

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("No tasks match the current filters.")).toBeInTheDocument();
    await user.click(screen.getByText("Risk · 0"));
    expect(await screen.findByText("Finished doc")).toBeInTheDocument();
  });

  it("collapses a group and expands it again", async () => {
    route({ todos: () => [MANUAL, RISK, BPM] });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Check access rights");

    const risk = headerOf("Risk");
    expect(risk).toHaveTextContent("expand_more");
    await user.click(risk);
    expect(risk).toHaveAttribute("aria-expanded", "false");
    expect(risk).toHaveTextContent("chevron_right");
    // Nothing at all is rendered for a collapsed group's rows.
    expect(risk.nextSibling).toBe(headerOf("Process approval"));

    await user.click(risk);
    expect(risk).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Check access rights")).toBeInTheDocument();
    expect(storedPrefs().collapsed).toEqual([]);
  });

  it("marks the current view mode and labels both toggles on the button and its icon", async () => {
    route({ todos: () => [MANUAL, RISK] });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Check access rights");

    expect(screen.getByRole("button", { name: "Group by origin" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Flat list" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByLabelText("Group by origin")).toHaveLength(2);
    expect(screen.getAllByLabelText("Flat list")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Flat list" }));
    expect(screen.getByRole("button", { name: "Flat list" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Group by origin" })).toHaveAttribute("aria-pressed", "false");
  });

  it("falls back to the grouped view with nothing collapsed when the stored preferences are corrupt", async () => {
    localStorage.setItem(PREFS, "{not json");
    route({ todos: () => [MANUAL, RISK] });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Check access rights");
    expect(headers()).toHaveLength(2);

    await user.click(screen.getByLabelText("Sort"));
    await user.click(screen.getByRole("option", { name: "Newest first" }));
    expect(storedPrefs()).toEqual({ sort: "created", grouped: true, collapsed: [] });
  });

  it("changing the sort keeps the collapsed groups", async () => {
    localStorage.setItem(PREFS, JSON.stringify({ sort: "dueDate", grouped: true, collapsed: ["risk"] }));
    route({ todos: () => [MANUAL, RISK] });
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Write onboarding doc");

    await user.click(screen.getByLabelText("Sort"));
    await user.click(screen.getByRole("option", { name: "Newest first" }));
    expect(storedPrefs()).toEqual({ sort: "created", grouped: true, collapsed: ["risk"] });
  });
});

// ---------------------------------------------------------------------------
// Surveys sub-panel
// ---------------------------------------------------------------------------

describe("TodosPage — Surveys sub-panel", () => {
  const SURVEY: MySurveyItem = {
    survey_id: "s1",
    survey_name: "Application owner check",
    survey_message: "Please confirm the owners.",
    survey_status: "active",
    target_type_key: "Application",
    pending_count: 2,
    items: [
      { response_id: "r1", card_id: "card-1", card_name: "CRM" },
      { response_id: "r2", card_id: "card-2", card_name: "ERP" },
    ],
  };

  it("shows a spinner until the surveys arrive, then only the surveys", async () => {
    const list = deferred<unknown>();
    route({ todos: () => [MANUAL], surveys: () => list.promise });
    renderAt("/todos?tab=surveys");

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("page-section")).toHaveTextContent("Surveys");
    // The todos panel is not mounted behind the Surveys section.
    expect(screen.queryByRole("tab", { name: "Assigned to me" })).toBeNull();

    list.resolve([SURVEY]);
    expect(await screen.findByText("Application owner check")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Please confirm the owners.").tagName).toBe("P");
    expect(screen.getAllByText("Respond")).toHaveLength(2);
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/todos\?/), expect.anything());
  });

  it("dismissing the load error leaves only the empty-state notice", async () => {
    route({ surveys: () => Promise.reject(new Error("Survey service down")) });
    const user = userEvent.setup();
    renderAt("/todos?tab=surveys");
    expect(await screen.findByText("Survey service down")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    expect(screen.getByRole("alert")).toHaveTextContent("No pending surveys. You're all caught up!");
  });
});
