# Survey Management System — Implementation Plan

## Overview

A full survey system within Turbo EA that lets admins send data-maintenance surveys to fact sheet subscribers. The workflow:

1. **Create** — Admin defines a survey: name, message, target type, filters, target subscription roles, and which fields to maintain/confirm
2. **Preview** — Before sending, admin sees the resolved list of fact sheets + users
3. **Send** — System creates individual response records per fact-sheet/user pair and sends notifications
4. **Respond** — Targeted users see pending surveys, review current field values, confirm or propose changes
5. **Monitor** — Admin views response rates and submitted answers
6. **Apply** — Admin selects responses and applies field changes back to fact sheets

---

## Data Model

### `surveys` table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| name | String(500) | Survey title |
| description | Text | Optional longer description |
| message | Text | Personalized message shown to respondents |
| status | String(20) | `draft` / `active` / `closed` |
| target_type_key | String(100) | Fact sheet type to target (e.g. "Application") |
| target_filters | JSONB | Filter criteria: `{related_type?, related_ids?, tag_ids?, attribute_filters?}` |
| target_roles | JSONB | Array of subscription roles to target, e.g. `["responsible"]` |
| fields | JSONB | Array of field defs: `[{key, section, label, type, action: "maintain"|"confirm"}]` |
| created_by | UUID FK → users | |
| sent_at | DateTime nullable | When survey was activated |
| closed_at | DateTime nullable | When survey was closed |
| created_at, updated_at | DateTime | Timestamps |

### `survey_responses` table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| survey_id | UUID FK → surveys | |
| fact_sheet_id | UUID FK → fact_sheets | |
| user_id | UUID FK → users | |
| status | String(20) | `pending` / `completed` |
| responses | JSONB | `{field_key: {current_value, new_value, confirmed}}` |
| applied | Boolean | Whether changes were applied to the fact sheet |
| responded_at | DateTime nullable | |
| applied_at | DateTime nullable | |
| created_at, updated_at | DateTime | |

Unique constraint on `(survey_id, fact_sheet_id, user_id)`.

---

## Backend

### Model: `backend/app/models/survey.py`
- `Survey` class with all columns above
- `SurveyResponse` class with relationships to Survey, FactSheet, User

### Migration: `backend/alembic/versions/009_add_surveys.py`
- Create both tables with indexes

### API: `backend/app/api/v1/surveys.py`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/surveys` | admin | List all surveys |
| POST | `/surveys` | admin | Create draft survey |
| GET | `/surveys/{id}` | admin | Get survey + response stats |
| PATCH | `/surveys/{id}` | admin | Update draft survey |
| DELETE | `/surveys/{id}` | admin | Delete draft survey |
| POST | `/surveys/{id}/preview` | admin | Resolve filters → list of fact sheets + users that would be targeted |
| POST | `/surveys/{id}/send` | admin | Activate: create response records + send notifications |
| POST | `/surveys/{id}/close` | admin | Close survey |
| GET | `/surveys/{id}/responses` | admin | All responses with fact sheet names + user names |
| POST | `/surveys/{id}/apply` | admin | Apply selected responses: body `{response_ids: [...]}` |
| GET | `/surveys/my` | any | Pending surveys for current user |
| GET | `/surveys/{id}/respond/{fs_id}` | any | Get response form (current values + field defs) |
| POST | `/surveys/{id}/respond/{fs_id}` | any | Submit response |

### Filter resolution logic (for preview + send):
1. Start with all active fact sheets of `target_type_key`
2. If `target_filters.related_type` + `target_filters.related_ids`: filter to fact sheets that have a relation to any of those IDs
3. If `target_filters.tag_ids`: filter to fact sheets that have any of those tags
4. If `target_filters.attribute_filters`: filter by attribute values (e.g. `{key: "criticality", value: "high"}`)
5. For each matching fact sheet, find subscribers with roles in `target_roles`
6. Return list of `{fact_sheet, users}` pairs

### Registration:
- Add `Survey` and `SurveyResponse` to `backend/app/models/__init__.py`
- Add `surveys` router to `backend/app/api/v1/router.py`

---

## Frontend

### Types (add to `frontend/src/types/index.ts`):
- `Survey`, `SurveyResponse`, `SurveyField`, `SurveyTargetFilters`
- `SurveyPreviewResult`, `SurveyResponseDetail`

### Pages:

1. **`SurveysAdmin`** (`frontend/src/features/admin/SurveysAdmin.tsx`)
   - Table listing all surveys with name, status, target type, response rate, dates
   - Create button → opens SurveyBuilder
   - Click row → SurveyResults (if active/closed) or SurveyBuilder (if draft)

2. **`SurveyBuilder`** (`frontend/src/features/admin/SurveyBuilder.tsx`)
   - Stepper or accordion with sections:
     - **Step 1 — Basics**: name, description, message (rich text or plain)
     - **Step 2 — Target**: select fact sheet type, add filters (related fact sheets, tags, attributes), select subscription roles
     - **Step 3 — Fields**: pick which fields from the type's `fields_schema` to include, set action (maintain/confirm)
     - **Step 4 — Preview**: show resolved targets (fact sheets + users), allow send
   - Save as draft at any point
   - Send button on preview step

3. **`SurveyResults`** (`frontend/src/features/admin/SurveyResults.tsx`)
   - Summary stats: total targets, responded, pending
   - Table of all responses: fact sheet name, user, status, each field's answer
   - Checkbox selection + "Apply selected" button
   - Close survey button

4. **`MySurveys`** (section in existing page or standalone)
   - List of pending surveys for current user grouped by survey
   - Click → SurveyRespond

5. **`SurveyRespond`** (`frontend/src/features/surveys/SurveyRespond.tsx`)
   - Shows survey message at top
   - For each field: current value displayed, with input to confirm or change
   - Submit button

### Routes (add to `App.tsx`):
- `/admin/surveys` → `SurveysAdmin`
- `/admin/surveys/new` → `SurveyBuilder`
- `/admin/surveys/:id` → `SurveyBuilder`
- `/admin/surveys/:id/results` → `SurveyResults`
- `/surveys` → `MySurveys`
- `/surveys/:surveyId/respond/:factSheetId` → `SurveyRespond`

### Navigation:
- Add "Surveys" to `ADMIN_ITEMS` in `AppLayout.tsx`
- Add "Surveys" to main `NAV_ITEMS` (for respondents to access their pending surveys)

---

## Implementation Order

1. Backend model + migration
2. Backend API endpoints
3. Frontend types
4. Frontend SurveysAdmin (list page)
5. Frontend SurveyBuilder (create/edit with stepper)
6. Frontend SurveyResults (monitoring + apply)
7. Frontend MySurveys + SurveyRespond (respondent experience)
8. Navigation + routing
9. Build verification
