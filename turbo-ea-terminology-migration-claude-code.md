# Turbo EA — Terminology Migration (Claude Code Instructions)

## Objective

Rename LeanIX-specific terminology throughout the codebase. This is a mechanical refactoring — no logic changes, no new features.

## Term Map

| Old | New | Context |
|-----|-----|---------|
| `fact_sheet` / `FactSheet` / `fact-sheet` / `Fact Sheet` | `card` / `Card` / `card` / `Card` | Core entity |
| `fact_sheet_type` / `FactSheetType` | `card_type` / `CardType` | Entity type definition |
| `quality_seal` / `Quality Seal` | `approval_status` / `Approval Status` | Governance status field |
| `completion` (only on FactSheet/Card model and its derivatives) | `data_quality` / `Data Quality` | Completeness score |
| `subscription` / `Subscription` (user↔fact-sheet assignment) | `stakeholder` / `Stakeholder` | User role on a card |
| `subscription_roles` / `subscription-roles` | `stakeholder_roles` / `stakeholder-roles` | Role definitions |
| `fs_id` (route parameter) | `card_id` | URL parameter |

## Critical Disambiguation Rules

### `completion` — ONLY rename when it refers to the Card/FactSheet data quality score

**RENAME** these patterns:
- `FactSheet.completion` / `Card.completion` (model field)
- `fs.completion` / `card.completion` → `card.data_quality` (instance attribute access)
- `"completion"` in column references: sort columns, query filters, response dicts, schema fields
- `avg_completion`, `completion_distribution`, `overall_completion`, `sum_completion`, `all_completions`, `_compute_completion` — these all derive from the Card completion field
- `completion: number` / `completion: float` in type definitions for Card/FactSheet

**DO NOT RENAME**:
- Any use of the word "completion" outside the Card/FactSheet context (none currently exist in this codebase, but verify)

### `subscription` — ONLY rename when it means "user assigned to a fact sheet/card"

**RENAME** these:
- `Subscription` model class → `Stakeholder`
- `subscriptions` table → `stakeholders`
- `subscription.py` model file → `stakeholder.py`
- `subscriptions.py` API route file → `stakeholders.py`
- `SubscriptionCreate` schema → `StakeholderCreate`
- `SubscriptionRef` / `SubscriptionRoleDef` / `SubscriptionRoleDefinition` types → `StakeholderRef` / `StakeholderRoleDef` / `StakeholderRoleDefinition`
- `subscription_roles` → `stakeholder_roles` (on FactSheetType/CardType model)
- `/subscription-roles` → `/stakeholder-roles` (API path)
- `/subscriptions/{sub_id}` → `/stakeholders/{stakeholder_id}` (API path)
- `/fact-sheets/{fs_id}/subscriptions` → `/cards/{card_id}/stakeholders` (API path)
- `card.stakeholders` (relationship access, was `fs.subscriptions`)
- `"Subscriptions"` tab label → `"Stakeholders"`
- `"Add Subscription"` button label → `"Add Stakeholder"`

**DO NOT RENAME**:
- `notification_preferences` keys containing "subscription" (none exist currently)
- Any future reference to notification subscriptions (push/email subscribe)
- The concept in `notification_service.py` is "notify subscribers" which actually means "notify stakeholders" — so this DOES get renamed

---

## Phase 1: Database Migration

Create a new Alembic migration file. This must run BEFORE any code changes.

**Create file**: `backend/alembic/versions/XXX_rename_terminology.py`

Use the next sequential number based on existing migrations. The migration performs metadata-only renames (instant in PostgreSQL).

