import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { vi, it, expect, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { api, ApiError } from "@/api/client";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import type { User } from "@/types";
import BoRelationshipPage from "./BoRelationshipPage";
import type Diagram from "./BoRelationshipDiagram";

vi.mock("@/api/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/api/client")>(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/AuthContext", () => ({ useOptionalAuthUser: vi.fn() }));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "DataObject", subtypes: [{ key: "Data", label: "Custom Data" }] }],
    getType: () => undefined,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => [key, ...Object.values(values ?? {})].join(" "),
    i18n: { language: "en" },
  }),
}));
// Stands in for the real panel's contract (#1397): with unsaved edits and a declined
// confirm it keeps showing its card and tells the parent to put its selection back.
const panelDirty = vi.hoisted(() => ({ value: false }));
vi.mock("@/components/CardDetailSidePanel", async () => {
  const { useEffect, useRef } = await import("react");
  const Panel = ({ cardId, open, refreshKey, onSaved, onKeepCard }: {
      cardId: string; open: boolean; refreshKey: number; onSaved: () => void;
      onKeepCard?: (id: string) => void;
    }) => {
      const shown = useRef(cardId);
      const keep = open && panelDirty.value && cardId !== shown.current;
      if (!keep) shown.current = cardId;
      useEffect(() => { if (keep) onKeepCard?.(shown.current); });
      return open ? (
        <div data-testid="card-panel" data-refresh={refreshKey}>
          {shown.current}
          <button onClick={onSaved}>Refetch from card panel</button>
        </div>
      ) : null;
  };
  return { default: Panel };
});
vi.mock("./BoRelationshipDiagram", () => ({
  default: ({
    nodes, edges, positions, showGrid, onActivate, onMove, onRequestRemoveEdge, onShortcut,
  }: React.ComponentProps<typeof Diagram>) => (
    <div data-testid="canvas" data-grid={showGrid} data-edges={edges.map((edge) => edge.id).join(",")} data-positions={JSON.stringify(positions)}>
      {nodes.map((node) => <button key={node.id} onClick={() => onActivate(node.id)}>{node.name}</button>)}
      {nodes[0] && onMove && <button onClick={() => onMove(nodes[0].id, { x: 96, y: 48 })}>Move first BO</button>}
      {onShortcut && <>
        <button onClick={() => onShortcut("copy")}>Canvas copy</button>
        <button onClick={() => onShortcut("paste")}>Canvas paste</button>
        <button onClick={() => onShortcut("selectAll")}>Canvas select all</button>
        <button onClick={() => onShortcut("delete")}>Canvas delete</button>
        <button onClick={() => onShortcut("undo")}>Canvas undo</button>
        <button onClick={() => onShortcut("edit")}>Canvas rename</button>
      </>}
      {onRequestRemoveEdge && edges.map((edge) => (
        <button key={edge.id} onClick={() => onRequestRemoveEdge(edge.id)}>Remove line {edge.source}</button>
      ))}
    </div>
  ),
}));

function signInAsEditor() {
  vi.mocked(useOptionalAuthUser).mockReturnValue({ permissions: { "*": true } } as User);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  panelDirty.value = false;
  vi.mocked(useOptionalAuthUser).mockReturnValue(null);
});

it("opens the chosen card alongside the canvas and shows its own application groups", async () => {
  vi.mocked(api.get).mockResolvedValue({ nodes: [{ id: "a", name: "Customer", subtype: "Data", isPersonalData: true, isPaymentData: false }, { id: "b", name: "Order", subtype: "Document", isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: { a: { master: { id: "x", name: "CRM" }, slaves: [], unclassified: [] }, b: { master: null, slaves: [], unclassified: [{ id: "y", name: "ERP" }] } }, capabilities: { can_manage_master: false }, snapshot_revision: null });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Customer" }));
  expect(screen.getByTestId("card-panel")).toHaveTextContent("a");
  expect(screen.getByTestId("canvas")).toBeInTheDocument();
  expect(screen.getByText("CRM")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Order" }));
  expect(screen.getByTestId("card-panel")).toHaveTextContent("b");
  expect(screen.getByText("ERP")).toBeInTheDocument();
  expect(screen.queryByText("CRM")).not.toBeInTheDocument();
});

it("puts the canvas selection back on the open card when the user declines to leave its unsaved edits", async () => {
  const graph = { ...baseGraph, nodes: [customer, order], applications: {
    a: { master: { id: "x", name: "CRM" }, slaves: [], unclassified: [] },
    b: { master: null, slaves: [], unclassified: [{ id: "y", name: "ERP" }] },
  } };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? graph : { changes: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: customer.name }));
  expect(screen.getByTestId("card-panel")).toHaveTextContent(customer.id);
  expect(screen.getByText("CRM")).toBeInTheDocument();
  panelDirty.value = true;

  fireEvent.click(screen.getByRole("button", { name: order.name }));

  await waitFor(() => expect(screen.getByTestId("card-panel")).toHaveTextContent(customer.id));
  expect(screen.getByTestId("card-panel")).not.toHaveTextContent(order.id);
  // The side column reads the page's selection: it is back on the first object.
  expect(screen.getByText("CRM")).toBeInTheDocument();
  expect(screen.queryByText("ERP")).not.toBeInTheDocument();
});

it("groups drawing actions above the workspace and reserves a card panel before selection", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);

  const heading = await screen.findByRole("heading", { name: "boRelationship.title" });
  const header = heading.closest("header")!;
  expect(within(header).getByRole("button", { name: "toolbar.back" })).toBeInTheDocument();
  // The header's sync button only exists once the graph has loaded; the title does not wait for it.
  expect(await within(header).findByRole("button", { name: "editor.toolbar.sync" })).toBeInTheDocument();
  const toolbar = screen.getByRole("toolbar", { name: "boRelationship.title" });
  expect(within(toolbar).getByRole("button", { name: "boRelationship.newObject" })).toBeInTheDocument();
  expect(within(toolbar).getByRole("button", { name: "common:actions.save" })).toBeDisabled();
  expect(within(toolbar).getByRole("button", { name: "archimate:toolbar.fit" })).toBeInTheDocument();
  const grid = within(toolbar).getByRole("button", { name: "editor.toolbar.dotGrid" });
  expect(grid).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(grid);
  expect(grid).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-grid", "false");
  const applications = screen.getByRole("complementary", { name: "boRelationship.applications" });
  const detail = screen.getByRole("complementary", { name: "boRelationship.cardDetails" });
  expect(within(applications).getByText("boRelationship.noSelection")).toBeInTheDocument();
  const toggle = within(toolbar).getByRole("button", { name: "boRelationship.applications" });
  fireEvent.click(toggle);
  expect(applications).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByRole("complementary", { name: "boRelationship.applications" })).toBeInTheDocument();
  expect(within(detail).queryByTestId("card-panel")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: customer.name }));
  expect(within(detail).getByTestId("card-panel")).toHaveTextContent(customer.id);
});

