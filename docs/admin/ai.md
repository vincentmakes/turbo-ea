# AI Description Suggestions

Turbo EA can generate card descriptions automatically using a combination of **web search** and a **Large Language Model (LLM)**. When a user clicks the AI suggest button on a card, the system searches the web for relevant information about the component, then uses an LLM to produce a concise, type-aware description — complete with a confidence score and clickable source links.

This feature is **optional** and **fully admin-controlled**. It can run entirely on your own infrastructure using a local Ollama instance, or connect to commercial LLM providers.

---

## How It Works

The AI suggestion pipeline has two steps:

1. **Web search** — Turbo EA queries a search provider (DuckDuckGo, Google Custom Search, or SearXNG) using the card's name and type as context. For example, an Application card named "SAP S/4HANA" generates a search for "SAP S/4HANA software application".

2. **LLM extraction** — The search results are sent to the configured LLM along with a type-aware system prompt. The model produces a description, a confidence score (0–100%), and lists the sources it used.

The result is displayed to the user with:

- An **editable description** they can review and modify before applying
- A **confidence badge** showing how reliable the suggestion is
- **Source links** so the user can verify the information

---

## Supported LLM Providers

| Provider | Type | Configuration |
|----------|------|---------------|
| **Ollama** | Self-hosted | Provider URL (e.g., `http://ollama:11434`) + model name |
| **OpenAI** | Commercial | API key + model name (e.g., `gpt-4o`) |
| **Google Gemini** | Commercial | API key + model name |
| **Azure OpenAI** | Commercial | API key + deployment URL |
| **OpenRouter** | Commercial | API key + model name |
| **Anthropic Claude** | Commercial | API key + model name |

Commercial providers require an API key, which is stored encrypted in the database using Fernet symmetric encryption.

---

## Search Providers

| Provider | Setup | Notes |
|----------|-------|-------|
| **DuckDuckGo** | No configuration needed | Default. Zero-dependency HTML scraping. No API key required. |
| **Google Custom Search** | Requires API key and Custom Search Engine ID | Enter as `API_KEY:CX` in the search URL field. Higher quality results. |
| **SearXNG** | Requires a self-hosted SearXNG instance URL | Privacy-focused meta-search engine. JSON API. |

---

## Setup

### Option A: Bundled Ollama (Docker Compose)

The simplest way to get started. Turbo EA includes an optional Ollama container in its Docker Compose configuration.

**1. Start with the AI profile:**

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

**2. Enable auto-configuration** by adding these variables to your `.env`:

```dotenv
AI_AUTO_CONFIGURE=true
AI_MODEL=gemma3:4b          # or mistral, llama3:8b, etc.
```

On startup, the backend will:

- Detect the Ollama container
- Save the connection settings to the database
- Pull the configured model if it is not already downloaded (runs in the background, may take a few minutes)

**3. Verify** in the admin UI: go to **Settings > AI Suggestions** and confirm the status shows as connected.

### Option B: External Ollama Instance

If you already run Ollama on a separate server:

1. Go to **Settings > AI Suggestions** in the admin UI.
2. Select **Ollama** as the provider type.
3. Enter the **Provider URL** (e.g., `http://your-server:11434`).
4. Click **Test Connection** — the system will show available models.
5. Select a **model** from the dropdown.
6. Click **Save**.

### Option C: Commercial LLM Provider

1. Go to **Settings > AI Suggestions** in the admin UI.
2. Select your provider (OpenAI, Google Gemini, Azure OpenAI, OpenRouter, or Anthropic Claude).
3. Enter your **API key** — it will be encrypted before storage.
4. Enter the **model name** (e.g., `gpt-4o`, `gemini-pro`, `claude-sonnet-4-20250514`).
5. Click **Test Connection** to verify.
6. Click **Save**.

---

## Configuration Options

Once connected, you can fine-tune the feature in **Settings > AI Suggestions**:

### Enable/Disable per Card Type

Not every card type benefits equally from AI suggestions. You can enable or disable AI for each type individually. For example, you might enable it for Application and IT Component cards but disable it for Organization cards where descriptions are company-specific.

### Search Provider

Choose which web search provider to use for gathering context before sending to the LLM. DuckDuckGo works out of the box with no configuration. Google Custom Search and SearXNG require additional setup (see the Search Providers table above).

### Model Selection

For Ollama, the admin UI shows all models currently downloaded on the Ollama instance. For commercial providers, enter the model identifier directly.

---

## Using AI Suggestions

Once configured by an admin, users with the `ai.suggest` permission (granted to Admin, BPM Admin, and Member roles by default) will see a sparkle button on card detail pages and in the create card dialog.

### On an Existing Card

1. Open any card's detail view.
2. Click the **sparkle button** (visible next to the description section when AI is enabled for that card type).
3. Wait a few seconds for the web search and LLM processing.
4. Review the suggestion: read the generated description, check the confidence score, and verify the source links.
5. **Edit** the text if needed — the suggestion is fully editable before applying.
6. Click **Apply** to set the description, or **Dismiss** to discard it.

### When Creating a New Card

1. Open the **Create Card** dialog.
2. After entering the card name, the AI suggest button becomes available.
3. Click it to pre-fill the description before saving.

!!! note
    AI suggestions only generate the **description** field. They do not populate other attributes like lifecycle, cost, or custom fields.

---

## Permissions

| Role | Access |
|------|--------|
| **Admin** | Full access: configure AI settings and use suggestions |
| **BPM Admin** | Use suggestions |
| **Member** | Use suggestions |
| **Viewer** | No access to AI suggestions |

The permission key is `ai.suggest`. Custom roles can be granted this permission through the Roles administration page.

---

## Privacy and Security

- **Self-hosted option**: When using Ollama, all AI processing happens on your own infrastructure. No data leaves your network.
- **Encrypted API keys**: Commercial provider API keys are encrypted with Fernet symmetric encryption before being stored in the database.
- **Search-only context**: The LLM receives web search results and the card's name/type — not your internal card data, relationships, or other sensitive metadata.
- **User control**: Every suggestion must be reviewed and explicitly applied by a user. AI never modifies cards automatically.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| AI suggest button not visible | Check that AI is enabled for the card type in Settings > AI Suggestions, and that the user has the `ai.suggest` permission. |
| "AI not configured" status | Go to Settings > AI Suggestions and complete the provider setup. Click Test Connection to verify. |
| Model not appearing in dropdown | For Ollama: ensure the model is downloaded (`ollama pull model-name`). For commercial providers: enter the model name manually. |
| Slow suggestions | LLM inference speed depends on hardware (for Ollama) or network latency (for commercial providers). Smaller models like `gemma3:4b` are faster than larger ones. |
| Low confidence scores | The LLM may not find enough relevant information via web search. Try a more specific card name, or consider using Google Custom Search for better results. |
| Connection test fails | Verify the provider URL is reachable from the backend container. For Docker setups, ensure both containers are on the same network. |

---

## Environment Variables

These environment variables provide initial AI configuration. Once saved through the admin UI, the database settings take precedence.

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER_URL` | *(empty)* | Ollama-compatible LLM provider URL |
| `AI_MODEL` | *(empty)* | LLM model name (e.g., `gemma3:4b`, `mistral`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Web search provider: `duckduckgo`, `google`, or `searxng` |
| `AI_SEARCH_URL` | *(empty)* | Search provider URL or API credentials |
| `AI_AUTO_CONFIGURE` | `false` | Auto-enable AI on startup if provider is reachable |
