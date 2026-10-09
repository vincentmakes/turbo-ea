/**
 * The vendor field: a freeSolo Provider search that also manages the one
 * Provider relation on the card.
 *
 * The relation type is discovered from the metamodel (any type connecting
 * Provider and the card's type, lowest `sort_order` first) and the pair is
 * POSTed in that type's direction — Provider as source for the fixture's
 * `relProviderToITC`, as target when the type runs the other way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeUser, renderWithProviders, userWith, wrapWithProviders } from "@/test/render";
import {
  CARDS,
  CARD_IDS,
  CARD_TYPES,
  RELATION_TYPES,
  REL_PROVIDER_TO_ITC,
  cardPage,
  makeCard,
  makeRelationType,
} from "@/test/fixtures/metamodel";
import type { Relation, RelationType } from "@/types";
import VendorField from "./VendorField";

const FS_ID = CARD_IDS.postgres;
const RELATIONS_URL = `/relations?card_id=${FS_ID}&type=${REL_PROVIDER_TO_ITC.key}`;
const ACME = CARDS.find((c) => c.id === CARD_IDS.acme)!;
const GLOBEX = makeCard({ id: "ca4d0000-0000-4000-8000-000000000032", type: "Provider", name: "Globex" });

const EXISTING: Relation = {
  id: "rel-old",
  type: REL_PROVIDER_TO_ITC.key,
  source_id: GLOBEX.id,
  target_id: FS_ID,
  source: { id: GLOBEX.id, type: "Provider", name: "Globex" },
  target: { id: FS_ID, type: "ITComponent", name: "PostgreSQL" },
};

function linkedTo(provider: { id: string; name: string }): Relation[] {
  return [
    {
      id: "rel-new",
      type: REL_PROVIDER_TO_ITC.key,
      source_id: provider.id,
      target_id: FS_ID,
      source: { id: provider.id, type: "Provider", name: provider.name },
      target: { id: FS_ID, type: "ITComponent", name: "PostgreSQL" },
    },
  ];
}

type Props = React.ComponentProps<typeof VendorField>;

function renderField(props: Partial<Props> = {}, user?: ReturnType<typeof userWith>) {
  const onChange = vi.fn();
  const onRelationChange = vi.fn();
  const onProviderSelected = vi.fn();
  const utils = renderWithProviders(
    <VendorField
      value=""
      onChange={onChange}
      cardTypeKey="ITComponent"
      onRelationChange={onRelationChange}
      onProviderSelected={onProviderSelected}
      {...props}
    />,
    user ? { user } : {},
  );
  return { ...utils, onChange, onRelationChange, onProviderSelected };
}

/** The `search` param of every `/cards` request, in order ("" for a browse). */
function cardSearches(): string[] {
  return mockApi
    .callsOf("get", "/cards?*")
    .map((c) => new URL(c.path, "http://x").searchParams.get("search") ?? "");
}

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  mockApi.reset();
  mockApi.on("get", "/cards?*", (path) => {
    const search = new URL(path, "http://x").searchParams.get("search")?.toLowerCase() ?? "";
    return cardPage([ACME, GLOBEX].filter((c) => c.name.toLowerCase().includes(search)));
  });
  mockApi.on("get", RELATIONS_URL, []);
  mockApi.on("post", "/relations", {});
  mockApi.on("delete", "/relations/*", {});
});

