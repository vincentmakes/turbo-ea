import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

vi.mock("@/api/client", () => ({ api: { post: vi.fn() } }));

import { api } from "@/api/client";
import i18n from "@/i18n";
import type { ArchitectureDecision } from "@/types";
import ReviseMenu, {
  createRevision,
  isClosed,
  reviseFailure,
  reviseMenuState,
  successorDraft,
} from "./ReviseMenu";

const t = i18n.getFixedT("en", "delivery");

const ADR: ArchitectureDecision = {
  id: "a1",
  reference_number: "ADR-012",
  title: "Use Kafka",
  status: "signed",
  standing: "in_force",
  is_current: true,
  is_earlier_revision: false,
  context: null,
  decision: null,
  consequences: null,
  alternatives_considered: null,
  related_decisions: [],
  created_by: null,
  signatories: [],
  signed_at: "2026-06-01T00:00:00Z",
  revision_number: 2,
  parent_id: "a0",
  created_at: null,
  updated_at: null,
  linked_cards: [
    { id: "c1", name: "Kafka", type: "ITComponent" },
    { id: "c2", name: "Orders", type: "Application" },
  ],
};

const refused = (detail: unknown) => Object.assign(new Error("409"), { detail });

/** A mock answer that rejects only when called (no eager rejected promise). */
const rejecting = (err: unknown) => async () => {
  throw err;
};

beforeEach(() => vi.mocked(api.post).mockReset());

describe("pure helpers", () => {
  it("calls a revoked or replaced decision closed, an earlier revision not", () => {
    expect(isClosed({ standing: "revoked", is_earlier_revision: false })).toBe(true);
    expect(isClosed({ standing: "superseded", is_earlier_revision: false })).toBe(true);
    expect(isClosed({ standing: "superseded", is_earlier_revision: true })).toBe(false);
    expect(isClosed({ standing: "expired", is_earlier_revision: false })).toBe(false);
    expect(isClosed({ standing: "amended" })).toBe(false);
  });

  it("disables every action with the first reason that applies", () => {
    expect(reviseMenuState(ADR, true)).toEqual({ revise: null, replace: null, revoke: null });
    const noPerm = "adr.revise.reasonNoPermission";
    expect(reviseMenuState({ ...ADR, is_earlier_revision: true }, false)).toEqual({
      revise: noPerm,
      replace: noPerm,
      revoke: noPerm,
    });
    expect(reviseMenuState({ ...ADR, is_earlier_revision: true, standing: "revoked" }, true).revise).toBe(
      "adr.revise.reasonEarlier",
    );
    expect(reviseMenuState({ ...ADR, standing: "revoked" }, true).replace).toBe("adr.revise.reasonClosed");
    expect(reviseMenuState({ ...ADR, standing: "expired" }, true).revoke).toBeNull();
  });

  it("drafts a replacement and a revocation with the link and the same cards", () => {
    expect(successorDraft(ADR, "replaces", t)).toEqual({
      title: "Replaces: Use Kafka",
      links: [{ decision_id: "a1", kind: "replaces" }],
      linked_card_ids: ["c1", "c2"],
    });
    expect(successorDraft({ ...ADR, linked_cards: undefined }, "revokes", t)).toEqual({
      title: "Revocation of ADR-012 · Rev 2 — Use Kafka",
      links: [{ decision_id: "a1", kind: "revokes" }],
      linked_card_ids: [],
    });
  });

  it("reads the revise refusals", () => {
    expect(reviseFailure(refused({ error: "open_revision_exists", revision_id: "r3" }), t)).toEqual({
      kind: "existing",
      id: "r3",
    });
    expect(reviseFailure(refused({ error: "not_revisable", reason: "not_latest" }), t)).toEqual({
      kind: "error",
      message: "A later revision exists: revise the current revision instead.",
    });
    expect(
      reviseFailure(
        refused({
          error: "not_revisable",
          by: { id: "z", reference_number: "ADR-020", revision_number: 1, title: "Z" },
        }),
        t,
      ),
    ).toEqual({
      kind: "error",
      message: "ADR-020 has revoked or replaced this decision: it can no longer be revised.",
    });
    // An open revision without its id is not something to navigate to.
    expect(reviseFailure(refused({ error: "open_revision_exists" }), t)).toEqual({
      kind: "error",
      message: "Failed to create revision",
    });
    expect(reviseFailure(new Error("boom"), t)).toEqual({ kind: "error", message: "Failed to create revision" });
  });

  it("creates a revision with the body given, or says where the open one is", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "r3" } as never);
    expect(await createRevision("a1", { consolidates: ["m1"] }, t)).toEqual({
      id: "r3",
      notice: "New revision created",
    });
    expect(api.post).toHaveBeenCalledWith("/adr/a1/revise", { consolidates: ["m1"] });

    vi.mocked(api.post).mockImplementationOnce(rejecting(refused({ error: "open_revision_exists", revision_id: "r4" })));
    expect(await createRevision("a1", {}, t)).toEqual({
      id: "r4",
      notice: "A revision is already being drafted: it is now open.",
    });

    vi.mocked(api.post).mockImplementationOnce(rejecting(new Error("x")));
    expect(await createRevision("a1", {}, t)).toEqual({ error: "Failed to create revision" });
  });
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderMenu(adr: ArchitectureDecision = ADR, canManage = true) {
  const onNotice = vi.fn();
  const onError = vi.fn();
  render(
    <MemoryRouter initialEntries={["/ea-delivery/adr/a1"]}>
      <Routes>
        <Route
          path="*"
          element={<ReviseMenu adr={adr} canManage={canManage} onNotice={onNotice} onError={onError} />}
        />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return { onNotice, onError };
}

const openMenu = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Revise/ }));
  return within(await screen.findByRole("menu"));
};

