# Extensions

**Extensions** add capabilities to Turbo EA without changing the core — extra
metamodel content, integrations with the tools your teams already use,
regulatory reporting, and whole new pages. They are built and signed by Turbo EA
and installed from **Admin → Extensions**.

This section documents what each published extension *does* and how to use it.
For how the Extension Store itself works — trust and signatures, licences,
instance IDs, installing, updating and trials — see
[Administration → Extension Store](../admin/extensions.md).

## Available extensions

### Strategy, Planning & Transformation

| Extension | What it does | Licence |
|-----------|--------------|---------|
| [Digital Autonomy Assessment](digital-autonomy.md) | Scores every application against the Utrecht University Digital Autonomy Assessment Framework — 22 weighted indicators, an automatic 1–10 autonomy score, and a risk/mitigation quadrant report | **Free** |
| [EA Value Tracker](value-savings.md) | Turns Architecture Decision Records into an auditable financial ledger: categorized savings claims, four-eyes realization approval, and a value dashboard | Commercial |
| [Roadmap Studio](roadmap-studio.md) | Plans alternative futures of the landscape as what-if scenarios, steps through transition plateaus, compares them on cost and end-of-life exposure, and takes them through review and a review-board decision | Commercial |

### Integrations

| Extension | What it does | Licence |
|-----------|--------------|---------|
| [Jira Todo Sync](jira-todos.md) | Keeps Turbo EA todos and a Jira Cloud project aligned in both directions — status, summary, due date and assignee | Commercial |
| [Slack Notifications](slack-notify.md) | Delivers each person's Turbo EA notifications as a Slack direct message, with per-user, per-type opt-in | Commercial |

### Regulations

| Extension | What it does | Licence |
|-----------|--------------|---------|
| [DORA Register of Information](dora-roi.md) | Maintains the EU DORA Art. 28 Register of Information on your existing cards and exports the official xBRL-CSV submission package | Commercial |

## What every extension has in common

- **Vendor-signed.** Every bundle carries an Ed25519 signature that Turbo EA
  verifies on upload *and* at every backend start. An extension that installs is
  exactly what the vendor built.
- **Licence-gated at runtime** (except free ones). If a licence lapses, the
  extension is soft-disabled — its pages disappear and its jobs pause — but
  **your data is never deleted**. Applying a renewed licence restores everything.
- **Least privilege.** Anything an extension reads or writes beyond its own data
  is declared as a **grant** inside the signed bundle, so you can see it before
  you install. See [Data access grants](../admin/extensions.md).
- **Its own permissions.** Each extension defines permission keys named
  `ext.<name>.…` that appear in **Admin → Users & Roles** once it is loaded, so
  you decide who may use it.
- **Auditable.** Every change an extension makes to your inventory is recorded in
  **Admin → Audit log** under the **Extension** origin and can be rolled back.

## Before you install

Check the **minimum Turbo EA version** on each extension's page — an extension
will not install on an older core. Extensions that ship backend code need a
one-off backend restart after installation; Turbo EA shows a banner when that
applies.