it("restores the dot grid choice when Data Modeller is reopened", async () => {
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  const page = <MemoryRouter><BoRelationshipPage /></MemoryRouter>;
  const grid = () => screen.findByRole("button", { name: "editor.toolbar.dotGrid" });
  const first = render(page);
  fireEvent.click(await grid());
  first.unmount();

  const second = render(page);
  expect(await grid()).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-grid", "false");
  fireEvent.click(await grid());
  second.unmount();

  render(page);
  expect(await grid()).toHaveAttribute("aria-pressed", "true");
});

it("toggles the docked panel and opens the keyboard shortcuts dialog", async () => {
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  const toggle = await screen.findByRole("button", { name: "archimate:toolbar.togglePanel" });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("complementary", { name: "boRelationship.cardDetails" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: customer.name }));
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("card-panel")).toHaveTextContent(customer.id);
  fireEvent.click(screen.getByRole("button", { name: "archimate:toolbar.shortcuts" }));
  const help = await screen.findByRole("dialog", { name: "archimate:shortcuts.title" });
  expect(within(help).getByText("Ctrl+0")).toBeInTheDocument();
  expect(within(help).queryByText("Ctrl+Z")).not.toBeInTheDocument();
});

it("pastes a copied BO as an editable draft and can undo hiding the visible nodes", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: customer.name }));
  fireEvent.click(screen.getByRole("button", { name: "Canvas copy" }));
  fireEvent.click(screen.getByRole("button", { name: /boRelationship.filters/ }));
  const personalData = screen.getByRole("checkbox", { name: "boRelationship.personalData" });
  fireEvent.click(personalData);
  expect(screen.queryByRole("button", { name: customer.name })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Canvas paste" }));
  const editor = screen.getByRole("dialog", { name: "boRelationship.newObject" });
  const name = within(editor).getByRole("textbox", { name: "boRelationship.objectName" });
  expect((name as HTMLInputElement).value).toContain(customer.name);
  fireEvent.change(name, { target: { value: "Customer draft" } });
  fireEvent.click(within(editor).getByRole("button", { name: "boRelationship.stageObject" }));
  fireEvent.click(personalData);
  expect(screen.getByRole("button", { name: "Customer draft" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Canvas select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Canvas delete" }));
  expect(screen.queryByRole("button", { name: customer.name })).not.toBeInTheDocument();
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Canvas undo" }));
  expect(screen.getByRole("button", { name: customer.name })).toBeVisible();
  expect(screen.getByRole("button", { name: "Customer draft" })).toBeVisible();
  expect(api.put).not.toHaveBeenCalled();
});

it.each([true, false])("checks the saved card edit permission before renaming (can edit: %s)", async (canEdit) => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === "/bo-relationship") return baseGraph;
    if (path === `/bo-relationship/objects/${customer.id}/detail`) {
      return { card: customer, permissions: { can_edit: canEdit } };
    }
    return { changes: [] };
  });
  vi.mocked(api.patch).mockResolvedValue({});
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: customer.name }));
  fireEvent.click(screen.getByRole("button", { name: "Canvas rename" }));
  if (!canEdit) {
    expect(await screen.findByText("common:errors.forbidden")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "archimate:shortcuts.edit" })).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    return;
  }
  const modal = await screen.findByRole("dialog", { name: "archimate:shortcuts.edit" });
  fireEvent.change(within(modal).getByRole("textbox", { name: "boRelationship.objectName" }), { target: { value: "Updated BO" } });
  fireEvent.click(within(modal).getByRole("button", { name: "common:actions.save" }));
  expect(api.patch).toHaveBeenCalledWith(`/cards/${customer.id}`, { name: "Updated BO" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "archimate:shortcuts.edit" })).not.toBeInTheDocument());
  // The dialog's exit transition keeps the page aria-hidden a moment after the dialog is gone.
  expect(await screen.findByRole("button", { name: customer.name })).toBeVisible();
});

it("updates or clears the master and refreshes both panels", async () => {
  signInAsEditor();
  const graph = { nodes: [{ id: "a", name: "Customer", subtype: "data", isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: { a: { master: { id: "x", name: "CRM" }, slaves: [{ id: "y", name: "ERP" }], unclassified: [] } }, capabilities: { can_manage_master: true }, snapshot_revision: null };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put)
    .mockResolvedValueOnce({ master: { id: "y", name: "ERP" }, slaves: [{ id: "x", name: "CRM" }], unclassified: [] })
    .mockResolvedValueOnce({ master: null, slaves: [], unclassified: [{ id: "x", name: "CRM" }, { id: "y", name: "ERP" }] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Customer" }));
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === "/bo-relationship/changes")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.setMaster" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/objects/a/master", { application_id: "y" }));
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === "/bo-relationship/changes")).toHaveLength(2));
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === "/bo-relationship").length).toBeGreaterThan(1));
  expect(screen.getByTestId("card-panel")).toHaveAttribute("data-refresh", "1");
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.clearMaster" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/objects/a/master", { application_id: null }));
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === "/bo-relationship/changes")).toHaveLength(3));
  await waitFor(() => expect(screen.queryByRole("button", { name: "boRelationship.clearMaster" })).not.toBeInTheDocument());
});

