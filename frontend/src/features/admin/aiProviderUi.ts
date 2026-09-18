/**
 * Per-provider presentation for the AI settings form.
 *
 * The form used to branch inline, which meant five nested ternaries — one per
 * field — that every new provider had to be threaded through separately. This
 * keeps the whole of a provider's presentation in one readable row and makes it
 * unit-testable without rendering the page.
 *
 * `urlLabelKey` exists for Amazon Bedrock: the field holds an AWS region rather
 * than a URL. The stored settings key stays `providerUrl` so every existing
 * "is AI configured?" check on the backend keeps working unchanged.
 */

export type AiProviderType = "ollama" | "openai" | "azure_openai" | "anthropic" | "bedrock";

export const AI_PROVIDER_TYPES: AiProviderType[] = [
  "ollama",
  "openai",
  "azure_openai",
  "anthropic",
  "bedrock",
];

export interface AiProviderUi {
  /** i18n key for the option label in the provider dropdown. */
  labelKey: string;
  /** i18n key for the caption under the dropdown. */
  descKey: string;
  /** True when the provider needs the URL/region field at all. */
  showProviderUrl: boolean;
  /** i18n key for the URL field's label; undefined keeps the default "Provider URL". */
  urlLabelKey?: string;
  urlPlaceholder: string;
  urlHelperKey: string;
  /** True when the provider needs credentials (Ollama never does). */
  showApiKey: boolean;
  apiKeyPlaceholder: string;
  apiKeyHelperKey: string;
  /** Azure's api-version field. */
  showApiVersion: boolean;
  modelPlaceholder: string;
  modelHelperKey: string;
  /**
   * Whether Test Connection returns a usable model list. Providers without a
   * list endpoint (Anthropic) keep the free-text model field.
   */
  supportsModelList: boolean;
}

const PROVIDERS: Record<AiProviderType, AiProviderUi> = {
  ollama: {
    labelKey: "settings.ai.providerOllama",
    descKey: "settings.ai.providerOllamaDesc",
    showProviderUrl: true,
    urlPlaceholder: "http://localhost:11434",
    urlHelperKey: "settings.ai.providerUrlHelper",
    showApiKey: false,
    apiKeyPlaceholder: "",
    apiKeyHelperKey: "settings.ai.apiKeyHelper",
    showApiVersion: false,
    modelPlaceholder: "gemma3:4b",
    modelHelperKey: "settings.ai.modelHelper",
    supportsModelList: true,
  },
  openai: {
    labelKey: "settings.ai.providerOpenai",
    descKey: "settings.ai.providerOpenaiDesc",
    showProviderUrl: true,
    urlPlaceholder: "https://api.openai.com",
    urlHelperKey: "settings.ai.providerUrlHelperOpenai",
    showApiKey: true,
    apiKeyPlaceholder: "sk-...",
    apiKeyHelperKey: "settings.ai.apiKeyHelper",
    showApiVersion: false,
    modelPlaceholder: "gpt-4o-mini",
    modelHelperKey: "settings.ai.modelHelperOpenai",
    supportsModelList: true,
  },
  azure_openai: {
    labelKey: "settings.ai.providerAzureOpenai",
    descKey: "settings.ai.providerAzureOpenaiDesc",
    showProviderUrl: true,
    urlPlaceholder: "https://your-resource.openai.azure.com",
    urlHelperKey: "settings.ai.providerUrlHelperAzureOpenai",
    showApiKey: true,
    apiKeyPlaceholder: "sk-...",
    apiKeyHelperKey: "settings.ai.apiKeyHelper",
    showApiVersion: true,
    modelPlaceholder: "my-gpt4o-deployment",
    modelHelperKey: "settings.ai.modelHelperAzureOpenai",
    supportsModelList: true,
  },
  anthropic: {
    labelKey: "settings.ai.providerAnthropic",
    descKey: "settings.ai.providerAnthropicDesc",
    showProviderUrl: false,
    urlPlaceholder: "",
    urlHelperKey: "settings.ai.providerUrlHelper",
    showApiKey: true,
    apiKeyPlaceholder: "sk-...",
    apiKeyHelperKey: "settings.ai.apiKeyHelper",
    showApiVersion: false,
    modelPlaceholder: "claude-sonnet-4-20250514",
    modelHelperKey: "settings.ai.modelHelperAnthropic",
    supportsModelList: false,
  },
  bedrock: {
    labelKey: "settings.ai.providerBedrock",
    descKey: "settings.ai.providerBedrockDesc",
    showProviderUrl: true,
    urlLabelKey: "settings.ai.providerUrlLabelBedrock",
    urlPlaceholder: "eu-central-1",
    urlHelperKey: "settings.ai.providerUrlHelperBedrock",
    // Optional: empty means the IAM role of the container or instance.
    showApiKey: true,
    apiKeyPlaceholder: "AKIAEXAMPLE:secret (optional)",
    apiKeyHelperKey: "settings.ai.apiKeyHelperBedrock",
    showApiVersion: false,
    modelPlaceholder: "eu.anthropic.claude-sonnet-4-20250514-v1:0",
    modelHelperKey: "settings.ai.modelHelperBedrock",
    supportsModelList: true,
  },
};

/** Presentation for a provider; unknown values fall back to Ollama, the default. */
export function providerUi(providerType: string): AiProviderUi {
  return PROVIDERS[providerType as AiProviderType] ?? PROVIDERS.ollama;
}
