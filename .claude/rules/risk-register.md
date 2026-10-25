---
paths:
  - "backend/app/services/risk_*.py"
  - "backend/app/api/v1/risk*.py"
  - "backend/app/models/risk*.py"
  - "frontend/src/features/grc/risk/**"
  - "frontend/src/features/cards/sections/RisksTab.tsx"
---

# The EA Risk Register and mitigation tasks

> Loaded when you touch `backend/app/services/risk_*.py`, `backend/app/api/v1/risk*.py`, `backend/app/models/risk*.py`, `frontend/src/features/grc/risk/**`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

## EA Risk Register (TOGAF Phase G)

Landscape-level risk register aligned to TOGAF ADM Phase G. Separate from `PpmRisk` (which is initiative-scoped). Lives as a tab inside the **GRC** page (`/grc?tab=risk`) with detail pages at `/grc/risks/:id`. The legacy `/ea-delivery/risks` and `/ea-delivery/risks/:id` paths redirect to the GRC routes.

### Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `risks` | `Risk` | One row per risk. Fields: reference (`R-000123`), title, description, category, source_type / source_ref, initial + residual probability × impact (with derived level), owner_id, target_resolution_date, status, acceptance_rationale + accepted_by + accepted_at, created_by. **No `mitigation` text column** — mitigation is task-driven (see below). |
| `risk_cards` | `RiskCard` | M:N junction between risks and cards (composite PK risk_id + card_id, role defaulting to `affected`) |
| `risk_mitigation_tasks` | `RiskMitigationTask` | Owned mitigation activities attached to a risk. Each row carries a human-readable `reference` (`T-NNNNNN`, monotonic, `String(16)` — same shape as `risks.reference`). One-shot (default) or recurring (`recurrence_unit` = `days`/`weeks`/`months`/`years`, `recurrence_interval` ≥ 1). Carries title, description, current `owner_id`, `is_active` (flips false when a one-shot task completes), and **`lead_time_days`** (how many days before `due_date` the cycle is promoted from `scheduled` to `open` — smart per-unit defaults of 1/2/7/14 for daily/weekly/monthly/yearly, capped at half the cycle). |
| `risk_mitigation_task_occurrences` | `RiskMitigationTaskOccurrence` | One row per scheduled instance of a task. Captures `sequence` (monotonic per task), `due_date`, `assigned_owner_id` (snapshot when the cycle opens), `status` (`scheduled` / `open` / `done` / `skipped`), **`activated_at`** (stamp when a scheduled cycle was promoted to open — NULL on cycles that were never gated), `completed_at` / `completed_by` / **`owner_at_completion`** (snapshot when the cycle closes — may differ from `assigned_owner_id` if the owner was changed mid-cycle), and `completion_notes`. Recurring tasks roll forward calendar-correctly on completion: `next_due = due_date + interval`, day-of-month clamped (Jan 31 + 1 month → Feb 28); the new cycle lands as `scheduled` if today is outside `due_date - lead_time_days`, `open` otherwise. |

The `compliance_findings` table also carries a nullable `risk_id` back-link so findings that have been promoted show **Open risk R-000123** instead of **Create risk** (idempotent promotion). Promoting a finding now spawns a one-shot mitigation task seeded from the finding's `remediation` text instead of writing free-text guidance into the dropped `mitigation` column.

### Backend modules

| File | Purpose |
|------|---------|
| `models/risk.py` | `Risk` + `RiskCard` SQLAlchemy models |
| `schemas/risk.py` | Pydantic I/O models with typed literals for category, level, probability, impact, status |
| `services/risk_service.py` | Pure helpers: `derive_level` (4×4 probability × impact matrix), `validate_status_transition`, `next_reference` (`R-000001` monotonic), `link_cards`, `promote_compliance_finding`, `risk_to_dict`, `compute_metrics`, `build_level_matrix` |
| `services/risk_mitigation_task_service.py` | Mitigation-task lifecycle: `compute_next_due` (calendar-correct month/year math via `_add_months`), `create_task_with_first_occurrence`, `complete_occurrence` / `skip_occurrence` (snapshots `owner_at_completion`, deactivates one-shot tasks, rolls forward recurring tasks), `apply_task_owner_change` (propagates parent-task owner edits to the current open occurrence — past occurrences stay frozen), `sync_occurrence_todo` (mirrors `sync_owner_todo` but keyed per open occurrence), `publish_task_event` (fan-out to linked cards). |
| `api/v1/risks.py` | CRUD + card linking + promote + metrics + `GET /cards/{id}/risks`. Includes `sync_owner_todo()` which creates / updates / deletes an `is_system` Todo on the owner and fires a `risk_assigned` notification whenever the owner changes (self-assignment included — whitelisted in `allow_self_types`). |
| `api/v1/risk_mitigation_tasks.py` | Mitigation-task endpoints. `GET/POST /risks/{id}/mitigation-tasks`, `PATCH/DELETE /mitigation-tasks/{id}`, `POST /mitigation-tasks/{id}/occurrences/{occ_id}/complete` and `/skip`, `GET /mitigation-tasks/{id}/occurrences` (full audit history). Permission: `risks.view` to read; `risks.manage` to mutate; **carve-out** — a user without `risks.manage` who is the `assigned_owner_id` of an open occurrence can complete that occurrence so assignees don't have to escalate just to mark their own control review done. Skip always requires full `risks.manage`. |