it("shows an isolated object with empty groups and no master controls for viewers", async () => {
  vi.mocked(api.get).mockResolvedValue({ nodes: [{ id: "z", name: "Isolated", subtype: null, isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: {}, capabilities: { can_manage_master: false }, snapshot_revision: null });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Isolated" }));
  expect(screen.getByText("boRelationship.master")).toBeInTheDocument();
  expect(screen.getByText("boRelationship.slave")).toBeInTheDocument();
  expect(screen.getByText("boRelationship.unclassified")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.setMaster" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.clearMaster" })).not.toBeInTheDocument();
});

it("shows the live master returned by the mutation even if the saved graph is older", async () => {
  signInAsEditor();
  const graph = { nodes: [{ id: "a", name: "Customer", subtype: "data", isPersonalData: false, isPaymentData: false }], edges: [], positions: {}, applications: { a: { master: null, slaves: [], unclassified: [{ id: "y", name: "ERP" }] } }, capabilities: { can_manage_master: true }, snapshot_revision: null };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValue({ master: { id: "y", name: "ERP" }, slaves: [], unclassified: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Customer" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.setMaster" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.clearMaster" })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "boRelationship.setMaster" })).not.toBeInTheDocument();
});


it("filters nodes and incident edges with AND while retaining positions and clearing hidden selection", async () => {
  vi.mocked(api.get).mockResolvedValue({
    nodes: [
      { id: "a", name: "Personal", subtype: null, isPersonalData: true, isPaymentData: false },
      { id: "b", name: "Payment", subtype: null, isPersonalData: false, isPaymentData: true },
      { id: "c", name: "Both", subtype: null, isPersonalData: true, isPaymentData: true },
    ],
    edges: [{ id: "ab", source: "a", target: "b", cardinality: null }, { id: "bc", source: "b", target: "c", cardinality: null }],
    positions: { a: { x: 10, y: 20 }, b: { x: 30, y: 40 }, c: { x: 50, y: 60 } },
    applications: {}, capabilities: { can_manage_master: false }, snapshot_revision: null,
  });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Personal" }));
  const originalPositions = screen.getByTestId("canvas").getAttribute("data-positions");
  fireEvent.click(screen.getByRole("button", { name: /boRelationship.filters/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.paymentData" }));
  expect(screen.queryByRole("button", { name: "Personal" })).not.toBeInTheDocument();
  expect(screen.queryByTestId("card-panel")).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "bc");
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", originalPositions);
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.personalData" }));
  expect(screen.queryByRole("button", { name: "Payment" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.paymentData" }));
  expect(screen.getByRole("button", { name: "Personal" })).toBeInTheDocument();
  expect(screen.queryByTestId("card-panel")).not.toBeInTheDocument();
});

it("keeps filters active when collapsed and shows an empty result without unmounting the canvas", async () => {
  vi.mocked(api.get).mockResolvedValue({
    nodes: [{ id: "a", name: "Personal", subtype: null, isPersonalData: true, isPaymentData: false }],
    edges: [], positions: {}, applications: {}, capabilities: { can_manage_master: false }, snapshot_revision: null,
  });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await screen.findByRole("button", { name: "Personal" });
  const filters = screen.getByRole("button", { name: /boRelationship.filters/ });
  fireEvent.click(filters);
  expect(filters).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: "boRelationship.paymentData" }));
  expect(screen.getByText("boRelationship.noFilterResults")).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toBeInTheDocument();
  filters.focus();
  await userEvent.keyboard(" ");
  expect(filters).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Personal" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("checkbox", { checked: true })).toBeInTheDocument();
});

const customer = { id: "a", name: "Customer", subtype: "Data", isPersonalData: false, isPaymentData: false };
const order = { ...customer, id: "b", name: "Order" };
const orderEdge = { id: "ab", source: "a", target: "b", cardinality: null };
const baseGraph = {
  nodes: [customer],
  edges: [],
  positions: { a: { x: 10, y: 20 } },
  applications: {},
  capabilities: { can_manage_master: true },
  snapshot_revision: "rev-1",
};

function openPage() {
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  return screen.findByRole("button", { name: "Customer" });
}

async function stageOrderAndLink() {
  const customerButton = await openPage();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.newObject" }));
  let dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("boRelationship.objectName"), { target: { value: "Order" } });
  const stage = within(dialog).getByRole("button", { name: "boRelationship.stageObject" });
  expect(stage).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("boRelationship.subtype"), { target: { value: "Data" } });
  fireEvent.click(stage);
  fireEvent.click(customerButton);
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.linkObjects" }));
  dialog = screen.getByRole("dialog");
  const target = within(dialog).getByLabelText("boRelationship.targetObject");
  const orderOption = within(target).getByRole("option", { name: "Order" }) as HTMLOptionElement;
  fireEvent.change(target, { target: { value: orderOption.value } });
  fireEvent.click(within(dialog).getByRole("button", { name: "boRelationship.stageLink" }));
}

it("discards a rejected BO and its dependent link while keeping independent edits", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put).mockRejectedValueOnce(new ApiError("Duplicate BO name", 409, null));
  await stageOrderAndLink();

  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Duplicate BO name/)).toBeInTheDocument();
  expect(screen.getByText(/boRelationship.waitingForObject/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.discardFailedDraft Order" }));

  expect(screen.queryByRole("button", { name: "Order" })).not.toBeInTheDocument();
  expect(screen.queryByText(/boRelationship.waitingForObject/)).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  vi.mocked(api.put).mockResolvedValue({ ...baseGraph, positions: { a: { x: 96, y: 48 } } });
  fireEvent.click(save);
  await waitFor(() => expect(api.put).toHaveBeenNthCalledWith(2, "/bo-relationship/layout",
    expect.objectContaining({ positions: { a: { x: 96, y: 48 } }, saved_drafts: [] })));
  expect(api.delete).not.toHaveBeenCalled();
});

