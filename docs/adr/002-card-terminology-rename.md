# ADR-002: Rename "fact sheets" to "cards"

**Status**: Accepted
**Date**: 2024-06-01

## Context

The codebase originally used "fact sheet" terminology (common in SAP LeanIX).
This was confusing for users unfamiliar with that product and overly verbose
in code (`fact_sheet_id`, `FactSheet` model, `/fact-sheets` routes).

## Decision

Rename all occurrences of "fact sheet" to "card" throughout the codebase:

- Database table: `fact_sheets` → `cards`
- Model: `FactSheet` → `Card`
- API routes: `/fact-sheets` → `/cards`
- Frontend: all references updated
- DrawIO shapes: kept `factSheetId`/`factSheetType` in XML user objects for
  backward compatibility with existing diagrams

## Consequences

**Positive**:
- Shorter, more intuitive terminology
- Cleaner API surface
- Less vendor-specific language

**Negative**:
- Required a comprehensive rename across ~200 files
- DrawIO XML user objects retain old naming for backward compatibility
