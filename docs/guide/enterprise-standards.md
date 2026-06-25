# Enterprise Standards

## Overview

Enterprise Standards define the mandatory, recommended, and deprecated requirements and practices that shape your IT landscape. They establish consistency, interoperability, and compliance across your organization's architecture.

Turbo EA's Enterprise Standards module allows you to:

- **Define standards** with categories (security, interoperability, data, business, etc.)
- **Set compliance levels** (mandatory, recommended, deprecated)
- **Link standards to cards** (Applications, IT Components, etc.) and track compliance
- **Audit compliance status** with evidence and notes per card-standard pairing
- **Reference external standards** (NORA, ISO, TOGAF, etc.)

## Managing Standards

### Viewing Available Standards

Standards are displayed in the **Governance** tab within the **GRC module** (`/grc?tab=governance`):

1. Navigate to the **GRC** page
2. Click the **Standards** sub-tab
3. Browse available standards with:
   - **Compliance level badge** (red for mandatory, blue for recommended, orange for deprecated)
   - **Category** (Security, Interoperability, Data, Business)
   - **Reference link** to external standards documentation
   - **Linked card count** showing how many cards are mapped to each standard

### Adding Standards (Admin Only)

To add new standards:

1. Go to **Admin** › **Metamodel**
2. Click the **Enterprise Standards** tab
3. Click **Add Standard** and fill in:
   - **Title** — Standard name (e.g., "ISO 27001 Information Security Management")
   - **Description** — What the standard covers
   - **Rationale** — Why this standard matters to your organization
   - **Category** — Select from: Security, Interoperability, Data, Business, Other
   - **Compliance Level** — Mandatory, Recommended, or Deprecated
   - **Reference URL** — Link to the external standard documentation
   - **Active** — Toggle to enable/disable without deleting
   - **Sort Order** — Control display order

4. Click **Save**

### Editing Standards

1. Go to **Admin** › **Metamodel** › **Enterprise Standards**
2. Click **Edit** on any standard
3. Modify fields and click **Save**

### Deleting Standards

1. Go to **Admin** › **Metamodel** › **Enterprise Standards**
2. Click **Delete** on any standard
3. Confirm deletion

**Note:** Deleting a standard removes it from the registry but does not delete card-standard compliance mappings that were created before deletion. These become orphaned and will be cleaned up on next manual card sync.

## Mapping Cards to Standards

Once standards are defined, you can link them to cards and track compliance status.

### Linking a Card to a Standard

1. Open a card detail page (Application, IT Component, etc.)
2. Go to the **Standards** section (if available for that card type)
3. Click **Link to Standard**
4. Search for and select a standard
5. Set the compliance status:
   - **Pending Review** — Awaiting evaluation
   - **Compliant** — Card meets the standard
   - **Non-Compliant** — Card does not meet the standard
   - **Compliant with Exceptions** — Card mostly meets the standard with documented exceptions
   - **N/A** — Not applicable to this card

6. Optionally add:
   - **Evidence** — Reference to audit reports, certificates, or documentation
   - **Notes** — Additional context or remediation plans

7. Click **Save**

### Tracking Compliance

For each linked standard, you can:

- **Update compliance status** as assessments progress
- **Add evidence** links to proof of compliance (audit reports, security certificates, etc.)
- **Record notes** on remediation efforts or exceptions
- **View history** of compliance status changes via the card's audit trail

## Built-In Standards (Demo Data)

Turbo EA seeds 10 built-in standards from NORA (Saudi Arabia's National Organizational Requirements for Architecture) and ISO:

| Standard | Category | Level | Reference |
|----------|----------|-------|-----------|
| NORA Security Framework | Security | Mandatory | https://www.dga.gov.sa |
| NORA Interoperability Standards | Interoperability | Mandatory | https://www.dga.gov.sa |
| ISO 27001 Information Security | Security | Recommended | https://www.iso.org/standard/27001 |
| ISO 20000-1 IT Service Management | Interoperability | Recommended | https://www.iso.org/standard/20000-1 |
| Data Governance Framework | Data | Mandatory | https://www.dga.gov.sa |
| TOGAF Architecture Standards | Business | Recommended | https://www.opengroup.org/togaf |

You can customize these or add your own organization-specific standards.

## Using Standards in Reports

The **Compliance dashboard** (under GRC) shows:

- Standards coverage by card type
- Cards with pending compliance reviews
- Compliance exception details
- Evidence audit trail

## Best Practices

1. **Start with mandatory standards** — Define which standards are non-negotiable
2. **Link progressively** — Don't try to map all cards at once; phase by card type
3. **Gather evidence early** — Collect compliance proof as you go, not retroactively
4. **Document exceptions clearly** — Use the "Compliant with Exceptions" status and notes field
5. **Review regularly** — Set a quarterly cadence to reassess compliance status
6. **Integrate with Risk Register** — Link standards to EA risks when compliance gaps pose business impact

## Related Topics

- [GRC Overview](/grc) — Governance, Risk & Compliance modules
- [Risk Register](/grc/risks) — Track standards-driven risks
- [Principles & Decisions](/grc?tab=governance) — Complement standards with architectural principles
