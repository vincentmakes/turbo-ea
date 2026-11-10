import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import DecisionPicker, {
  DECISION_PICKER_PATH,
  filterAndRankDecisions,
  type DecisionPickerValue,
} from "./DecisionPicker";
import type { ArchitectureDecision } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: () => false,
}));

import { api } from "@/api/client";

function adr(over: Partial<ArchitectureDecision>): ArchitectureDecision {
  return {
    id: "x",
    reference_number: "ADR-001",
    title: "Untitled",
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
    ...over,
  };
}

const ROWS = [
  adr({ id: "a", reference_number: "ADR-010", title: "Use Postgres", standing: "in_force" }),
  adr({ id: "b", reference_number: "ADR-002", title: "Adopt Kafka", revision_number: 2, standing: "revoked" }),
  adr({ id: "c", reference_number: "ADR-003", title: "Draft on Postgres", status: "draft", standing: null }),
];

function Harness(props: Partial<React.ComponentProps<typeof DecisionPicker>> & {
  onPicked?: (a: ArchitectureDecision | null) => void;
}) {
  const { onPicked, ...rest } = props;
  const [value, setValue] = useState<DecisionPickerValue | null>(null);
  return (
    <DecisionPicker
      value={value}
      onChange={(a) => {
        setValue(a);
        onPicked?.(a);
      }}
      label="Decision"
      {...rest}
    />
  );
}

describe("DecisionPicker", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("fetches nothing until opened, then current revisions only", async () => {
    vi.mocked(api.get).mockResolvedValue(ROWS);
    render(<Harness />);
    expect(api.get).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText("Decision"));
    await waitFor(() => expect(screen.getByText("Use Postgres")).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls[0][0]).toBe("/adr?include_earlier=false");
    expect(DECISION_PICKER_PATH).toBe("/adr?include_earlier=false");
  });

  it("does not fetch when disabled by enabled=false", async () => {
    vi.mocked(api.get).mockResolvedValue(ROWS);
    render(<Harness enabled={false} />);
    await userEvent.click(screen.getByLabelText("Decision"));
    expect(api.get).not.toHaveBeenCalled();
  });

  it("browses in reference order with the reference label and state chip", async () => {
    vi.mocked(api.get).mockResolvedValue(ROWS);
    render(<Harness />);
    await userEvent.click(screen.getByLabelText("Decision"));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "ADR-002 · Rev 2Adopt KafkaRevoked",
      "ADR-003Draft on PostgresDraft",
      "ADR-010Use PostgresIn force",
    ]);
  });

  it("hides excluded ids and rows the filter refuses", async () => {
    vi.mocked(api.get).mockResolvedValue(ROWS);
    render(
      <Harness excludeIds={["a"]} filter={(r) => r.status === "signed"} />,
    );
    await userEvent.click(screen.getByLabelText("Decision"));
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Adopt Kafka");
  });

  it("filters on the typed text and emits the full row", async () => {
    vi.mocked(api.get).mockResolvedValue(ROWS);
    const onPicked = vi.fn();
    render(<Harness onPicked={onPicked} />);
    const input = screen.getByLabelText("Decision");
    await userEvent.click(input);
    await screen.findByRole("listbox");
    await userEvent.type(input, "postgres");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    // Both start a word with the term, so they sort alphabetically by title.
    expect(options.map((o) => o.textContent)).toEqual([
      "ADR-003Draft on PostgresDraft",
      "ADR-010Use PostgresIn force",
    ]);
    await userEvent.click(options[1]);
    expect(onPicked).toHaveBeenCalledWith(ROWS[0]);
    expect(input).toHaveValue("ADR-010 — Use Postgres");
  });

  it("shows a value that is not among the loaded rows", () => {
    render(
      <DecisionPicker
        value={{ id: "z", reference_number: "ADR-099", revision_number: 3, title: "Old" }}
        onChange={() => {}}
        label="Decision"
      />,
    );
    expect(screen.getByLabelText("Decision")).toHaveValue("ADR-099 · Rev 3 — Old");
  });

  it("uses the translated hint as placeholder", () => {
    render(<Harness />);
    expect(screen.getByPlaceholderText("Search by reference or title")).toBeInTheDocument();
  });
});

describe("filterAndRankDecisions", () => {
  const opts: DecisionPickerValue[] = [
    { id: "1", reference_number: "ADR-012", revision_number: 1, title: "Cloud first" },
    { id: "2", reference_number: "ADR-001", revision_number: 1, title: "Cloud" },
    { id: "3", reference_number: "ADR-005", revision_number: 1, title: "Private cloud" },
    { id: "4", reference_number: "ADR-006", revision_number: 1, title: "Kafka" },
  ];

  it("returns the list untouched for an empty query", () => {
    expect(filterAndRankDecisions(opts, "  ")).toBe(opts);
  });

  it("ranks exact, then starts-with, then word start, dropping non-matches", () => {
    expect(filterAndRankDecisions(opts, "cloud").map((o) => o.id)).toEqual(["2", "1", "3"]);
  });

  it("matches the reference exactly", () => {
    expect(filterAndRankDecisions(opts, "adr-012").map((o) => o.id)).toEqual(["1"]);
  });
});
