import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import i18n from "@/i18n";
import type { ArchitectureDecision, DecisionRef } from "@/types";
import DecisionBanners, {
  SoawBanners,
  buildDecisionBanners,
  buildSoawBanners,
  decisionHref,
  soawHref,
} from "./DecisionBanners";

const t = i18n.getFixedT("en", "delivery");
const formatDate = (d: string | null | undefined) => (d ? `D(${d})` : "");

function adr(over: Partial<ArchitectureDecision> = {}): ArchitectureDecision {
  return {
    id: "self",
    reference_number: "ADR-012",
    title: "Self",
    status: "signed",
    context: null,
    decision: null,
    consequences: null,
    alternatives_considered: null,
    related_decisions: [],
    created_by: null,
    signatories: [],
    signed_at: null,
    revision_number: 1,
    parent_id: null,
    created_at: null,
    updated_at: null,
    standing: "in_force",
    ...over,
  };
}

const REF = (id: string, ref: string, rev = 1): DecisionRef => ({
  id,
  reference_number: ref,
  revision_number: rev,
  title: `T ${id}`,
});

const build = (a: ArchitectureDecision, mode: "editor" | "preview" = "editor", canConsolidate = false) =>
  buildDecisionBanners(a, { mode, t, formatDate, canConsolidate });

describe("buildDecisionBanners", () => {
  it("shows nothing for a plain in-force decision", () => {
    expect(build(adr())).toEqual([]);
  });

  it("points an earlier revision to the current one", () => {
    expect(
      build(adr({ standing: "superseded", is_earlier_revision: true, superseded_by: REF("cur", "ADR-012", 3) })),
    ).toEqual([
      {
        id: "earlier-revision",
        severity: "warning",
        message: "This is an earlier revision. The current revision is ADR-012 · Rev 3.",
        links: [{ id: "cur", label: "Open current revision" }],
      },
    ]);
  });

  it("names the replacing decision of a superseded chain", () => {
    expect(
      build(adr({ standing: "superseded", is_earlier_revision: false, superseded_by: REF("n", "ADR-040") })),
    ).toEqual([
      {
        id: "superseded",
        severity: "warning",
        message: "This decision has been superseded by ADR-040.",
        links: [{ id: "n", label: "Open" }],
      },
    ]);
  });

  it("needs a pointer for the superseded banner", () => {
    expect(build(adr({ standing: "superseded", superseded_by: null }))).toEqual([]);
  });

  it("reports a revocation as an error", () => {
    const [b] = build(adr({ standing: "revoked", revoked_by: REF("r", "ADR-050", 2) }));
    expect(b).toEqual({
      id: "revoked",
      severity: "error",
      message: "This decision has been revoked by ADR-050 · Rev 2.",
      links: [{ id: "r", label: "Open" }],
    });
    expect(build(adr({ standing: "in_force", revoked_by: REF("r", "ADR-050") }))).toEqual([]);
  });

  it("lists the amending decisions and offers consolidation only when asked", () => {
    const a = adr({ standing: "amended", amended_by: [REF("m1", "ADR-020"), REF("m2", "ADR-021", 2)] });
    expect(build(a)).toEqual([
      {
        id: "amended",
        severity: "info",
        message: "This decision is in force and has been amended by:",
        links: [
          { id: "m1", label: "ADR-020" },
          { id: "m2", label: "ADR-021 · Rev 2" },
        ],
        consolidate: false,
      },
    ]);
    expect(build(a, "editor", true)[0].consolidate).toBe(true);
    expect(build(adr({ standing: "amended", amended_by: [] }))).toEqual([]);
    expect(build(adr({ standing: "in_force", amended_by: [REF("m1", "ADR-020")] }))).toEqual([]);
  });

  it("dates a scheduled and an expired decision", () => {
    expect(build(adr({ standing: "scheduled", effective_from: "2026-12-01" }))[0]).toMatchObject({
      id: "scheduled",
      severity: "info",
      message: "This decision takes effect on D(2026-12-01).",
    });
    expect(build(adr({ standing: "expired", valid_until: "2026-01-31" }))[0]).toMatchObject({
      id: "expired",
      severity: "warning",
      message: "This decision has expired: it was valid until D(2026-01-31).",
    });
  });

  it("announces each upcoming change", () => {
    const banners = build(
      adr({
        upcoming: [
          { kind: "revision", by: REF("v3", "ADR-012", 3), effective_from: "2027-01-01" },
          { kind: "replaces", by: REF("p", "ADR-060"), effective_from: "2027-02-01" },
          { kind: "revokes", by: REF("k", "ADR-061", 2), effective_from: "2027-03-01" },
        ],
      }),
    );
    expect(banners.map((b) => [b.id, b.message, b.links])).toEqual([
      ["upcoming-revision-v3", "Revision 3 takes effect on D(2027-01-01).", [{ id: "v3", label: "Open" }]],
      [
        "upcoming-replaces-p",
        "This decision will be replaced by ADR-060 on D(2027-02-01).",
        [{ id: "p", label: "Open" }],
      ],
      [
        "upcoming-revokes-k",
        "This decision will be revoked by ADR-061 · Rev 2 on D(2027-03-01).",
        [{ id: "k", label: "Open" }],
      ],
    ]);
  });

  it("points to the open revision and to the consolidating revision", () => {
    const banners = build(
      adr({ open_revision: REF("o", "ADR-012", 4), consolidated_into: REF("c", "ADR-003", 2) }),
    );
    expect(banners.map((b) => [b.id, b.severity, b.message])).toEqual([
      ["open-revision", "info", "A revision is being drafted: ADR-012 · Rev 4."],
      ["consolidated", "info", "The amendment made by this decision is consolidated into ADR-003 · Rev 2."],
    ]);
  });

  it("shows the review lock in the editor only", () => {
    const a = adr({ status: "in_review", standing: null });
    expect(build(a, "editor")).toEqual([
      {
        id: "in-review",
        severity: "info",
        message: "Sent for review: the content is locked. Recall the signatures to edit it.",
        links: [],
      },
    ]);
    expect(build(a, "preview")).toEqual([]);
    expect(build(adr({ status: "draft", standing: null }), "editor")).toEqual([]);
  });

  it("states who recorded a decision, with or without a name", () => {
    const rec = adr({
      recorded_at: "2026-05-06T10:00:00Z",
      recorded_by: { user_id: "u1", display_name: "Jane" },
    });
    expect(build(rec, "preview")[0]).toEqual({
      id: "recorded",
      severity: "info",
      message: "Recorded by Jane on D(2026-05-06T10:00:00Z), not signed in Turbo EA.",
      links: [],
    });
    expect(build({ ...rec, recorded_by: null })[0].message).toBe(
      "Recorded on D(2026-05-06T10:00:00Z), not signed in Turbo EA.",
    );
    expect(build(adr({ status: "draft", recorded_at: "2026-05-06" }))).toEqual([]);
  });
});