describe("ReviseMenu", () => {
  it("revises and opens the new revision", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "r3" } as never);
    const { onNotice } = renderMenu();
    const menu = await openMenu();
    await userEvent.click(menu.getByRole("menuitem", { name: /Revise this decision/ }));
    expect(api.post).toHaveBeenCalledWith("/adr/a1/revise", {});
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/adr/r3"));
    expect(onNotice).toHaveBeenCalledWith("New revision created");
  });

  it("opens the existing revision on a 409", async () => {
    vi.mocked(api.post).mockImplementationOnce(rejecting(refused({ error: "open_revision_exists", revision_id: "r9" })));
    const { onNotice, onError } = renderMenu();
    await userEvent.click((await openMenu()).getByRole("menuitem", { name: /Revise this decision/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/adr/r9"));
    expect(onNotice).toHaveBeenCalledWith("A revision is already being drafted: it is now open.");
    expect(onError).not.toHaveBeenCalled();
  });

  it("says why a decision is not revisable and stays", async () => {
    vi.mocked(api.post).mockImplementationOnce(rejecting(refused({ error: "not_revisable", reason: "not_latest" })));
    const { onError } = renderMenu();
    await userEvent.click((await openMenu()).getByRole("menuitem", { name: /Revise this decision/ }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("A later revision exists: revise the current revision instead."),
    );
    expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/adr/a1");
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("goes straight to a revision already being drafted, without a request", async () => {
    const { onNotice } = renderMenu({
      ...ADR,
      open_revision: { id: "r5", reference_number: "ADR-012", revision_number: 3, title: "Use Kafka" },
    });
    const menu = await openMenu();
    await userEvent.click(
      menu.getByRole("menuitem", { name: /Open the revision being drafted \(ADR-012 · Rev 3\)/ }),
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/adr/r5");
    expect(onNotice).toHaveBeenCalledWith("A revision is already being drafted: it is now open.");
  });

  it("replaces with a new draft carrying the link and the cards", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "n1" } as never);
    const { onNotice } = renderMenu();
    await userEvent.click((await openMenu()).getByRole("menuitem", { name: /Replace with a new decision/ }));
    expect(api.post).toHaveBeenCalledWith("/adr", {
      title: "Replaces: Use Kafka",
      links: [{ decision_id: "a1", kind: "replaces" }],
      linked_card_ids: ["c1", "c2"],
    });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/adr/n1"));
    expect(onNotice).toHaveBeenCalledWith("Draft created");
  });

  it("revokes through a new draft", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "n2" } as never);
    renderMenu();
    await userEvent.click((await openMenu()).getByRole("menuitem", { name: /^block Revoke/ }));
    expect(api.post).toHaveBeenCalledWith("/adr", {
      title: "Revocation of ADR-012 · Rev 2 — Use Kafka",
      links: [{ decision_id: "a1", kind: "revokes" }],
      linked_card_ids: ["c1", "c2"],
    });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/adr/n2"));
  });

  it("reports a draft that could not be created", async () => {
    vi.mocked(api.post).mockImplementationOnce(rejecting(new Error("x")));
    const { onError } = renderMenu();
    await userEvent.click((await openMenu()).getByRole("menuitem", { name: /^block Revoke/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Failed to create the draft"));
    expect(screen.getByTestId("where")).toHaveTextContent("/ea-delivery/adr/a1");
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("disables every item with its reason on an earlier revision", async () => {
    renderMenu({ ...ADR, is_current: false, is_earlier_revision: true, standing: "superseded" });
    const menu = await openMenu();
    for (const item of menu.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveTextContent("This is an earlier revision: open the current one.");
    }
    expect(menu.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("disables every item for a user who cannot manage decisions", async () => {
    renderMenu(ADR, false);
    const menu = await openMenu();
    for (const item of menu.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveTextContent("You do not have permission to manage decisions.");
    }
  });

  it("explains each action when it is available", async () => {
    renderMenu();
    const menu = await openMenu();
    expect(menu.getByRole("menuitem", { name: /Revise this decision/ })).toHaveTextContent(
      "A new revision of the same decision, under the same reference",
    );
    expect(menu.getByRole("menuitem", { name: /Replace with a new decision/ })).toHaveTextContent(
      "A new draft that replaces this one once signed",
    );
    expect(menu.getByRole("menuitem", { name: /^block Revoke/ })).toHaveTextContent(
      "A new draft that revokes this one once signed",
    );
  });
});
