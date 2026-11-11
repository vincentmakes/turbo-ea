import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { withMetamodel } from "@/test/hooks";
import MentionRow from "./MentionRow";

beforeEach(() => withMetamodel(CARD_TYPES, []));

describe("MentionRow", () => {
  it("shows a card's type icon, type and subtype labels", () => {
    render(
      <MentionRow
        item={{ kind: "card", id: "c", label: "SAP", card: { type: "Application", subtype: "microservice" } }}
      />,
    );
    expect(screen.getByText("SAP")).toBeInTheDocument();
    expect(screen.getByText("Application · Microservice")).toBeInTheDocument();
    expect(screen.getByTestId("mention-type-icon")).toHaveTextContent("apps");
  });

  it("adds the parent's name once it is known", () => {
    render(
      <MentionRow
        item={{
          kind: "card",
          id: "c",
          label: "SAP",
          card: { type: "Application", subtype: "microservice", parentId: "p", parentName: "ERP Suite" },
        }}
      />,
    );
    expect(screen.getByText("Application · Microservice · in ERP Suite")).toBeInTheDocument();
  });

  it("shows no icon and no key for a type the metamodel does not offer", () => {
    const { container } = render(
      <MentionRow item={{ kind: "card", id: "c", label: "SAP", card: { type: "NoSuchType", subtype: "x" } }} />,
    );
    expect(screen.queryByTestId("mention-type-icon")).not.toBeInTheDocument();
    expect(container).toHaveTextContent(/^SAP$/);
  });

  it("shows a decision's reference, title and standing", () => {
    render(
      <MentionRow
        item={{
          kind: "decision",
          id: "d",
          label: "ADR-002 · Rev 2 Pick",
          decision: { reference: "ADR-002 · Rev 2", title: "Pick", status: "signed", standing: "revoked" },
        }}
      />,
    );
    expect(screen.getByText("ADR-002 · Rev 2")).toBeInTheDocument();
    expect(screen.getByText("Pick")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("shows a person's name and e-mail", () => {
    const { rerender, container } = render(
      <MentionRow item={{ kind: "user", id: "u", label: "Ann", secondary: "ann@x.io" }} />,
    );
    expect(screen.getByText("ann@x.io")).toBeInTheDocument();
    rerender(<MentionRow item={{ kind: "user", id: "u", label: "Ann" }} />);
    expect(container).toHaveTextContent(/^Ann$/);
  });
});
