import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));

import { GroupTranslationsDialog } from "./CardLayoutEditor";

describe("GroupTranslationsDialog — group header translation authoring", () => {
  it("prefills existing translations and emits the edited per-locale map on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <GroupTranslationsDialog
        groupName="Dimension One"
        initial={{ de: "Dimension Eins" }}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    // Existing German translation is prefilled.
    expect(screen.getByDisplayValue("Dimension Eins")).toBeInTheDocument();
    // The raw group name is the placeholder / fallback (not a stored value).
    expect(screen.getByLabelText("Français")).toHaveValue("");

    // Author a French translation and save.
    await user.type(screen.getByLabelText("Français"), "Dimension Un");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const map = onSave.mock.calls[0][0] as Record<string, string>;
    expect(map.de).toBe("Dimension Eins");
    expect(map.fr).toBe("Dimension Un");
  });
});
