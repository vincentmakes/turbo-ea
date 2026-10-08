/**
 * VendorField regressions: the linked-Provider chip belongs to the card it was
 * looked up for, in the create-a-Provider flow it appears only once the new
 * Provider is actually linked to the card, and relinking the card to another
 * Provider never unlinks the old one before the new link is made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import {
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
const OTHER = CARD_IDS.erp;
const RELATIONS_URL = `/relations?card_id=${FS_ID}&type=${REL_PROVIDER_TO_ITC.key}`;
const OTHER_URL = `/relations?card_id=${OTHER}&type=${REL_PROVIDER_TO_ITC.key}`;

function linkedTo(cardId: string, provider: { id: string; name: string }): Relation[] {
  return [
    {
      id: `rel-${provider.id}`,
      type: REL_PROVIDER_TO_ITC.key,
      source_id: provider.id,
      target_id: cardId,
      source: { id: provider.id, type: "Provider", name: provider.name },
      target: { id: cardId, type: "ITComponent", name: "Some card" },
    },
  ];
}

const chip = (name: string) => screen.queryByText(name, { selector: ".MuiChip-label" });

function field(fsId?: string) {
  return <VendorField value="" onChange={() => {}} cardTypeKey="ITComponent" fsId={fsId} />;
}

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  mockApi.reset();
  mockApi.on("get", "/cards?*", cardPage([]));
  mockApi.on("delete", "/relations/*", {});
});

describe("VendorField — the chip follows the card", () => {
  it("drops the previous card's Provider when the next card has none", async () => {
    mockApi.on("get", RELATIONS_URL, linkedTo(FS_ID, { id: "p-globex", name: "Globex" }));
    mockApi.on("get", OTHER_URL, []);
    const { rerender } = renderWithProviders(field(FS_ID));
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();

    rerender(wrapWithProviders(field(OTHER)));
    await waitFor(() => expect(mockApi.callsOf("get", OTHER_URL)).toHaveLength(1));
    await waitFor(() => expect(chip("Globex")).not.toBeInTheDocument());
  });

  it("does not show the previous card's Provider while the next card's lookup is pending", async () => {
    mockApi.on("get", RELATIONS_URL, linkedTo(FS_ID, { id: "p-globex", name: "Globex" }));
    mockApi.on("get", OTHER_URL, () => new Promise(() => {}));
    const { rerender } = renderWithProviders(field(FS_ID));
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();

    rerender(wrapWithProviders(field(OTHER)));
    await waitFor(() => expect(mockApi.callsOf("get", OTHER_URL)).toHaveLength(1));
    expect(chip("Globex")).not.toBeInTheDocument();
  });

  it("shows the next card's own Provider", async () => {
    mockApi.on("get", RELATIONS_URL, linkedTo(FS_ID, { id: "p-globex", name: "Globex" }));
    mockApi.on("get", OTHER_URL, linkedTo(OTHER, { id: "p-acme", name: "Acme Corp" }));
    const { rerender } = renderWithProviders(field(FS_ID));
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();

    rerender(wrapWithProviders(field(OTHER)));
    expect(await screen.findByText("Acme Corp", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(chip("Globex")).not.toBeInTheDocument();
  });
});

describe("VendorField — creating a Provider for a card", () => {
  async function createInitech(user: ReturnType<typeof renderWithProviders>["user"]) {
    await user.type(screen.getByLabelText("Provider"), "Initech");
    await user.click(await screen.findByRole("option", { name: /Create Provider "Initech"/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create & Link" }));
  }

  it("shows no chip for the new Provider when linking it to the card fails", async () => {
    mockApi.on("post", "/cards", { id: "prov-new", name: "Initech" });
    mockApi.on("get", RELATIONS_URL, []);
    mockApi.fail("post", "/relations", 500);
    const { user } = renderWithProviders(field(FS_ID));
    await createInitech(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("POST /relations failed");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(chip("Initech")).not.toBeInTheDocument();
  });

  it("shows the chip once the new Provider is linked", async () => {
    mockApi.on("post", "/cards", { id: "prov-new", name: "Initech" });
    mockApi.on("post", "/relations", {});
    mockApi.on("get", RELATIONS_URL, () =>
      mockApi.callsOf("post", "/relations").length
        ? linkedTo(FS_ID, { id: "prov-new", name: "Initech" })
        : [],
    );
    const { user } = renderWithProviders(field(FS_ID));
    await createInitech(user);

    expect(await screen.findByText("Initech", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("VendorField — relinking the card to another Provider", () => {
  const GLOBEX = { id: "p-globex", name: "Globex" };
  const ACME = { id: "p-acme", name: "Acme Corp" };

  /** A server holding this card's Provider relations of one type. */
  function serveRelations(url: string, initial: Relation[], newRow: (body: Relation) => Relation) {
    let rows = initial;
    mockApi.on("get", url, () => rows);
    mockApi.on("post", "/relations", (_p: string, body: unknown) => {
      const sent = body as Relation;
      const same = rows.find(
        (r) => r.type === sent.type && r.source_id === sent.source_id && r.target_id === sent.target_id,
      );
      if (same) return same; // POST /relations is idempotent on the pair.
      const row = newRow(sent);
      rows = [...rows, row];
      return row;
    });
    mockApi.on("delete", "/relations/*", (path: string) => {
      rows = rows.filter((r) => `/relations/${r.id}` !== path);
      return {};
    });
  }

  const writes = () =>
    mockApi.calls
      .filter((c) => c.method === "post" || c.method === "delete")
      .map((c) => `${c.method} ${c.path}`);

  beforeEach(() => {
    mockApi.on(
      "get",
      "/cards?*",
      cardPage([GLOBEX, ACME].map((p) => makeCard({ ...p, type: "Provider" }))),
    );
  });

  async function pick(user: ReturnType<typeof renderWithProviders>["user"], name: RegExp) {
    await user.click(screen.getByLabelText("Provider"));
    await user.click(await screen.findByRole("option", { name }));
  }

  it("keeps the old link and its chip when the new link fails", async () => {
    mockApi.on("get", RELATIONS_URL, linkedTo(FS_ID, GLOBEX));
    mockApi.fail("post", "/relations", 500);
    const { user } = renderWithProviders(field(FS_ID));
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();

    await pick(user, /Acme Corp/);
    expect(await screen.findByRole("alert")).toHaveTextContent("POST /relations failed");
    expect(mockApi.callsOf("delete")).toHaveLength(0);
    expect(chip("Globex")).toBeInTheDocument();
  });

  it("links the new Provider before it unlinks the old one", async () => {
    serveRelations(RELATIONS_URL, linkedTo(FS_ID, GLOBEX), (b) => ({
      ...b,
      id: "rel-acme",
      source: { id: ACME.id, type: "Provider", name: ACME.name },
      target: { id: FS_ID, type: "ITComponent", name: "Some card" },
    }));
    const { user } = renderWithProviders(field(FS_ID));
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();

    await pick(user, /Acme Corp/);
    expect(await screen.findByText("Acme Corp", { selector: ".MuiChip-label" })).toBeInTheDocument();
    expect(writes()).toEqual(["post /relations", `delete /relations/rel-${GLOBEX.id}`]);
    expect(chip("Globex")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the link when the linked Provider is picked again on a card → Provider type", async () => {
    const CARD_TO_PROVIDER = makeRelationType({
      key: "relITCToProvider",
      source_type_key: "ITComponent",
      target_type_key: "Provider",
    });
    withMetamodel(CARD_TYPES, [CARD_TO_PROVIDER]);
    const url = `/relations?card_id=${FS_ID}&type=relITCToProvider`;
    const existing: Relation = {
      id: "rel-globex",
      type: "relITCToProvider",
      source_id: FS_ID,
      target_id: GLOBEX.id,
      source: { id: FS_ID, type: "ITComponent", name: "Some card" },
      target: { id: GLOBEX.id, type: "Provider", name: GLOBEX.name },
    };
    serveRelations(url, [existing], (b) => ({ ...b, id: "rel-other" }));
    const { user } = renderWithProviders(field(FS_ID));
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();

    await pick(user, /Globex/);
    await waitFor(() => expect(mockApi.callsOf("get", url)).toHaveLength(3));
    expect(writes()).toEqual(["post /relations"]);
    expect(await screen.findByText("Globex", { selector: ".MuiChip-label" })).toBeInTheDocument();
  });
});
