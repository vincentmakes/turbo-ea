# Turbo EA extension tooling (`teax`)

Vendor-side tooling for building, signing, and shipping Turbo EA extensions
and licenses. Everything here is **offline-first**: bundles and licenses are
plain signed files that customers install by upload — including on
air-gapped instances. The customer-facing documentation lives in the user
manual under **Admin → Extensions** (`docs/admin/extensions.md`).

`teax.py` is deliberately self-contained (stdlib + `cryptography` only) so it
can be vendored into private extension repositories and run in CI or on an
offline operator machine.

```
python scripts/extension-tools/teax.py keygen
python scripts/extension-tools/teax.py lint   <extension-src-dir>
python scripts/extension-tools/teax.py pack   <extension-src-dir> --key-file vendor.key
python scripts/extension-tools/teax.py verify my-ext-1.0.0.teax --pubkey <pub>
python scripts/extension-tools/teax.py sign-license payload.json --key-file vendor.key --out acme.tealic
python scripts/extension-tools/teax.py verify-license acme.tealic --pubkey <pub>
```

## One-time vendor setup

1. `teax keygen` — generate the vendor keypair. **The private key is the
   crown jewel**: anyone holding it can produce extensions every customer
   instance will trust.
2. Bake the **public** key into core: set `DEFAULT_VENDOR_PUBLIC_KEY` in
   `backend/app/core/extension_signing.py` and release. Production images
   only trust this baked-in key — the `EXTENSION_VENDOR_PUBLIC_KEY` env
   override works exclusively in `ENVIRONMENT=development`, so a customer
   cannot repoint a production install at a different key without forking
   and rebuilding the image (that is the provenance guarantee).
3. Key custody: keep the **license-signing** use of the key on an offline
   operator machine. For **bundle signing in CI**, store the key as a
   protected GitHub Actions *environment* secret (`TEAX_SIGNING_KEY`) that
   only release workflows on the default branch can read. The `key_id`
   field in both envelopes exists so a future core release can trust
   several keys during a rotation window.

## Extension source layout (private repo per extension)

```
my-extension/
├── extension.json          # manifest source — see below
├── content/                # optional: content-pack JSON payloads
│   └── pack.json
├── backend/                # optional: Python package source
│   └── turbo_ext_myext/
├── wheels/                 # optional: built py3-none-any wheels (own + pure-Python deps)
├── frontend/               # optional: built ESM bundle (entry.js)
└── docs/
```

`extension.json` (the `schema` and per-file `files` hash map are added by
`teax pack` at build time):

```json
{
  "key": "my-extension",
  "name": "My Extension",
  "version": "1.2.0",
  "vendor": "Turbo EA",
  "core": { "min": "1.70.0", "max_exclusive": "2.0.0" },
  "sdk_version": "1.0",
  "capabilities": ["content", "backend", "frontend"],
  "backend": {
    "entrypoint": "turbo_ext_myext:extension",
    "wheels": ["wheels/turbo_ext_myext-1.2.0-py3-none-any.whl"]
  },
  "frontend": { "entry": "frontend/entry.js" },
  "content": ["content/pack.json"],
  "permissions": { "ext.my-extension.view": "View My Extension data" }
}
```

### Content packs

Content files map **workspace-transfer sheet names** to row lists
(`CardTypes`, `RelationTypes`, `TagGroups`, `Tags`, `Cards`, `CardTags`,
`Relations`, `Calculations`, `Principles`, `StakeholderRoles`,
`ComplianceRegs`, `ResourceTypes`). Rows use exactly the shapes the
workspace exporter produces, so the easiest authoring workflow is: build
the content on a staging instance, run **Admin → Workspace Transfer →
Export**, and copy the relevant sheets into JSON. Content is applied
through the core's idempotent upsert engine — built-in-type protection,
the one-relation-type-per-pair rule, and dry-run preview all apply.
`Users`, `Roles`, and `Settings` sheets are deliberately not allowed.

### Backend code (SDK 1.0)

The manifest entrypoint must resolve to a module-level object satisfying
the `TurboExtension` protocol from
`backend/app/services/extensions/sdk.py` — the **only** supported import
surface (importing other `app.*` internals voids compatibility):

