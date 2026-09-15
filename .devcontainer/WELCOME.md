# Turbo EA Demo

The Codespace pulls the published Turbo EA images from GHCR and starts
the full stack with the NexaTech demo dataset (including BPM and PPM
data). First-run setup takes ~5–10 minutes — mostly the image pull and
the demo seed.

Once the build finishes, **open the forwarded port `8920`** in your
browser (the *Ports* panel pops it open automatically the first time).

## Login credentials

| Field    | Value                  |
| -------- | ---------------------- |
| Email    | `admin@turboea.demo`   |
| Password | `TurboEA!2025`         |

## What's enabled

- NexaTech Industries demo metamodel + cards (`SEED_DEMO=true`)
- PPM module — initiatives, status reports, WBS, tasks, costs, risks
- BPM module — enabled by default, browse from the top nav

## Useful commands

Run from the repository root:

```bash
# Tail all logs
docker compose logs -f

# Restart the stack
docker compose restart

# Stop the stack
docker compose down

# Pull newer images and restart
docker compose pull && docker compose up -d
```

## Troubleshooting

If port 8920 returns 502:

```bash
docker compose ps
docker compose logs --tail=200
```

The first-run database migrations + demo seed take several minutes even
after containers are *Up* — give it a moment and refresh.