```python
"""Rename terminology: fact_sheet→card, quality_seal→approval_status, subscription→stakeholder.

Revision ID: <generate>
Revises: <current head>
"""
from alembic import op

# revision identifiers
revision = "<generate>"
down_revision = "<current head>"

def upgrade():
    # Table renames
    op.rename_table("fact_sheets", "cards")
    op.rename_table("fact_sheet_types", "card_types")
    op.rename_table("fact_sheet_tags", "card_tags")
    op.rename_table("subscriptions", "stakeholders")

    # Column renames on cards (was fact_sheets)
    op.alter_column("cards", "quality_seal", new_column_name="approval_status")
    op.alter_column("cards", "completion", new_column_name="data_quality")

    # FK columns: fact_sheet_id → card_id
    op.alter_column("comments", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("documents", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("events", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("notifications", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("todos", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("card_tags", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("stakeholders", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("survey_responses", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("process_diagrams", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("process_assessments", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("process_elements", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("process_elements", "linked_fact_sheet_id", new_column_name="linked_card_id")
    op.alter_column("process_elements", "application_fact_sheet_id", new_column_name="application_card_id")
    op.alter_column("process_elements", "capability_fact_sheet_id", new_column_name="capability_card_id")
    op.alter_column("relations", "source_fact_sheet_id", new_column_name="source_card_id")
    op.alter_column("relations", "target_fact_sheet_id", new_column_name="target_card_id")
    op.alter_column("bookmarks", "fact_sheet_type", new_column_name="card_type")
    op.alter_column("web_portals", "fact_sheet_type", new_column_name="card_type")
    op.alter_column("card_types", "subscription_roles", new_column_name="stakeholder_roles")

    # Note: SoAW has initiative_id (not fact_sheet_id) — no rename needed for the column.
    # But the FK target string changes automatically with table rename.
    # diagram_initiatives has initiative_id — no rename needed.
    # process_flow_versions has process_id — no rename needed.

def downgrade():
    op.alter_column("card_types", "stakeholder_roles", new_column_name="subscription_roles")
    op.alter_column("web_portals", "card_type", new_column_name="fact_sheet_type")
    op.alter_column("bookmarks", "card_type", new_column_name="fact_sheet_type")
    op.alter_column("relations", "target_card_id", new_column_name="target_fact_sheet_id")
    op.alter_column("relations", "source_card_id", new_column_name="source_fact_sheet_id")
    op.alter_column("process_elements", "capability_card_id", new_column_name="capability_fact_sheet_id")
    op.alter_column("process_elements", "application_card_id", new_column_name="application_fact_sheet_id")
    op.alter_column("process_elements", "linked_card_id", new_column_name="linked_fact_sheet_id")
    op.alter_column("process_elements", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("process_assessments", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("process_diagrams", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("survey_responses", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("stakeholders", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("card_tags", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("todos", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("notifications", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("events", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("documents", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("comments", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("cards", "data_quality", new_column_name="completion")
    op.alter_column("cards", "approval_status", new_column_name="quality_seal")
    op.rename_table("stakeholders", "subscriptions")
    op.rename_table("card_tags", "fact_sheet_tags")
    op.rename_table("card_types", "fact_sheet_types")
    op.rename_table("cards", "fact_sheets")
```

**DO NOT** modify any existing Alembic migration files. They describe historical schema states.

**Verification**: After creating the migration, verify it is syntactically valid:
```bash
cd backend && python -c "import alembic; print('OK')"
```

---

## Phase 2: Backend Model Files

### 2.1 Rename files

```
backend/app/models/fact_sheet.py        → backend/app/models/card.py
backend/app/models/fact_sheet_type.py   → backend/app/models/card_type.py
backend/app/models/subscription.py      → backend/app/models/stakeholder.py
backend/app/schemas/fact_sheet.py       → backend/app/schemas/card.py
backend/app/api/v1/fact_sheets.py       → backend/app/api/v1/cards.py
backend/app/api/v1/subscriptions.py     → backend/app/api/v1/stakeholders.py
```

### 2.2 Apply replacements inside model files

In ALL `.py` files under `backend/app/`, apply the following replacements **in this order** (longer patterns first to avoid partial matches):

