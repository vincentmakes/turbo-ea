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

## SDK 1.2: grants, todos bridge, events, secrets

SDK 1.2 (additive — 1.0/1.1 extensions load unchanged) lets a backend
extension work with core todos, e.g. to build a task-tracker sync
connector (discussion #921). The manifest side, which `teax lint`
validates:

- `grants` — a list of core capability strings the extension needs.
  Valid values are pinned in `VALID_GRANTS` (mirrored from
  `backend/app/services/extensions/bundle.py`): the metamodel authoring
  grants plus `core.todos.read`, `core.todos.write` (write implies read)
  and `core.events.todo`. An unknown grant is a hard lint/verify error.
- `sdk_version` — `pack` defaults it to the SDK this teax ships with
  (currently `1.4`). The loader is major-only, so a newer-minor bundle
  still loads on an older 1.x core (with a newer-minor warning in the
  core logs).

At runtime the extension uses, on its `ExtensionContext`:

- `ctx.todos` — typed bridge (`list` / `get` / `create` / `update` /
  `complete` / `delete`), grant-checked on every call; writes are audited
  as `ext:{key}` mutation batches and stamp `external_source` with the
  extension's key.
- `get_event_handlers()` — an optional module-level hook on the extension
  instance returning `EventSubscription(prefix, handler, include_self)`
  rows; delivery is gated by `core.events.todo`. Own bridge-caused events
  are filtered out unless `include_self=True` — do not set it unless you
  know why.
- `ctx.get_secret` / `ctx.set_secret` — Fernet-encrypted credential
  storage (`str` only). A rotated instance `SECRET_KEY` makes
  `get_secret` return `""` — treat as missing and re-prompt the operator.
  Never store credentials via `set_setting` (plaintext, and exported in
  workspace-transfer bundles).

## SDK 1.3: users bridge, system-todo mirror fields

SDK 1.3 (additive) rounds out the connector surface:

- `ctx.users` — read-only typed bridge to the user directory (`list` /
  `get` / `find_by_email`), gated by the new `core.users.read` grant and
  returning only the least-privilege picker payload (id, email, display
  name, active flag). Built for assignee mapping against an external
  tracker's accounts.
- The todos bridge now accepts exactly one kind of write on `is_system`
  todos: an `update` whose only fields are `external_ref` /
  `external_url`, so a connector can reference a sign-off in the external
  tool (the chip renders in core as usual). Status, description,
  assignee, due date, `complete` and `delete` on system todos stay
  refused — a sign-off can be referenced externally, never performed
  externally.
- lint warns when `core.users.*` grants are declared with an
  `sdk_version` older than `1.3`.

## SDK 1.4: batch settings

SDK 1.4 (additive) adds `ctx.get_settings(names)` / `ctx.set_settings(values)`
— read or write many namespaced settings in one database transaction
instead of one transaction per key (the per-key `get_setting` /
`set_setting` remain). `set_settings` refuses `secret.`-prefixed names;
credentials still go through `set_secret`.

## Authoring extensions & vendor operations

The full authoring guide (content packs, backend/UI SDK), signing/key
custody, the CI release pipeline, and the license-issuance runbook live in
the vendor's **private extensions repository** — not here. This directory
ships only the tool and its formats. Customer-facing usage (installing
extensions and licenses) is documented in the user manual:
[`docs/admin/extensions.md`](../../docs/admin/extensions.md).
