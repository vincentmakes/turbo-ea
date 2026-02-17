# Plan: Rename remaining "Seal" terminology to "Approval Status"

The backend models, schemas, API routes, and permissions have already been migrated to use `approval_status`. However, several frontend files still use "Seal" in UI labels and variable names, and CLAUDE.md has stale references.

## Frontend Changes

### 1. `frontend/src/features/cards/CardDetail.tsx`
- Rename state variable `sealMenuAnchor` → `approvalMenuAnchor`
- Rename setter `setSealMenuAnchor` → `setApprovalMenuAnchor`
- Rename handler `handleSealAction` → `handleApprovalAction`
- Rename local `newSeal` → `newStatus`
- Change button label `"Seal"` → `"Approval Status"`

### 2. `frontend/src/features/dashboard/Dashboard.tsx`
- Change KPI label `"Approved Seals"` → `"Approved"`
- Change KPI label `"Broken Seals"` → `"Broken"`

### 3. `frontend/src/features/inventory/InventoryPage.tsx`
- Change AG Grid column `headerName: "Seal"` → `headerName: "Approval Status"`

### 4. `frontend/src/features/inventory/InventoryFilterSidebar.tsx`
- Rename function `toggleSeal` → `toggleApprovalStatus`

### 5. `frontend/src/features/inventory/excelImport.ts`
- Rename constant `VALID_SEALS` → `VALID_APPROVAL_STATUSES`

## Documentation Changes

### 6. `CLAUDE.md`
Update all stale references:
- `quality seal` → `approval status`
- `QualitySealBadge.tsx` → `ApprovalStatusBadge.tsx`
- `quality_seal` → `approval_status` (in table schemas, API docs, event types)
- `quality_seal_changed` → `approval_status_changed` (notification types)
- `fact_sheet.quality_seal.*` → `card.approval_status.*` (event types)
- Update API endpoint path `/fact-sheets/{id}/quality-seal` → `/cards/{id}/approval-status`

## Out of Scope (no changes needed)
- **Backend code**: Already fully migrated to `approval_status`
- **Alembic migrations**: Historical migrations should NOT be modified
- **`turbo-ea-rbac-spec.md`**: Reference doc, not active code
- **`turbo-ea-terminology-migration-claude-code.md`**: Migration guide, documents both old and new terms
- **`marketing-site/index.html`**: Separate concern
- **`seed_demo.py` line 1928**: The word "sealed" here refers to physical IP67 enclosures, not the feature