1. `"fact_sheet_types"` → `"card_types"` (tablename string)
2. `"fact_sheet_tags"` → `"card_tags"` (tablename string)
3. `"fact_sheets"` → `"cards"` (tablename string, FK target string)
4. `"subscriptions"` → `"stakeholders"` (tablename string) — **ONLY in model files** where it's a `__tablename__` or FK target
5. `FactSheetType` → `CardType` (class name)
6. `FactSheetTag` → `CardTag` (class name)
7. `FactSheet` → `Card` (class name) — apply AFTER FactSheetType and FactSheetTag to avoid partial replacement
8. `fact_sheet_type` → `card_type` (attribute/variable name)
9. `fact_sheet_id` → `card_id` (attribute/variable/column name)
10. `fact_sheet` → `card` (attribute/variable name) — apply AFTER the more specific patterns above
11. `Subscription` → `Stakeholder` (class name)
12. `subscription_roles` → `stakeholder_roles` (attribute name)
13. `subscription` → `stakeholder` (variable name) — apply carefully, only for the user↔card assignment concept
14. `quality_seal` → `approval_status` (attribute/column name)
15. `quality-seal` → `approval-status` (URL path segment)
16. `"Quality Seal"` → `"Approval Status"` (string literal)
17. `"quality seal"` → `"approval status"` (string literal)

For `completion` → `data_quality`, apply ONLY to these specific patterns in backend files:
- `completion: Mapped[float]` → `data_quality: Mapped[float]` (model field)
- `FactSheet.completion` / `Card.completion` → `Card.data_quality` (query references)
- `fs.completion` → `card.data_quality` (instance access)
- `"completion"` in sort column whitelists → `"data_quality"`
- `completion=` in response dicts → `data_quality=`
- `avg_completion` → `avg_data_quality`
- `completion_distribution` → `data_quality_distribution`
- `completion_dist` → `data_quality_dist`
- `overall_completion` → `overall_data_quality`
- `sum_completion` → `sum_data_quality`
- `all_completions` → `all_data_quality_scores`
- `_compute_completion` → `_compute_data_quality`
- `quality_seal: str` in schemas → `approval_status: str`
- `completion: float` in schemas → `data_quality: float`

### 2.3 Update `backend/app/models/__init__.py`

```python
# Update imports:
from app.models.card import Card                    # was fact_sheet / FactSheet
from app.models.card_type import CardType            # was fact_sheet_type / FactSheetType
from app.models.stakeholder import Stakeholder       # was subscription / Subscription
from app.models.tag import CardTag                   # was FactSheetTag

# Update __all__:
# "FactSheet" → "Card"
# "FactSheetType" → "CardType"
# "FactSheetTag" → "CardTag"
# "Subscription" → "Stakeholder"
```

### 2.4 Update all imports across backend

Every file that imports from the old module paths must be updated:

```python
# Old → New
from app.models.fact_sheet import FactSheet           → from app.models.card import Card
from app.models.fact_sheet_type import FactSheetType   → from app.models.card_type import CardType
from app.models.subscription import Subscription       → from app.models.stakeholder import Stakeholder
from app.schemas.fact_sheet import ...                  → from app.schemas.card import ...
from app.api.v1 import fact_sheets                     → from app.api.v1 import cards
from app.api.v1 import subscriptions                   → from app.api.v1 import stakeholders
```

### 2.5 Update route prefixes

In `backend/app/api/v1/cards.py` (was `fact_sheets.py`):
```python
router = APIRouter(prefix="/cards", tags=["cards"])   # was "/fact-sheets", "fact-sheets"
```

In `backend/app/api/v1/stakeholders.py` (was `subscriptions.py`):
- Update route paths from `/fact-sheets/{fs_id}/subscriptions` to `/cards/{card_id}/stakeholders`
- Update `/subscriptions/{sub_id}` to `/stakeholders/{stakeholder_id}`
- Update `/subscription-roles` to `/stakeholder-roles`

In `backend/app/api/v1/comments.py`:
- `/fact-sheets/{fs_id}/comments` → `/cards/{card_id}/comments`

In `backend/app/api/v1/documents.py`:
- `/fact-sheets/{fs_id}/documents` → `/cards/{card_id}/documents`

In `backend/app/api/v1/todos.py`:
- `/fact-sheets/{fs_id}/todos` → `/cards/{card_id}/todos`

