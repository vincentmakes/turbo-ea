# Turbo EA Extension Store server

The **vendor-hosted** online store for Turbo EA extensions: a small FastAPI
service that sells extension subscriptions via **Stripe**, issues signed
composite licenses, and serves `.teax` bundle downloads to connected
customer instances.

**This service is your infrastructure — it is never part of a customer's
Turbo EA stack.** Customers either connect to it once with a redeem code
(Admin → Extensions → Store) or ignore it entirely and receive files by
email (the air-gapped flow, which stays fully supported).

## How the pieces fit

```
Customer browser ──buy──▶ Stripe Checkout ──webhook──▶ store-server
                                                          │
Customer Turbo EA ◀──redeem code (one-time, success page)─┘
      │
      ├─ GET /account/license   → signed composite license (all entitlements)
      └─ GET /account/bundles/… → .teax download (verified by the core as usual)
```

Trust model: the store signs licenses with its **own** Ed25519 key
(`store-1`), never the offline vendor key. The matching public key must be
baked into core's `DEFAULT_VENDOR_PUBLIC_KEYS` (in
`backend/app/core/extension_signing.py`) under the same key id. Bundles are
still signed at build time by your release pipeline — the store only
*transports* them; every customer core re-verifies the signature on upload
and at every boot. Compromising the store server therefore cannot forge
bundles, and rotating `store-1` is a one-key core release.

Licenses are **composite and stateless**: `GET /account/license` regenerates
the license from current Stripe subscription state on every call — one
entitlement per subscribed extension, `expires_at` mirroring the Stripe
`current_period_end`. Cancellation needs no kill switch: the entitlement
simply stops being renewed and the core's grace + soft-disable does the rest.

## One-time setup

1. **Signing key**: `python scripts/extension-tools/teax.py keygen` →
   set `STORE_SIGNING_KEY` (private) here, and add the PUBLIC half to core's
   `DEFAULT_VENDOR_PUBLIC_KEYS` as `"store-1"` in a core release.
2. **Stripe**: create one Product + recurring Price per extension in the
   Stripe dashboard. Set `STRIPE_API_KEY`. Add a webhook endpoint pointing at
   `https://<store>/stripe/webhook` subscribed to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`; set its signing secret as `STRIPE_WEBHOOK_SECRET`.
   Enable Stripe Tax + the Customer Portal for self-serve VAT/cancellation.
3. **Deploy** (any Docker host; put TLS in front):

   ```bash
   cp store-server/.env.example .env   # or export the vars below
   docker compose -f store-server/docker-compose.store.yml up -d --build
   ```

4. **Publish products + releases** (admin API, `STORE_ADMIN_TOKEN` bearer):

   ```bash
   curl -X PUT https://store.example.com/admin/products/esg-pack \
     -H "Authorization: Bearer $STORE_ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"ESG Pack","description":"ESG metamodel content",
          "stripe_price_id":"price_…","display_price":"990 EUR / year"}'

   curl -X POST https://store.example.com/admin/releases \
     -H "Authorization: Bearer $STORE_ADMIN_TOKEN" \
     -F file=@esg-pack-1.0.0.teax
   ```

   Publishing a release is typically the last step of the extension repo's
   CI after `teax pack`.

## Customer flow

1. Customer buys on your storefront (or you send them a Checkout link).
2. The Stripe success page shows a one-time **activation code**
   (`XXXX-XXXX-XXXX`).
3. In Turbo EA: **Admin → Extensions → Store** → enter store URL + code.
   The instance exchanges the code for an account token (stored encrypted),
   pulls its license, and lists entitled packages with one-click **Install**
   (download → signature verification → dry-run preview → apply — the exact
   same pipeline as a manual upload).
4. Renewals: Stripe renews the subscription; the customer clicks **Refresh
   license** (or it is included next time they connect). A customer who buys
   a second extension later needs no new code — refresh picks it up.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `STORE_PUBLIC_URL` | `http://localhost:8010` | Public https URL (used in Stripe redirects) |
| `STORE_PORT` | `8010` | Bind port |
| `STORE_DATA_DIR` | `data` | SQLite DB + uploaded `.teax` artifacts |
| `STORE_DATABASE_URL` | *(empty)* | Optional Postgres DSN (`postgresql+asyncpg://…`) |
| `STRIPE_API_KEY` | *(empty)* | Stripe secret key (`sk_live_…` / `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | *(empty)* | Webhook endpoint signing secret |
| `STORE_SIGNING_KEY` | *(empty)* | base64 raw Ed25519 private key (license issuing) |
| `STORE_SIGNING_KEY_ID` | `store-1` | Key id customer cores know this key by |
| `STORE_LICENSE_GRACE_DAYS` | `30` | Grace window written into issued licenses |
| `STORE_ADMIN_TOKEN` | *(empty)* | Bearer token for the /admin publish API |
| `STORE_REDEEM_CODE_TTL_DAYS` | `30` | Unused activation codes expire after this |

## Local testing

```bash
cd store-server && pip install -e ".[dev]" && pytest          # mocked Stripe
stripe listen --forward-to localhost:8010/stripe/webhook     # real test-mode events
```
