# Installation og opsætning

Denne guide leder dig gennem installation af Turbo EA med Docker, konfiguration af miljøet, indlæsning af demodata og start af valgfrie tjenester som AI-forslag og MCP-serveren.

## Forudsætninger

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

Cirka 2 GB ledig diskplads, et par minutters båndbredde til det første billede-pull og portene `8920` (HTTP) samt valgfrit `9443` (HTTPS) fri på værten.

## Trin 1: Hent konfigurationen

Du har brug for `docker-compose.yml` og en konfigureret `.env`-fil i en arbejdsmappe. Den nemmeste måde er at klone repositoriet:

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Åbn `.env` og angiv de to påkrævede værdier:

```dotenv
# PostgreSQL credentials (used by the embedded database container).
# Choose a strong password — it persists in the bundled volume.
POSTGRES_PASSWORD=choose-a-strong-password

# JWT signing key. Generate one with:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

Alt andet i `.env.example` har fornuftige standardværdier.

!!! note
    Backenden nægter at starte med eksemplets standard-`SECRET_KEY` uden for udvikling. Generér en rigtig en, før du går videre.

## Trin 2: Pull og start

Den medfølgende stak (Postgres + backend + frontend + edge nginx) kører fra forudbyggede multi-arch billeder på GHCR — ingen lokal build kræves:

```bash
docker compose pull
docker compose up -d
```

Åbn **http://localhost:8920** og registrér den første bruger. Den første bruger, der registrerer sig, forfremmes automatisk til **Admin**.

For at ændre værtsporten skal du angive `HOST_PORT` i `.env` (standard `8920`). Direkte HTTPS-terminering er dækket i [Trin 5](#trin-5-direkte-https-valgfrit).

## Trin 3: Indlæs demodata (valgfrit)

Turbo EA kan starte tom (kun den indbyggede metamodel) eller med datasættet **NexaTech Industries**-demo, som er ideelt til evaluering, træning og udforskning af funktioner.

Angiv seed-flaget i `.env` **før den første opstart**:

```dotenv
SEED_DEMO=true
```

Kør derefter `docker compose up -d` (hvis du allerede er startet, se "Nulstil og re-seed" nedenfor).

### Seed-flag

| Variabel | Standard | Beskrivelse |
|----------|----------|-------------|
| `SEED_DEMO` | `false` | Indlæs hele NexaTech Industries-datasættet, inklusive BPM- og PPM-data |
| `SEED_BPM` | `false` | Indlæs kun BPM-demoprocesser (delmængde af `SEED_DEMO`) |
| `SEED_PPM` | `false` | Indlæs kun PPM-projektdata (delmængde af `SEED_DEMO`) |
| `RESET_DB` | `false` | Slet alle tabeller og genopret fra bunden ved opstart |

`SEED_DEMO=true` inkluderer allerede BPM- og PPM-data — du behøver ikke angive delmængde-flagene separat.

### Demoadministratorkonto

Når demodata indlæses, oprettes en standardadministratorkonto:

| Felt | Værdi |
|------|-------|
| **E-mail** | `admin@turboea.demo` |
| **Adgangskode** | `TurboEA!2025` |
| **Rolle** | Admin |

!!! warning
    Demoadministratoren bruger kendte, offentlige legitimationsoplysninger. Skift adgangskoden — eller opret din egen administratorkonto og deaktivér denne — for ethvert miljø ud over lokal evaluering.

### Hvad demoen indeholder

Cirka 150 kort på tværs af alle fire arkitekturlag, plus relationer, tags, kommentarer, opgaver, BPM-diagrammer, PPM-data, EA Decision Records og et Statement of Architecture Work:

- **Core EA** — Organisationer, ~20 forretningskompetencer, forretningskontekster, ~15 applikationer, ~20 it-komponenter, grænseflader, dataobjekter, platforme, mål, 6 initiativer, 5 taggrupper, 60+ relationer.
- **BPM** — ~30 forretningsprocesser i et 4-niveaus hierarki med BPMN 2.0-diagrammer, element-til-kort-kæder og procesvurderinger.
- **PPM** — Statusrapporter, Work Breakdown Structures, ~60 opgaver, budget- og omkostningslinjer og et risikoregister på tværs af de 6 demo-initiativer.
- **EA Delivery** — Architecture Decision Records og Statements of Architecture Work.

### Nulstil og re-seed

For at slette databasen og starte forfra:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Genstart stakken, og **fjern derefter `RESET_DB=true` fra `.env`** — hvis det forbliver indstillet, nulstilles databasen ved hver genstart:

```bash
docker compose up -d
# Verify the new data is there, then edit .env to remove RESET_DB
```

## Trin 4: Valgfrie tjenester (Compose-profiler)

Begge tilføjelser er opt-in via Docker Compose-profiler og kører sideløbende med kernestakken uden at forstyrre den.

### AI-beskrivelsesforslag

Generér kortbeskrivelser med en lokal LLM (medfølgende Ollama) eller en kommerciel udbyder. Den medfølgende Ollama-container er den nemmeste vej for selv-hostede opsætninger.

Tilføj til `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Start med `ai`-profilen:

