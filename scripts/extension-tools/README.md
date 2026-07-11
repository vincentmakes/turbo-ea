# Turbo EA extension tooling (`teax`)

`teax.py` builds, signs, and verifies Turbo EA extension bundles (`.teax`)
and license files. It is deliberately self-contained (Python stdlib + the
`cryptography` package only) so it can be vendored into an extension
repository and run in CI or on an offline/air-gapped operator machine.

The formats it produces are exactly what the core verifiers in
`backend/app/services/extensions/` accept:

- **bundle**: a zip whose `manifest.sig` is an Ed25519 signature over the
  raw `manifest.json` bytes, plus a per-file sha256 map inside the signed
  manifest;
- **license**: an envelope `{schema, key_id, payload: base64(json),
  signature}` where the signature covers the decoded payload bytes.

## Commands

```
python scripts/extension-tools/teax.py keygen
python scripts/extension-tools/teax.py lint   <extension-src-dir>
python scripts/extension-tools/teax.py pack   <extension-src-dir> --key-file vendor.key --key-id vendor-1
python scripts/extension-tools/teax.py verify <bundle>.teax --pubkey <pub>
python scripts/extension-tools/teax.py sign-license payload.json --key-file vendor.key --out acme.tealic
python scripts/extension-tools/teax.py verify-license acme.tealic --pubkey <pub>
```

Signatures are verified in core against the public keys baked into
`backend/app/core/extension_signing.py` (`DEFAULT_VENDOR_PUBLIC_KEYS`,
keyed by `key_id`). Public keys are safe to keep in the repo — they only
*verify*, never sign. Shipping your own commercial extensions means
forking — replace the keys in `DEFAULT_VENDOR_PUBLIC_KEYS` and rebuild.

## Authoring extensions & vendor operations

The full authoring guide (content packs, backend/UI SDK), signing/key
custody, the CI release pipeline, and the license-issuance runbook live in
the vendor's **private extensions repository** — not here. This directory
ships only the tool and its formats. Customer-facing usage (installing
extensions and licenses) is documented in the user manual:
[`docs/admin/extensions.md`](../../docs/admin/extensions.md).
