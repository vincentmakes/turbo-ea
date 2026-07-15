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

The Store tab is read-only and anonymous: no account, no token, and nothing about your instance is sent anywhere — it only reads the vendor's public catalogue. Air-gapped instances need no configuration — the tab simply shows a friendly hint — and use the file-based flow below; the vendor's storefront website offers the same purchases and downloads from any internet-connected browser.

## Installing an extension

1. If you have not done so yet, apply your license first (see below).
2. Open **Admin → Extensions** and choose **Install from file…** on the Store tab, then upload the `.teax` file you received.
3. Turbo EA verifies the signature and shows a **preview**: for content-carrying extensions this is a dry-run of every card type, tag group, card, and relation the extension would create or update — nothing is written yet.
4. Review the preview and press **Install extension**.
5. If the extension carries backend code, a banner asks you to restart the backend container (`docker compose restart backend`). Content and UI extensions are active immediately — users pick up new UI on their next page load.

Uploading the same bundle again is safe — the preview shows everything as "skipped" and applying changes nothing.

## Licenses and renewal

Apply a license via **Enter license…** on the Installed tab (paste the text or upload the file) — the button also appears on each extension row that needs one. The page then shows the licensee and one chip per entitlement with its expiry date.

When an entitlement passes its expiry it enters a **grace window** (30 days by default): everything keeps working and administrators see a warning banner. After grace the extension is **soft-disabled** — its pages disappear, its API refuses requests, and its background jobs pause. **No data is ever deleted.** Applying a renewed license file restores everything instantly, without a restart.

Licenses bought through the Store renew themselves on connected instances: after each successful payment, your instance fetches the extended license automatically — nothing to paste. Renewal on an air-gapped instance is: paste the updated license file from the renewal email (or request one from your vendor) — nothing else.

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

## Where extension pages appear

Extension pages appear in the navigation once the extension is installed and licensed — usually as their own top-level menu item, though some reports are placed under the **Reports** menu alongside the built-in ones.
