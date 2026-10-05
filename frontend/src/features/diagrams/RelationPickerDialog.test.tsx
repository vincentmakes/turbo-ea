/**
 * The dialog the diagram editor opens when an edge is drawn between two card
 * cells. It lists the metamodel's relation types valid for the ordered type
 * pair — in BOTH directions, since the user may have drawn the arrow the
 * other way round — and hands the pick back as `(relationType, direction,
 * attributes?)`. A type with editable attributes (a `flowDirection` picker,
 * say) gets an optional second step; one without is committed on click.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  RELATION_TYPES,
  REL_APP_TO_APP,
  REL_APP_TO_BC,
  REL_APP_TO_ITC,
  makeRelationType,
} from "@/test/fixtures/metamodel";
import type { RelationType } from "@/types";
import RelationPickerDialog, { type EdgeEndpoints } from "./RelationPickerDialog";

type Props = React.ComponentProps<typeof RelationPickerDialog>;

const APP_TO_BC: EdgeEndpoints = {
  edgeCellId: "edge-1",
  sourceType: "Application",
  targetType: "BusinessCapability",
  sourceName: "ERP Core",
  targetName: "Finance",
  sourceColor: "#0f7eb5",
  targetColor: "#003399",
};

function renderDialog(overrides: Partial<Props> = {}, relationTypes: RelationType[] = RELATION_TYPES) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const result = render(
    <RelationPickerDialog
      open
      endpoints={APP_TO_BC}
      relationTypes={relationTypes}
      onClose={onClose}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { ...result, user, onClose, onSelect };
}

describe("RelationPickerDialog", () => {
  it("renders nothing without endpoints", () => {
    const { container } = renderDialog({ endpoints: null });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Pick Relation Type")).not.toBeInTheDocument();
  });

  it("lists the relation types valid for the pair with the drawn direction", () => {
    renderDialog();
    expect(screen.getByText("Pick Relation Type")).toBeInTheDocument();
    // The endpoint chips name the two cards.
    expect(screen.getByText("ERP Core")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
    const item = screen.getByRole("button", { name: /supports/ });
    expect(item).toHaveTextContent("ERP Core → Finance");
    expect(item).toHaveTextContent("n:m");
    // relAppToITC / relProviderToITC do not touch this pair; relAppToApp is a
    // self-pair on Application and does not reach BusinessCapability.
    expect(screen.queryByText("uses")).not.toBeInTheDocument();
    expect(screen.queryByText("sends data to")).not.toBeInTheDocument();
  });

  it("offers a type whose direction runs against the drawn edge as reversed", async () => {
    const { user, onSelect } = renderDialog({
      endpoints: {
        ...APP_TO_BC,
        sourceType: "ITComponent",
        targetType: "Application",
        sourceName: "PostgreSQL",
        targetName: "ERP Core",
      },
    });
    const item = screen.getByRole("button", { name: /uses/ });
    // The secondary line reads in the relation type's own direction.
    expect(item).toHaveTextContent("ERP Core → PostgreSQL");
    await user.click(item);
    expect(onSelect).toHaveBeenCalledWith(REL_APP_TO_ITC, "reversed");
  });

  it("skips hidden relation types and explains when nothing fits", () => {
    const hidden = makeRelationType({
      key: "relHidden",
      source_type_key: "Application",
      target_type_key: "BusinessCapability",
      label: "secretly maps",
      is_hidden: true,
    });
    renderDialog({}, [hidden, REL_APP_TO_ITC]);
    expect(screen.queryByText("secretly maps")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "No valid relation types exist between these two card types in the metamodel.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a relation type's description as linkified secondary text", () => {
    const described = { ...REL_APP_TO_BC, description: "See https://docs.example/rel" };
    renderDialog({}, [described]);
    const link = screen.getByRole("link", { name: "https://docs.example/rel" });
    expect(link).toHaveAttribute("href", "https://docs.example/rel");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("commits a type without editable attributes on the first click", async () => {
    const { user, onSelect, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: /supports/ }));
    expect(onSelect).toHaveBeenCalledWith(REL_APP_TO_BC, "as-is");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lists a self-pair type once per direction", () => {
    renderDialog({
      endpoints: {
        ...APP_TO_BC,
        targetType: "Application",
        targetName: "CRM Cloud",
        targetColor: "#0f7eb5",
      },
    });
    const items = screen.getAllByRole("button", { name: /sends data to/ });
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("ERP Core → CRM Cloud");
    expect(items[1]).toHaveTextContent("CRM Cloud → ERP Core");
  });

  describe("attribute step", () => {
    const APP_TO_APP: EdgeEndpoints = {
      ...APP_TO_BC,
      targetType: "Application",
      targetName: "CRM Cloud",
      targetColor: "#0f7eb5",
    };

    it("opens the attribute editor for a type carrying flowDirection and sends the value", async () => {
      const { user, onSelect } = renderDialog({ endpoints: APP_TO_APP });
      await user.click(screen.getAllByRole("button", { name: /sends data to/ })[1]);
      // The title now names the picked verb and the list is replaced by the editor.
      expect(screen.getByText("Optional details")).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();

      await user.click(screen.getByRole("combobox", { name: "Flow Direction" }));
      const listbox = await screen.findByRole("listbox");
      // Forward is worded with the relation's own verb, reverse with its reverse label.
      expect(within(listbox).getByRole("option", { name: /sends data to/ })).toBeInTheDocument();
      expect(
        within(listbox).getByRole("option", { name: /receives data from/ }),
      ).toBeInTheDocument();
      await user.click(within(listbox).getByRole("option", { name: /receives data from/ }));

      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(onSelect).toHaveBeenCalledWith(REL_APP_TO_APP, "reversed", {
        flowDirection: "reverse",
      });
    });

    it("creates without attributes when nothing was set", async () => {
      const { user, onSelect } = renderDialog({ endpoints: APP_TO_APP });
      await user.click(screen.getAllByRole("button", { name: /sends data to/ })[0]);
      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(onSelect).toHaveBeenCalledWith(REL_APP_TO_APP, "as-is", undefined);
    });

    it("returns to the list on Back and closes on Cancel", async () => {
      const { user, onClose, onSelect } = renderDialog({ endpoints: APP_TO_APP });
      await user.click(screen.getAllByRole("button", { name: /sends data to/ })[0]);
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByText("Pick Relation Type")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /sends data to/ })).toHaveLength(2);

      await user.click(screen.getAllByRole("button", { name: /sends data to/ })[0]);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("forgets a half-finished pick when the dialog is closed", async () => {
      const { user, rerender } = renderDialog({ endpoints: APP_TO_APP });
      await user.click(screen.getAllByRole("button", { name: /sends data to/ })[0]);
      expect(screen.getByText("Optional details")).toBeInTheDocument();
      const props = {
        endpoints: APP_TO_APP,
        relationTypes: RELATION_TYPES,
        onClose: vi.fn(),
        onSelect: vi.fn(),
      };
      rerender(<RelationPickerDialog open={false} {...props} />);
      rerender(<RelationPickerDialog open {...props} />);
      expect(screen.getByText("Pick Relation Type")).toBeInTheDocument();
      expect(screen.queryByText("Optional details")).not.toBeInTheDocument();
    });
  });

  it("closes from the list step's Cancel", async () => {
    const { user, onClose } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