### Key behaviour

- **Status workflow** is sequential with explicit side actions. The UI renders one primary **Next step** button per state (Start analysis → Plan mitigation → Start mitigation → Mark mitigated → Start monitoring → Close) plus secondary actions for Accept risk / Resume mitigation / Reopen. Accepting requires a rationale; acceptance user + timestamp are captured on the record.
- **Derived levels** (`initial_level`, `residual_level`) are computed server-side via `derive_level()` and treated as read-only by the API layer.
- **Promote-from-finding** is idempotent — the compliance finding's `risk_id` is populated on promotion and a re-promote returns the existing risk.
- **Owner → Todo → Notification** loop: assignment (from create, patch, or promote) creates a linked Todo on the owner's Todos page and sends an in-app + email-capable `risk_assigned` notification. The Todo auto-marks done when the risk reaches `mitigated` / `monitoring` / `accepted` / `closed`, and is removed when the owner is cleared or the risk is deleted.
- **Task-driven mitigation.** Mitigation is captured as owned tasks under `risk_mitigation_tasks` rather than free-text. Tasks are one-shot by default; setting `recurrence_unit` (`days` / `weeks` / `months` / `years`) plus `recurrence_interval` ≥ 1 makes them recurring controls (e.g. "Check access rights every 6 months"). Recurrence is **completion-driven** — on close (done or skipped) of one occurrence, the next occurrence opens with `due_date = previous_due_date + interval`. Each occurrence snapshots `assigned_owner_id` at open and `owner_at_completion` at close, so the audit answer to "who signed off on the Jan 2024 review?" is preserved even after years of owner rotation. **Lead-time gating** (`lead_time_days` on the task) controls when a cycle becomes visible to the assignee: a new cycle lands as `scheduled` (audit-visible but no Todo, no notification) when today is outside `due_date - lead_time_days`, and is promoted to `open` (Todo created, notification fired) by the **daily `_promote_recurring_tasks_loop()` background task** in `app.main` at 03:00 UTC. `POST /mitigation-tasks/{id}/occurrences/{occ_id}/promote` short-circuits the wait for `risks.manage` holders. Smart defaults per recurrence unit (1/2/7/14 for daily/weekly/monthly/yearly, capped at half the cycle); one-shot tasks default to 0. Per-occurrence system Todos sync to the assignee (link `/ea-delivery/risks/{risk_id}?task={task_id}#occurrence-{occurrence_id}`); a `task_assigned` notification fires on every fresh assignment / promotion (cycle rollover included, whitelisted for self). `risk_mitigation_task.*` events (`created` / `updated` / `activated` / `completed` / `skipped` / `deleted`) fan out to every linked card so the per-card history timeline picks them up; `activated_at` on the occurrence captures the promotion moment for audit. **Residual scoring stays manual** — task completion does **not** auto-adjust the residual matrix; the Risk Detail page surfaces "X/Y open · Z overdue" chips alongside the residual block as context for the human assessment (ISO 31000-aligned). Promoting a TurboLens compliance finding spawns a one-shot mitigation task from the finding's `remediation` text.

### Permissions

- `risks.view` — view the register, metrics, and the Risks tab on cards (admin / bpm_admin / member / viewer).
- `risks.manage` — create, edit, promote, delete, link cards, change status (admin / bpm_admin / member).

### Frontend modules

- `features/grc/risk/RiskMatrix.tsx` — shared 4×4 clickable heatmap used by Register and Detail pages.
- `features/grc/risk/CreateRiskDialog.tsx` — reused for manual create and for promoting compliance findings, including an Owner picker so assignment happens at creation time.
- `features/grc/risk/RiskRegisterPage.tsx` — register list view (embedded as a tab in GRC at `/grc?tab=risk`).
- `features/grc/risk/RiskDetailPage.tsx` — full TOGAF layout: Identification → Initial assessment → **Mitigation tasks panel** (replaces the old free-text field) → Residual assessment (with Owner autocomplete, Target date, residual matrix, task-summary chips for context) → Affected cards (M:N) → Status workflow (primary Next step + secondary side actions + stepper) → Audit.
- `features/grc/risk/mitigation/MitigationTasksPanel.tsx` — task list with per-task expandable history. Add / edit / complete / skip / delete actions.
- `features/grc/risk/mitigation/MitigationTaskDialog.tsx` — create / edit dialog (title, description, owner autocomplete, due date, "Repeats" Switch + unit/interval picker).
- `features/grc/risk/mitigation/CompleteOccurrenceDialog.tsx` — confirm + optional completion notes when marking an occurrence done or skipped.
- `features/grc/risk/mitigation/OccurrenceHistoryList.tsx` — read-only audit list per cycle, including the `owner_at_completion` snapshot.
- `features/grc/risk/mitigation/recurrenceLabel.ts` — pure helper that formats `(unit, interval)` → translation-aware label ("One-shot", "Every 6 months", etc.). Unit-tested.
- `features/cards/sections/RisksTab.tsx` — Card Detail → Risks tab listing all risks linked to that card.
