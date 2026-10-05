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
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders, userWith } from "@/test/render";
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
import type { Relation } from "@/types";
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

  it("reports typed text as the vendor value", async () => {
    const { user, onChange } = renderField();
    await user.type(screen.getByLabelText("Provider"), "Ac");
    expect(onChange).toHaveBeenLastCalledWith("Ac");
  });

  it("browses all Providers on open, then relinks the card to the picked one", async () => {
    // Globex is linked until the POST lands; the re-read afterwards shows Acme.
    mockApi.on("get", RELATIONS_URL, () =>
      mockApi.callsOf("post", "/relations").length ? linkedTo(ACME) : [EXISTING],
    );
    const { user, onChange, onRelationChange, onProviderSelected } = renderField({ fsId: FS_ID });
    await screen.findByText("Globex");

    await user.click(screen.getByLabelText("Provider"));
    expect(await screen.findByRole("option", { name: /Acme Corp/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Globex/ })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Acme Corp/ }));

    expect(onChange).toHaveBeenCalledWith("Acme Corp");
    expect(onProviderSelected).toHaveBeenCalledWith({ id: ACME.id, name: "Acme Corp" });
    await waitFor(() => expect(onRelationChange).toHaveBeenCalledTimes(1));
    // The old link goes first, then the new one in the type's direction.
    expect(mockApi.callsOf("delete", "/relations/rel-old")).toHaveLength(1);
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: REL_PROVIDER_TO_ITC.key,
      source_id: ACME.id,
      target_id: FS_ID,
    });
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByLabelText("Provider")).toHaveValue("Acme Corp");
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