```python
from fastapi import APIRouter
from app.services.extensions.sdk import ExtensionJob, ExtensionMigration

router = APIRouter()

@router.get("/items")            # served at /api/v1/ext/my-extension/items,
async def items(): ...           # gated per-request by license entitlement

class MyExtension:
    key = "my-extension"
    sdk_version = "1.0"
    def get_router(self): return router
    def get_permissions(self): return {"ext.my-extension.view": "…"}
    def get_migrations(self):    # sequential; tables MUST be ext_my_extension_*
        return [ExtensionMigration(version=1, name="init", upgrade=_create_tables)]
    def get_jobs(self): return []
    async def on_startup(self, ctx): ...

extension = MyExtension()
```

Rules enforced at load time: signature re-verification on every boot, SDK
major match, `key` consistency, `ext.{key}.*` permission namespace. Wheels
are installed by zip extraction (no pip, no network): **py3-none-any
only**, and any dependency outside core's dependency set must be shipped
as an additional pure-Python wheel in `wheels/`.

### Frontend code (UI SDK 1.0)

Build a single ESM file with `react`, `react-dom`, and `@mui/material`
externalized onto the host globals (`window.TurboEA.sdk`). On import the
bundle registers itself:

```js
const { React } = window.TurboEA.sdk;
window.TurboEA.register("my-extension", {
  key: "my-extension",
  sdkVersion: "1.0",
  routes: [{ id: "main", path: "/ext/my-extension", label: "My Extension",
             icon: "extension", permission: "ext.my-extension.view",
             component: MyPage }],
  cardTabs: [{ id: "tab", label: "My Tab", appliesTo: ["Application"],
               component: MyCardTab }],
  adminPanels: [{ id: "settings", label: "My Extension settings",
                  component: MyAdminPanel }],
});
```

The TypeScript shape is `TurboExtensionUI` in
`frontend/src/lib/extensionHost.tsx` — copy the exported interfaces into
the extension repo as a `.d.ts`. Exactly three extension points exist
(routes, card tabs, admin panels); every component renders inside an
error boundary, so a crash shows a fallback instead of blanking the app.

## Release workflow (CI)

```yaml
# .github/workflows/release.yml in the private extension repo
on:
  release: { types: [published] }
jobs:
  build:
    runs-on: ubuntu-latest
    environment: release          # protected environment holds the secret
    steps:
      - uses: actions/checkout@v4
      - run: pip install cryptography build
      - run: python -m build --wheel backend/ -o wheels/   # if backend code
      - run: npm ci && npm run build                        # if frontend code
      - run: python teax.py lint .
      - run: python teax.py pack . --out "my-extension-${{ github.ref_name }}.teax"
        env: { TEAX_SIGNING_KEY: "${{ secrets.TEAX_SIGNING_KEY }}" }
      - uses: softprops/action-gh-release@v2
        with: { files: "*.teax" }
```

Delivery to the customer is manual by design: send the `.teax` from the
release (email, portal, USB — identical flow for air-gapped sites).

## License issuance runbook (offline)

1. Write the payload:

   ```json
   {
     "licensee": "ACME Corp",
     "customer_id": "cus_7f3a",
     "issued_at": "2026-07-08T00:00:00Z",
     "grace_days": 30,
     "entitlements": [
       {"extension_key": "my-extension", "plan": "enterprise",
        "expires_at": "2027-07-08T00:00:00Z"}
     ]
   }
   ```

   `expires_at: null` issues a perpetual entitlement. Renewals are simply a
   new license file with later dates — the customer pastes it in and the
   old one is superseded (kept as audit history).

2. `teax sign-license payload.json --key-file vendor.key --out acme.tealic`
   on the offline operator machine (license signing never goes into CI).
3. Email `acme.tealic` to the customer admin.

## Honest threat model

Extensions run in-process with full database access — the vendor
signature is the security boundary, which is why it is non-bypassable in
production. Code delivered to customer infrastructure is readable by the
customer (Python and JS are not secrets); the license file gates
*activation* and the commercial contract gates *rights*. No DRM is
attempted, and expiry never deletes data.
