---
paths:
  - "backend/app/services/ai_service.py"
  - "backend/app/services/servicenow_service.py"
  - "backend/app/api/v1/ai_suggest.py"
  - "backend/app/api/v1/servicenow.py"
  - "frontend/src/components/AiSuggestPanel*"
  - "frontend/src/features/admin/AiAdmin*"
  - "frontend/src/features/admin/ServiceNow*"
---

# AI description suggestions and the ServiceNow integration

> Loaded when you touch `backend/app/services/ai_service.py`, `backend/app/services/servicenow_service.py`, `backend/app/api/v1/ai_suggest.py`, `backend/app/api/v1/servicenow.py`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

## ServiceNow Integration

Bi-directional sync between Turbo EA cards and ServiceNow CMDB.

- **Connections**: Multiple ServiceNow instances with credential management (encrypted)
- **Mappings**: Card type ↔ ServiceNow table mappings with field-level rules
- **Sync modes**: Pull (ServiceNow → Turbo), Push (Turbo → ServiceNow)
- **Staging**: Records staged for admin review before applying changes (skip_staging flag available)
- **Identity persistence**: `snow_identity_map` maintains ID mappings across syncs

---

## AI Description Suggestions

Optional feature that uses a local LLM (via Ollama or any Ollama-compatible provider) to generate card description suggestions. The pipeline combines web search context with LLM inference.

### Architecture
- **Two-step pipeline**: Web search (DuckDuckGo/Google/SearXNG) → LLM description generation
- **Description-only**: Suggestions are limited to the `description` field — not arbitrary metadata fields
- **Type-aware prompting**: Search queries and LLM system prompts are customized per card type (e.g., "Application" → "software application", "ITComponent" → "technology product")
- **Confidence scoring**: Each suggestion includes a 0–100% confidence score for user transparency
- **Source attribution**: Web search sources are displayed as clickable links alongside suggestions

### Backend Components
- **`services/ai_service.py`**: Core orchestration — web search dispatch, LLM prompt building, response validation
- **`api/v1/ai_suggest.py`**: FastAPI endpoints (`POST /ai/suggest`, `GET /ai/status`)
- **`schemas/ai_suggest.py`**: Pydantic request/response models
- **Settings stored in**: `app_settings.general_settings.ai` (JSONB) — provider URL, model, search provider, enabled types

### Frontend Components
- **`AiSuggestPanel.tsx`**: Reusable UI showing suggestion with confidence badge, editable description, source links, and apply/dismiss buttons. Used in both `CardDetail` and `CreateCardDialog`
- **`AiAdmin.tsx`**: Admin settings page — toggle, provider URL, model selector, search provider, per-type enablement

### Search Providers
- **DuckDuckGo** (default): Zero-dependency HTML scraping fallback
- **Google Custom Search**: Requires API key + search engine ID (`API_KEY:CX` format)
- **SearXNG**: Self-hosted meta-search engine, JSON API

### Docker Integration
Ollama is available as an opt-in Docker Compose profile:
```bash
docker compose --profile ai up -d   # Starts Ollama alongside backend + frontend
```
The `ollama` service uses a persistent volume (`ollama_models`) and is only accessible internally. Set `AI_AUTO_CONFIGURE=true` to auto-detect and configure on first startup.

### Startup Automation (`main.py`)
- **Auto-configuration**: If `AI_AUTO_CONFIGURE=true` and AI is not yet configured in DB, writes env var values to `app_settings`
- **Model pulling**: Background task checks if the configured model exists in Ollama and pulls it if missing (10-minute timeout, non-blocking)

### Permission
- **`ai.suggest`**: Controls access to AI suggestion functionality. Granted to admin, bpm_admin, and member roles by default. Not available to viewers.
