import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{
      key: "Application",
      lifecycle_stages: [{ key: "testing", label: "Testing", color: "#123456" }],
    }],
  }),
}));
vi.mock("@/hooks/useLifecyclePhaseHelp", () => ({
  useLifecyclePhaseHelp: () => ({ phaseHelp: () => "" }),
}));

import type { Card } from "@/types";
import LifecycleSection from "./LifecycleSection";

describe("LifecycleSection current stage", () => {
  it("lets an editor assign a custom stage without changing lifecycle dates", async () => {
    const onSave = vi.fn(async () => {});
    const card = { id: "1", type: "Application", name: "App", lifecycle: {} } as Card;
    render(<LifecycleSection card={card} onSave={onSave} />);
    fireEvent.click(screen.getAllByRole("button").at(-1)!);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Current stage" }));
    fireEvent.click(screen.getByRole("option", { name: "Testing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ lifecycle_stage: "testing" }));
  });
});