In `backend/app/api/v1/tags.py`:
- `/fact-sheets/{fs_id}/tags` → `/cards/{card_id}/tags`

In `backend/app/api/v1/web_portals.py`:
- `/public/{slug}/fact-sheets` → `/public/{slug}/cards`

### 2.6 Update route parameter names

In ALL route handlers across all API files, rename the parameter:
- `fs_id: str` → `card_id: str`
- All references to `fs_id` inside handler bodies → `card_id`

### 2.6b Rename `fs` local variables

In ALL API route handlers, the local variable `fs` (used for FactSheet instances) should be renamed to `card`:
- `fs = result.scalar_one_or_none()` → `card = result.scalar_one_or_none()`
- `fs = FactSheet(...)` → `card = Card(...)`
- `fs.name`, `fs.type`, `fs.id`, `fs.approval_status`, etc. → `card.name`, `card.type`, `card.id`, `card.approval_status`
- `fs_result` → `card_result`
- `fs_map` → `card_map`
- `fs_type` → `card_type_key` (to avoid shadowing the `CardType` class; use context to pick an appropriate name)

This affects ~15 route files. Apply carefully — `fs` as a variable name is very short and could appear in other contexts. Only rename when it refers to a FactSheet/Card instance.

### 2.7 Update router registration

In `backend/app/api/v1/router.py`:
```python
from app.api.v1 import cards          # was fact_sheets
from app.api.v1 import stakeholders   # was subscriptions
api_router.include_router(cards.router)
api_router.include_router(stakeholders.router)
```

### 2.8 Update event types

In `backend/app/services/event_bus.py` and all files that publish events:
- `"fact_sheet.created"` → `"card.created"`
- `"fact_sheet.updated"` → `"card.updated"`
- `"fact_sheet.deleted"` → `"card.deleted"`
- `"fact_sheet.quality_seal.*"` → `"card.approval_status.*"`

In `backend/app/services/notification_service.py`:
- `"fact_sheet_updated"` → `"card_updated"`
- `"quality_seal_changed"` → `"approval_status_changed"`
- Update import of Subscription → Stakeholder

### 2.9 Update API response keys

