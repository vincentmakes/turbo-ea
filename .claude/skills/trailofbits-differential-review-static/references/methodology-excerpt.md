# Reading a changed protection

Selected passages from Trail of Bits, Differential Review Methodology (CC BY-SA 4.0).

## Compare the versions

For each changed file:

1. **Read both versions** (baseline and changed)

2. **Analyze each diff region:**
   ```
   BEFORE: [exact code]
   AFTER: [exact code]
   CHANGE: [behavioral impact]
   SECURITY: [implications]
   ```


## Trace state and caller context

1. **Map complete function flow:**
   - Entry conditions (preconditions, requires, modifiers)
   - State reads (which variables accessed)
   - State writes (which variables modified)
   - External calls (to contracts, APIs, system)
   - Return values and side effects
