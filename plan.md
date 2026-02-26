# AI App Metadata Suggestions — Feasibility & Implementation Plan

## Feature Summary

When creating (or editing) an Application card, offer a **"Suggest with AI"** button that calls a **local LLM** (e.g. Ollama) to search the internet and propose values for the card's built-in fields (description, vendor, hosting type, business criticality, etc.). The user reviews suggestions in a side panel and selectively accepts individual field values.

---

## 1. Feasibility Assessment

### 1.1 Technical Feasibility: **HIGH**

| Dimension | Assessment | Notes |
|-----------|-----------|-------|
| **Backend integration** | Straightforward | Follows the same async `httpx` proxy pattern as the EOL and ServiceNow integrations. New `backend/app/api/v1/ai_suggest.py` + `backend/app/services/ai_service.py`. |
| **Local LLM (Ollama)** | Well-suited | Ollama exposes a simple REST API (`POST /api/generate` or `/api/chat`) on `localhost:11434`. No external cloud dependency, no API keys for the base case. Models with tool-use / structured output (e.g. `llama3.1`, `mistral`, `qwen2.5`) can return JSON reliably. |
| **Internet search** | Feasible via LLM tools or two-step | Option A: Use a model that supports web search tool-use natively. Option B: Backend performs a web search first (SearXNG, Tavily, or a simple DuckDuckGo scrape), then feeds results into the LLM as context for structured extraction. Option B is more reliable and controllable. |
| **Frontend UX** | Natural fit | The `CreateCardDialog` already dynamically renders fields from the metamodel. Adding a suggestion overlay/panel that maps LLM output to field keys is a clean extension. The existing EOL suggestion chips pattern is a proven UX reference. |
| **Metamodel-driven** | Excellent | Because field schemas are data (JSONB), the backend can dynamically build the LLM prompt from the Application type's `fields_schema` — no hardcoding needed. This means the feature naturally extends to other card types in the future. |
| **Data-driven configuration** | No migration needed | LLM settings (provider URL, model name, enabled/disabled) fit cleanly into the `general_settings` JSONB column on `AppSettings`. |

### 1.2 Key Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **LLM hallucination** — suggestions may be inaccurate | Medium | User reviews every field individually before accepting. UI shows confidence indicators. Suggestions are never auto-applied. |
| **Latency** — local LLM inference can take 5-15s | Medium | Use streaming (`stream: true` in Ollama API) to show results progressively. Show a skeleton/loading state. Make it fully asynchronous — user can continue filling other fields while waiting. |
| **Ollama not available** — user hasn't installed it | Low | Feature is opt-in. If the AI service is not configured or unreachable, the "Suggest" button is simply hidden. Graceful degradation — card creation works exactly as before. |
| **Structured output reliability** — LLM may not return valid JSON | Medium | Use Ollama's `format: "json"` parameter + a well-crafted system prompt with the exact JSON schema. Validate response with Pydantic on the backend. Retry once on parse failure with a stricter prompt. |
| **Security — prompt injection** | Low | The search query is the application name (user-supplied), which is a short string. Sanitize input, limit length. The LLM output is validated against a strict Pydantic schema — arbitrary text in unexpected fields is rejected. |

### 1.3 Architecture Decision: Two-Step Search + Extract

Rather than relying on the LLM to "search the internet" (which requires specific model capabilities and is unreliable), use a **two-step approach**:

1. **Step 1 — Web Search**: Backend calls a configurable search provider (SearXNG instance, or DuckDuckGo HTML scrape as a zero-dependency fallback) with the application name. Extracts top 5-10 result snippets.
2. **Step 2 — LLM Extraction**: Backend sends the search snippets + the Application field schema to the local LLM, asking it to extract structured metadata. The LLM acts as a **structured data extractor**, not a search engine.

This is more reliable, auditable, and works with any LLM model (no tool-use required).

---

## 2. Architecture

### 2.1 System Flow