In ALL route handlers that return JSON dicts, rename response keys:
- `"fact_sheet_id"` → `"card_id"`
- `"fact_sheet_name"` → `"card_name"`
- `"fact_sheet_type"` → `"card_type"`
- `"fact_sheet"` → `"card"` (when it's a response key)
- `"quality_seal"` → `"approval_status"`
- `"quality_seals"` → `"approval_statuses"`
- `"completion"` → `"data_quality"` (only in Card-related response dicts)
- `"avg_completion"` → `"avg_data_quality"`
- `"completion_distribution"` → `"data_quality_distribution"`
- `"overall_completion"` → `"overall_data_quality"`
- `"total_fact_sheets"` → `"total_cards"`
- `"subscription"` → `"stakeholder"` (in subscription/stakeholder responses)

**Verification after Phase 2**:
```bash
cd backend
grep -rn "fact_sheet\|FactSheet\|quality_seal\|Subscription" app/ --include="*.py" | grep -v __pycache__ | grep -v alembic
# Expected: 0 results (except inside string comments that are purely descriptive)
python -c "from app.models import Card, CardType, Stakeholder, CardTag; print('Models OK')"
```

---

## Phase 3: Frontend Types and Files

### 3.1 Rename files and folders

```
frontend/src/features/fact-sheets/                     → frontend/src/features/cards/
frontend/src/features/fact-sheets/FactSheetDetail.tsx   → frontend/src/features/cards/CardDetail.tsx
frontend/src/components/CreateFactSheetDialog.tsx        → frontend/src/components/CreateCardDialog.tsx
frontend/src/features/diagrams/FactSheetPickerDialog.tsx → frontend/src/features/diagrams/CardPickerDialog.tsx
frontend/src/features/diagrams/FactSheetSidebar.tsx      → frontend/src/features/diagrams/CardSidebar.tsx
```

### 3.2 Update `frontend/src/types/index.ts`

Rename all types and properties:
- `FactSheetType` → `CardType`
- `FactSheet` → `Card`
- `FactSheetListResponse` → `CardListResponse`
- `SubscriptionRef` → `StakeholderRef`
- `SubscriptionRoleDef` → `StakeholderRoleDef`
- `SubscriptionRoleDefinition` → `StakeholderRoleDefinition`
- Property `quality_seal` → `approval_status` (inside Card type and all related interfaces)
- Property `completion` → `data_quality` (inside Card type and all related interfaces)
- Property `subscriptions` → `stakeholders` (inside Card type)
- Property `fact_sheet_id` → `card_id` (all interfaces)
- Property `fact_sheet_name` → `card_name` (all interfaces)
- Property `fact_sheet_type` → `card_type` (all interfaces)
- Property `total_fact_sheets` → `total_cards` (all interfaces)
- Property `fact_sheet_count` → `card_count` (all interfaces)
- Property `fact_sheet_updated` → `card_updated` (notification type)
- Property `factSheetId` → `cardId` (all interfaces, e.g. in route params)

### 3.3 Update all `.tsx` and `.ts` files

Apply the following replacements across ALL `.ts` and `.tsx` files in `frontend/src/`. Order matters — apply longer patterns first:

1. `FactSheetType` → `CardType`
2. `FactSheetListResponse` → `CardListResponse`
3. `FactSheetDetail` → `CardDetail`
4. `FactSheetPickerDialog` → `CardPickerDialog`
5. `FactSheetSidebar` → `CardSidebar`
6. `CreateFactSheetDialog` → `CreateCardDialog`
7. `FactSheetTag` → `CardTag`
8. `FactSheet` → `Card` (apply AFTER all more specific FactSheet* patterns)
9. `factSheetId` → `cardId`
10. `factSheet` → `card` (camelCase variable names — apply AFTER factSheetId)
11. `fact_sheet_type` → `card_type`
12. `fact_sheet_id` → `card_id`
13. `fact_sheet_name` → `card_name`
14. `fact_sheet_count` → `card_count`
15. `total_fact_sheets` → `total_cards`
16. `fact_sheet_updated` → `card_updated`
17. `fact_sheet` → `card` (remaining snake_case — apply AFTER specific patterns)
18. `/fact-sheets/` → `/cards/` (API paths and route paths)
19. `/fact-sheets` → `/cards` (without trailing slash)
20. `"fact-sheets"` → `"cards"` (tag names, string literals)
21. `SubscriptionRoleDefinition` → `StakeholderRoleDefinition`
22. `SubscriptionRoleDef` → `StakeholderRoleDef`
23. `SubscriptionRef` → `StakeholderRef`
24. `SubscriptionCreate` → `StakeholderCreate`
25. `subscription_roles` → `stakeholder_roles`
26. `/subscription-roles` → `/stakeholder-roles`
27. `/subscriptions/` → `/stakeholders/`
28. `".subscriptions"` → `".stakeholders"` (if accessing property as string)
29. `.subscriptions` → `.stakeholders` (object property access on Card/FactSheet objects)
30. `"Subscriptions"` → `"Stakeholders"` (tab labels, headings)
31. `"Add Subscription"` → `"Add Stakeholder"` (button labels)
32. `"subscription"` → `"stakeholder"` (remaining string refs to the concept)
33. `quality_seal` → `approval_status` (all occurrences)
34. `qualitySeal` → `approvalStatus` (camelCase)
35. `"Quality Seal"` → `"Approval Status"` (UI labels)
36. `"quality seal"` → `"approval status"` (lowercase labels)
37. `quality-seal` → `approval-status` (API paths)
38. `"Fact Sheet"` → `"Card"` (UI labels)
39. `"Fact sheet"` → `"Card"` (UI labels)
40. `"fact sheet"` → `"card"` (comments, error messages, lowercase labels)
41. `"Fact Sheets"` → `"Cards"` (UI labels, sheet names)
42. `"fact sheets"` → `"cards"` (lowercase)
43. `"Quality Seal Distribution"` → `"Approval Status Distribution"` (dashboard title)
44. `"Quality Seal Changed"` → `"Approval Status Changed"` (notification label)

For `completion` → `data_quality` in frontend, rename ONLY these patterns:
- `completion: number` inside Card/FactSheet type definitions → `data_quality: number`
- `avg_completion` → `avg_data_quality`
- `completion_distribution` → `data_quality_distribution`
- `.completion` when accessed on a Card/FactSheet object → `.data_quality`
- `"completion"` when used as a column key, sort key, or filter key for cards → `"data_quality"`
- `"Data Quality"` should be the new UI label where `"Completion"` was used as a Card column header

### 3.4 Update route in `frontend/src/App.tsx`

```tsx
// Old
import FactSheetDetail from "@/features/fact-sheets/FactSheetDetail";
<Route path="/fact-sheets/:id" element={<FactSheetDetail />} />

// New
import CardDetail from "@/features/cards/CardDetail";
<Route path="/cards/:id" element={<CardDetail />} />
```

Also update the survey respond route parameter if it uses `factSheetId`:
```tsx
<Route path="/surveys/:surveyId/respond/:cardId" element={<SurveyRespond />} />
```

### 3.5 Update navigation links

In `frontend/src/layouts/AppLayout.tsx` and any sidebar/nav component:
- Any link to `/fact-sheets/` → `/cards/`

### 3.6 Update `useMetamodel.ts` hook

All references to `FactSheetType` → `CardType`, `fact_sheet` → `card`.

**Verification after Phase 3**:
```bash
cd frontend
npx tsc --noEmit 2>&1 | head -50
# Fix any TypeScript errors. The compiler will catch every missed reference.
grep -rn "fact_sheet\|FactSheet\|factSheet\|Fact Sheet\|quality_seal\|qualitySeal\|Quality Seal" src/ --include="*.ts" --include="*.tsx" | head -20
# Expected: 0 results (except comments that are purely descriptive)
```

---

## Phase 4: Seed Data and Tests

### 4.1 Update seed scripts

Apply all the same renames in:
- `backend/app/services/seed.py`
- `backend/app/services/seed_demo.py`
- `backend/app/services/seed_demo_bpm.py`

These files create `FactSheet(...)` instances, reference `fact_sheet_id`, `quality_seal`, `Subscription`, `completion` etc. All must be updated.

### 4.2 Update test files

Apply all renames in `backend/tests/` — same patterns as Phase 2.

### 4.3 Update notification preferences

In `backend/app/models/user.py`, the `DEFAULT_NOTIFICATION_PREFERENCES` dict has keys:
- `"fact_sheet_updated"` → `"card_updated"`
- `"quality_seal_changed"` → `"approval_status_changed"`

In `frontend/src/components/NotificationPreferencesDialog.tsx`:
- `"fact_sheet_updated"` → `"card_updated"`
- `"quality_seal_changed"` → `"approval_status_changed"`
- `"Fact Sheet Updated"` → `"Card Updated"`
- `"Quality Seal Changed"` → `"Approval Status Changed"`

---

## Phase 5: Final Verification

Run these checks to confirm the migration is complete:

```bash
# Backend: zero remaining old-term references (excluding alembic history and comments)
cd backend
grep -rn "fact_sheet\|FactSheet\|quality_seal\|\"Subscription\"\|\"subscriptions\"" app/ --include="*.py" | grep -v __pycache__ | grep -v "# " | grep -v alembic
# Expected: 0 results

# Frontend: zero remaining old-term references  
cd frontend
grep -rn "fact_sheet\|FactSheet\|factSheet\|quality_seal\|qualitySeal" src/ --include="*.ts" --include="*.tsx"
# Expected: 0 results

grep -rn "Fact Sheet\|Quality Seal" src/ --include="*.ts" --include="*.tsx"
# Expected: 0 results

# TypeScript compilation
npx tsc --noEmit
# Expected: 0 errors

# Python imports
cd backend && python -c "
from app.models import Card, CardType, Stakeholder, CardTag
from app.schemas.card import CardResponse
print('All imports OK')
"
```

---

## Files Affected (Complete List)

### Backend (52 files)

**Models (rename + edit):**
`card.py` (was `fact_sheet.py`), `card_type.py` (was `fact_sheet_type.py`), `stakeholder.py` (was `subscription.py`), `__init__.py`, `bookmark.py`, `comment.py`, `diagram.py`, `document.py`, `event.py`, `notification.py`, `process_assessment.py`, `process_diagram.py`, `process_element.py`, `process_flow_version.py`, `relation.py`, `soaw.py`, `survey.py`, `tag.py`, `todo.py`, `user.py`, `web_portal.py`

**Schemas (rename + edit):**
`card.py` (was `fact_sheet.py`), `common.py`, `relation.py`

**API routes (rename + edit):**
`cards.py` (was `fact_sheets.py`), `stakeholders.py` (was `subscriptions.py`), `router.py`, `auth.py`, `bookmarks.py`, `bpm.py`, `bpm_assessments.py`, `bpm_reports.py`, `bpm_workflow.py`, `comments.py`, `diagrams.py`, `documents.py`, `eol.py`, `events.py`, `metamodel.py`, `notifications.py`, `relations.py`, `reports.py`, `settings.py`, `soaw.py`, `surveys.py`, `tags.py`, `todos.py`, `web_portals.py`

**Services (edit):**
`event_bus.py`, `notification_service.py`, `seed.py`, `seed_demo.py`, `seed_demo_bpm.py`

**Config (edit):**
`main.py` (if it references fact_sheets)

### Frontend (49 files)

**Renamed files:**
`CardDetail.tsx` (was `FactSheetDetail.tsx`), `CreateCardDialog.tsx` (was `CreateFactSheetDialog.tsx`), `CardPickerDialog.tsx` (was `FactSheetPickerDialog.tsx`), `CardSidebar.tsx` (was `FactSheetSidebar.tsx`)

**Renamed folder:**
`features/cards/` (was `features/fact-sheets/`)

**Edited files:**
`App.tsx`, `types/index.ts`, `hooks/useMetamodel.ts`, `hooks/useAuth.ts`, `layouts/AppLayout.tsx`, `components/EolLinkSection.tsx`, `components/NotificationBell.tsx`, `components/NotificationPreferencesDialog.tsx`, `components/VendorField.tsx`, `features/admin/EolAdmin.tsx`, `features/admin/MetamodelAdmin.tsx`, `features/admin/SurveyBuilder.tsx`, `features/admin/SurveyResults.tsx`, `features/admin/WebPortalsAdmin.tsx`, `features/bpm/BpmDashboard.tsx`, `features/bpm/BpmReportPage.tsx`, `features/bpm/ElementLinker.tsx`, `features/bpm/ProcessAssessmentPanel.tsx`, `features/bpm/ProcessFlowEditorPage.tsx`, `features/bpm/ProcessFlowTab.tsx`, `features/bpm/ProcessNavigator.tsx`, `features/dashboard/Dashboard.tsx`, `features/diagrams/CreateOnDiagramDialog.tsx`, `features/diagrams/DiagramEditor.tsx`, `features/diagrams/DiagramSyncPanel.tsx`, `features/diagrams/DiagramsPage.tsx`, `features/diagrams/RelationPickerDialog.tsx`, `features/diagrams/drawio-shapes.ts`, `features/ea-delivery/EADeliveryPage.tsx`, `features/ea-delivery/SoAWEditor.tsx`, `features/inventory/ImportDialog.tsx`, `features/inventory/InventoryFilterSidebar.tsx`, `features/inventory/InventoryPage.tsx`, `features/inventory/RelationCellPopover.tsx`, `features/inventory/excelExport.ts`, `features/inventory/excelImport.ts`, `features/reports/*.tsx` (all 9 report files), `features/surveys/MySurveys.tsx`, `features/surveys/SurveyRespond.tsx`, `features/todos/TodosPage.tsx`, `features/web-portals/PortalViewer.tsx`

### Alembic (1 new file)

`backend/alembic/versions/XXX_rename_terminology.py` — **new file only, do not edit existing migrations**
