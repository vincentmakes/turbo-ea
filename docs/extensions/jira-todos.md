# Jira Todo Sync

Stop maintaining two task lists. **Jira Todo Sync** mirrors Turbo EA todos into a
Jira Cloud project of your choice and keeps both sides aligned: a todo created in
Turbo EA becomes a Jira issue within seconds, completing it transitions the
issue, and Jira issues matching a filter of your choice appear as todos.
Summaries, due dates and assignees sync both ways.

## At a glance

| | |
|---|---|
| **Licence** | Commercial — a signed entitlement is required |
| **Minimum Turbo EA version** | 2.68.0 |
| **Permission** | `ext.jira-todos.admin` |
| **Data access grants** | `core.todos.read`, `core.todos.write`, `core.events.todo`, `core.users.read` |
| **Backend restart needed** | Yes — it ships backend code |
| **Where it appears** | **Admin → Settings → Integrations → Jira Todo Sync** · issue-key chips on the Todos page and card Todos tabs |

Only **Jira Cloud** is supported. The connection is outbound only — Turbo EA
calls Jira's REST API with an account email and an API token. There is no OAuth
callback to expose, no Jira app to install and no inbound network access, so it
works on a self-hosted or firewalled instance.

## Setup

### 1. Create an Atlassian API token

1. Go to
   <https://id.atlassian.com/manage-profile/security/api-tokens> and log in with
   the Atlassian account the sync should act as. Use a **dedicated service
   account** if you have one — issues are created and transitioned as this
   account. (This direct link is the reliable route; the token page is no longer
   reachable through an obvious menu path.)
2. Click **Create API token** — the plain one, **not** *Create API token with
   scopes*. **Scoped tokens are not supported.**
3. Name it (for example `turbo-ea-sync`) and choose an expiry. Atlassian requires
   one and caps it at **one year**.
4. **Copy the token immediately** — it is shown only once.

!!! warning "Tokens expire"
    When the token expires the sync stops with authentication errors until a
    fresh one is pasted in. Diary the expiry date when you create it.

### 2. Connect Turbo EA

Open **Admin → Settings → Integrations** and choose the **Jira Todo Sync**
sub-tab.

Under **Jira Cloud connection**, fill in:

| Field | Notes |
|---|---|
| **Site URL** | For example `https://your-site.atlassian.net` |
| **Account email** | The Atlassian account the token belongs to |
| **API token** | Stored encrypted. Leave blank later to keep the stored token |

Press **Test connection**. On success it reports *Connected as …*.

### 3. Choose the scope

Under **Sync scope**:

- **Jira project** — pick from the list, which loads from Jira once the
  connection details are filled in. Pushed todos are created here as **Task**
  issues.
- **Pull filter (JQL)** — issues matching this JQL are mirrored as todos. Leave
  it empty for the default, `project = "<KEY>" AND statusCategory != Done`.
- **Poll interval (seconds)** — how often Jira is polled. Default 300, minimum 60.

Under **Directions**, three switches:

| Switch | Default | Effect |
|---|---|---|
| **Push todos to Jira** | On | Todos created in Turbo EA become Jira issues; completing a todo transitions its issue |
| **Pull issues from Jira** | On | Matching Jira issues appear as todos; resolving an issue completes its todo |
| **Mirror sign-off todos (one-way)** | **Off** | Risk, decision and project sign-offs become Jira issues with a link back — they must still be completed in Turbo EA |

Press **Save configuration**. **Sync now** runs a cycle immediately.

Assignee mapping needs no configuration — Turbo EA resolves people to Jira
accounts by email address automatically.

## How the sync behaves

