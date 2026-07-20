# Operations & Upgrades

This page is the operator's guide to running Turbo EA in production: how upgrades and database migrations work, how to back up and roll back, which environments to run, and the pitfalls that catch teams at scale.

## Production images and version pinning

The published images at `ghcr.io/vincentmakes/turbo-ea/*` are the recommended way to run production — the stock `docker-compose.yml` pulls them by default, and building from source is a development workflow. Beyond convenience, the published images carry supply-chain guarantees a local build does not: every publish is multi-arch (amd64 + arm64), signed with cosign (keyless OIDC, verifiable against the GitHub Actions workflow identity), and attested with SLSA provenance and an SBOM. Images are gated on critical CVEs at publish time, re-scanned daily once live, and rebuilt weekly against fresh Alpine repositories so base-image patches flow in automatically. If your organization enforces image-signature verification at admission, the cosign signatures slot straight into that — see [Supply chain](supply-chain.md) for verification commands.

The most important habit: **pin your version**. The `:latest` tag is retagged on releases and on the weekly rebuild — not on every commit — so it can move underneath you on a schedule you don't control. Set an explicit tag in your `.env`:

```bash
TURBO_EA_TAG=2.23.1
```

See [Pinning a version](../getting-started/setup.md#pinning-a-version) for the basics and [Releases](../reference/releases.md) for the full tag tree and pre-release channel policy.

## How upgrades work: Alembic migrations

Database schema compatibility is handled automatically via [Alembic](https://alembic.sqlalchemy.org/). On startup, the backend runs `alembic upgrade head`, so every pending migration between your current schema and the new version is applied — in order — before the app serves traffic.

Migrations are sequentially numbered and cumulative, which means version jumps are safe: if you upgrade from, say, 2.10 to 2.23, every intermediate migration runs in sequence. You do not need to step through each minor release.

A few behaviors worth knowing:

| Situation | What happens on startup |
|---|---|
| Fresh database | Tables are created directly and the database is stamped at head — no migration replay. |
| Existing database | Pending migrations run automatically before the API comes up. |
| `RESET_DB=true` | All tables are dropped, recreated, and re-seeded. Never set this in production. |

Within a major version line, migrations stay additive and backwards-compatible-on-upgrade — see the [Compatibility policy](../reference/compatibility.md) for the full contract.

!!! warning "Never run an older backend against a newer schema"
    Alembic only migrates forward on startup. Old code against a newer schema is undefined behavior — this is the key rollback constraint (see below).

## The upgrade procedure

1. **Read the changelog.** Review the `CHANGELOG.md` entries between your current version and the target. Breaking changes bump the major version.
2. **Back up** the database and data volume (see below).
3. **Bump the tag and pull:**

    ```bash
    TURBO_EA_TAG=2.24.0 docker compose pull
    docker compose up -d
    ```

4. **Watch the startup logs** and confirm migrations complete cleanly before the API starts serving:

    ```bash
    docker compose logs -f backend
    ```

!!! note "Maintenance windows"
    Migrations are usually fast, but on large inventories some data migrations can take a few minutes, during which the backend isn't serving. Schedule upgrades in a maintenance window.

## Backups

Take a backup **before every upgrade**, and automate a nightly one regardless:

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Adjust the user and database name if you changed `POSTGRES_USER` / `POSTGRES_DB`. Snapshotting the `postgres_data` volume is an equivalent alternative.

Also back up the **`backend_data`** volume — it holds file attachments, installed extensions, and workspace-transfer bundles that don't live in PostgreSQL.

Two more points on recovery posture:

- **Test your restores periodically.** A backup that has never been restored is a hope, not a plan.
- **Archived cards are soft-deleted** with a 30-day window before permanent purge — that's your safety net for data mistakes, distinct from infrastructure recovery.

## Rollback and recovery

Schema migrations are effectively **forward-only in production**: while Alembic technically supports downgrades, data-bearing migrations can't always be reversed losslessly, and the app never runs downgrades automatically. The reliable rollback strategy is:

1. Stop the stack.
2. Restore the database backup taken before the upgrade.
3. Set `TURBO_EA_TAG` back to the previous version.
4. `docker compose up -d` — the restored database matches the old code's schema, so everything is consistent.

!!! warning "Never roll back the image alone"
    Rolling back the image while keeping the migrated database is the one combination the automatic migration system cannot protect you from. Database backup and image tag move together.

## Environments and release governance

For most organizations, **two environments** (Staging + Production) are enough, because upgrades are vendor-released images, not custom builds — you're validating, not developing. A full Dev/SIT/UAT/Prod chain adds value mainly if you build custom extensions or heavy integrations.

| Environment | Purpose | Notes |
|---|---|---|
| Dev / sandbox (optional) | Trial metamodel changes, demos | `SEED_DEMO=true` for the demo dataset; `RESET_DB=true` gives a clean slate. |
| Staging | Validate new versions first | Production-like data; first to receive new tags. |
| Production | Pinned tag, backups, maintenance-window upgrades | Never `latest`, never `RESET_DB`. |

Two good ways to get realistic data into staging:

- **[Workspace Transfer](workspace-transfer.md)**: export the production workspace as a `.zip` bundle and import it into staging. Secrets (SMTP, SSO, AI, ServiceNow credentials) are stripped by design and never leave the instance.
- **Database restore**: restore a production `pg_dump` into the staging database. Encrypted secrets in the database are derived from `SECRET_KEY`, so staging either needs the same `SECRET_KEY` or you re-enter integration credentials there.

Governance-wise:

- Treat the `.env` file and pinned `TURBO_EA_TAG` as configuration-as-code — keep them in your internal Git, and make upgrades a reviewed change (a pull request bumping the tag).
- Because staging and production pull the same pinned GHCR tag, you validate the byte-identical artifact you'll promote.
- Upgrade staging → soak for a few days → promote the same tag to production.

## Common pitfalls

1. **Running unpinned `latest`** — a routine `docker compose pull` becomes an unplanned upgrade with unplanned migrations, on the release schedule rather than yours.
2. **Upgrading without a backup** — migrations are forward-only; the backup *is* your rollback.
3. **Losing or changing `SECRET_KEY`** — it signs JWTs *and* derives the encryption key for stored secrets (SMTP, SSO, ServiceNow credentials). Changing it makes stored secrets undecryptable. Treat it like a database credential: vaulted, stable, backed up.
4. **`RESET_DB=true` left in an env file** — it does exactly what it says, on every startup.
5. **Editing the database directly** — schema state is owned by Alembic, and manual DDL will collide with future migrations. The same goes for data: use the API or UI so permissions, audit events, and data-quality recalculation stay correct.
6. **Not persisting the volumes** — `postgres_data` and `backend_data` must survive container recreation; check that your snapshot and backup tooling covers both.
7. **Rolling back the image without restoring the database** — see [Rollback and recovery](#rollback-and-recovery).