```
┌──────────────┐     POST /ai/suggest        ┌──────────────────┐
│   Frontend    │ ──────────────────────────→  │   FastAPI Backend │
│  CreateCard   │     {type, name, subtype}    │   ai_suggest.py  │
│  Dialog       │                              └────────┬─────────┘
│               │                                       │
│  ┌──────────┐ │     SSE stream or JSON               │ 1. Build search query
│  │Suggestion│ │ ←──────────────────────────           │ 2. Web search (SearXNG / DDG)
│  │ Panel    │ │     {field: value, ...}               │ 3. Build LLM prompt from
│  └──────────┘ │                                       │    fields_schema + snippets
│               │                              ┌────────▼─────────┐
└──────────────┘                               │  ai_service.py   │
                                               │                  │
                                               │  ┌────────────┐  │
                                               │  │ Web Search  │  │  → SearXNG / DDG
                                               │  └─────┬──────┘  │
                                               │        │ snippets │
                                               │  ┌─────▼──────┐  │
                                               │  │ Ollama LLM  │  │  → localhost:11434
                                               │  │ (structured │  │
                                               │  │  extraction) │  │
                                               │  └─────────────┘  │
                                               └──────────────────┘
```

### 2.2 Backend Components

#### New Files

| File | Purpose |
|------|---------|
| `backend/app/api/v1/ai_suggest.py` | API endpoint: `POST /ai/suggest` — accepts card type + name, returns field suggestions |
| `backend/app/services/ai_service.py` | Orchestrator: web search → LLM prompt → parse response |
| `backend/app/schemas/ai_suggest.py` | Pydantic request/response models |

#### Modified Files

| File | Change |
|------|--------|
| `backend/app/config.py` | Add `AI_PROVIDER_URL`, `AI_MODEL`, `AI_SEARCH_URL` env vars with empty defaults (disabled by default) |
| `backend/app/api/v1/router.py` | Register `ai_suggest.router` |
| `backend/app/api/v1/settings.py` | Add `GET/PATCH /settings/ai` endpoints for admin UI configuration |
| `backend/app/core/permissions.py` | Add `"ai": {"ai.suggest": "Use AI suggestions"}` permission group |

#### API Contract

**Request:**
```http
POST /api/v1/ai/suggest
Authorization: Bearer <token>
Content-Type: application/json

{
  "type_key": "Application",
  "subtype": "businessApplication",
  "name": "SAP S/4HANA",
  "context": "ERP system"       // optional hint from the user
}
```

**Response:**
```json
{
  "suggestions": {
    "description": {
      "value": "SAP S/4HANA is an intelligent ERP suite built on SAP HANA...",
      "confidence": 0.92,
      "source": "sap.com"
    },
    "vendor": {
      "value": "SAP SE",
      "confidence": 0.98,
      "source": "sap.com"
    },
    "hostingType": {
      "value": "SaaS",
      "confidence": 0.75,
      "source": "sap.com",
      "alternatives": ["Hybrid", "On-Premise"]
    },
    "businessCriticality": {
      "value": "critical",
      "confidence": 0.60,
      "note": "Typically critical for enterprises using it as primary ERP"
    },
    "productName": {
      "value": "S/4HANA",
      "confidence": 0.95,
      "source": "sap.com"
    }
  },
  "sources": [
    {"url": "https://www.sap.com/products/erp/s4hana.html", "title": "SAP S/4HANA"},
    {"url": "https://en.wikipedia.org/wiki/SAP_S/4HANA", "title": "Wikipedia"}
  ],
  "model": "llama3.1:8b",
  "search_provider": "duckduckgo"
}
```

Each suggestion maps to a field key from the type's `fields_schema`. For `single_select` fields, the value must match one of the defined option keys. The backend validates this before returning.

### 2.3 Frontend Components

#### New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/AiSuggestPanel.tsx` | Reusable panel showing AI suggestions with accept/reject per field |
| `frontend/src/features/admin/AiSettingsSection.tsx` | Admin UI section for configuring AI provider URL, model, search provider |

#### Modified Files

| File | Change |
|------|---------|
| `frontend/src/components/CreateCardDialog.tsx` | Add "Suggest with AI" button (sparkle icon). When clicked, calls API, opens `AiSuggestPanel`. Accepted values populate form fields. |
| `frontend/src/features/cards/CardDetail.tsx` | Add "Suggest with AI" action on the card detail page too (for filling empty fields on existing cards) |
| `frontend/src/features/admin/SettingsAdmin.tsx` | Add AI configuration section |
| `frontend/src/types/index.ts` | Add `AiSuggestion`, `AiSuggestResponse` interfaces |
| `frontend/src/i18n/locales/{all}/common.json` | Add translation keys for AI suggestion UI strings |