it("prevents staging an object name beyond the API limit", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.newObject" }));
  const dialog = screen.getByRole("dialog");
  const name = within(dialog).getByLabelText("boRelationship.objectName");
  fireEvent.change(within(dialog).getByLabelText("boRelationship.subtype"), { target: { value: "Data" } });
  fireEvent.change(name, { target: { value: "a".repeat(501) } });
  const stage = within(dialog).getByRole("button", { name: "boRelationship.stageObject" });
  expect(stage).toBeDisabled();
  fireEvent.change(name, { target: { value: "a".repeat(500) } });
  expect(stage).toBeEnabled();
});

it("keeps a saved BO and retries only its failed link with the same draft ID", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  let linkFailed = false;
  let linkSaved = false;
  vi.mocked(api.put).mockImplementation(async (path) => {
    if (path.startsWith("/bo-relationship/objects/")) return order;
    if (path.startsWith("/bo-relationship/relation-drafts/")) {
      if (!linkFailed) {
        linkFailed = true;
        throw new Error("Link unavailable");
      }
      linkSaved = true;
      return orderEdge;
    }
    return { ...baseGraph, nodes: [customer, order], edges: linkSaved ? [orderEdge] : [] };
  });

  await stageOrderAndLink();
  expect(api.put).not.toHaveBeenCalled();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Link unavailable/)).toBeInTheDocument();
  const [object, failedLink, firstLayout] = vi.mocked(api.put).mock.calls;
  expect(object).toEqual([expect.stringMatching(/^\/bo-relationship\/objects\/[0-9a-f-]{36}$/), {
    name: "Order", subtype: "Data", isPersonalData: false, isPaymentData: false,
  }]);
  expect(failedLink).toEqual([expect.stringMatching(/^\/bo-relationship\/relation-drafts\/[0-9a-f-]{36}$/), {
    source_id: "a", target_id: "b",
  }]);
  expect(firstLayout).toEqual(["/bo-relationship/layout", expect.objectContaining({
    saved_drafts: [{ kind: "node", id: object[0].split("/").at(-1) }],
  })]);
  expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab"));
  expect(vi.mocked(api.put).mock.calls.slice(3)).toEqual([
    failedLink,
    ["/bo-relationship/layout", expect.objectContaining({
      saved_drafts: [{ kind: "edge", id: failedLink[0].split("/").at(-1) }],
    })],
  ]);
});

it("retries a lost object response with the same UUID even without crypto.randomUUID", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put)
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce(order)
    .mockResolvedValueOnce(orderEdge)
    .mockResolvedValueOnce({ ...baseGraph, nodes: [customer, order], edges: [orderEdge] });
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    await stageOrderAndLink();
    const save = screen.getByRole("button", { name: "common:actions.save" });
    fireEvent.click(save);
    expect(await screen.findByText(/Response lost/)).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(api.put).mock.calls[0];
    expect(url).toMatch(/\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab"));
    expect(vi.mocked(api.put).mock.calls[1]).toEqual(vi.mocked(api.put).mock.calls[0]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("retains failed position writes for the next Save", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put)
    .mockRejectedValueOnce(new Error("Positions unavailable"))
    .mockResolvedValueOnce({ ...baseGraph, positions: { a: { x: 96, y: 48 } } });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Positions unavailable/)).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify({ a: { x: 96, y: 48 } }));
  fireEvent.click(save);
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.put).mock.calls[1]).toEqual(vi.mocked(api.put).mock.calls[0]);
  expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    positions: { a: { x: 96, y: 48 } },
  }));
});

it("applies a newer scoped graph read after showing the committed layout response", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const positions = { a: { x: 96, y: 48 }, b: { x: 400, y: 30 } };
  let graphReads = 0;
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes"
    ? { changes: [] } : ++graphReads === 1 ? graph : { ...baseGraph, positions });
  vi.mocked(api.put).mockResolvedValue({ ...graph, positions });
  fireEvent.click(await openPage());
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole("button", { name: "Move first BO" })).toBeEnabled());
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(positions));
  fireEvent.click(screen.getByRole("button", { name: "Refetch from card panel" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Order" })).not.toBeInTheDocument());
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
});

it("retries a failed layout Save without recreating the successful BO and ER link", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put)
    .mockResolvedValueOnce(order)
    .mockResolvedValueOnce(orderEdge)
    .mockRejectedValueOnce(new Error("Layout unavailable"))
    .mockResolvedValueOnce({
      ...baseGraph, nodes: [customer, order], edges: [orderEdge],
      positions: { ...baseGraph.positions, b: { x: 400, y: 30 } },
    });
  await stageOrderAndLink();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText("Layout unavailable")).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(save);
  await waitFor(() => expect(screen.queryByText("Layout unavailable")).not.toBeInTheDocument());
  expect(save).toBeDisabled();
  const calls = vi.mocked(api.put).mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls[3]).toEqual(calls[2]);
});

it("drops a successful BO draft and its dependent link when the layout reports the BO unavailable", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  vi.mocked(api.put).mockImplementation(async (path, body) => {
    if (path.startsWith("/bo-relationship/objects/")) return order;
    if (path.startsWith("/bo-relationship/relation-drafts/")) throw new Error("BO unavailable");
    return {
      ...baseGraph,
      unavailable_drafts: (body as { saved_drafts: unknown[] }).saved_drafts,
    };
  });
  await stageOrderAndLink();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText("boRelationship.draftUnavailable")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Order" })).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(save).toBeDisabled();
});

