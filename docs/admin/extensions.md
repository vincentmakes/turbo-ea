# Extensions

The **Extension Store** (Admin → Extensions) installs vendor-signed extensions that add customer-specific capabilities — extra metamodel content, integrations, background jobs, and even new pages — without changing the Turbo EA core ("clean core" principle).

Extensions can be installed two ways: **one click from the built-in Store** (when your instance has internet access), or by **uploading the files directly** — the extension is a signed `.teax` bundle and the license is a signed text file, both typically sent by email. The file-based flow needs no store account or outbound connection, so the whole workflow works identically on **air-gapped** instances.

The page has two tabs: **Store** browses your vendor's extension catalogue with one-click install, and **Installed** manages licenses and installs from files.

**Extensions are built and signed by Turbo EA** — they are not self-built or open to third parties. If you need a capability tailored to your organisation, we can build and license it for you. See [Turbo EA consulting](https://www.turbo-ea.org/consulting).

## How trust works

Two independent checks protect your instance:

1. **Provenance (signature).** Every bundle carries an Ed25519 signature by the vendor's signing key. Turbo EA verifies it on upload *and again at every backend start*. Unsigned, tampered, or third-party bundles are rejected — an extension that installs is guaranteed to be exactly what the vendor built.
2. **Activation (license).** A signed license file lists your entitlements — one per extension, each with its own expiry. An installed extension only runs while a usable entitlement exists. Licenses are **bound to your instance ID** — a license issued for a different instance is refused.

## Free extensions

Some extensions are **free** and require no license at all. They install and run straight away — there is no purchase step and no license file to paste. Free extensions are marked with a **Free** badge on the Store and Installed tabs, and the **Buy** and **Renew** actions are hidden for them. The signature check still applies exactly as for paid extensions (a free extension is still vendor-signed), so provenance is guaranteed either way. Because they need no entitlement, free extensions never lapse or enter a grace window.

## Your instance ID

Every installation generates a unique **instance ID** (`TEA-XXXX-XXXX-XXXX`) once, shown at the top of Admin → Extensions with a copy button. It is your licensing identity: quote it when purchasing (the in-app Store sends it automatically; the storefront checkout asks for it) so that every extension bought for this instance — by any administrator, under any email — lands in one combined license. It identifies your instance only; it is never a credential, so it is safe to share with your vendor.

The ID travels with a workspace transfer, so moving to a new host keeps your license working. After a **full reinstall** the instance gets a new ID — ask your vendor to re-issue your license for it (a quick "re-key" on their side).

## The Store tab

The **Store** tab works out of the box and lists the vendor's published extensions with description and price:

- **Buy** opens the payment page in a new browser tab. Once the payment is confirmed, your license applies automatically (a copy also arrives by email).
- **Install** (or **Update** when a newer version is published) checks your license first — if the extension isn't licensed yet, a dialog offers to buy it or paste a license, then continues automatically — and downloads the bundle through the exact same signature verification and dry-run preview as a manual upload. Extensions with a demo show a **See it in action** link, and a published newer version turns the button into **Update**.

When the catalogue carries category tags, each item shows small pills (free or commercial, plus topics such as integration) and a filter bar appears above the list — click pills to narrow it (several pills combine), and **All** resets the view.

The Store tab is read-only and anonymous: no account, no token, and nothing about your instance is sent anywhere — it only reads the vendor's public catalogue. Air-gapped instances need no configuration — the tab simply shows a friendly hint — and use the file-based flow below; the vendor's storefront website offers the same purchases and downloads from any internet-connected browser. If something between your instance and the store blocks the request — a proxy, a firewall, or bot protection in front of the store — the tab says so and names the HTTP status it got back, so a blocked instance is never mistaken for an air-gapped one.

The instance also **checks the catalogue once a day** and tells you what changed, so a new extension — or a security fix to one you already run — does not wait until somebody happens to open this page. Administrators (anyone whose role grants `admin.manage_extensions`) get a notification in the bell when a new extension is published to the store, and another when an extension they have installed has a newer version. Each change is announced once, and a busy release day arrives as one notification per kind rather than one per extension. Nothing is downloaded or installed — the notification simply brings you here. The daily check can be switched off entirely under [Admin → Settings → Update notifications](settings.md#update-notifications).

## Trials

Some paid extensions offer a **free 30-day trial** — look for the **Start 30-day trial** button on the Store tab (or the trial option on the store website). Starting a trial works like a purchase without the payment: no credit card is needed, your license updates automatically (a copy also arrives by email for air-gapped installs), and the extension runs with full functionality for 30 days.

- Each Turbo EA instance can trial a given extension **once**.
- A trial ends exactly on its end date — there is no grace period. The extension then stops running until you subscribe; **your data is never deleted**, and everything comes back the moment a subscription license is applied.
- The Installed tab shows trial entitlements as **Trial until …**.
- Trials end by themselves — there is nothing to cancel and nothing is ever billed.

## Installing an extension

1. If you have not done so yet, apply your license first (see below).
2. Open **Admin → Extensions** and choose **Install from file…** on the Store tab, then upload the `.teax` file you received.
3. Turbo EA verifies the signature and shows a **preview**: for content-carrying extensions this is a dry-run of every card type, tag group, card, and relation the extension would create or update — nothing is written yet.
4. Review the preview and press **Install extension**.
5. If the extension carries backend code, a banner asks you to restart the backend container (`docker compose restart backend`). Content and UI extensions are active immediately — users pick up new UI on their next page load.

Uploading the same bundle again is safe — the preview shows everything as "skipped" and applying changes nothing.

## Updating an extension

When the store publishes a newer version of an installed extension, the Installed tab shows an **Update to X** chip next to the extension's version (and the Store tab's button turns into **Update**). One click runs the same signature verification, dry-run preview, and apply as a fresh install. Two safeguards apply:

- Updating an extension you have deliberately **disabled** keeps it disabled — the new version lands on disk, but its content stays hidden and nothing runs until you enable it again.
- Installing a bundle **older** than the installed version asks for an explicit confirmation first: a downgrade may not understand data written by the newer version. Nothing is deleted either way.

## Licenses and renewal

Apply a license via **Enter license…** on the Installed tab (paste the text or upload the file) — the button also appears on each extension row that needs one. The page then shows the licensee and one chip per entitlement with its expiry date.

Your instance holds **one license at a time** — applying a new one replaces the previous one. Store-issued licenses always contain every purchase made for your instance, so replacing is safe. If you also hold manually issued licenses, ask your vendor for one combined license instead of installing per-extension files; should a license you apply drop entitlements the current one still covers, Turbo EA lists them and asks for confirmation first (no data is deleted either way).

When an entitlement passes its expiry it enters a **grace window** (30 days by default): everything keeps working and administrators see a warning banner. After grace the extension is **soft-disabled** — its pages disappear, its API refuses requests, and its background jobs pause. **No data is ever deleted.** Applying a renewed license file restores everything instantly, without a restart.

Licenses bought through the Store renew themselves on connected instances: after each successful payment, your instance fetches the extended license automatically — nothing to paste. Renewal on an air-gapped instance is: paste the updated license file from the renewal email (or request one from your vendor) — nothing else.

### Auto-renew status and cancelling

Each entitlement chip states what happens on its date: **Renews on {date}** for an active subscription, or **Expires {date} — will not renew** after a cancellation. This comes from the signed license itself, so it is accurate on air-gapped instances too — the license file emailed after any subscription change carries the updated status; paste it and the chip is current.

To see the renewal date, cancel or restore auto-renew, change the payment method, or download invoices, use **Manage subscription** next to the licensee name (shown for store-bought licenses). It opens your billing portal in a new tab — no account needed. On an air-gapped instance the button cannot reach the store; use the **Manage subscription** link included in every license email instead (your browser only needs internet access, your Turbo EA instance does not).

Cancelling never switches anything off immediately: the extension keeps working until the end of the paid period, then the normal grace + soft-disable flow applies. **Your data is never deleted**, and resubscribing restores everything.

## Enabling, disabling, and uninstalling

- The **Enabled** switch soft-disables an extension immediately (no restart) and can be flipped back at any time. For content packs this hides their card types from the metamodel — cards stay where they are.
- **Uninstall** removes the extension's files and hides its card types from the metamodel. Cards and the extension's own tables are deliberately kept, and everything — types included — reappears if you reinstall.

## Permissions

The whole page and all its API routes are gated by the dedicated `admin.manage_extensions` permission (granted to the built-in Admin role). Extensions can define their own permission keys (`ext.<name>.…`), which appear in **Admin → Users & Roles** once the extension is loaded.

## Advanced field capabilities

Some extensions unlock advanced ways to describe your data that the core does not offer on its own:

- **Field help text** — collapsible guidance shown under a field while people enter data, so a form explains itself.
- **Custom field types** — new kinds of field beyond the built-in set (for example a configurable rating from 1–5 or 0–10).

These options appear in the metamodel field editor **only while the extension that provides them is installed and licensed**. If such an extension is later disabled or its license lapses, the values you already captured keep displaying as plain read-only text — nothing is blanked or deleted — and the authoring options simply disappear until the extension is active again.

## Data access grants

Most extensions only work with their own data. An extension that integrates with core data — for example a connector that syncs todos with an external task tracker such as Jira or MS Planner ([#921](https://github.com/vincentmakes/turbo-ea/discussions/921)) — must declare **grants** in its signed manifest:

- `core.todos.read` / `core.todos.write` — read or change todos through the extension SDK. Write implies read. On system todos (such as sign-off requests) a sync extension can only set the external reference shown as a chip — it can never complete, edit, reassign or delete them, and it can never touch todos owned by another extension.
- `core.events.todo` — receive todo change events, so a connector reacts to a completed todo immediately instead of on its next polling cycle.
- `core.users.read` — look up users (name, email, active flag only) so a connector can match assignees with accounts in the external tool. No role, login or preference data is exposed, and extensions can never change users.
- `core.cards.read` — read cards, relations and the metamodel, e.g. so a connector can match your applications against records in an external system. Archived cards stay out of view.
- `core.cards.write` — create, update or archive cards and add relations, with exactly the validation the app's own editor applies. Updates merge field values rather than replacing them, so an extension can never wipe data it does not manage, and there is **no permanent delete** — archiving, with its restore window, is the only removal an extension can perform.
- `core.events.card` — receive card and relation change events, so a connector reacts to inventory changes immediately instead of on its next polling cycle.

Grants ride inside the vendor-signed bundle, so they are fixed at packaging time and visible before you install. They only apply while the extension is installed, enabled and licensed — disabling it or letting the license lapse revokes access immediately, no restart needed. Every change an extension makes is recorded in **Admin → Audit log** under the **Extension** origin as an `ext:<key>` batch with per-field diffs, and can be rolled back from there like any other batch. A todo mirrored from an external tracker shows a chip linking to the external item.

Operators keep the last word on inventory writes: setting the environment variable `EXTENSION_WRITES_ENABLED=false` pauses every extension write instantly (reads keep working, no restart needed), and `EXTENSION_MAX_WRITES_PER_BATCH` / `EXTENSION_MAX_BATCHES_PER_MINUTE` cap how much a single extension can change per batch and per minute.

## Where extension pages appear

Extension pages appear in the navigation once the extension is installed and licensed — usually as their own top-level menu item, though some reports are placed under the **Reports** menu alongside the built-in ones.
