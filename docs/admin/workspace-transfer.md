# Workspace Transfer

Workspace Transfer (**Admin → Settings → Workspace Transfer**) moves an entire Turbo EA workspace from one instance to another as a single, self-contained bundle. The driving use case: you build out a workspace on a **local** instance and need to promote everything to **Production**.

## What's included

The export captures the full workspace as a `.zip` bundle containing one Excel workbook (all structured data, one sheet per domain) and, where relevant, an `assets/` folder for unstructured files:

- **Metamodel** — card types and relation types, including all custom fields, subtypes, sections, and translations.
- **Configuration** — roles, per-type stakeholder roles, tag groups and tags, calculated fields, EA principles, and compliance regulations.
- **Settings** — currency, date format, feature flags, login branding, enabled locales, and the rest of the general application settings.
- **Users** — email, display name, role, and active flag (used to re-link ownership and assignments on the target).
- **Inventory** — every card (with its hierarchy, lifecycle, and attributes), card tags, and relations.

## What's never included

For security, **secrets are never exported**:

- SMTP password
- SSO client secret
- AI provider API key
- ServiceNow credentials

You must re-enter these on the target instance after importing. This is unavoidable by design: encrypted values are tied to the source instance's `SECRET_KEY` and cannot be decrypted anywhere else.

## Exporting

1. Open **Admin → Settings → Workspace Transfer**.
2. (Optional) tick **Include archived cards** to add archived inventory to the bundle.
3. Click **Export bundle**. Your browser downloads `workspace_export_<timestamp>.zip`.

## Importing

1. On the **target** instance, open **Admin → Settings → Workspace Transfer**.
2. Under **Import workspace**, click **Choose bundle…** and select the `.zip` you exported.
3. Turbo EA parses the bundle and shows a **dry-run preview** — a per-section table of how many entities would be created, updated, skipped, or are in conflict. Nothing is written yet.
4. Review the preview, then click **Apply import**.

Import is **idempotent**: metamodel and configuration are matched by key, cards by external id or by type + hierarchy path, and users by email. Re-importing the same bundle is safe — already-present entities are skipped rather than duplicated. Existing built-in metamodel types keep their identity; only their editable schema is merged.

## After importing

- Re-enter any SMTP, SSO, and AI credentials under their respective settings tabs.
- Synthetic users referenced by the bundle are created **deactivated**; activate them under **Admin → Users** as needed.

## Permissions

Workspace Transfer is gated by two dedicated permissions, both granted to administrators:

- `admin.export_workspace` — export the bundle.
- `admin.import_workspace` — preview and apply an import.