it("discards a staged line locally without prompting or writing to inventory", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockResolvedValue(baseGraph);
  await stageOrderAndLink();
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
  expect(api.put).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

it("saves a visual removal and retries inventory deletion only through Sync", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValue({ ...graph, edges: [] });
  vi.mocked(api.delete).mockRejectedValueOnce(new Error("Delete response lost")).mockResolvedValueOnce(undefined);
  await openPage();
  const remove = screen.getByRole("button", { name: "Remove line a" });
  fireEvent.click(remove);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Customer");
  expect(dialog).toHaveTextContent("Order");
  fireEvent.click(within(dialog).getByRole("button", { name: "boRelationship.keepLine" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(remove);
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.cancelRemoval" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    removed_relation_ids: ["ab"],
  })));
  expect(api.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.syncAll" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.syncAll" }));
  expect(await screen.findByText(/Delete response lost/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.syncRemoval" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "boRelationship.cancelRemoval" })).not.toBeInTheDocument());
  expect(vi.mocked(api.delete).mock.calls).toEqual([
    ["/bo-relationship/relations/ab"], ["/bo-relationship/relations/ab"],
  ]);
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
});

it("restores a queued line after a visual Save when its removal is cancelled", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const savedGraph = { ...graph, edges: [], positions: { ...graph.positions, b: { x: 400, y: 30 } } };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValueOnce(savedGraph).mockResolvedValueOnce(graph);
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  const cancel = screen.getByRole("button", { name: "boRelationship.cancelRemoval" });
  await waitFor(() => expect(cancel).toBeEnabled());
  expect(save).toBeDisabled();
  fireEvent.click(cancel);
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  fireEvent.click(save);
  await waitFor(() => expect(api.put).toHaveBeenNthCalledWith(2, "/bo-relationship/layout", expect.objectContaining({
    restored_relation_ids: ["ab"],
    removed_relation_ids: [],
  })));
  expect(api.delete).not.toHaveBeenCalled();
});

it("reopens the saved drawing with an empty inventory deletion queue", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const savedGraph = { ...graph, edges: [], positions: { ...graph.positions, b: { x: 400, y: 30 } } };
  let graphReads = 0;
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes"
    ? { changes: [] } : ++graphReads === 1 ? graph : savedGraph);
  vi.mocked(api.put).mockResolvedValue(savedGraph);
  const page = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.syncAll" })).toBeEnabled());
  page.unmount();
  await openPage();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(screen.queryByRole("button", { name: "boRelationship.syncAll" })).not.toBeInTheDocument();
  expect(api.delete).not.toHaveBeenCalled();
});

it("saves an unrelated move when a queued visual removal is no longer available", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const positions = { a: { x: 96, y: 48 }, b: { x: 400, y: 30 } };
  vi.mocked(api.get).mockResolvedValue(graph);
  vi.mocked(api.put).mockResolvedValue({
    ...graph, edges: [], positions, inventory_conflicts: [{ kind: "edge", id: "ab" }],
  });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText("boRelationship.visualChangeUnavailable")).toBeInTheDocument();
  expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    skip_unavailable_relations: true,
    removed_relation_ids: ["ab"],
    positions: { a: { x: 96, y: 48 } },
  }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(positions));
  expect(save).toBeDisabled();
  expect(screen.getByRole("button", { name: "boRelationship.syncRemoval" })).toBeEnabled();
  expect(api.delete).not.toHaveBeenCalled();
});

it("omits drawing actions for viewers", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...baseGraph, nodes: [customer, order], edges: [orderEdge] });
  fireEvent.click(await openPage());
  expect(screen.queryByRole("button", { name: "common:actions.save" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.newObject" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.linkObjects" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.linkApplication" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove line a" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Move first BO" })).not.toBeInTheDocument();
});

const crm = { id: "crm", name: "CRM" };
const erp = { id: "erp", name: "ERP" };

async function stageApplication(name: string, role: "master" | "slave" | "unclassified") {
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.linkApplication" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.focus(within(dialog).getByRole("combobox", { name: "boRelationship.application" }));
  fireEvent.click(await screen.findByRole("option", { name }));
  fireEvent.change(within(dialog).getByLabelText("boRelationship.role"), { target: { value: role } });
  fireEvent.click(within(dialog).getByRole("button", { name: "boRelationship.stageLink" }));
}

it("discards a rejected Application link without dropping another edit", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path.startsWith("/bo-relationship/applications?")
    ? { items: [crm], total: 1 }
    : baseGraph);
  vi.mocked(api.put).mockRejectedValueOnce(new ApiError("Application unavailable", 404, null));
  fireEvent.click(await openPage());
  await stageApplication("CRM", "unclassified");
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Application unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.discardFailedDraft Customer ↔ CRM" }));
  expect(screen.queryByText(/Application unavailable/)).not.toBeInTheDocument();
  expect(screen.queryByText(/CRM · boRelationship.unclassified/)).not.toBeInTheDocument();

  vi.mocked(api.put).mockResolvedValue({ ...baseGraph, positions: { a: { x: 96, y: 48 } } });
  fireEvent.click(save);
  await waitFor(() => expect(api.put).toHaveBeenNthCalledWith(2, "/bo-relationship/layout",
    expect.objectContaining({ positions: { a: { x: 96, y: 48 } }, saved_drafts: [] })));
  expect(api.delete).not.toHaveBeenCalled();
});

it("keeps a Slave pending until the staged Master saves, using the module-scoped picker", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path.startsWith("/bo-relationship/applications?")
    ? { items: [crm, erp], total: 2 }
    : baseGraph);
  vi.mocked(api.put)
    .mockRejectedValueOnce(new Error("Master unavailable"))
    .mockResolvedValueOnce({ id: "ac", object_id: "a", application: crm, is_master: true })
    .mockResolvedValueOnce({ id: "ae", object_id: "a", application: erp, is_master: false })
    .mockResolvedValueOnce({ ...baseGraph, applications: { a: { master: crm, slaves: [erp], unclassified: [] } } });
  fireEvent.click(await openPage());
  await stageApplication("CRM", "master");
  await stageApplication("ERP", "slave");
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith("/bo-relationship/applications?"))).toBe(true);
  expect(vi.mocked(api.get).mock.calls.some(([path]) => path.startsWith("/cards?"))).toBe(false);
  expect(api.put).not.toHaveBeenCalled();
  const save = screen.getByRole("button", { name: "common:actions.save" });
  fireEvent.click(save);
  expect(await screen.findByText(/Master unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/boRelationship.waitingForMaster/)).toHaveTextContent("ERP");
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put).toHaveBeenNthCalledWith(1, expect.stringMatching(/^\/bo-relationship\/application-link-drafts\//), {
    object_id: "a", application_id: "crm", role: "master",
  });
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByRole("link", { name: "CRM" })).toBeInTheDocument());
  expect(vi.mocked(api.put).mock.calls[1]).toEqual(vi.mocked(api.put).mock.calls[0]);
  expect(api.put).toHaveBeenNthCalledWith(3, expect.stringMatching(/^\/bo-relationship\/application-link-drafts\//), {
    object_id: "a", application_id: "erp", role: "slave",
  });
});

