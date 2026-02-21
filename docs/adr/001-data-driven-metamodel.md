# ADR-001: Data-driven metamodel

**Status**: Accepted
**Date**: 2024-01-01

## Context

Enterprise architecture tools typically hardcode their entity types (Applications,
Business Capabilities, etc.) in code. This makes them rigid — adding a new type or
field requires code changes, migration, and deployment.

Turbo EA needed to support diverse EA frameworks (TOGAF, ArchiMate, custom) where
each organization defines its own types, fields, and relationships.

## Decision

All card types, fields, subtypes, relations, stakeholder roles, and calculated
fields are stored as data (JSONB) in the database, not hardcoded in code.

- `card_types.fields_schema` — JSONB array of field definitions per section
- `card_types.section_config` — JSONB controlling layout and ordering
- `card_types.subtypes` — JSONB array of subtype definitions
- `relation_types` — separate table defining allowed relations between types
- `calculations` — admin-defined formulas evaluated at card save time

The seed service (`seed.py`) populates 14 default types on first startup, but
these are created as data rows, not schema.

## Consequences

**Positive**:
- Admins can add/modify types, fields, and relations without code changes
- Single codebase supports diverse EA frameworks
- UI is fully data-driven (AttributeSection renders from fields_schema)

**Negative**:
- Queries are more complex (JSONB access patterns)
- Field validation happens at the application layer, not the database layer
- No foreign key constraints between card attributes and field definitions
