import { describe, it, expect } from "vitest";
import enAdmin from "@/i18n/locales/en/admin.json";
import { AI_PROVIDER_TYPES, azureUsesV1, providerUi } from "./aiProviderUi";

describe("azureUsesV1", () => {
  const ROOT = "https://my-resource.openai.azure.com";

  // The same cases as TestChatTargetV1 in backend/tests/services/test_azure_openai.py.
  it.each([
    `${ROOT}/openai/v1/`,
    `${ROOT}/openai/v1`,
    `${ROOT}/openai/v1///`,
    `  ${ROOT}/openai/v1/  `,
    `${ROOT}/OpenAI/V1/`,
    `${ROOT}/openai/v1/chat/completions`,
    `${ROOT}/openai/v1/Chat/Completions/`,
    `${ROOT}/openai/v1/?api-version=preview`,
    `${ROOT}/openai/v1#section`,
    "https://gw.example.com/ai/team-a/openai/v1/",
    // Nothing has to precede the path (test_a_bare_v1_path_is_the_v1_endpoint_too).
    "/openai/v1",
  ])("is true for the v1 endpoint written as %s", (url) => {
    expect(azureUsesV1(url)).toBe(true);
  });

  it.each([
    "",
    ROOT,
    `${ROOT}/`,
    `${ROOT}/openai`,
    `${ROOT}/openai/deployments/gpt-5/chat/completions?api-version=2024-10-21`,
    `${ROOT}/openai/v1beta`,
    `${ROOT}/openai/v1/responses`,
    `${ROOT}/xopenai/v1`,
    `${ROOT}/v1`,
    `${ROOT}?next=/openai/v1`,
    "https://openai/v1",
  ])("is false for %s", (url) => {
    expect(azureUsesV1(url)).toBe(false);
  });
});

describe("providerUi", () => {
  it("offers every provider the backend accepts", () => {
    // Mirrors _VALID_PROVIDER_TYPES in backend/app/api/v1/settings.py.
    expect(AI_PROVIDER_TYPES).toEqual(["ollama", "openai", "azure_openai", "anthropic", "bedrock"]);
  });

  it("resolves every i18n key it names", () => {
    const keys = enAdmin as Record<string, string>;
    for (const type of AI_PROVIDER_TYPES) {
      const ui = providerUi(type);
      for (const key of [
        ui.labelKey,
        ui.descKey,
        ui.urlHelperKey,
        ui.apiKeyHelperKey,
        ui.modelHelperKey,
        ...(ui.urlLabelKey ? [ui.urlLabelKey] : []),
      ]) {
        // admin.json uses flat dotted keys, so this is a direct lookup.
        expect(keys[key], key).toBeTruthy();
      }
    }
  });

  it("falls back to Ollama for an unknown provider", () => {
    expect(providerUi("something-else")).toEqual(providerUi("ollama"));
  });

  describe("bedrock", () => {
    const ui = providerUi("bedrock");

    it("labels the URL field as an AWS region", () => {
      expect(ui.showProviderUrl).toBe(true);
      expect(ui.urlLabelKey).toBe("settings.ai.providerUrlLabelBedrock");
      expect(ui.urlPlaceholder).toBe("eu-central-1");
    });

    it("shows an optional credentials field", () => {
      // Empty means the IAM role of the container; a key pair is the exception.
      expect(ui.showApiKey).toBe(true);
      expect(ui.apiKeyHelperKey).toBe("settings.ai.apiKeyHelperBedrock");
    });

    it("has no Azure api-version field", () => {
      expect(ui.showApiVersion).toBe(false);
    });

    it("can populate the model picker from a connection test", () => {
      expect(ui.supportsModelList).toBe(true);
    });

    it("suggests an inference profile id as the model", () => {
      expect(ui.modelPlaceholder).toMatch(/^eu\./);
    });
  });

  describe("existing providers keep their behaviour", () => {
    it("ollama needs no credentials", () => {
      expect(providerUi("ollama").showApiKey).toBe(false);
    });

    it("anthropic hides the URL field and has no model list", () => {
      const ui = providerUi("anthropic");
      expect(ui.showProviderUrl).toBe(false);
      expect(ui.supportsModelList).toBe(false);
    });

    it("azure keeps its api-version field", () => {
      expect(providerUi("azure_openai").showApiVersion).toBe(true);
    });

    it("openai keeps its sk- placeholder", () => {
      expect(providerUi("openai").apiKeyPlaceholder).toBe("sk-...");
    });
  });
});