#### UX Design — Suggestion Panel

```
┌─────────────────────────────────────────┐
│  ✨ AI Suggestions for "SAP S/4HANA"   │
│  ─────────────────────────────────────  │
│                                         │
│  📝 Description                  [✓ Apply]│
│  ┌─────────────────────────────────┐    │
│  │ SAP S/4HANA is an intelligent   │    │
│  │ ERP suite built on SAP HANA...  │    │
│  └─────────────────────────────────┘    │
│  Source: sap.com · Confidence: 92%      │
│                                         │
│  🏢 Vendor                       [✓ Apply]│
│  SAP SE                                 │
│  Source: sap.com · Confidence: 98%      │
│                                         │
│  ☁️ Hosting Type                 [✓ Apply]│
│  ● SaaS  ○ Hybrid  ○ On-Premise        │
│  Confidence: 75%                        │
│                                         │
│  ⚡ Business Criticality         [✓ Apply]│
│  Critical                               │
│  Confidence: 60%                        │
│                                         │
│  📦 Product Name                 [✓ Apply]│
│  S/4HANA                                │
│  Confidence: 95%                        │
│                                         │
│  ─────────────────────────────────────  │
│  Sources: sap.com, wikipedia.org        │
│  Model: llama3.1:8b                     │
│  [Apply All Selected]  [Dismiss]        │
└─────────────────────────────────────────┘
```

- Each field has a checkbox (default checked for confidence > 0.7)
- `single_select` fields show the suggested option highlighted + alternatives as radio buttons
- Text fields show the full text in an editable textarea so the user can tweak before applying
- "Apply All Selected" pushes checked values into the form state
- "Dismiss" closes the panel without applying anything
- Sources are shown for transparency

### 2.4 Admin Configuration

New section in **Settings > AI Configuration** (admin only):

| Setting | Type | Default | Notes |
|---------|------|---------|-------|
| Enable AI Suggestions | boolean | `false` | Feature flag — hides the button entirely when off |
| LLM Provider URL | url | `http://localhost:11434` | Ollama API base URL |
| LLM Model | text | `llama3.1:8b` | Model name (must be pulled in Ollama) |
| Search Provider | select | `duckduckgo` | `duckduckgo` (zero-dependency) or `searxng` |
| SearXNG URL | url | *(empty)* | Only shown when search provider = searxng |
| Card types enabled | multiselect | `[Application]` | Which card types show the AI suggest button |

All settings stored in `general_settings` JSONB → no Alembic migration needed.

### 2.5 LLM Prompt Engineering

The backend dynamically builds the prompt from the metamodel:

```
System: You are a metadata extractor for enterprise architecture.
Given web search results about a software application, extract
structured metadata. Return ONLY valid JSON matching this schema:

{
  "description": "2-3 sentence description of the application",
  "vendor": "company name that develops/sells it",
  "productName": "official product name",
  "hostingType": "one of: onPremise, iaas, paas, saas, hybrid",
  "businessCriticality": "one of: critical, high, medium, low",
  "functionalSuitability": "one of: suitable, sufficient, insufficient",
  "costTotalAnnual": null
}

For select fields, use ONLY the allowed option keys listed above.
Set the value to null if the information is not available in the
search results. Do not guess — only extract what is clearly stated.

For each field you populate, also provide:
- "confidence": float 0.0-1.0
- "source": which search result domain the info came from

User: Application name: "SAP S/4HANA"
Subtype: Business Application

Web search results:
[1] sap.com — "SAP S/4HANA is the next-generation ERP suite..."
[2] wikipedia.org — "SAP S/4HANA is an enterprise resource planning..."
[3] gartner.com — "SAP S/4HANA is positioned as a Leader..."
...
```

The field schema is injected dynamically from `fields_schema`, so if an admin adds new fields to the Application type, they automatically appear in the prompt.

---

## 3. Implementation Plan

### Phase 1 — Backend Foundation (Core)

