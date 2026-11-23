import { api, ApiError } from "@/api/client";
import type { AiApplyPayload } from "@/components/AiSuggestPanel";
import type { Card } from "@/types";

/** What saving an accepted AI suggestion did to the card. */
export type AiApplyResult =
  | { card: Card; skippedFields: false }
  /** Only the description was saved: the card type refused the other values. */
  | { card: Card; skippedFields: true; reason: string };

/**
 * Save an accepted AI suggestion on a card: the description and the
 * suggested attribute values in one PATCH, so the normal case is one history
 * entry.
 *
 * When the card type refuses one of the suggested values (a 4xx — an admin
 * removed the field or the option since the suggestion was made, #1422), the
 * description is saved on its own and the result says the other values were
 * skipped, with the server's reason. Any other failure, and a refusal of the
 * description itself, rejects, so the caller can show it.
 */
export async function applyAiSuggestion(
  card: Card,
  payload: AiApplyPayload,
): Promise<AiApplyResult> {
  const patch: Record<string, unknown> = {};
  if (payload.description) patch.description = payload.description;
  if (payload.fields) {
    patch.attributes = { ...(card.attributes ?? {}), ...payload.fields };
  }
  try {
    const updated = await api.patch<Card>(`/cards/${card.id}`, patch);
    return { card: updated, skippedFields: false };
  } catch (err) {
    const refused = err instanceof ApiError && err.status >= 400 && err.status < 500;
    if (!refused || !patch.description || !patch.attributes) throw err;
    const updated = await api.patch<Card>(`/cards/${card.id}`, {
      description: patch.description,
    });
    return { card: updated, skippedFields: true, reason: err.message };
  }
}
