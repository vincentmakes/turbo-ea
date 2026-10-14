# Audit Log

The **Audit log** at **Admin → Settings → Audit log** (`/admin/settings?tab=audit-log`) answers the two questions a security review asks of an instance that holds a map of the whole IT landscape: *what changed in it*, and *who signed in and how*. It is split into two sub-tabs:

| Sub-tab | URL | What it records |
|---------|-----|-----------------|
| **Changes** | `/admin/settings?tab=audit-log` | Every write to the landscape — cards, relations, risks, tags, stakeholder roles, draft decisions — grouped into mutation batches, with a per-event diff and a **Rollback** |
| **Security & admin** | `/admin/settings?tab=audit-log&view=security` | Sign-ins and sign-outs, failed attempts, lockouts, SSO and proxy sessions, password events, role impersonation and every administrative action |

The two are kept apart on purpose. **Changes** is a working tool — it exists so you can see and undo a bad write — and it keeps a short history. **Security & admin** is an evidence trail: its entries cannot be edited or deleted, and it is kept for a year by default.

## Who can see it

Both sub-tabs require the **`admin.events`** permission ("View audit trail and event stream"), which only the **Admin** role holds by default. To give a security or compliance officer read access without making them an administrator, create a role that carries `admin.events` under [Users & Roles](users.md#roles) and assign it to them.

## Changes

The **Changes** sub-tab is the mutation-batch ledger. Every mutating write lands here as a batch, together with who made it and where it came from:

| Origin | Meaning |
|--------|---------|
| **Web** | The Turbo EA web interface |
| **API** | A direct call to the REST API (a script, an integration) |
| **AI tool** | An AI assistant connected through the [MCP server](mcp.md) |
| **Extension** | An installed [extension](extensions.md), recorded as an `ext:<key>` batch |

Click a batch to open its drawer: the per-event diff shows each field's old and new value, and **Rollback** reverts the card, relation, risk, stakeholder-role, tag and draft-decision writes it made.

Batches are kept for **`MUTATION_BATCH_RETENTION_DAYS`** days (an environment variable, default **15**) and then purged automatically. The events themselves stay on each card's **History** tab after the batch is gone.

## Security & admin

![Security & admin log](../assets/img/en/62_admin_audit_log_security.png)

The **Security & admin** sub-tab lists one entry per security-relevant action, newest first:

- sign-ins and sign-outs, with password, SSO or a trusted reverse proxy;
- failed sign-in attempts, each with a **reason code** saying why it failed;
- account lockouts after repeated failures;
- registrations, and passwords being set, reset or changed;
- role impersonation — an administrator starting and stopping **View as role…**;
- administrative actions — changes to users, roles, settings, the metamodel, tags, calculations, extensions, imports, integrations, public portals and published diagrams, surveys and operator access (see [Administrative actions](#administrative-actions));
- exports of this log itself.

!!! note "Coming in the next release"
    **Data exports** (inventory CSV/JSON exports, workspace and migration exports) will be recorded in this same log in the next release.

### Columns

| Column | Description |
|--------|-------------|
| **When** | Date and time the action happened |
| **Category** | `auth` (authentication), `admin` (administrative actions) or `access` (exports and other data access) |
| **Action** | What happened, for example `auth.login.failed` — see the [action catalogue](#action-catalogue) |
| **Outcome** | **Success** or **Failure** |
| **Actor** | The signed-in user who performed the action. Empty when nobody was signed in — a failed sign-in, for instance |
| **Subject** | The account the action was about — the email address typed into a failed sign-in, or the user whose password was reset |
| **Target** | The object acted on, when there is one — for example the role chosen when starting an impersonation |
| **IP** | The client's IP address (see [Client IP address](#client-ip-address)) |
| **Origin** | Where the request came from: web, API, AI tool, extension, ops or system |
| **Impersonated role** | When an administrator was viewing the app as another role, that role. The real administrator stays the actor |

Columns can be shown, hidden, reordered and frozen like on every other data table; **When** and **Action** are always shown.

### Filters

The filter sidebar on the left narrows the list by **category**, **outcome**, **action**, **actor**, **IP address** and a **date range**. Every section header shows how many values are selected, and the collapsed sidebar shows the number of active filters. The **Columns** tab of the same sidebar shows, hides and freezes columns. Your filters and column layout are remembered in this browser.

A search for an email address matches the actor, the subject and the target, so typing one address finds both what that person did and what was attempted against their account.

### Entry details

Click a row to open the entry drawer. It shows every field of the entry, including the browser's user agent and the **details** recorded with it — the reason code of a failed sign-in, the time a lockout ends, the identity provider of an SSO sign-in. Where an entry records a change, the details are shown as a table of old and new values. Secrets are never stored: a password, token or client secret is replaced with `***` before the entry is written.

The drawer has no actions. Entries cannot be edited or deleted.

### Export CSV

**Export CSV** in the toolbar downloads the entries matching the current filters as a CSV file, up to 50,000 rows. The export is itself recorded, as `access.audit_log.exported`, so an export of the security log always leaves a trace in it.

## Action catalogue

| Action | Recorded when |
|--------|---------------|
| `auth.login.succeeded` | A user signs in with email and password |
| `auth.login.failed` | A password sign-in is refused. The **reason code** says why (see below) |
| `auth.login.locked` | The fifth failed attempt in a row locks the account for 15 minutes. The details carry the time the lock ends |
| `auth.logout` | A signed-in user signs out. A sign-out without a valid session records nothing |
| `auth.sso.succeeded` | A user signs in through an SSO provider. The details carry the provider, the identity provider's subject and whether the account was created by this sign-in |
| `auth.sso.failed` | An SSO sign-in is refused — a domain that is not allowed, a missing email address, a local account with the same email, an inactive account. The details carry the provider and the reason |
| `auth.proxy_session.succeeded` | A user signs in through a trusted [reverse proxy](sso.md#reverse-proxy-authentication) |
| `auth.proxy_session.failed` | A reverse-proxy sign-in is refused |
| `auth.register` | A user creates an account through self-registration |
| `auth.password.set` | An invited user sets their first password |
| `auth.password.reset_requested` | Someone asks for a password-reset email. Always recorded as a success with the typed address, so the response reveals nothing; the details say whether an account matched and whether an email was sent |
| `auth.password.reset` | A password is changed through a reset link |
| `auth.password.changed` | A signed-in user changes their own password |
| `auth.impersonation.started` | An administrator starts **View as role…**. The target is the role chosen |
| `auth.impersonation.stopped` | The administrator returns to their own role |
| `access.audit_log.exported` | Someone exports the security log to CSV |

**Reason codes** on `auth.login.failed`:

| Reason | Meaning |
|--------|---------|
| `unknown_user` | No account has that email address |
| `sso_account` | The account signs in through SSO and has no password |
| `no_password` | The account has no password set yet — an invitation that was never accepted |
| `locked` | The account is locked after repeated failures |
| `bad_password` | The password is wrong |
| `inactive` | The account is deactivated |

**Reason codes** on `auth.sso.failed`, `auth.proxy_session.failed`, `auth.password.set` and `auth.password.reset`:

| Reason | Meaning |
|--------|---------|
| `expired` | The account's time-limited access has ended |
| `hd_mismatch` | The Google account belongs to a domain that is not allowed |
| `no_email` | The identity provider returned no email address |
| `no_subject` | The identity provider returned no subject identifier |
| `local_account` | A local password account already uses that email |
| `no_account` | No account exists and accounts are not created automatically |
| `exchange_failed` | The identity provider did not complete the sign-in |
| `unauthenticated` | The reverse proxy did not authenticate the request |
| `identity_rejected` | The forwarded identity was rejected (domain or unverified email) |
| `invalid_token` | The invitation or reset link was invalid or has expired |

A burst of `unknown_user` failures from one IP address is what password spraying looks like; a run of `bad_password` against one account followed by `auth.login.locked` is a guessing attempt against that account.

### Administrative actions

Every change an administrator makes to how the instance is configured is recorded in the `admin` category. The **actor** is the administrator, the **target** is the object changed — a user, a role, a setting, a card type — with its name as it was at that moment, and the **details** list what changed as old and new values, limited to the fields that actually changed. Two rules hold for every entry:

- **Secrets are masked.** An SMTP password, an SSO client secret, an AI provider key, a ServiceNow credential or any other secret value is written as `***`: the entry shows that it changed, never what it was or what it became.
- **No license text or credential is ever stored.** An extension license is identified, not copied, and a password an administrator sets for a user is recorded as changed, never with its value.

| Area | Actions | What is recorded |
|------|---------|------------------|
| **Users & roles** | `admin.user.created`, `.updated`, `.deleted`, `.bulk_updated`, `.bulk_deleted`, `.unlocked`; `admin.user.invitation.resent`, `.deleted`; `admin.role.created`, `.updated`, `.archived`, `.restored`; `admin.stakeholder_role.created`, `.updated`, `.deleted`, `.archived`, `.restored` | Accounts created, edited, activated or deactivated, deleted (one by one or in bulk) and unlocked, with the changed fields — role, email, name, active state; invitations re-sent or revoked; application roles and per-type stakeholder roles, with the permissions granted or removed |
| **Settings** | `admin.settings.updated` | One entry per setting saved — email, authentication and SSO, registration, AI, MCP, languages, module toggles, branding, logo and favicon, retention periods. The target is the setting; the details are its old and new value, with secrets masked |
| **Metamodel** | `admin.metamodel.type.*` (including `.references_generated`), `admin.metamodel.relation_type.*`, `admin.metamodel.resource_type.*`, `admin.principle.*` (including `.imported`), `admin.regulation.*` | Card types, relation types and resource types created, changed, deleted or restored, with the changed properties; card references generated for a type; EA principles, including those imported from the catalogue; compliance regulations |
| **Tags & calculations** | `admin.tag_group.*`, `admin.tag.*`, `admin.calculation.*` | Tag groups and tags; calculated fields created, changed, deleted, activated or deactivated, with the old and new formula, and a calculation run over all cards (`.recalculated`) |
| **Extensions** | `admin.extension.install.uploaded`, `.applied`, `.discarded`; `admin.extension.store.claimed`, `.refreshed`, `.installed`; `admin.extension.enabled`, `.disabled`, `.uninstalled`; `admin.extension.license.updated`, `.removed` | Bundles uploaded, installed or discarded; licenses and downloads from the Extension Store; extensions enabled, disabled and uninstalled; the license replaced or removed — with the extension and its version, never the license text |
| **Workspace transfer & migration** | `admin.workspace.import.uploaded`, `.applied`, `.completed`, `.discarded`; `admin.migration.uploaded`, `.field_mappings.updated`, `.applied`, `.deleted` | A [workspace bundle](workspace-transfer.md) uploaded, its import started, finished or discarded; a [platform migration](migration.md) uploaded, its field mappings edited, applied or deleted |
| **Integrations** | `admin.servicenow.connection.*`, `admin.servicenow.mapping.*`, `admin.servicenow.sync.pulled`, `.pushed`, `.applied` | ServiceNow connections, with credentials masked, and mappings; every pull, push and apply of staged records |
| **Public exposure** | `admin.web_portal.created`, `.updated`, `.deleted`; `admin.diagram.published`, `.unpublished` | [Web portals](web-portals.md) and published diagrams — everything that makes data reachable without an account |
| **Surveys** | `admin.survey.sent`, `admin.survey.closed` | A survey sent to its recipients, or closed |
| **Operator access** | `admin.ops.rescue_access.granted`, `.revoked` | Rescue access granted or revoked through the [operations API](ops-api.md), recorded alongside the existing `ops.*` events |

## What is not recorded

- **Token refresh.** The web app renews its session on a timer, so every open tab would add an entry and none of them would mean anything.
- **Requests rejected for an expired or invalid session token.** These happen every time a session ends naturally.
- **OData feed reads.** Excel and Power BI poll a saved view's OData feed on a schedule, so every refresh would add an entry.
- **Plain read access** — opening a card, running a report, searching the inventory.

## Retention

Entries are kept for **365 days** by default. Change it under **Admin → Settings → General → Data management → Security log retention**: any number of days up to 3650, or **0** to keep entries forever. A job deletes the entries older than the window once a night, and re-reads the setting each time, so a change takes effect without a restart.

The retention job is the only thing that ever deletes an entry. There is no edit or delete action in the interface or the API, for any role.

The log is deliberately **not** part of [Workspace Transfer](workspace-transfer.md): it is the security history of this instance, not workspace content, and cloning an instance does not copy it.

## The JSON audit stream

Every entry is also written by the backend as **one JSON line** on the logger **`turbo_ea.audit`**, at the same moment it is stored. The backend logs to standard output, so the stream reaches whatever already collects your container logs — `docker compose logs backend`, Kubernetes log collection, or any SIEM shipper — with no configuration in Turbo EA:

```bash
docker compose logs -f backend | grep turbo_ea.audit
```

The line is written when the entry is recorded. If the request's transaction fails afterwards, the line exists without a row, so the table is the record and the stream is the live feed.

Each line carries the same fields as the entry:

| Field | Content |
|-------|---------|
| `audit_id`, `created_at` | The entry's id and the moment it was written |
| `category`, `action`, `outcome` | What happened and whether it succeeded |
| `actor_user_id`, `actor_email` | Who did it |
| `subject_email` | The account it was about |
| `target_type`, `target_id`, `target_label` | What it acted on |
| `ip`, `user_agent` | The client |
| `origin` | web, api, mcp, ext, ops or system |
| `impersonator_user_id`, `impersonated_role` | Set while an administrator is viewing the app as another role |
| `details` | Reason codes and old/new values, with secrets already masked |

Shipping the stream to a central log store keeps a copy outside the instance, out of reach of anyone who can administer it — which is what an insider-threat review needs. See [Logging and the audit stream](operations.md#logging-and-the-audit-stream) for how to collect it.

## Client IP address

The **IP** column records the address of the client, not of the proxy in front of the backend. The bundled edge nginx sets the `X-Real-IP` header to the address it received the connection from, and the backend reads that header because the published backend image sets **`TRUST_PROXY_HEADERS=true`**. A value that is not a valid IP address is dropped rather than recorded.

- **Leave `TRUST_PROXY_HEADERS` on** as long as every request reaches the backend through the bundled nginx — the default stack, the [Helm chart](kubernetes.md) and the [managed container templates](managed-containers.md) all work that way.
- **Turn it off** (`TRUST_PROXY_HEADERS=false`) if you expose the backend container directly, without the bundled nginx in front of it: a client could then send its own `X-Real-IP` and choose the address that gets recorded.
- **Behind another load balancer**, the bundled nginx sees that load balancer's address, so every entry records it. A setting that lets nginx trust the client address forwarded by your load balancer (`NGINX_TRUSTED_PROXIES`) is planned for a later release.
