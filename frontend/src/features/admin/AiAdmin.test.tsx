import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      {
        key: "Application",
        label: "Application",
        translations: {},
        is_hidden: false,
      },
    ],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";

import AiAdmin from "./AiAdmin";

const AI_DEFAULTS = {
  enabled: false,
  provider_type: "ollama",
  provider_url: "http://localhost:11434",
  api_key: "",
  model: "gemma3:4b",
  api_version: "2025-01-01",
  search_provider: "duckduckgo",
  search_url: "",
  enabled_types: [],
  portfolio_insights_enabled: false,
};

function mockLoad(overrides: Partial<typeof AI_DEFAULTS> = {}) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === "/settings/ai") {
      return Promise.resolve({ ...AI_DEFAULTS, ...overrides });
    }
    return Promise.resolve({ enabled: false, sso_configured: false });
  });
}

async function renderLoaded(overrides: Partial<typeof AI_DEFAULTS> = {}) {
  mockLoad(overrides);
  render(<AiAdmin />);
  await waitFor(() => expect(screen.getByLabelText("AI Provider")).toBeInTheDocument());
}

async function selectProvider(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("AI Provider"));
  await user.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AiAdmin provider selection", () => {
  it("offers Amazon Bedrock alongside the existing providers", async () => {
    await renderLoaded();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("AI Provider"));

    for (const name of [
      "Ollama (Self-hosted)",
      "OpenAI Compatible",
      "Azure Hosted OpenAI",
      "Anthropic Claude",
      "Amazon Bedrock",
    ]) {
      expect(await screen.findByRole("option", { name })).toBeInTheDocument();
    }
  });
});

describe("AiAdmin with Amazon Bedrock selected", () => {
  it("asks for an AWS region rather than a provider URL", async () => {
    await renderLoaded();
    await selectProvider("Amazon Bedrock");

    expect(screen.getByLabelText("AWS Region")).toBeInTheDocument();
    expect(screen.queryByLabelText("Provider URL")).not.toBeInTheDocument();
  });

  it("clears the previous provider's URL so it cannot be saved as a region", async () => {
    await renderLoaded({ provider_url: "http://localhost:11434" });
    await selectProvider("Amazon Bedrock");

    expect(screen.getByLabelText("AWS Region")).toHaveValue("");
  });

  it("shows the credentials field as optional", async () => {
    await renderLoaded();
    await selectProvider("Amazon Bedrock");

    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByText(/Leave empty to use the IAM role/i)).toBeInTheDocument();
  });

  it("does not show the Azure api-version field", async () => {
    await renderLoaded();
    await selectProvider("Amazon Bedrock");

    expect(screen.queryByLabelText("API Version")).not.toBeInTheDocument();
  });

  it("mentions inference profiles in the model helper", async () => {
    await renderLoaded();
    await selectProvider("Amazon Bedrock");

    expect(screen.getByText(/inference profile/i)).toBeInTheDocument();
  });

  it("saves the region in provider_url", async () => {
    const user = userEvent.setup();
    await renderLoaded({ provider_url: "" });
    await selectProvider("Amazon Bedrock");

    await user.type(screen.getByLabelText("AWS Region"), "eu-central-1");
    // The page has a Save button per section; the provider one comes first.
    await user.click(screen.getAllByRole("button", { name: /save/i })[0]);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/settings/ai",
        expect.objectContaining({
          provider_type: "bedrock",
          provider_url: "eu-central-1",
        }),
      ),
    );
  });

  it("turns the model field into a picker once a connection test lists ids", async () => {
    const user = userEvent.setup();
    await renderLoaded({ provider_url: "" });
    await selectProvider("Amazon Bedrock");
    await user.type(screen.getByLabelText("AWS Region"), "eu-central-1");

    vi.mocked(api.post).mockResolvedValue({
      ok: true,
      available_models: ["eu.anthropic.claude-sonnet-4", "amazon.nova-lite"],
      model_found: false,
    });
    await user.click(screen.getByRole("button", { name: /test connection/i }));

    await user.click(await screen.findByLabelText("Model"));
    expect(
      await screen.findByRole("option", {
        name: "eu.anthropic.claude-sonnet-4",
      }),
    ).toBeInTheDocument();
  });
});

describe("AiAdmin keeps the other providers working", () => {
  it("hides the credentials field for Ollama", async () => {
    await renderLoaded();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
  });

  it("hides the URL field for Anthropic but still offers a connection test", async () => {
    await renderLoaded();
    await selectProvider("Anthropic Claude");

    expect(screen.queryByLabelText("Provider URL")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test connection/i })).toBeInTheDocument();
  });

  it("shows the api-version field for Azure", async () => {
    await renderLoaded();
    await selectProvider("Azure Hosted OpenAI");

    expect(screen.getByLabelText("API Version")).toBeInTheDocument();
  });
});