describe("buildSoawBanners", () => {
  it("points an earlier revision to the current one", () => {
    expect(
      buildSoawBanners(
        { status: "signed", is_earlier_revision: true, superseded_by: { id: "s3", name: "S", revision_number: 3 } },
        { mode: "preview", t },
      ),
    ).toEqual([
      {
        id: "earlier-revision",
        severity: "warning",
        message: "This is an earlier revision. The current revision is Rev 3.",
        links: [{ id: "s3", label: "Open current revision" }],
      },
    ]);
  });

  it("points to the open revision and locks in review in the editor", () => {
    const soaw = {
      status: "in_review" as const,
      open_revision: { id: "s4", name: "S", revision_number: 4, status: "draft" as const },
    };
    expect(buildSoawBanners(soaw, { mode: "editor", t }).map((b) => [b.id, b.message])).toEqual([
      ["open-revision", "A revision is being drafted: Rev 4."],
      ["in-review", "Sent for review: the content is locked. Recall the signatures to edit it."],
    ]);
    expect(buildSoawBanners(soaw, { mode: "preview", t }).map((b) => b.id)).toEqual(["open-revision"]);
  });

  it("needs a pointer for the earlier-revision banner", () => {
    expect(
      buildSoawBanners({ status: "signed", is_earlier_revision: true, superseded_by: null }, { mode: "editor", t }),
    ).toEqual([]);
  });
});