it("offers Unclassified and omits Master when the BO capability is denied", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path.startsWith("/bo-relationship/applications?")
    ? { items: [crm], total: 1 }
    : { ...baseGraph, capabilities: { can_manage_master: false } });
  fireEvent.click(await openPage());
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.linkApplication" }));
  const role = screen.getByLabelText("boRelationship.role");
  expect(within(role).getByRole("option", { name: "boRelationship.unclassified" })).toBeInTheDocument();
  expect(within(role).queryByRole("option", { name: "boRelationship.master" })).not.toBeInTheDocument();
  expect(within(role).queryByRole("option", { name: "boRelationship.slave" })).not.toBeInTheDocument();
});

it("applies an inventory update locally without moving the BO and shares it only on Save", async () => {
  signInAsEditor();
  const updated = { ...customer, name: "Client", subtype: "Document" };
  const change = { kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: updated };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : baseGraph);
  vi.mocked(api.put).mockResolvedValue({ ...baseGraph, nodes: [updated], inventory_conflicts: [], unavailable_drafts: [] });
  await openPage();
  expect(await screen.findByText(/Client ·/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Customer" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.acceptChange" }));
  expect(screen.getByRole("button", { name: "Client" })).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(baseGraph.positions));
  expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    accepted_inventory_changes: [{ kind: "node", id: "a", revision: "a".repeat(64) }],
    positions: {},
  })));
});


it("shows inventory changes to viewers without allowing synchronization", async () => {
  const updated = { ...customer, name: "Client" };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes"
    ? { changes: [{ kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: updated }] }
    : baseGraph);
  await openPage();
  expect(await screen.findByText(/Client ·/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "boRelationship.acceptChange" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "common:actions.save" })).not.toBeInTheDocument();
});

it("keeps the drawing and its positions usable if the inventory comparison fails", async () => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === "/bo-relationship/changes") throw new Error("Inventory unavailable");
    return baseGraph;
  });
  await openPage();
  expect(await screen.findByText(/Inventory unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Customer" })).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(baseGraph.positions));
  expect(screen.getByRole("button", { name: "editor.toolbar.sync" })).toBeEnabled();
});

it("requests a fresh comparison when an accepted inventory revision conflicts", async () => {
  signInAsEditor();
  const updated = { ...customer, name: "Client" };
  const change = { kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: updated };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : baseGraph);
  vi.mocked(api.put).mockResolvedValue({ ...baseGraph, inventory_conflicts: [{ kind: "node", id: "a" }], unavailable_drafts: [] });
  await openPage();
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  expect(await screen.findByText("boRelationship.inventoryConflict")).toBeInTheDocument();
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === "/bo-relationship/changes")).toHaveLength(2));
  expect(screen.getByRole("button", { name: "Customer" })).toBeInTheDocument();
});

it("syncs an application ownership change into the local groups", async () => {
  signInAsEditor();
  const crm = { id: "crm", name: "CRM" };
  const erp = { id: "erp", name: "ERP" };
  const graph = { ...baseGraph, applications: { a: { master: crm, slaves: [erp], unclassified: [] } } };
  const before = { id: "link", object_id: "a", application: crm, is_master: true };
  const change = { kind: "application_link", id: "link", revision: "b".repeat(64), change: "updated", before, after: { ...before, is_master: false } };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : graph);
  fireEvent.click(await openPage());
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  const groups = screen.getByRole("group", { name: "boRelationship.unclassified" });
  expect(within(groups).getByText("CRM")).toBeInTheDocument();
  expect(within(groups).getByText("ERP")).toBeInTheDocument();
  expect(api.put).not.toHaveBeenCalled();
});

it("ignores a superseded inventory comparison even when its request resolves last", async () => {
  signInAsEditor();
  let resolveFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  let checks = 0;
  const stale = { kind: "node", id: "a", revision: "a".repeat(64), change: "updated", before: customer, after: { ...customer, name: "Stale" } };
  const fresh = { ...stale, revision: "b".repeat(64), after: { ...customer, name: "Fresh" } };
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path !== "/bo-relationship/changes") return baseGraph;
    return ++checks === 1 ? first : { changes: [fresh] };
  });
  fireEvent.click(await openPage());
  fireEvent.click(screen.getByRole("button", { name: "Refetch from card panel" }));
  expect(await screen.findByText(/Fresh ·/)).toBeInTheDocument();
  resolveFirst({ changes: [stale] });
  await waitFor(() => expect(screen.queryByText(/Stale ·/)).not.toBeInTheDocument());
  expect(screen.getByText(/Fresh ·/)).toBeInTheDocument();
});

it("keeps queued outgoing removals distinct from incoming changes after a visual Save", async () => {
  signInAsEditor();
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge] };
  const change = { kind: "edge", id: "ab", revision: "a".repeat(64), change: "added", before: null, after: orderEdge };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : graph);
  vi.mocked(api.put).mockResolvedValue({ ...graph, edges: [], inventory_conflicts: [], unavailable_drafts: [] });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Remove line a" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.syncRemoval" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "boRelationship.acceptChange" })).not.toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(api.delete).not.toHaveBeenCalled();
});