describe("VendorField", () => {
  it("paints the current vendor in the very first render", () => {
    // Before any effect runs: the value must not flash in late.
    const paint = (value: string) =>
      renderToStaticMarkup(
        wrapWithProviders(<VendorField value={value} onChange={() => {}} cardTypeKey="ITComponent" />),
      );
    expect(paint("Globex")).toContain('value="Globex"');
    expect(paint("")).toContain('value=""');
  });

  it("searches Providers for the current vendor from the start, with a placeholder hint", async () => {
    renderField({ value: "Globex" });
    expect(screen.getByLabelText("Provider")).toHaveAttribute(
      "placeholder",
      "Search existing providers or type a new name...",
    );
    await waitFor(() => expect(mockApi.callsOf("get", "/cards?*").length).toBeGreaterThanOrEqual(1));
    const first = new URL(mockApi.callsOf("get", "/cards?*")[0].path, "http://x").searchParams;
    expect(first.get("type")).toBe("Provider");
    expect(first.get("search")).toBe("Globex");
  });

  it("debounces the search: a superseded keystroke never reaches the server", async () => {
    vi.useFakeTimers();
    try {
      renderField();
      // An empty field browses: no search term at all.
      expect(cardSearches()).toEqual([""]);
      const input = screen.getByLabelText("Provider");
      fireEvent.change(input, { target: { value: "A" } });
      act(() => vi.advanceTimersByTime(200));
      fireEvent.change(input, { target: { value: "Ac" } });
      // 400 ms in: the first keystroke's timer would have fired by now.
      act(() => vi.advanceTimersByTime(200));
      await act(async () => {});
      expect(cardSearches()).not.toContain("A");
      act(() => vi.advanceTimersByTime(200));
      await act(async () => {});
      expect(cardSearches()).toEqual(["", "Ac"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the vendor value when the parent changes it", async () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <VendorField value="Globex" onChange={onChange} cardTypeKey="ITComponent" />,
    );
    expect(screen.getByLabelText("Provider")).toHaveValue("Globex");
    rerender(wrapWithProviders(<VendorField value="Acme Corp" onChange={onChange} cardTypeKey="ITComponent" />));
    expect(screen.getByLabelText("Provider")).toHaveValue("Acme Corp");
  });

  it("uses the Provider label by default and an override when given", () => {
    const { unmount } = renderField();
    expect(screen.getByLabelText("Provider")).toBeInTheDocument();
    unmount();
    renderField({ label: "Vendor" });
    expect(screen.getByLabelText("Vendor")).toBeInTheDocument();
  });

  it("shows the Provider already linked to the card", async () => {
    mockApi.on("get", RELATIONS_URL, [EXISTING]);
    renderField({ fsId: FS_ID, value: "Globex" });
    expect(await screen.findByText("Globex")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toHaveValue("Globex");
  });

  it("does not look up relations when no type connects Provider to the card type", async () => {
    renderField({ fsId: FS_ID, cardTypeKey: "BusinessCapability" });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards?*")).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(0);
  });

  it("ignores relation types that touch the card type but not Provider, or Provider but not the card type", async () => {
    // Applications have relation types of their own, none of them to a Provider.
    renderField({ fsId: FS_ID, cardTypeKey: "Application" });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards?*")).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(0);
  });

  it("finds the Provider relation type among unrelated ones on either side", async () => {
    withMetamodel(CARD_TYPES, [
      makeRelationType({ key: "relITCToBC", source_type_key: "ITComponent", target_type_key: "BusinessCapability" }),
      makeRelationType({ key: "relAppToProvider", source_type_key: "Application", target_type_key: "Provider" }),
      REL_PROVIDER_TO_ITC,
    ]);
    renderField({ fsId: FS_ID });
    await waitFor(() => expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/relations/)[0].path).toBe(RELATIONS_URL);
  });

  it("picks the Provider relation type with the lowest sort order, then by key", async () => {
    const provider = (key: string, sort_order: number): RelationType =>
      makeRelationType({ key, source_type_key: "Provider", target_type_key: "ITComponent", sort_order });
    withMetamodel(CARD_TYPES, [provider("relA", 5), provider("relZ", 1), provider("relM", 1), provider("relB", 2)]);
    mockApi.on("get", /^\/relations/, []);
    const { unmount } = renderField({ fsId: FS_ID });
    await waitFor(() => expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/relations/)[0].path).toBe(`/relations?card_id=${FS_ID}&type=relM`);
    unmount();

    // Unset sort orders count as 0.
    mockApi.reset();
    mockApi.on("get", "/cards?*", cardPage([]));
    mockApi.on("get", /^\/relations/, []);
    withMetamodel(CARD_TYPES, [provider("relC", 3), { ...provider("relQ", 0), sort_order: undefined } as unknown as RelationType, provider("relD", 2)]);
    renderField({ fsId: FS_ID });
    await waitFor(() => expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/relations/)[0].path).toBe(`/relations?card_id=${FS_ID}&type=relQ`);
  });

  it("looks the Provider up again for a new card or a new card type", async () => {
    const OTHER = CARD_IDS.erp;
    mockApi.on("get", /^\/relations/, []);
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <VendorField value="" onChange={onChange} cardTypeKey="BusinessCapability" fsId={FS_ID} />,
    );
    await waitFor(() => expect(mockApi.callsOf("get", "/cards?*")).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(0);

    rerender(wrapWithProviders(<VendorField value="" onChange={onChange} cardTypeKey="ITComponent" fsId={FS_ID} />));
    await waitFor(() => expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/relations/)[0].path).toBe(RELATIONS_URL);

    rerender(wrapWithProviders(<VendorField value="" onChange={onChange} cardTypeKey="ITComponent" fsId={OTHER} />));
    await waitFor(() => expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(2));
    expect(mockApi.callsOf("get", /^\/relations/)[1].path).toBe(
      `/relations?card_id=${OTHER}&type=${REL_PROVIDER_TO_ITC.key}`,
    );
  });

  it("reads the Provider off whichever end of the relation it sits on, skipping unnamed ones", async () => {
    withMetamodel(CARD_TYPES, [
      makeRelationType({ key: "relITCToProvider", source_type_key: "ITComponent", target_type_key: "Provider" }),
    ]);
    mockApi.on("get", `/relations?card_id=${FS_ID}&type=relITCToProvider`, [
      { id: "rel-0", type: "relITCToProvider", source_id: FS_ID, target_id: "ghost" },
      {
        id: "rel-1",
        type: "relITCToProvider",
        source_id: FS_ID,
        target_id: GLOBEX.id,
        source: { id: FS_ID, type: "ITComponent", name: "PostgreSQL" },
        target: { id: GLOBEX.id, type: "Provider", name: "Globex" },
      },
    ]);
    renderField({ fsId: FS_ID });
    expect(await screen.findByText("Globex")).toBeInTheDocument();
    expect(screen.queryByText("PostgreSQL")).not.toBeInTheDocument();
  });

  it("reports typed text as the vendor value", async () => {
    const { user, onChange } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Ac");
    expect(onChange).toHaveBeenLastCalledWith("Ac");
  });

  it("browses all Providers on open, then relinks the card to the picked one", async () => {
    // Globex is linked until the POST lands, both are until the old link is
    // deleted, and the re-read afterwards shows Acme alone.
    mockApi.on("get", RELATIONS_URL, () => {
      if (!mockApi.callsOf("post", "/relations").length) return [EXISTING];
      if (!mockApi.callsOf("delete", "/relations/rel-old").length) return [EXISTING, ...linkedTo(ACME)];
      return linkedTo(ACME);
    });
    const { user, onChange, onRelationChange, onProviderSelected } = renderField({ fsId: FS_ID });
    await screen.findByText("Globex");

    await user.click(screen.getByLabelText("Provider"));
    expect(await screen.findByRole("option", { name: /Acme Corp/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Globex/ })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Acme Corp/ }));

    expect(onChange).toHaveBeenCalledWith("Acme Corp");
    // Picking reports the vendor once, not once more per input reset.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onProviderSelected).toHaveBeenCalledWith({ id: ACME.id, name: "Acme Corp" });
    await waitFor(() => expect(onRelationChange).toHaveBeenCalledTimes(1));
    // The new link goes first, in the type's direction; only then the old one,
    // and never the new one.
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: REL_PROVIDER_TO_ITC.key,
      source_id: ACME.id,
      target_id: FS_ID,
    });
    expect(
      mockApi.calls
        .filter((c) => c.method === "post" || c.method === "delete")
        .map((c) => `${c.method} ${c.path}`),
    ).toEqual(["post /relations", "delete /relations/rel-old"]);
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toHaveValue("Acme Corp");
  });

  it("names the new link from the re-read, skipping rows without a name, and drops a stale chip", async () => {
    mockApi.on("get", RELATIONS_URL, () =>
      mockApi.callsOf("post", "/relations").length
        ? [{ id: "rel-x", type: REL_PROVIDER_TO_ITC.key, source_id: "ghost", target_id: FS_ID }, ...linkedTo(ACME)]
        : [EXISTING],
    );
    const { user, onRelationChange } = renderField({ fsId: FS_ID });
    await screen.findByText("Globex");
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    await waitFor(() => expect(onRelationChange).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.queryByText("Globex")).not.toBeInTheDocument();
  });

  it("shows no chip when the re-read after linking finds no named Provider", async () => {
    mockApi.on("get", RELATIONS_URL, () => (mockApi.callsOf("post", "/relations").length ? [] : [EXISTING]));
    const { user, onRelationChange } = renderField({ fsId: FS_ID });
    await screen.findByText("Globex");
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    await waitFor(() => expect(onRelationChange).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".MuiChip-root")).toBeNull();
  });

  it("follows a metamodel change in which way round the Provider relation runs", async () => {
    mockApi.on("get", /^\/relations/, []);
    const onChange = vi.fn();
    const ui = () => <VendorField value="" onChange={onChange} cardTypeKey="ITComponent" fsId={FS_ID} />;
    const { user, rerender } = renderWithProviders(ui());
    await waitFor(() => expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(1));

    withMetamodel(CARD_TYPES, [
      makeRelationType({ key: "relITCToProvider", source_type_key: "ITComponent", target_type_key: "Provider" }),
    ]);
    rerender(wrapWithProviders(ui()));
    await waitFor(() => expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(2));

    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: "relITCToProvider",
      source_id: FS_ID,
      target_id: ACME.id,
    });
  });

  it("makes no relation calls for a card type without a Provider relation", async () => {
    const { user, onProviderSelected, onChange } = renderField({
      fsId: FS_ID,
      cardTypeKey: "BusinessCapability",
    });
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    expect(onProviderSelected).toHaveBeenCalledWith({ id: ACME.id, name: "Acme Corp" });
    await waitFor(() => expect(mockApi.callsOf("get", "/cards?*").length).toBeGreaterThanOrEqual(1));
    expect(mockApi.callsOf("get", /^\/relations/)).toHaveLength(0);
    expect(mockApi.callsOf("post")).toHaveLength(0);
    // Nothing to link is not a failed link: the vendor text is the pick.
    expect(onChange).toHaveBeenLastCalledWith("Acme Corp");
    expect(screen.getByLabelText("Provider")).toHaveValue("Acme Corp");
  });

  it("works without the optional callbacks", async () => {
    // An error thrown inside an event handler never fails a test by itself;
    // it is reported on window, so collect it there.
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error);
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      const onChange = vi.fn();
      const { user } = renderWithProviders(
        <VendorField value="" onChange={onChange} cardTypeKey="ITComponent" />,
      );
      await user.click(screen.getByLabelText("Provider"));
      await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
      expect(await screen.findByText("Acme Corp", { selector: ".MuiChip-label" })).toBeInTheDocument();

      // Clearing drops the chip too.
      await user.click(screen.getByLabelText("Provider"));
      await user.click(screen.getByTitle("Clear"));
      expect(onChange).toHaveBeenLastCalledWith(undefined);
      expect(screen.queryByText("Acme Corp", { selector: ".MuiChip-label" })).not.toBeInTheDocument();
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("creates a Provider without a card id and without the optional callbacks", async () => {
    mockApi.on("post", "/cards", { id: "prov-new", name: "Initech Corp" });
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <VendorField value="" onChange={onChange} cardTypeKey="ITComponent" />,
    );
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create New Provider" });
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The server's name wins over what was typed: field, chip and the reported value.
    expect(onChange).toHaveBeenLastCalledWith("Initech Corp");
    expect(screen.getByLabelText("Provider")).toHaveValue("Initech Corp");
    expect(screen.getByText("Initech Corp", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);
  });

  it("links a created Provider to the card even without the selection callback", async () => {
    mockApi.on("post", "/cards", { id: "prov-new", name: "Initech" });
    const { user } = renderWithProviders(
      <VendorField value="" onChange={vi.fn()} cardTypeKey="ITComponent" fsId={FS_ID} />,
    );
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Create & Link" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: REL_PROVIDER_TO_ITC.key,
      source_id: "prov-new",
      target_id: FS_ID,
    });
  });

  it("shows the create in progress, and is ready for the next one afterwards", async () => {
    let release: (v: { id: string; name: string }) => void = () => {};
    mockApi.on("post", "/cards", () => new Promise<{ id: string; name: string }>((resolve) => (release = resolve)));
    const { user } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/cards")).toHaveLength(1));
    expect(within(dialog).getByRole("button", { name: "Creating..." })).toBeDisabled();

    await act(async () => release({ id: "prov-new", name: "Initech" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.clear(screen.getByLabelText("Provider"));
    await user.type(screen.getByLabelText("Provider"), "Umbrella");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Umbrella"/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Create & Link" })).toBeEnabled();
  });

  it("closes the create dialog on Escape without creating anything", async () => {
    const { user } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("offers to create a Provider when the matches are only partial", async () => {
    const { user } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Acme");
    await waitFor(() => expect(cardSearches()).toContain("Acme"));
    expect(await screen.findByRole("option", { name: /Create Provider "Acme"/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Acme Corp/ })).toBeInTheDocument();
  });

  it("offers creation to a role granted Provider creation globally or on the type alone", async () => {
    const { user, unmount } = renderField({}, userWith("inventory.view", "inventory.create"));
    await user.type(screen.getByLabelText("Provider"), "Initech");
    expect(await screen.findByRole("option", { name: /Create Provider "Initech"/ })).toBeInTheDocument();
    unmount();

    const typeOnly = makeUser({
      role: "member",
      permissions: { "inventory.view": true },
      type_permissions: { Provider: { "inventory.create": true } },
    });
    const second = renderField({}, typeOnly);
    await second.user.type(screen.getByLabelText("Provider"), "Initech");
    expect(await screen.findByRole("option", { name: /Create Provider "Initech"/ })).toBeInTheDocument();
  });

  it("names the new link from the far end when the type runs card → Provider", async () => {
    withMetamodel(CARD_TYPES, [
      makeRelationType({ key: "relITCToProvider", source_type_key: "ITComponent", target_type_key: "Provider" }),
    ]);
    const url = `/relations?card_id=${FS_ID}&type=relITCToProvider`;
    mockApi.on("get", url, () =>
      mockApi.callsOf("post", "/relations").length
        ? [
            {
              id: "rel-n",
              type: "relITCToProvider",
              source_id: FS_ID,
              target_id: ACME.id,
              source: { id: FS_ID, type: "ITComponent", name: "PostgreSQL" },
              target: { id: ACME.id, type: "Provider", name: "Acme Corp" },
            },
          ]
        : [],
    );
    const { user, onRelationChange } = renderField({ fsId: FS_ID });
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    await waitFor(() => expect(onRelationChange).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Acme Corp", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(screen.queryByText("PostgreSQL")).not.toBeInTheDocument();
  });

  it("puts the Provider on the target side when the type runs card → Provider", async () => {
    withMetamodel(CARD_TYPES, [
      makeRelationType({
        key: "relITCToProvider",
        source_type_key: "ITComponent",
        target_type_key: "Provider",
      }),
    ]);
    mockApi.on("get", `/relations?card_id=${FS_ID}&type=relITCToProvider`, []);
    const { user } = renderField({ fsId: FS_ID });
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: "relITCToProvider",
      source_id: FS_ID,
      target_id: ACME.id,
    });
  });

  it("without a card id only remembers the pick and shows the chip", async () => {
    const { user, onProviderSelected } = renderField();
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    expect(onProviderSelected).toHaveBeenCalledWith({ id: ACME.id, name: "Acme Corp" });
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("filters the list as the user types, then offers to create a new Provider", async () => {
    mockApi.on("post", "/cards", { id: "prov-new", name: "Initech" });
    mockApi.on("get", RELATIONS_URL, () =>
      mockApi.callsOf("post", "/relations").length ? linkedTo({ id: "prov-new", name: "Initech" }) : [],
    );
    const { user, onChange, onProviderSelected } = renderField({ fsId: FS_ID });
    const input = screen.getByLabelText("Provider");
    await user.type(input, "Initech");

    const create = await screen.findByRole("option", { name: /Create Provider "Initech"/ });
    expect(screen.queryByRole("option", { name: /Acme Corp/ })).not.toBeInTheDocument();
    await user.click(create);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/No existing Provider matches "Initech"/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));

    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/cards")[0].body).toEqual({ type: "Provider", name: "Initech" });
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: REL_PROVIDER_TO_ITC.key,
      source_id: "prov-new",
      target_id: FS_ID,
    });
    expect(onChange).toHaveBeenCalledWith("Initech");
    expect(onProviderSelected).toHaveBeenCalledWith({ id: "prov-new", name: "Initech" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancels the create dialog without creating anything", async () => {
    const { user } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("forgets the pending Provider on Cancel, so a stray click on the closing dialog creates nothing", async () => {
    mockApi.on("post", "/cards", { id: "prov-new", name: "Initech" });
    const { user, onProviderSelected } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const dialog = await screen.findByRole("dialog");
    const createButton = within(dialog).getByRole("button", { name: "Create & Link" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    // The dialog is still fading out: its button is on screen but must be inert.
    fireEvent.click(createButton);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
    expect(onProviderSelected).not.toHaveBeenCalled();
  });

  it("forgets the pending Provider on Escape too", async () => {
    mockApi.on("post", "/cards", { id: "prov-new", name: "Initech" });
    const { user } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const dialog = await screen.findByRole("dialog");
    const createButton = within(dialog).getByRole("button", { name: "Create & Link" });
    await user.keyboard("{Escape}");
    fireEvent.click(createButton);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("keeps the create dialog open with the error when the Provider cannot be created", async () => {
    mockApi.fail("post", "/cards", 409, "duplicate");
    const { user, onProviderSelected, onChange } = renderField({ fsId: FS_ID });
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /cards failed");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create & Link" })).toBeEnabled();
    expect(onProviderSelected).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith("Initech Corp");
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);

    // Cancel closes it, and the next attempt starts without the old error.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.clear(screen.getByLabelText("Provider"));
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const again = await screen.findByRole("dialog");
    expect(within(again).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names a failed create that carries no message", async () => {
    mockApi.on("post", "/cards", () => Promise.reject("nope"));
    const { user } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("shows a failed link to the picked Provider, and drops it on the next successful one", async () => {
    mockApi.on("get", RELATIONS_URL, [EXISTING]);
    mockApi.fail("post", "/relations", 500);
    const { user, onRelationChange, onChange } = renderField({ fsId: FS_ID });
    await screen.findByText("Globex");
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("POST /relations failed");
    expect(onRelationChange).not.toHaveBeenCalled();
    // The card keeps the Provider it had, and the chip still says so.
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(screen.getByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();
    // The vendor text goes back to what it was: empty, i.e. no value.
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText("Provider")).toHaveValue("");

    mockApi.on("post", "/relations", {});
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Globex/ }));
    await waitFor(() => expect(onRelationChange).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names a failed link that carries no message", async () => {
    mockApi.on("get", RELATIONS_URL, []);
    mockApi.on("post", "/relations", () => Promise.reject("nope"));
    const { user } = renderField({ fsId: FS_ID });
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("ignores a late Provider lookup for the card it was showing before", async () => {
    const OTHER = CARD_IDS.erp;
    const otherUrl = `/relations?card_id=${OTHER}&type=${REL_PROVIDER_TO_ITC.key}`;
    let releaseFirst: (rows: Relation[]) => void = () => {};
    mockApi.on("get", RELATIONS_URL, () => new Promise<Relation[]>((resolve) => (releaseFirst = resolve)));
    mockApi.on("get", otherUrl, []);
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <VendorField value="" onChange={onChange} cardTypeKey="ITComponent" fsId={FS_ID} />,
    );
    await waitFor(() => expect(mockApi.callsOf("get", RELATIONS_URL)).toHaveLength(1));
    rerender(wrapWithProviders(<VendorField value="" onChange={onChange} cardTypeKey="ITComponent" fsId={OTHER} />));
    await waitFor(() => expect(mockApi.callsOf("get", otherUrl)).toHaveLength(1));
    // The superseded lookup is aborted…
    const firstOpts = mockApi.api.get.mock.calls.find(([path]) => path === RELATIONS_URL)?.[1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(firstOpts?.signal?.aborted).toBe(true);

    // …and its reply, landing last, does not put the old card's Provider on this one.
    await act(async () => releaseFirst([EXISTING]));
    expect(screen.queryByText("Globex", { selector: ".MuiChip-label" })).not.toBeInTheDocument();
  });

  it("offers no create option when the role may not create Providers", async () => {
    const { user } = renderField({}, userWith("inventory.view", "inventory.edit"));
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await waitFor(() => expect(mockApi.callsOf("get", "/cards?*").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("option", { name: /Create Provider/ })).not.toBeInTheDocument();
  });

  it("does not offer to create a Provider that already exists by name", async () => {
    const { user } = renderField();
    await user.type(screen.getByLabelText("Provider"), "acme corp");
    expect(await screen.findByRole("option", { name: /Acme Corp/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Create Provider/ })).not.toBeInTheDocument();
  });

  it("clearing the field drops the vendor and the remembered Provider", async () => {
    const { user, onChange, onProviderSelected } = renderField({ value: "Acme Corp" });
    await user.click(screen.getByLabelText("Provider"));
    await user.click(screen.getByTitle("Clear"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(onProviderSelected).toHaveBeenCalledWith(null);
  });
});

describe("VendorField — error alerts", () => {
  async function openCreateDialog(user: ReturnType<typeof renderField>["user"]) {
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    return screen.findByRole("dialog");
  }

  it("shows no error under the field once the linked Provider is shown", async () => {
    mockApi.on("get", RELATIONS_URL, [EXISTING]);
    renderField({ fsId: FS_ID });
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes a failed link's error from its close button", async () => {
    mockApi.fail("post", "/relations", 500);
    const { user } = renderField({ fsId: FS_ID });
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name: /Acme Corp/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("POST /relations failed");
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the create dialog without an error", async () => {
    const { user } = renderField({ fsId: FS_ID });
    const dialog = await openCreateDialog(user);
    expect(within(dialog).getByRole("button", { name: "Create & Link" })).toBeEnabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes a failed create's error from its close button, keeping the dialog open", async () => {
    mockApi.fail("post", "/cards", 409, "duplicate");
    const { user } = renderField({ fsId: FS_ID });
    const dialog = await openCreateDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("POST /cards failed");
    expect(alert).toHaveStyle({ marginTop: "8px" });
    await user.click(within(alert).getByRole("button", { name: "Close" }));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("drops a failed create's error while the retry runs", async () => {
    mockApi.fail("post", "/cards", 409, "duplicate");
    const { user } = renderField({ fsId: FS_ID });
    const dialog = await openCreateDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("POST /cards failed");

    let release!: (card: { id: string; name: string }) => void;
    mockApi.on(
      "post",
      "/cards",
      () => new Promise<{ id: string; name: string }>((resolve) => (release = resolve)),
    );
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/cards")).toHaveLength(2));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => release({ id: "prov-new", name: "Initech" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
