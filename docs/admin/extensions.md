# Extensions

The **Extension Store** (Admin → Extensions) installs vendor-signed extensions that add customer-specific capabilities — extra metamodel content, integrations, background jobs, and even new pages — without changing the Turbo EA core ("clean core" principle).

Everything is delivered as files: the extension is a signed `.teax` bundle and the license is a signed text file, both typically sent by email. No online activation, store account, or outbound connection is required, so the whole workflow works identically on **air-gapped** instances.

## How trust works

Two independent checks protect your instance:

1. **Provenance (signature).** Every bundle carries an Ed25519 signature by the vendor's signing key. Turbo EA verifies it on upload *and again at every backend start*. Unsigned, tampered, or third-party bundles are rejected — an extension that installs is guaranteed to be exactly what the vendor built.
2. **Activation (license).** A signed license file lists your entitlements — one per extension, each with its own expiry. An installed extension only runs while a usable entitlement exists.

## Installing an extension

1. If you have not done so yet, apply your license first (see below).
2. Open **Admin → Extensions**, choose **Install extension**, and upload the `.teax` file you received.
3. Turbo EA verifies the signature and shows a **preview**: for content-carrying extensions this is a dry-run of every card type, tag group, card, and relation the extension would create or update — nothing is written yet.
4. Review the preview and press **Install extension**.
5. If the extension carries backend or UI code, a banner asks you to restart the backend container (`docker compose restart backend`). Content-only extensions are active immediately.

Uploading the same bundle again is safe — the preview shows everything as "skipped" and applying changes nothing.

## Licenses and renewal

Paste the license text you received (or upload the license file) in the **License** card. The page then shows the licensee and one chip per entitlement with its expiry date.

When an entitlement passes its expiry it enters a **grace window** (30 days by default): everything keeps working and administrators see a warning banner. After grace the extension is **soft-disabled** — its pages disappear, its API refuses requests, and its background jobs pause. **No data is ever deleted.** Applying a renewed license file restores everything instantly, without a restart.

Renewal on an air-gapped instance is therefore: request a new license file from your vendor (by email), then paste it in — nothing else.

## Enabling, disabling, and uninstalling

- The **Enabled** switch soft-disables an extension immediately (no restart) and can be flipped back at any time.
- **Uninstall** removes the extension's files. Data the extension created — card types, cards, and its own tables — is deliberately kept and reappears if you reinstall. A restart is needed to fully unload backend code.

## Online store (optional)

If your vendor operates an online extension store, you can connect instead of exchanging files. After a purchase you receive a one-time **activation code**: open **Admin → Extensions → Store**, enter the store URL and the code. Your instance then lists the packages you are entitled to with one-click **Install**, and a **Refresh license** button picks up renewals and new purchases instantly — the downloaded bundles go through exactly the same signature verification and preview as manual uploads. Air-gapped instances simply never connect; the file-based flow above remains fully supported.

## Permissions

The whole page and all its API routes are gated by the dedicated `admin.manage_extensions` permission (granted to the built-in Admin role). Extensions can define their own permission keys (`ext.<name>.…`), which appear in **Admin → Users & Roles** once the extension is loaded.