| Event | Effect |
|---|---|
| Todo created in Turbo EA | A Jira issue is created within seconds (summary, description with a link back, due date, assignee) |
| Todo completed or edited | The issue is transitioned to Done, or its fields are updated |
| Issue matches the JQL | It is mirrored as a todo |
| Issue resolved in Jira | The todo is completed on the next poll (recurring todos roll their series forward) |
| Issue reopened in Jira | The todo is reopened |
| **Both sides edited** | **The newer change wins; on a tie, Jira wins** |
| Todo deleted in Turbo EA | The issue is **never deleted** — a comment notes the removal |
| Issue deleted in Jira | A pulled todo is removed; a Turbo-EA-created todo is kept and flagged in the log |

**Push is near-real-time; pull is polled.** Changes made in Turbo EA reach Jira
within seconds. Changes made in Jira are picked up on the next poll — by default
within five minutes. Each cycle also reconciles both sides, so a Jira outage or a
missed event heals itself rather than losing changes.

The four fields kept aligned are **summary**, **due date**, **done status** and
**assignee**. The summary maps to the **first line** of the todo text, so renaming
an issue in Jira replaces that first line and leaves any further detail intact.

### The issue-key chip

A synced todo carries its Jira issue key (for example `PROJ-123`) as a small
link, both on the [Todos page](../guide/tasks.md) and on a card's Todos tab.
Clicking it opens the issue in Jira. The chip is for reference — the todo is
always completed in Turbo EA or through the sync, never by editing the chip.

### Sign-off todos

Sign-off requests — a risk, decision or project awaiting someone's approval — are
system todos and are **never** pushed as ordinary todos. With **Mirror sign-off
todos** switched on they get a **one-way** Jira issue that deep-links to the page
where the sign-off actually happens.

A sign-off can never be completed from Jira. If someone closes the mirror issue
while the obligation is still open, the sync reopens it with a comment pointing
back to Turbo EA. When the sign-off is completed in Turbo EA, the mirror is
transitioned to Done on the next poll.

Switching the toggle off stops *new* mirrors being created; existing ones keep
being maintained.

## Monitoring

The panel's **Status** line shows when the last sync ran, any error, and a
summary of what it did. **Recent activity** below it lists the 50 most recent
actions with their time, direction (**Turbo EA → Jira**, **Jira → Turbo EA** or
**Sync**), the issue and a detail message. Warnings and errors are colour-coded —
this is where an unmapped assignee or a rejected transition shows up.

## Permissions

| Permission | Grants |
|---|---|
| `ext.jira-todos.admin` | Configure and operate the sync — connection, project, filters, manual sync, activity log |

The sub-tab is hidden entirely from anyone without it. **End users need no extra
permission**: synced todos simply appear in their ordinary todo list with the
issue-key chip.

## If the licence lapses or the extension is disabled

The sync job and its event handler pause immediately and the data-access grants
are revoked. **Nothing is deleted** — todos keep their chips, and the settings are
preserved. Applying a renewed licence resumes syncing where it left off.

The API token is stored encrypted on your instance and is excluded from workspace
transfer, so it never leaves the instance it was entered on.

## Troubleshooting and limitations

- **Jira Cloud only.** Jira Data Center is not supported.
- **One project per instance**, and issues are always created as type **Task**.
- **Polling, not webhooks.** Jira-side changes land on the next poll. Jira Cloud
  webhooks would require an OAuth app and an internet-reachable instance, and
  would still need a reconciling poll, so the sync is poll-based by design.
- **Assignee mapping and email privacy.** Turbo EA matches people by email, then
  falls back to an exact display-name match among the project's assignable users.
  Someone whose email is hidden in Jira *and* whose display name differs between
  the two systems cannot be matched; those assignees are left unchanged and the
  activity log records the email that failed to match. An unmapped Turbo EA
  assignee never silently unassigns the Jira issue.
- **Clearing a due date in Jira is not mirrored back.** Clear it in Turbo EA
  instead.
- **Sign-off mirrors are one-way and lag by up to one poll interval**, because
  core sign-off workflows do not emit change events.
- **Sync now** reports *A sync is already running* if one is in progress.
- After rotating your instance's `SECRET_KEY`, the stored token can no longer be
  decrypted and the panel returns to *Not configured yet* — re-enter the token.