it("keeps the previous master as a slave when syncing a promotion", async () => {
  signInAsEditor();
  const crm = { id: "crm", name: "CRM" };
  const erp = { id: "erp", name: "ERP" };
  const graph = { ...baseGraph, applications: { a: { master: crm, slaves: [erp], unclassified: [] } } };
  const before = { id: "link", object_id: "a", application: erp, is_master: false };
  const change = { kind: "application_link", id: "link", revision: "b".repeat(64), change: "updated", before, after: { ...before, is_master: true } };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [change] } : graph);
  fireEvent.click(await openPage());
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  expect(within(screen.getByRole("group", { name: "boRelationship.master" })).getByText("ERP")).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "boRelationship.slave" })).getByText("CRM")).toBeInTheDocument();
});

it.each([true, false])("retains a manual move after a conflicting removal only if the node is visible (%s)", async (visible) => {
  signInAsEditor();
  const removal = { kind: "node", id: "a", revision: "a".repeat(64), change: "removed", before: customer, after: null };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship/changes" ? { changes: [removal] } : baseGraph);
  vi.mocked(api.put).mockResolvedValue({
    ...baseGraph,
    nodes: visible ? baseGraph.nodes : [],
    positions: visible ? baseGraph.positions : {},
    inventory_conflicts: [{ kind: "node", id: "a" }],
    unavailable_drafts: [],
  });
  await openPage();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.acceptChange" }));
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  expect(await screen.findByText("boRelationship.inventoryConflict")).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(visible ? { a: { x: 96, y: 48 } } : {}));
  const save = screen.getByRole("button", { name: "common:actions.save" });
  if (visible) expect(save).toBeEnabled();
  else expect(save).toBeDisabled();
});

it("offers a local moved drawing on reopen without changing the shared canvas", async () => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  let shared = { ...baseGraph, nodes: [customer, order], positions: { ...baseGraph.positions, b: { x: 30, y: 40 } } };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? shared : { changes: [] });
  vi.mocked(api.post).mockResolvedValue({ changes: [], draft_results: [], object_ids: ["a"], applications: [] });
  const view = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await screen.findByRole("button", { name: "Customer" });
  await screen.findByRole("button", { name: "Move first BO" });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  await act(async () => { vi.advanceTimersByTime(5100); });
  view.unmount();
  vi.useRealTimers();
  shared = { ...shared, snapshot_revision: "another-editor", positions: { ...shared.positions, b: { x: 60, y: 80 } } };
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await screen.findByRole("button", { name: "Customer" });
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(shared.positions));
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.restoreDraft" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify({ a: { x: 96, y: 48 }, b: { x: 60, y: 80 } }));
  expect(api.put).not.toHaveBeenCalled();
});

it("discards a recovered drawing without changing the shared canvas", async () => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  vi.mocked(api.post).mockResolvedValue({ changes: [], draft_results: [], object_ids: ["a"], applications: [] });
  const view = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await screen.findByRole("button", { name: "Customer" });
  await screen.findByRole("button", { name: "Move first BO" });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  await act(async () => { vi.advanceTimersByTime(5100); });
  view.unmount();
  vi.useRealTimers();
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.discardDraft" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(baseGraph.positions));
  expect(localStorage.length).toBe(0);
});

it("does not offer a moved object when access has been revoked", async () => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  vi.mocked(api.post).mockResolvedValue({ changes: [], draft_results: [], object_ids: [], applications: [] });
  const view = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await screen.findByRole("button", { name: "Customer" });
  await screen.findByRole("button", { name: "Move first BO" });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Move first BO" }));
  await act(async () => { vi.advanceTimersByTime(5100); });
  view.unmount();
  vi.useRealTimers();
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "boRelationship.restoreDraft" })).not.toBeInTheDocument();
});

it("restores a staged object with its original operation ID without publishing", async () => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  const view = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  await screen.findByRole("button", { name: "Customer" });
  await waitFor(() => expect(screen.getByRole("button", { name: "boRelationship.newObject" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.newObject" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("boRelationship.objectName"), { target: { value: "Order" } });
  fireEvent.change(within(dialog).getByLabelText("boRelationship.subtype"), { target: { value: "Data" } });
  vi.useFakeTimers();
  fireEvent.click(within(dialog).getByRole("button", { name: "boRelationship.stageObject" }));
  await act(async () => { vi.advanceTimersByTime(5100); });
  const stored = JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
  const id = stored.draft.objects[0].id;
  view.unmount();
  vi.useRealTimers();
  vi.mocked(api.post).mockResolvedValue({ changes: [], draft_results: [{ kind: "node", id, status: "pending", value: null }], object_ids: [], applications: [] });
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Customer" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Order" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.restoreDraft" }));
  expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
  expect(api.put).not.toHaveBeenCalled();
  expect(api.post).toHaveBeenCalledWith("/bo-relationship/changes/draft", expect.objectContaining({ draft_operations: [{ kind: "node", id }] }));
});

it("restores a hidden line without restoring its outgoing removal queue", async () => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  const graph = { ...baseGraph, nodes: [customer, order], edges: [orderEdge], positions: { a: { x: 10, y: 20 }, b: { x: 30, y: 40 } } };
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? graph : { changes: [] });
  vi.mocked(api.post).mockResolvedValue({ changes: [{ kind: "edge", id: "ab", revision: "r", change: "added", before: null, after: orderEdge }], draft_results: [], object_ids: [], applications: [] });
  const view = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Remove line a" }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.queueRemoval" }));
  const pendingUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(pendingUnload);
  expect(pendingUnload.defaultPrevented).toBe(true);
  await act(async () => { vi.advanceTimersByTime(5100); });
  view.unmount();
  vi.useRealTimers();
  render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.restoreDraft" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(screen.queryByText("boRelationship.pendingRemovals")).not.toBeInTheDocument();
  const restoredUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(restoredUnload);
  expect(restoredUnload.defaultPrevented).toBe(false);
  expect(screen.getByRole("button", { name: "boRelationship.acceptChange" })).toBeInTheDocument();
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.acceptChange" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "ab");
  vi.mocked(api.put).mockResolvedValue({ ...graph, inventory_conflicts: [], unavailable_drafts: [] });
  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  expect(api.delete).not.toHaveBeenCalled();
});

