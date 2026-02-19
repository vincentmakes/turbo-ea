# ServiceNow Integration — Administrator Guide

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Setting Up a Connection](#setting-up-a-connection)
4. [Configuring Type Mappings](#configuring-type-mappings)
5. [Field Mapping Reference](#field-mapping-reference)
6. [Running Syncs](#running-syncs)
7. [Sync Modes and Deletion Safety](#sync-modes-and-deletion-safety)
8. [Recommended Mapping Recipes](#recommended-mapping-recipes)
9. [Security Best Practices](#security-best-practices)
10. [Operational Runbook](#operational-runbook)
11. [Troubleshooting](#troubleshooting)
12. [API Reference (Quick)](#api-reference-quick)

---

## Overview

The ServiceNow integration connects Turbo EA's enterprise architecture
repository with your ServiceNow CMDB (Configuration Management Database).
This enables:

- **Pull sync** — Import CIs from ServiceNow into Turbo EA as cards
- **Push sync** — Export Turbo EA cards back to ServiceNow tables
- **Bidirectional sync** — Keep both systems in sync with per-field ownership
- **Identity mapping** — Persistent cross-reference tracking between records
- **Staged changes** — Review what will change before applying (optional)

### Architecture

```
┌──────────────────┐        HTTPS / Table API         ┌──────────────────┐
│   Turbo EA       │ ◄───────────────────────────────► │  ServiceNow      │
│                  │                                    │                  │
│  Cards           │  Pull: SNOW CIs → Turbo Cards     │  CMDB CIs        │
│  (Application,   │  Push: Turbo Cards → SNOW CIs     │  (cmdb_ci_appl,  │
│   ITComponent,   │                                    │   cmdb_ci_server, │
│   Provider, ...) │  Identity Map tracks sys_id↔UUID   │   core_company)  │
└──────────────────┘                                    └──────────────────┘
```

---

## Prerequisites

### ServiceNow Side

1. **A service account** with the following minimum roles:

   | Role | Purpose |
   |------|---------|
   | `itil` | Read access to CMDB tables |
   | `cmdb_read` | Read Configuration Items |
   | `rest_api_explorer` | (Optional) Helpful for testing queries |
   | `import_admin` | (Push sync only) Write access to target tables |

2. **Network connectivity** — The Turbo EA backend must reach your
   ServiceNow instance over HTTPS (port 443). Ensure firewall rules
   and any IP allowlists are configured.

3. **Instance URL** — The full URL of your instance:
   - `https://company.service-now.com`
   - `https://company.servicenowservices.com`

### Turbo EA Side

1. **Admin access** with the `servicenow.manage` permission. The default
   admin role has this. For other roles, grant it via Admin > Users & Roles.

2. **Metamodel configured** — The card types you want to sync should
   already exist in Turbo EA with appropriate `fields_schema`. The
   integration maps ServiceNow columns to these fields.

---

## Setting Up a Connection

Navigate to **Admin > ServiceNow** and open the **Connections** tab.

### Step 1: Create the Connection

Click **Add Connection** and fill in:

| Field | Example Value | Notes |
|-------|---------------|-------|
| Name | `Production CMDB` | Descriptive label |
| Instance URL | `https://company.service-now.com` | Must use HTTPS |
| Auth Type | `Basic Auth` | Or OAuth 2.0 (see below) |
| Username | `svc_turboea` | ServiceNow service account |
| Password | `••••••••` | Encrypted at rest via Fernet |

### Step 2: Test the Connection

After saving, click the **wifi icon** next to the connection. The system
sends a lightweight request to `sys_db_object` (limit 1).

- **Green "Connected" chip** — Credentials work, instance is reachable
- **Red "Failed" chip** — Check credentials, network, and URL

### OAuth 2.0 Authentication (Recommended)

For production deployments, OAuth 2.0 provides token-based auth with
scoped access and audit-friendly logging:

1. In ServiceNow, go to **System OAuth > Application Registry**
2. Create a new OAuth API endpoint for external clients
3. Note the Client ID and Client Secret
4. In Turbo EA, set Auth Type to **OAuth 2.0** and enter the credentials

> **Industry best practice**: Use OAuth 2.0 with a dedicated application
> registration rather than Basic Auth. Basic Auth sends credentials on
> every request, while OAuth uses short-lived tokens. Rotate client
> secrets on a 90-day cycle.

---

## Configuring Type Mappings

Switch to the **Mappings** tab. A mapping defines which Turbo EA card
type corresponds to which ServiceNow table.

### Create a Mapping

Click **Add Mapping** and configure:

| Field | Example | Description |
|-------|---------|-------------|
| Connection | Production CMDB | Which ServiceNow instance |
| Card Type | Application | Turbo EA card type to sync |
| SNOW Table | `cmdb_ci_business_app` | The ServiceNow CMDB table |
| Sync Direction | ServiceNow > Turbo EA | Pull, Push, or Bidirectional |
| Sync Mode | Conservative | How to handle deletions |
| Max Deletion Ratio | 50% | Safety threshold for bulk deletes |
| Filter Query | `active=true^install_status=1` | Optional SNOW encoded query |

### Common ServiceNow Table Mappings

| Turbo EA Type | ServiceNow Table | Description |
|---------------|------------------|-------------|
| Application | `cmdb_ci_business_app` | Business applications |
| Application | `cmdb_ci_appl` | General application CIs |
| ITComponent (Software) | `cmdb_ci_spkg` | Software packages |
| ITComponent (Hardware) | `cmdb_ci_server` | Physical/virtual servers |
| ITComponent (SaaS) | `cmdb_ci_cloud_service_account` | Cloud service accounts |
| Provider | `core_company` | Vendors / companies |
| Interface | `cmdb_ci_endpoint` | Integration endpoints |
| DataObject | `cmdb_ci_database` | Database instances |
| System | `cmdb_ci_computer` | Computer CIs |
| Organization | `cmn_department` | Departments |

### Filter Query Syntax

The filter query uses ServiceNow's encoded query syntax:

```
# Only active CIs
active=true

# Active CIs with install status "Installed"
active=true^install_status=1

# Applications in production
active=true^used_for=Production

# CIs updated in the last 30 days
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# Specific assignment group
active=true^assignment_group.name=IT Operations

# Exclude retired CIs
active=true^install_statusNOT IN7,8
```

> **Best practice**: Always include `active=true` at minimum. CMDB tables
> often contain thousands of retired records that should not be imported.

---

## Field Mapping Reference

Each mapping contains **field mappings** that define how individual
columns translate between ServiceNow and Turbo EA.

### Adding Field Mappings

For each field, configure:

| Setting | Options | Description |
|---------|---------|-------------|
| Turbo EA Field | Any field path | Dot-notated path (see below) |
| SNOW Field | Column name | ServiceNow column API name |
| Direction | SNOW leads / Turbo leads | Which system owns this field |
| Transform | Direct / Value Map / Date / Boolean | How to transform |
| Identity | Checkbox | Used for matching during initial sync |

### Turbo EA Field Paths

Fields use dot notation to target different parts of a card:

| Path | Target | Example Value |
|------|--------|---------------|
| `name` | Card display name | `"SAP S/4HANA"` |
| `description` | Card description | `"Core ERP system"` |
| `lifecycle.plan` | Lifecycle: Plan date | `"2024-01-15"` |
| `lifecycle.phaseIn` | Lifecycle: Phase In | `"2024-03-01"` |
| `lifecycle.active` | Lifecycle: Active | `"2024-06-01"` |
| `lifecycle.phaseOut` | Lifecycle: Phase Out | `"2028-12-31"` |
| `lifecycle.endOfLife` | Lifecycle: End of Life | `"2029-06-30"` |
| `attributes.<key>` | Custom attribute | As defined in `fields_schema` |

For example, if the Application type has a field with key
`businessCriticality`, map it as `attributes.businessCriticality`.

### Transform Types

**Direct** (default) — Pass the value through unchanged. Use for text
fields that have the same format in both systems.

**Value Map** — Translates enumerated values. Requires a config:

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

The mapping reverses automatically when pushing from Turbo EA to SNOW.

**Date Format** — Truncates ServiceNow datetime values
(`2024-06-15 14:30:00`) to date-only (`2024-06-15`). Use for lifecycle
phase dates.

**Boolean** — Converts between ServiceNow string booleans (`"true"`,
`"1"`, `"yes"`) and native booleans.

### Identity Fields

Mark one or more fields as **Identity** (key icon). These are used
during the first sync to match ServiceNow records to existing cards:

1. **Exact match** on the field value (e.g., matching by name)
2. **Fuzzy match** using SequenceMatcher with 85% similarity threshold

> **Best practice**: Always mark the `name` field as an identity field.
> If names differ between systems (e.g., SNOW includes version numbers),
> clean them up before the first sync for better match quality.

### Per-Field Direction

Each field has its own direction, independent of the overall mapping:

| Direction | Meaning |
|-----------|---------|
| **SNOW leads** | ServiceNow is source of truth. Imported during pull, skipped during push. |
| **Turbo leads** | Turbo EA is source of truth. Exported during push, skipped during pull. |

This enables **bidirectional sync** where different fields are owned by
different systems:

```
name                  → SNOW leads   (CMDB is authoritative for names)
description           → Turbo leads  (EA team maintains descriptions)
businessCriticality   → Turbo leads  (EA assessment, not in SNOW)
lifecycle.active      → SNOW leads   (CMDB tracks go-live dates)
costTotalAnnual       → SNOW leads   (Financial data from SNOW)
```

---

## Running Syncs

Switch to the **Sync Dashboard** tab.

### Triggering a Sync

For each active mapping, you see Pull and/or Push buttons depending on
the configured sync direction:

- **Pull** (cloud download icon) — Fetches data from SNOW into Turbo EA
- **Push** (cloud upload icon) — Sends Turbo EA data to ServiceNow

### What Happens During a Pull Sync

```
1. FETCH     Retrieve all matching records from SNOW (batches of 500)
2. MATCH     Match each record to an existing card:
             a) Identity map (persistent sys_id ↔ card UUID lookup)
             b) Exact name match on identity fields
             c) Fuzzy name match (85% similarity threshold)
3. TRANSFORM Apply field mappings to convert SNOW → Turbo EA format
4. DIFF      Compare transformed data against existing card fields
5. STAGE     Assign an action to each record:
             • create — New, no matching card found
             • update — Match found, fields differ
             • skip   — Match found, no differences
             • delete — In identity map but absent from SNOW
6. APPLY     Execute staged actions (create/update/archive cards)
```

### Reviewing Sync Results

The **Sync History** table shows after each run:

| Column | Description |
|--------|-------------|
| Started | When the sync began |
| Direction | Pull or Push |
| Status | `completed`, `failed`, or `running` |
| Fetched | Total records retrieved from ServiceNow |
| Created | New cards created in Turbo EA |
| Updated | Existing cards updated |
| Deleted | Cards archived (soft-deleted) |
| Errors | Records that failed to process |
| Duration | Wall-clock time |

Click the **list icon** on any run to inspect individual staged records,
including the field-level diff for each update.

### Manual Review Mode

To review changes before applying, trigger via the API with
`auto_apply=false`:

```bash
# 1. Trigger pull sync without auto-apply
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/servicenow/sync/pull/$MAPPING_ID?auto_apply=false"

# 2. Review staged records
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/servicenow/sync/runs/$RUN_ID/staged"

# 3. Apply when satisfied
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/servicenow/sync/runs/$RUN_ID/apply"
```

---

## Sync Modes and Deletion Safety

### Sync Modes

| Mode | Creates | Updates | Deletes | Best For |
|------|---------|---------|---------|----------|
| **Additive** | Yes | Yes | **Never** | Initial imports, low-risk |
| **Conservative** | Yes | Yes | Only cards **created by sync** | Default, ongoing syncs |
| **Strict** | Yes | Yes | All linked cards | Full mirror of SNOW |

**Additive** never removes cards from Turbo EA, making it the safest
option for first-time imports and environments where Turbo EA may
contain cards not present in ServiceNow.

**Conservative** (default) tracks whether each card was originally
created by the sync engine. Only those cards can be auto-archived if
they disappear from ServiceNow. Cards created manually in Turbo EA
are never touched.

**Strict** archives any linked card whose corresponding ServiceNow CI
no longer appears in the query results, regardless of who created it.

### Max Deletion Ratio

As a safety net, the engine **skips all deletions** if the count
exceeds the configured ratio:

```
deletions / total_linked > max_deletion_ratio  →  SKIP ALL DELETIONS
```

| Scenario (10 linked records) | Deletions | Ratio | 50% Threshold | Result |
|------------------------------|-----------|-------|---------------|--------|
| 3 CIs removed from SNOW | 3 | 30% | Under | Deletions proceed |
| 6 CIs removed from SNOW | 6 | 60% | **Over** | All deletions skipped |
| SNOW returns empty (outage) | 10 | 100% | **Over** | All deletions skipped |

This prevents catastrophic data loss from:
- Filter query changes that accidentally exclude records
- Temporary ServiceNow outages returning empty results
- Misconfigured table names

> **Industry best practice**: Start with **additive** mode for your first
> sync. After verifying import quality, switch to **conservative**. Only
> use **strict** when ServiceNow is the definitive source and you want
> Turbo EA to mirror it exactly. Keep the deletion ratio at 50% or lower
> for tables with fewer than 100 records.

---

## Recommended Mapping Recipes

### Recipe 1: Applications from CMDB

Import business applications from ServiceNow into Turbo EA.

**Mapping settings:**

| Setting | Value |
|---------|-------|
| Card Type | Application |
| SNOW Table | `cmdb_ci_business_app` |
| Direction | ServiceNow > Turbo EA |
| Mode | Conservative |
| Filter | `active=true^install_status=1` |

**Field mappings:**

| Turbo EA Field | SNOW Field | Dir | Transform | ID |
|---------------|------------|-----|-----------|-----|
| `name` | `name` | SNOW | Direct | Yes |
| `description` | `short_description` | SNOW | Direct | |
| `lifecycle.active` | `go_live_date` | SNOW | Date | |
| `lifecycle.endOfLife` | `retirement_date` | SNOW | Date | |
| `attributes.businessCriticality` | `busines_criticality` | SNOW | Value Map | |
| `attributes.hostingType` | `hosting_type` | SNOW | Direct | |

Value map config for `businessCriticality`:

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

---

### Recipe 2: IT Components (Servers)

Import server CIs to track infrastructure in the EA landscape.

**Mapping settings:**

| Setting | Value |
|---------|-------|
| Card Type | ITComponent |
| SNOW Table | `cmdb_ci_server` |
| Direction | ServiceNow > Turbo EA |
| Mode | Conservative |
| Filter | `active=true^hardware_statusNOT IN6,7` |

**Field mappings:**

| Turbo EA Field | SNOW Field | Dir | Transform | ID |
|---------------|------------|-----|-----------|-----|
| `name` | `name` | SNOW | Direct | Yes |
| `description` | `short_description` | SNOW | Direct | |
| `attributes.manufacturer` | `manufacturer.name` | SNOW | Direct | |
| `attributes.operatingSystem` | `os` | SNOW | Direct | |
| `attributes.ipAddress` | `ip_address` | SNOW | Direct | |

---

### Recipe 3: Vendors / Providers (Bidirectional)

Keep the provider landscape in sync with ServiceNow's vendor registry.

**Mapping settings:**

| Setting | Value |
|---------|-------|
| Card Type | Provider |
| SNOW Table | `core_company` |
| Direction | Bidirectional |
| Mode | Additive |
| Filter | `vendor=true` |

**Field mappings:**

| Turbo EA Field | SNOW Field | Dir | Transform | ID |
|---------------|------------|-----|-----------|-----|
| `name` | `name` | SNOW | Direct | Yes |
| `description` | `notes` | Turbo | Direct | |
| `attributes.website` | `website` | SNOW | Direct | |
| `attributes.contactEmail` | `email` | SNOW | Direct | |

---

### Recipe 4: Push EA Assessments to ServiceNow

Push EA-specific assessments back to ServiceNow custom fields.

**Mapping settings:**

| Setting | Value |
|---------|-------|
| Card Type | Application |
| SNOW Table | `cmdb_ci_business_app` |
| Direction | Turbo EA > ServiceNow |
| Mode | Additive |

**Field mappings:**

| Turbo EA Field | SNOW Field | Dir | Transform | ID |
|---------------|------------|-----|-----------|-----|
| `name` | `name` | SNOW | Direct | Yes |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo | Value Map | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo | Value Map | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo | Value Map | |

> **Note**: Push sync to custom fields (prefixed with `u_`) requires
> those columns to exist in ServiceNow. Work with your ServiceNow admin
> to create them before configuring the push mapping.

---

### Recipe 5: Software Products with EOL Data

Import software products and combine with Turbo EA's EOL tracking.

**Mapping settings:**

| Setting | Value |
|---------|-------|
| Card Type | ITComponent |
| SNOW Table | `cmdb_ci_spkg` |
| Direction | ServiceNow > Turbo EA |
| Mode | Conservative |
| Filter | `active=true` |

**Field mappings:**

| Turbo EA Field | SNOW Field | Dir | Transform | ID |
|---------------|------------|-----|-----------|-----|
| `name` | `name` | SNOW | Direct | Yes |
| `description` | `short_description` | SNOW | Direct | |
| `attributes.version` | `version` | SNOW | Direct | |
| `attributes.vendor` | `manufacturer.name` | SNOW | Direct | |

After the initial import, use Admin > EOL Search to mass-link the
imported IT Components to endoflife.date products for automated
lifecycle risk tracking.

---

## Security Best Practices

### Credential Management

| Practice | Details |
|----------|---------|
| **Encryption at rest** | All credentials encrypted via Fernet (AES-128-CBC) derived from `SECRET_KEY`. If you rotate `SECRET_KEY`, re-enter all ServiceNow credentials. |
| **Least privilege** | Create a dedicated SNOW service account with read-only access to specific tables. Only grant write if using push sync. |
| **OAuth 2.0 preferred** | Basic Auth sends credentials on every request. OAuth uses short-lived tokens with scope restrictions. |
| **Credential rotation** | Rotate passwords or client secrets every 90 days. |

### Network Security

| Practice | Details |
|----------|---------|
| **HTTPS enforced** | HTTP URLs are rejected. All connections must use HTTPS. |
| **Table name validation** | Table names validated against `^[a-zA-Z0-9_]+$` to prevent injection. |
| **sys_id validation** | sys_id values validated as 32-character hex strings. |
| **IP allowlisting** | Configure ServiceNow IP Access Control to only allow your Turbo EA server's IP. |

### Access Control

| Practice | Details |
|----------|---------|
| **RBAC gated** | All endpoints require `servicenow.manage` permission. |
| **Audit trail** | All sync-created changes publish events with `source: "servicenow_sync"`, visible in card history. |
| **No credential exposure** | Passwords and secrets are never returned in API responses. |

### Production Checklist

- [ ] Dedicated ServiceNow service account (not a personal account)
- [ ] OAuth 2.0 with client credentials grant
- [ ] Credential rotation schedule (every 90 days)
- [ ] Service account restricted to only mapped tables
- [ ] ServiceNow IP allowlist configured for Turbo EA server IP
- [ ] Max deletion ratio set to 50% or lower
- [ ] Sync runs monitored for unusual error or deletion counts

---

## Operational Runbook

### Initial Setup Sequence

```
1. Create ServiceNow service account with minimum required roles
2. Verify network connectivity (can Turbo EA reach SNOW over HTTPS?)
3. Create connection in Turbo EA and test it
4. Verify metamodel types have all fields you want to sync
5. Create first mapping with ADDITIVE mode
6. Use preview endpoint to verify mapping produces correct output
7. Run first pull sync with auto_apply=false
8. Review staged records in the Sync Dashboard
9. Apply staged records
10. Verify imported cards in the Inventory
11. Switch mapping to CONSERVATIVE mode for ongoing use
```

### Ongoing Operations

| Task | Frequency | How |
|------|-----------|-----|
| Run pull sync | Daily or weekly | Sync Dashboard > Pull button |
| Review sync stats | After each run | Check error/deletion counts |
| Test connections | Monthly | Click test button on each connection |
| Rotate credentials | Quarterly | Update in both SNOW and Turbo EA |
| Review identity map | Quarterly | Check orphaned entries via sync stats |
| Audit card history | As needed | Filter events by `servicenow_sync` |

### Setting Up Scheduled Syncs

Syncs are currently triggered manually from the UI or via API. To
automate, use a cron job or external scheduler:

```bash
# Daily pull sync at 2:00 AM
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.company.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

> **Best practice**: Run syncs during off-peak hours. For large CMDB
> tables (10,000+ CIs), expect 2-5 minutes depending on network
> latency and record count.

### Capacity Planning

| CMDB Size | Expected Pull Duration | Recommendation |
|-----------|----------------------|----------------|
| < 500 CIs | < 30 seconds | Sync daily |
| 500-5,000 CIs | 30s - 2 minutes | Sync daily |
| 5,000-20,000 CIs | 2-5 minutes | Sync nightly |
| 20,000+ CIs | 5-15 minutes | Sync weekly, use filter queries |

---

## Troubleshooting

### Connection Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection failed: [SSL]` | Self-signed or expired cert | Ensure SNOW uses a valid public CA certificate |
| `HTTP 401: Unauthorized` | Wrong credentials | Re-enter username/password; check account is not locked |
| `HTTP 403: Forbidden` | Insufficient roles | Grant `itil` and `cmdb_read` to the service account |
| `Connection failed: timed out` | Firewall block | Check rules; allowlist Turbo EA's IP in SNOW |
| Test OK but sync fails | Table-level permissions | Grant read access to the specific CMDB table |

### Sync Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| 0 records fetched | Wrong table or filter | Verify table name; simplify filter query |
| All records are "create" | Identity mismatch | Mark `name` as identity; verify names match |
| High error count | Transform failures | Check staged records for error messages |
| Deletions skipped | Ratio exceeded | Increase threshold or investigate why CIs disappeared |
| Changes not visible | Browser cache | Hard-refresh; check card history for events |
| Duplicate cards | Multiple mappings for same type | Use one mapping per card type per connection |

### Diagnostic Endpoints

```bash
# Preview how records will map (5 samples, no side effects)
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# Browse tables on the SNOW instance
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# Inspect columns for a table
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# Filter staged records by action or status
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## API Reference (Quick)

All endpoints require `Authorization: Bearer <token>` and
`servicenow.manage` permission. Base path: `/api/v1`.

### Connections

| Method | Path | Description |
|--------|------|-------------|
| GET | `/servicenow/connections` | List connections |
| POST | `/servicenow/connections` | Create connection |
| GET | `/servicenow/connections/{id}` | Get connection |
| PATCH | `/servicenow/connections/{id}` | Update connection |
| DELETE | `/servicenow/connections/{id}` | Delete connection + mappings |
| POST | `/servicenow/connections/{id}/test` | Test connectivity |
| GET | `/servicenow/connections/{id}/tables` | Browse SNOW tables |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | List columns |

### Mappings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/servicenow/mappings` | List mappings |
| POST | `/servicenow/mappings` | Create with field mappings |
| GET | `/servicenow/mappings/{id}` | Get with field mappings |
| PATCH | `/servicenow/mappings/{id}` | Update (replaces fields if provided) |
| DELETE | `/servicenow/mappings/{id}` | Delete mapping |
| POST | `/servicenow/mappings/{id}/preview` | Dry-run (5 sample records) |

### Sync Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/servicenow/sync/pull/{mapping_id}` | Pull sync (`?auto_apply=true`) |
| POST | `/servicenow/sync/push/{mapping_id}` | Push sync |
| GET | `/servicenow/sync/runs` | List history (`?limit=20`) |
| GET | `/servicenow/sync/runs/{id}` | Get run details |
| GET | `/servicenow/sync/runs/{id}/staged` | List staged records |
| POST | `/servicenow/sync/runs/{id}/apply` | Apply pending records |
