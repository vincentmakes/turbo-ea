/**
 * Saving an accepted AI suggestion: one PATCH with the description and the
 * suggested values; when the card type refuses a value, the description is
 * still saved on its own (#1422).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { ApiError } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import { makeCard } from "@/test/fixtures/metamodel";
import { applyAiSuggestion } from "./applyAiSuggestion";

const CARD = makeCard({
  id: "card-1",
  type: "Application",
  name: "Jira",
  attributes: { costTotalAnnual: 1200, hostingType: "onPremise" },
});
const PATH = "/cards/card-1";
const REFUSAL = "Invalid option for Hosting Type: 'cloudSaaS'";

/** A PATCH that refuses any body carrying attributes, with `status`. */
function refuseAttributes(status: number) {
  mockApi.on("patch", PATH, (_path, body) => {
    const patch = body as Record<string, unknown>;
    if ("attributes" in patch) throw new ApiError(REFUSAL, status, REFUSAL);
    return { ...CARD, ...patch };
  });
}

beforeEach(() => {
  mockApi.reset();
});

describe("applyAiSuggestion", () => {
  it("saves the description and the suggested values together", async () => {
    mockApi.on("patch", PATH, (_path, body) => ({ ...CARD, ...(body as object) }));
    const result = await applyAiSuggestion(CARD, {
      description: "An issue tracker.",
      fields: { hostingType: "cloudSaaS", commercialApplication: true },
    });
    expect(mockApi.callsOf("patch")).toEqual([
      {
        method: "patch",
        path: PATH,
        body: {
          description: "An issue tracker.",
          attributes: {
            costTotalAnnual: 1200,
            hostingType: "cloudSaaS",
            commercialApplication: true,
          },
        },
      },
    ]);
    expect(result).toEqual({
      card: expect.objectContaining({ description: "An issue tracker." }),
      skippedFields: false,
    });
  });

  it("sends only the description when no values were suggested", async () => {
    mockApi.on("patch", PATH, (_path, body) => ({ ...CARD, ...(body as object) }));
    const result = await applyAiSuggestion(CARD, { description: "An issue tracker." });
    expect(mockApi.callsOf("patch").map((c) => c.body)).toEqual([
      { description: "An issue tracker." },
    ]);
    expect(result.skippedFields).toBe(false);
  });

  it("sends only the values when the description is empty", async () => {
    mockApi.on("patch", PATH, (_path, body) => ({ ...CARD, ...(body as object) }));
    await applyAiSuggestion({ ...CARD, attributes: undefined }, {
      description: "",
      fields: { commercialApplication: false },
    });
    expect(mockApi.callsOf("patch").map((c) => c.body)).toEqual([
      { attributes: { commercialApplication: false } },
    ]);
  });

  it.each([400, 422, 499])(
    "saves the description alone when the values are refused with a %i",
    async (status) => {
      refuseAttributes(status);
      const result = await applyAiSuggestion(CARD, {
        description: "An issue tracker.",
        fields: { hostingType: "cloudSaaS" },
      });
      const bodies = mockApi.callsOf("patch").map((c) => c.body);
      expect(bodies).toEqual([
        {
          description: "An issue tracker.",
          attributes: { costTotalAnnual: 1200, hostingType: "cloudSaaS" },
        },
        { description: "An issue tracker." },
      ]);
      expect(result).toEqual({
        card: expect.objectContaining({
          description: "An issue tracker.",
          attributes: { costTotalAnnual: 1200, hostingType: "onPremise" },
        }),
        skippedFields: true,
        reason: REFUSAL,
      });
    },
  );

  it("rejects when the description-only save is refused too", async () => {
    mockApi.on("patch", PATH, () => {
      throw new ApiError("Description too long", 422, null);
    });
    await expect(
      applyAiSuggestion(CARD, { description: "x", fields: { hostingType: "cloudSaaS" } }),
    ).rejects.toThrow("Description too long");
    expect(mockApi.callsOf("patch")).toHaveLength(2);
  });

  it("rejects without a retry when there were no values to drop", async () => {
    refuseAttributes(422);
    mockApi.fail("patch", PATH, 422, "Description refused");
    await expect(applyAiSuggestion(CARD, { description: "x" })).rejects.toBeInstanceOf(ApiError);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
  });

  it("rejects without a retry when there is no description to keep", async () => {
    refuseAttributes(422);
    await expect(
      applyAiSuggestion(CARD, { description: "", fields: { hostingType: "cloudSaaS" } }),
    ).rejects.toThrow(REFUSAL);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
  });

  it.each([399, 500, 503])("rejects without a retry on a %i", async (status) => {
    refuseAttributes(status);
    await expect(
      applyAiSuggestion(CARD, { description: "x", fields: { hostingType: "cloudSaaS" } }),
    ).rejects.toThrow(REFUSAL);
    expect(mockApi.callsOf("patch")).toHaveLength(1);
  });

  it("rejects without a retry on a failure that is not an API error", async () => {
    mockApi.on("patch", PATH, () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      applyAiSuggestion(CARD, { description: "x", fields: { hostingType: "cloudSaaS" } }),
    ).rejects.toThrow("Failed to fetch");
    expect(mockApi.callsOf("patch")).toHaveLength(1);
  });
});
