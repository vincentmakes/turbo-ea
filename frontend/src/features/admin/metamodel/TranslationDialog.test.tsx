import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TranslationDialog from "./TranslationDialog";
import type { CardType } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({
    enabledLocales: ["en", "de"],
    invalidateEnabledLocales: vi.fn(),
  }),
}));

import { api } from "@/api/client";

const CARD_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  subtypes: [],
  fields_schema: [],
  built_in: true,
  is_hidden: false,
  translations: { label: { en: "Application", de: "Anwendung" } },
} as unknown as CardType;

function renderDialog() {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <TranslationDialog open cardType={CARD_TYPE} onClose={onClose} onSave={onSave} />,
  );
  return { onSave, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue([]);
});

describe("TranslationDialog", () => {
  it("never sends translations: null — the column is NOT NULL", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    renderDialog();

    // Clear every translation in every locale, which used to clean down to
    // `null` and violate the NOT NULL constraint.
    for (const name of [/English/, /Deutsch/]) {
      await user.click(await screen.findByRole("tab", { name }));
      for (const input of await screen.findAllByRole("textbox")) await user.clear(input);
    }
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const body = vi.mocked(api.patch).mock.calls[0][1] as { translations: unknown };
    expect(body.translations).not.toBeNull();
    expect(body.translations).toEqual({});
  });

  it("carries an English edit into the label column", async () => {
    // `translations.label.en` shadows the `label` column everywhere labels are
    // resolved, so editing English here without the column is the card-type
    // twin of #912.
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    renderDialog();

    const englishTab = await screen.findByRole("tab", { name: /English/ });
    await user.click(englishTab);
    const input = (await screen.findAllByRole("textbox"))[0];
    await user.clear(input);
    await user.type(input, "Business System");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const body = vi.mocked(api.patch).mock.calls[0][1] as {
      label?: string;
      translations: Record<string, Record<string, string>>;
    };
    expect(body.label).toBe("Business System");
    expect(body.translations.label.en).toBe("Business System");
    expect(body.translations.label.de).toBe("Anwendung");
  });

  it("surfaces a failed save instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("Card type not found"));
    const { onSave, onClose } = renderDialog();

    await user.click(await screen.findByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/Card type not found/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