```bash
docker compose --profile ai up -d
```

Modellen downloades automatisk ved første opstart (et par minutter, afhængigt af din forbindelse). Se [AI-funktioner](../admin/ai.md) for den fulde konfigurationsreference, inklusive hvordan du bruger OpenAI / Gemini / Claude / DeepSeek i stedet for den medfølgende Ollama.

### MCP-server

MCP-serveren lader AI-værktøjer — Claude Desktop, Cursor, GitHub Copilot og andre — forespørge dine EA-data via [Model Context Protocol](https://modelcontextprotocol.io/) med RBAC pr. bruger. Den er skrivebeskyttet.

```bash
docker compose --profile mcp up -d
```

Se [MCP-integration](../admin/mcp.md) for OAuth-opsætning og værktøjsdetaljer.

### Begge på én gang

```bash
docker compose --profile ai --profile mcp up -d
```

## Trin 5: Direkte HTTPS (valgfrit)

Den medfølgende edge nginx kan selv terminere TLS — nyttigt, hvis du ikke har en ekstern reverse proxy. Tilføj til `.env`:

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

Placér `cert.pem` og `key.pem` i `./certs/` (mappen monteres skrivebeskyttet i nginx-containeren). Image'et udleder `server_name` og det forwardede skema fra `TURBO_EA_PUBLIC_URL`, serverer både HTTP og HTTPS og omdirigerer HTTP til HTTPS automatisk.

For opsætninger bag en eksisterende reverse proxy (Caddy, Traefik, Cloudflare Tunnel), lad `TURBO_EA_TLS_ENABLED=false` stå, og lad proxyen håndtere TLS.

## Fastlås en version

`docker compose pull` defaulter til `:latest`. For at fastlåse til en specifik udgivelse i produktion skal du angive `TURBO_EA_TAG`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

Udgivne versioner tagges `:<full-version>`, `:<major>.<minor>`, `:<major>` og `:latest`. Publiceringsarbejdsprocessen ekskluderer prerelease-tags (`-rc.N`) fra `:latest` og de korte `:X.Y` / `:X`-tags. Se [Udgivelser](../reference/releases.md) for det fulde tag-træ og pre-release-kanalpolitikken.

## Brug en eksisterende PostgreSQL

Hvis du allerede kører en administreret eller delt PostgreSQL-instans, så peg backenden på den og spring den medfølgende `db`-tjeneste over.

Opret databasen og brugeren på din eksisterende server:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Tilsidesæt forbindelsesvariablerne i `.env`:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Start derefter som sædvanligt: `docker compose up -d`. Den medfølgende `db`-tjeneste er stadig defineret i `docker-compose.yml`; du kan enten lade den køre tomt eller stoppe den eksplicit.

## Verificering af images

Fra `1.0.0` og fremefter er hvert udgivne image signeret med cosign keyless OIDC og leveres med en buildkit-genereret SPDX SBOM. Se [Supply Chain](../admin/supply-chain.md) for verifikationskommandoen, og hvordan du henter SBOM'en fra registreringsdatabasen.

## Udvikling fra kildekode

Hvis du vil bygge stakken fra kildekode (ved at ændre backend- eller frontend-kode), så brug dev compose-overstyringen:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

Eller bekvemmelighedstarget:

```bash
make up-dev
```

Den fulde udviklerguide — branch-navngivning, lint- og testkommandoer, pre-commit-tjek — findes i [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## Hurtig reference

| Scenarie | Kommando |
|----------|----------|
| Førstegangsstart (tomme data) | `docker compose pull && docker compose up -d` |
| Førstegangsstart med demodata | Angiv `SEED_DEMO=true` i `.env`, derefter det samme |
| Tilføj AI-forslag | Tilføj AI-variabler, derefter `docker compose --profile ai up -d` |
| Tilføj MCP-server | `docker compose --profile mcp up -d` |
| Fastlås en version | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| Nulstil og re-seed | `RESET_DB=true` + `SEED_DEMO=true`, genstart, fjern derefter `RESET_DB` |
| Brug ekstern Postgres | Tilsidesæt `POSTGRES_*`-variabler i `.env`, derefter `docker compose up -d` |
| Byg fra kildekode | `make up-dev` |

## Næste trin

- Åbn **http://localhost:8920** (eller din konfigurerede `HOST_PORT`) og log på. Hvis du indlæste demodata, brug `admin@turboea.demo` / `TurboEA!2025`. Ellers registrér — den første bruger forfremmes automatisk til Admin.
- Udforsk [Dashboardet](../guide/dashboard.md) for et overblik over dit EA-landskab.
- Tilpas [korttyper og felter](../admin/metamodel.md) — metamodellen er fuldt datadrevet, ingen kodeændringer nødvendige.
- Til produktionsudrulninger skal du gennemgå [Kompatibilitetspolitik](../reference/compatibility.md) og [Supply Chain](../admin/supply-chain.md).
