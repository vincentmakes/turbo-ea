import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import DecisionPicker, {
  DECISION_OPTIONS_MAX_AGE_MS,
  DECISION_PICKER_PATH,
  cachedDecisionOptions,
  fetchDecisionOptions,
  filterAndRankDecisions,
  invalidateDecisionOptions,
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
    invalidateDecisionOptions();
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("DecisionPicker — one shared register fetch", () => {
  beforeEach(() => {
    invalidateDecisionOptions();
    vi.mocked(api.get).mockReset();
  });

  it("eight pickers opened one after the other send one request", async () => {
    vi.mocked(api.get).mockResolvedValue(ROWS);
    const user = userEvent.setup();
    render(
      <>
        {Array.from({ length: 8 }, (_, i) => (
          <Harness key={i} label={`Decision ${i}`} />
        ))}
      </>,
    );
    for (let i = 0; i < 8; i += 1) {
      await user.click(screen.getByLabelText(`Decision ${i}`));
      const listbox = await screen.findByRole("listbox");
      expect(within(listbox).getAllByRole("option")).toHaveLength(3);
      await user.keyboard("{Escape}");
    }
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.get).mock.calls[0]).toEqual(["/adr?include_earlier=false"]);
  });

  it("concurrent callers share the request in flight, and the result fills the cache", async () => {
    const pending = deferred<typeof ROWS>();
    vi.mocked(api.get).mockReturnValue(pending.promise as never);
    const first = fetchDecisionOptions(1_000);
    const second = fetchDecisionOptions(1_000);
    expect(second).toBe(first);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(cachedDecisionOptions()).toBeNull();
    pending.resolve(ROWS);
    await expect(first).resolves.toBe(ROWS);
    expect(cachedDecisionOptions()).toBe(ROWS);
  });

  it("answers from the cache inside the window and refetches once it has passed", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(ROWS as never);
    await fetchDecisionOptions(1_000);
    await expect(fetchDecisionOptions(1_000 + DECISION_OPTIONS_MAX_AGE_MS - 1)).resolves.toBe(ROWS);
    expect(api.get).toHaveBeenCalledTimes(1);

    const fresh = [...ROWS, adr({ id: "d", reference_number: "ADR-011", title: "Created a moment ago" })];
    vi.mocked(api.get).mockResolvedValueOnce(fresh as never);
    await expect(fetchDecisionOptions(1_000 + DECISION_OPTIONS_MAX_AGE_MS)).resolves.toBe(fresh);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(cachedDecisionOptions()).toBe(fresh);
  });

  it("invalidating drops the cache and a request in flight, which no longer fills it", async () => {
    const stale = deferred<typeof ROWS>();
    vi.mocked(api.get).mockReturnValueOnce(stale.promise as never);
    const old = fetchDecisionOptions(1_000);
    invalidateDecisionOptions();
    vi.mocked(api.get).mockResolvedValueOnce([ROWS[0]] as never);
    await expect(fetchDecisionOptions(1_000)).resolves.toEqual([ROWS[0]]);
    expect(api.get).toHaveBeenCalledTimes(2);
    stale.resolve(ROWS);
    await old;
    expect(cachedDecisionOptions()).toEqual([ROWS[0]]);
  });

  it("a failed fetch caches nothing and the next open tries again", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    await expect(fetchDecisionOptions(1_000)).rejects.toThrow("down");
    expect(cachedDecisionOptions()).toBeNull();
    vi.mocked(api.get).mockResolvedValueOnce(ROWS as never);
    await expect(fetchDecisionOptions(1_000)).resolves.toBe(ROWS);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("a picker mounted after the fetch shows the cached rows without a request", async () => {
    vi.mocked(api.get).mockResolvedValue(ROWS);
    await fetchDecisionOptions();
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Decision"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("an opened picker whose cache went stale shows it at once, then the refetched rows", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(ROWS as never);
    // Cached long ago: stale on the next open.
    await fetchDecisionOptions(0);
    const refetch = deferred<ArchitectureDecision[]>();
    vi.mocked(api.get).mockReturnValueOnce(refetch.promise as never);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("Decision"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(api.get).toHaveBeenCalledTimes(2);
    refetch.resolve([...ROWS, adr({ id: "d", reference_number: "ADR-011", title: "Created a moment ago" })]);
    expect(await within(listbox).findByText("Created a moment ago")).toBeInTheDocument();
    expect(within(listbox).getAllByRole("option")).toHaveLength(4);
  });
});