function LocationMarker() { return <span data-testid="location">{useLocation().pathname}</span>; }

const recoveryStorageKey = "turbo-ea-bo-relationship-draft-v1-editor";

it("preserves another tab's local draft when a clean editor autosaves or exits", async () => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  const writer = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
  const move = await within(writer.container).findByRole("button", { name: "Move first BO" });
  vi.useFakeTimers();
  try {
    fireEvent.click(move);
    await act(async () => { vi.advanceTimersByTime(1000); });
    const idle = render(<MemoryRouter><BoRelationshipPage /></MemoryRouter>);
    await act(async () => {});

    await act(async () => { vi.advanceTimersByTime(4000); });
    const writerKey = localStorage.key(0)!;
    const saved = localStorage.getItem(writerKey);
    expect(saved).toContain('"moves":{"a":{"x":96,"y":48}}');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(localStorage.getItem(writerKey)).toBe(saved);

    fireEvent.click(within(idle.container).getByRole("button", { name: "boRelationship.saveAndExit" }));
    expect(localStorage.getItem(writerKey)).toBe(saved);
  } finally {
    vi.useRealTimers();
    localStorage.clear();
  }
});

it.each(["saved", "unavailable"])("recovers a partially saved BO without reviving a removed ER (%s)", async (status) => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  const positions = { ...baseGraph.positions, b: { x: 95, y: 55 } };
  localStorage.setItem(recoveryStorageKey, JSON.stringify({
    version: 1,
    revision: baseGraph.snapshot_revision,
    original: { positions: {}, edges: [] },
    draft: {
      objects: [{ id: "draft-order", input: { name: "Order", subtype: "Data", isPersonalData: false, isPaymentData: false } }],
      relations: [{ id: "draft-edge", input: { source: "a", target: "draft-order", cardinality: null } }],
      applications: [],
      moves: { "draft-order": positions.b },
      removed: [orderEdge.id],
      restored: [],
    },
    accepted: [],
  }));
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  vi.mocked(api.post).mockResolvedValue({
    changes: [],
    draft_results: [
      { kind: "node", id: "draft-order", status: "saved", value: order },
      { kind: "edge", id: "draft-edge", status, value: status === "saved" ? orderEdge : null },
    ],
    object_ids: ["a"],
    applications: [],
  });
  vi.mocked(api.put).mockResolvedValue({
    ...baseGraph, nodes: [customer, order], positions, inventory_conflicts: [], unavailable_drafts: [],
  });
  await openPage();
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.restoreDraft" }));
  expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify(positions));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-edges", "");
  expect(screen.queryByText("boRelationship.pendingRemovals")).not.toBeInTheDocument();
  expect(api.put).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem(recoveryStorageKey)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
    positions: { b: positions.b },
    saved_drafts: [
      { kind: "node", id: "draft-order" },
      ...(status === "saved" ? [{ kind: "edge", id: "draft-edge" }] : []),
    ],
    removed_relation_ids: status === "saved" ? [orderEdge.id] : [],
  })));
  await waitFor(() => expect(localStorage.length).toBe(0));
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.delete).not.toHaveBeenCalled();
});

it("keeps an unverified local draft and lets the editor retry a failed comparison", async () => {
  localStorage.clear();
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  const stored = JSON.stringify({
    version: 1,
    revision: baseGraph.snapshot_revision,
    original: { positions: baseGraph.positions, edges: [] },
    draft: { objects: [], relations: [], applications: [], moves: { a: { x: 96, y: 48 } }, removed: [], restored: [] },
    accepted: [],
  });
  localStorage.setItem(recoveryStorageKey, stored);
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  vi.mocked(api.post).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ changes: [], draft_results: [], object_ids: ["a"], applications: [] });
  await openPage();
  expect(await screen.findByText("boRelationship.draftValidationFailed")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "common:actions.save" })).toBeDisabled();
  expect(localStorage.getItem(recoveryStorageKey)).toBe(stored);
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.retryDraft" }));
  fireEvent.click(await screen.findByRole("button", { name: "boRelationship.restoreDraft" }));
  expect(screen.getByTestId("canvas")).toHaveAttribute("data-positions", JSON.stringify({ a: { x: 96, y: 48 } }));
  expect(api.put).not.toHaveBeenCalled();
  localStorage.clear();
});

it("leaves normal editing and Save usable when browser storage is disabled", async () => {
  vi.mocked(useOptionalAuthUser).mockReturnValue({ id: "editor", permissions: { "*": true } } as User);
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  vi.mocked(api.put).mockResolvedValue({ ...baseGraph, positions: { a: { x: 96, y: 48 } } });
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  try {
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Move first BO" }));
    fireEvent.click(screen.getByRole("button", { name: "common:actions.save" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bo-relationship/layout", expect.objectContaining({
      positions: { a: { x: 96, y: 48 } },
    })));
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it.each([true, false])("Save and Exit navigates only when save succeeds (%s)", async (success) => {
  signInAsEditor();
  vi.mocked(api.get).mockImplementation(async (path) => path === "/bo-relationship" ? baseGraph : { changes: [] });
  if (success) vi.mocked(api.put).mockResolvedValue({ ...baseGraph, positions: { a: { x: 96, y: 48 } } });
  else vi.mocked(api.put).mockRejectedValue(new Error("layout failed"));
  render(<MemoryRouter initialEntries={["/bo-relationship"]}><BoRelationshipPage /><LocationMarker /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Move first BO" }));
  fireEvent.click(screen.getByRole("button", { name: "boRelationship.saveAndExit" }));
  if (success) await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/));
  else {
    expect(await screen.findByText(/layout failed/)).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/bo-relationship");
  }
});
