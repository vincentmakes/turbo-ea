# Redesign Card Details Header Badges & Actions

## Problem Analysis

The current top-right header group has four elements with three distinct visual styles:

```
Current layout:
[52px SVG Ring] [Small Chip "Active"] [Small Chip w/icon "Draft"] [Outlined Button "Approval Status ▼"]
```

**Issues:**
1. **Size mismatch** — The 52px DataQualityRing visually dominates the 24px-tall chips beside it
2. **Redundant information** — Approval status is shown twice: as a read-only badge AND as a separate button labeled generically "Approval Status"
3. **Inconsistent visual language** — Three different component types (SVG ring, Chip, Button) with different heights/shapes
4. **The button label is vague** — "Approval Status" doesn't tell users what the button does; it just repeats the badge's purpose
5. **Busy on mobile** — All four elements wrapping to a second row feels heavy

## Proposed Design

Merge the approval badge and action into a single interactive chip, shrink the data quality ring, and give all elements consistent sizing.

```
New layout:
[36px Ring] [Chip "Active"] [Clickable Chip w/icon "Draft ▾"]    (if user has permission)
[36px Ring] [Chip "Active"] [Chip w/icon "Draft"]                 (read-only, no permission)
```

### Specific Changes

1. **Shrink DataQualityRing from 52px → 36px** — Reduce `size` to 36, `strokeWidth` to 3.5, keep percentage text. This brings it visually in line with the chip heights (~24-26px with padding).

2. **Merge ApprovalStatusBadge + Approval Button into one clickable chip** — When the user has `can_approval_status` permission, the approval chip becomes clickable with a dropdown caret and opens the action menu directly. When read-only, it's a plain chip (no caret). This eliminates the separate "Approval Status" button entirely.

3. **Add a small colored dot to LifecycleBadge** — Add an 8px colored dot before the text label (via the Chip `avatar` prop) for a more polished look consistent with status indicators in modern EA tools.

4. **Use `variant="outlined"` for all chips** — Both lifecycle and approval badges use outlined variant for a lighter, more harmonious look that doesn't compete with the ring.

### Files to Change

| File | Change |
|------|--------|
| `frontend/src/features/cards/sections/cardDetailUtils.tsx` | Reduce DataQualityRing size from 52→36, strokeWidth from 5→3.5 |
| `frontend/src/components/ApprovalStatusBadge.tsx` | Add `onClick`, `onDelete` (for caret icon), and menu functionality. Accept `onAction` callback + `canChange` prop |
| `frontend/src/features/cards/CardDetail.tsx` | Remove separate approval Button + Menu. Pass props to `ApprovalStatusBadge` instead. Simplify the badges Box. |
| `frontend/src/components/LifecycleBadge.tsx` | Switch to `variant="outlined"`, add colored dot via `avatar` prop |
| `frontend/src/i18n/locales/en/cards.json` | Remove `detail.approvalStatus` key (no longer needed) |
| `frontend/src/i18n/locales/{de,fr,es,it,pt,zh}/cards.json` | Remove `detail.approvalStatus` key from all locales |
| `VERSION` | Patch bump |
| `CHANGELOG.md` | Add entry |

### Visual Result

```
BEFORE:  [●72%●]  Active   ✓ Draft   [ Approval Status ▾ ]
          52px     chip     chip        outlined button
          ring    success   default

AFTER:   [72%]  ● Active  📝 Draft ▾
          36px   outlined   outlined + clickable
          ring    chip       chip (opens menu)
```

The result is:
- **Visually balanced** — all elements roughly the same height
- **Less redundant** — one approval indicator instead of two
- **Fewer distinct component types** — ring + outlined chips (no button)
- **Clearer affordance** — the dropdown caret on the approval chip signals interactivity
- **Cleaner on mobile** — one fewer element means less wrapping
