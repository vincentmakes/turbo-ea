/**
 * The full-page BPMN editor route: it hands the process and the draft version
 * from the URL to the modeler, and Back returns to the card's process-flow
 * sub-tab it came from.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

interface ModelerProps {
  processId: string;
  versionId?: string;
  onBack: () => void;
  onSaved: () => void;
}
const seen: ModelerProps[] = [];
vi.mock("./BpmnModeler", () => ({
  default: (props: ModelerProps) => {
    seen.push(props);
    return (
      <button type="button" onClick={props.onBack}>
        back
      </button>
    );
  },
}));

import ProcessFlowEditorPage from "./ProcessFlowEditorPage";

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderAt(url: string, path = "/bpm/processes/:id/flow") {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<ProcessFlowEditorPage />} />
        <Route path="/cards/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return user;
}

describe("ProcessFlowEditorPage", () => {
  it("edits the draft named in the URL and returns to the sub-tab it came from", async () => {
    const user = renderAt("/bpm/processes/p1/flow?versionId=v9&returnSubTab=3");
    expect(seen.at(-1)).toMatchObject({ processId: "p1", versionId: "v9" });
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/cards/p1?tab=1&subtab=3");
  });

  it("without a version or a sub-tab, edits the process and returns to the drafts", async () => {
    const user = renderAt("/bpm/processes/p2/flow?versionId=");
    expect(seen.at(-1)!.versionId).toBeUndefined();
    expect(seen.at(-1)!.processId).toBe("p2");
    seen.at(-1)!.onSaved(); // a no-op: saving stays on the page
    await user.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/cards/p2?tab=1&subtab=1");
  });

  it("renders nothing without a process id", () => {
    const before = seen.length;
    const { container } = render(
      <MemoryRouter initialEntries={["/flow"]}>
        <Routes>
          <Route path="/flow" element={<ProcessFlowEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(seen.length).toBe(before);
  });
});