| Step | Task | Files |
|------|------|-------|
| 1.1 | Add AI env vars to `config.py` (`AI_PROVIDER_URL`, `AI_MODEL`, `AI_SEARCH_PROVIDER`, `AI_SEARCH_URL`) | `config.py` |
| 1.2 | Add `"ai"` permission group to `permissions.py` | `permissions.py` |
| 1.3 | Create `schemas/ai_suggest.py` with Pydantic request/response models | New file |
| 1.4 | Create `services/ai_service.py` — web search + LLM orchestration | New file |
| 1.5 | Create `api/v1/ai_suggest.py` — `POST /ai/suggest` endpoint | New file |
| 1.6 | Register router in `router.py` | `router.py` |
| 1.7 | Add AI settings endpoints to `settings.py` | `settings.py` |
| 1.8 | Add `ai.suggest` permission to default roles (admin, bpm_admin, member — not viewer) | `permissions.py` |

### Phase 2 — Frontend Integration

| Step | Task | Files |
|------|------|-------|
| 2.1 | Add TypeScript interfaces to `types/index.ts` | `types/index.ts` |
| 2.2 | Create `AiSuggestPanel.tsx` component | New file |
| 2.3 | Integrate into `CreateCardDialog.tsx` — add button + panel | `CreateCardDialog.tsx` |
| 2.4 | Add AI settings UI section in `SettingsAdmin.tsx` | `SettingsAdmin.tsx` + new `AiSettingsSection.tsx` |
| 2.5 | Add i18n keys to all 7 locales (common namespace) | `locales/*/common.json` |

### Phase 3 — Card Detail Integration

| Step | Task | Files |
|------|------|-------|
| 3.1 | Add "Suggest with AI" action to `CardDetail.tsx` for filling empty fields | `CardDetail.tsx` |
| 3.2 | Extend `AiSuggestPanel` to work in "edit mode" (pre-fills only empty fields) | `AiSuggestPanel.tsx` |

### Phase 4 — Polish & Testing

| Step | Task | Files |
|------|------|-------|
| 4.1 | Backend unit tests for `ai_service.py` (mock Ollama + search responses) | `tests/services/test_ai_service.py` |
| 4.2 | Backend API tests for `POST /ai/suggest` | `tests/api/test_ai_suggest.py` |
| 4.3 | Frontend tests for `AiSuggestPanel` | `AiSuggestPanel.test.tsx` |
| 4.4 | Version bump + changelog | `VERSION`, `CHANGELOG.md` |

---

## 4. Effort Estimate

| Phase | Scope |
|-------|-------|
| Phase 1 — Backend | ~8 files (3 new, 5 modified) |
| Phase 2 — Frontend | ~12 files (2 new, 10 modified incl. 7 locale files) |
| Phase 3 — Card Detail | ~2 files modified |
| Phase 4 — Tests | ~3 new test files |
| **Total** | **~25 files** |

---

## 5. Dependencies & Prerequisites

| Dependency | Required? | Notes |
|------------|-----------|-------|
| **Ollama** | Yes (for LLM) | User must install and run Ollama with a pulled model. The feature gracefully disables when unavailable. |
| **SearXNG** | Optional | For privacy-respecting web search. DuckDuckGo HTML scrape works as a zero-dependency fallback. |
| **New Python packages** | Minimal | `httpx` already in deps. No new packages needed if using DuckDuckGo scrape. If adding SearXNG: still just `httpx`. |
| **New npm packages** | None | MUI components + existing patterns suffice. |
| **Alembic migration** | **None** | All config stored in `general_settings` JSONB. |

---

## 6. Future Extensions (Out of Scope for v1)

- **Streaming responses**: Use SSE to stream LLM output token-by-token for better perceived latency
- **Other card types**: Extend to ITComponent (auto-fill vendor, hosting, etc.), BusinessProcess, etc.
- **Batch suggestions**: "Suggest all" on inventory page for multiple cards at once
- **Custom prompts**: Let admins customize the extraction prompt per card type
- **Cloud LLM providers**: Add OpenAI / Anthropic / Azure as optional providers (with API key encryption)
- **RAG from existing cards**: Use existing card data as context for more accurate suggestions