describe("DecisionBanners", () => {
  it("renders nothing without banners", () => {
    const { container } = render(
      <MemoryRouter>
        <DecisionBanners adr={adr()} mode="editor" />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("links a single pointer from the alert's action, with the default route", () => {
    render(
      <MemoryRouter>
        <DecisionBanners
          adr={adr({ standing: "superseded", is_earlier_revision: true, superseded_by: REF("cur", "ADR-012", 2) })}
          mode="preview"
        />
      </MemoryRouter>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-banner", "earlier-revision");
    expect(alert.className).toContain("MuiAlert-colorWarning");
    expect(screen.getByRole("link", { name: "Open current revision" })).toHaveAttribute(
      "href",
      "/ea-delivery/adr/cur",
    );
    expect(decisionHref("x")).toBe("/ea-delivery/adr/x");
  });

  it("lists amending decisions and runs the consolidation action", async () => {
    const onConsolidate = vi.fn();
    render(
      <MemoryRouter>
        <DecisionBanners
          adr={adr({ standing: "amended", amended_by: [REF("m1", "ADR-020")] })}
          mode="editor"
          hrefFor={(id) => `/x/${id}/preview`}
          onCreateConsolidatedRevision={onConsolidate}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "ADR-020" })).toHaveAttribute("href", "/x/m1/preview");
    await userEvent.click(screen.getByRole("button", { name: "Create consolidated revision" }));
    expect(onConsolidate).toHaveBeenCalledTimes(1);
  });

  it("hides the consolidation action when no handler is passed", () => {
    render(
      <MemoryRouter>
        <DecisionBanners adr={adr({ standing: "amended", amended_by: [REF("m1", "ADR-020")] })} mode="editor" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Create consolidated revision" })).not.toBeInTheDocument();
    // A single amender is a plain pointer in the action slot.
    expect(screen.getByRole("link", { name: "ADR-020" })).toHaveAttribute("href", "/ea-delivery/adr/m1");
  });

  it("formats dates with the workspace date format", () => {
    render(
      <MemoryRouter>
        <DecisionBanners adr={adr({ standing: "scheduled", effective_from: "2026-12-01" })} mode="preview" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This decision takes effect on 2026-12-01.");
  });
});

describe("SoawBanners", () => {
  it("links to the SoAW route by default", () => {
    render(
      <MemoryRouter>
        <SoawBanners
          soaw={{ status: "signed", open_revision: { id: "s2", name: "S", revision_number: 2, status: "draft" } }}
          mode="editor"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/ea-delivery/soaw/s2");
    expect(soawHref("y")).toBe("/ea-delivery/soaw/y");
  });
});

describe("review outcome banners", () => {
  const by = { id: "u1", display_name: "Ada" };
  const outcome = (kind: "changes_requested" | "rejected" | "withdrawn", over = {}) => ({
    kind,
    at: "2026-11-27",
    by,
    note: "Costs missing",
    ...over,
  });

  it("names who, when and why for each outcome, with its severity", () => {
    const pick = (o: ReturnType<typeof outcome>) =>
      build(adr({ status: "draft", standing: null, outcome: o })).map((b) => [
        b.id,
        b.severity,
        b.message,
        b.reason,
      ]);
    expect(pick(outcome("changes_requested"))).toEqual([
      ["changes-requested", "warning", "Changes requested by Ada on D(2026-11-27):", "Costs missing"],
    ]);
    expect(pick(outcome("rejected"))[0]).toEqual([
      "rejected",
      "error",
      "Rejected by Ada on D(2026-11-27):",
      "Costs missing",
    ]);
    expect(pick(outcome("withdrawn"))[0].slice(0, 3)).toEqual([
      "withdrawn",
      "info",
      "Withdrawn by Ada on D(2026-11-27):",
    ]);
  });

  it("adds the closed lock in the editor only, never for changes requested", () => {
    const closed = adr({ status: "draft", standing: null, outcome: outcome("rejected") });
    expect(build(closed, "editor").map((b) => b.id)).toEqual(["rejected", "closed-lock"]);
    expect(build(closed, "preview").map((b) => b.id)).toEqual(["rejected"]);
    const returned = adr({ status: "draft", standing: null, outcome: outcome("changes_requested") });
    expect(build(returned, "editor").map((b) => b.id)).toEqual(["changes-requested"]);
  });

  it("drops the name when none was kept and says when no reason was given", () => {
    const [b] = build(
      adr({ status: "draft", standing: null, outcome: outcome("withdrawn", { by: null, note: null }) }),
    );
    expect(b.message).toBe("Withdrawn on D(2026-11-27):");
    expect(b.reason).toBe("No reason given");
  });

  it("ignores an outcome on a document that is not a draft", () => {
    expect(build(adr({ status: "in_review", standing: null, outcome: outcome("rejected") }), "preview")).toEqual(
      [],
    );
  });

  it("shows the SoAW outcome and its closed lock", () => {
    const soaw = { status: "draft" as const, outcome: outcome("withdrawn") };
    expect(buildSoawBanners(soaw, { mode: "editor", t, formatDate }).map((b) => [b.id, b.message])).toEqual([
      ["withdrawn", "Withdrawn by Ada on D(2026-11-27):"],
      ["closed-lock", "Closed: the content is locked. Reopen it to edit it."],
    ]);
  });

  it("renders the reason as linkified free text", () => {
    render(
      <MemoryRouter>
        <SoawBanners
          soaw={{ status: "draft", outcome: outcome("rejected", { note: "See https://example.com/x" }) }}
          mode="preview"
        />
      </MemoryRouter>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-banner", "rejected");
    expect(alert.className).toContain("MuiAlert-colorError");
    expect(alert).toHaveTextContent("Rejected by Ada on");
    expect(screen.getByRole("link", { name: "https://example.com/x" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
});
