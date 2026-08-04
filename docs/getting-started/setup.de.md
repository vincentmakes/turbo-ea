# Installation und Einrichtung

Diese Anleitung führt Sie durch die Installation von Turbo EA mit Docker, die Konfiguration der Umgebung, das Laden von Demodaten und das Starten optionaler Dienste wie KI-Vorschläge und MCP-Server.

## Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

Etwa 2 GB freier Speicherplatz, ein paar Minuten Bandbreite für den ersten Image-Pull und die Ports `8920` (HTTP) sowie optional `9443` (HTTPS) frei auf dem Host.

## Schritt 1: Konfiguration beziehen

Sie benötigen eine `docker-compose.yml` und eine konfigurierte `.env`-Datei in einem Arbeitsverzeichnis. Am einfachsten klonen Sie das Repository:

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Öffnen Sie `.env` und setzen Sie die beiden Pflichtwerte:

```dotenv
# PostgreSQL-Anmeldedaten (werden vom integrierten Datenbank-Container verwendet).
# Wählen Sie ein starkes Passwort — es bleibt im gebundelten Volume bestehen.
POSTGRES_PASSWORD=choose-a-strong-password

# JWT-Signaturschlüssel. Generieren Sie einen mit:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

Alle weiteren Werte in `.env.example` haben sinnvolle Voreinstellungen.

!!! note
    Das Backend verweigert den Start mit dem Beispiel-`SECRET_KEY` außerhalb der Entwicklung. Erzeugen Sie vorher einen echten Schlüssel.

## Schritt 2: Pull und Start

Der gebundelte Stack (Postgres + Backend + Frontend + Edge-Nginx) läuft aus vorgefertigten Multi-Arch-Images von GHCR — kein lokaler Build erforderlich:

```bash
docker compose pull
docker compose up -d
```

Öffnen Sie **http://localhost:8920** und registrieren Sie den ersten Benutzer. Der erste registrierte Benutzer wird automatisch zum **Admin** befördert.

Um den Host-Port zu ändern, setzen Sie `HOST_PORT` in `.env` (Standard `8920`). Direkte HTTPS-Terminierung wird in [Schritt 5](#schritt-5-direktes-https-optional) behandelt.

## Schritt 3: Demodaten laden (optional)

Turbo EA kann leer starten (nur das integrierte Metamodell) oder mit dem **NexaTech Industries**-Demodatensatz, der ideal für Evaluierung, Schulungen und das Erkunden von Funktionen ist.

Setzen Sie das Seed-Flag in `.env` **vor dem ersten Start**:

```dotenv
SEED_DEMO=true
```

Dann `docker compose up -d` (falls Sie bereits gestartet haben, siehe „Zurücksetzen und neu seeden" unten).

### Seed-Optionen

| Variable | Standard | Beschreibung |
|----------|----------|-------------|
| `SEED_DEMO` | `false` | Lädt den vollständigen NexaTech-Industries-Datensatz, einschließlich BPM- und PPM-Daten |
| `SEED_BPM` | `false` | Lädt nur BPM-Demoprozesse (Teilmenge von `SEED_DEMO`) |
| `SEED_PPM` | `false` | Lädt nur PPM-Projektdaten (Teilmenge von `SEED_DEMO`) |
| `RESET_DB` | `false` | Verwirft alle Tabellen und erstellt sie beim Start neu |

`SEED_DEMO=true` enthält bereits BPM- und PPM-Daten — die Teilmengen-Flags müssen nicht zusätzlich gesetzt werden.

!!! note "Demodaten werden einmalig eingespielt"
    Jeder Seeder läuft **einmal pro Installation** und vermerkt dies. Das Löschen
    von Demoinhalten — eines Beispieldiagramms, einer Demoumfrage — ist endgültig:
    Sie kehren beim nächsten Neustart nicht zurück, auch wenn `SEED_DEMO=true`
    weiterhin gesetzt ist. Um den Demodatensatz zurückzuholen, setzen Sie die
    Datenbank zurück (siehe *Zurücksetzen und neu einspielen* weiter unten).

### Demo-Administratorkonto

Beim Laden der Demodaten wird ein Standard-Adminkonto erstellt:

| Feld | Wert |
|-------|-------|
| **E-Mail** | `admin@turboea.demo` |
| **Passwort** | `TurboEA!2025` |
| **Rolle** | Admin |

!!! warning
    Das Demo-Adminkonto verwendet bekannte, öffentliche Anmeldedaten. Ändern Sie das Passwort — oder erstellen Sie ein eigenes Adminkonto und deaktivieren Sie dieses — für jede Umgebung jenseits der lokalen Evaluierung.

### Was die Demodaten enthalten

Etwa 150 Karten über alle vier Architekturschichten, plus Beziehungen, Tags, Kommentare, Aufgaben, BPM-Diagramme, PPM-Daten, EA-Entscheidungsdokumente und ein Statement of Architecture Work:

- **Kern-EA** — Organisationen, ~20 Geschäftsfähigkeiten, Geschäftskontexte, ~15 Anwendungen, ~20 IT-Komponenten, Schnittstellen, Datenobjekte, Plattformen, Ziele, 6 Initiativen, 5 Tag-Gruppen, 60+ Beziehungen.
- **BPM** — ~30 Geschäftsprozesse in einer 4-stufigen Hierarchie mit BPMN-2.0-Diagrammen, Element-zu-Karte-Verknüpfungen und Prozessbewertungen.
- **PPM** — Statusberichte, Work Breakdown Structures, ~60 Aufgaben, Budget- und Kostenpositionen sowie ein Risikoregister über die 6 Demo-Initiativen.
- **EA Delivery** — Architektur-Entscheidungsdokumente und Statements of Architecture Work.

### Zurücksetzen und neu seeden

Um die Datenbank zu löschen und neu zu starten:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Stack neu starten, dann **`RESET_DB=true` aus `.env` entfernen** — wenn es gesetzt bleibt, wird die Datenbank bei jedem Neustart zurückgesetzt:

```bash
docker compose up -d
# Neue Daten prüfen, dann RESET_DB aus .env entfernen
```

## Schritt 4: Optionale Dienste (Compose-Profile)

Beide Add-ons sind opt-in über Docker-Compose-Profile und laufen neben dem Kernstack, ohne ihn zu beeinträchtigen.

### KI-Beschreibungsvorschläge

Generieren Sie Kartenbeschreibungen mit einem lokalen LLM (gebundeltes Ollama) oder einem kommerziellen Anbieter. Der gebundelte Ollama-Container ist der einfachste Weg für Self-Hosted-Setups.

In `.env` ergänzen:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Mit dem `ai`-Profil starten:

```bash
docker compose --profile ai up -d
```

Das Modell wird beim ersten Start automatisch heruntergeladen (einige Minuten, je nach Verbindung). Siehe [KI-Funktionen](../admin/ai.md) für die vollständige Konfigurationsreferenz, einschließlich der Verwendung von OpenAI / Gemini / Claude / DeepSeek anstelle des gebundelten Ollama.

### MCP-Server

Der MCP-Server ermöglicht KI-Tools — Claude Desktop, Cursor, GitHub Copilot und anderen — den Zugriff auf Ihre EA-Daten über das [Model Context Protocol](https://modelcontextprotocol.io/) mit benutzerspezifischer RBAC. Read-only.

```bash
docker compose --profile mcp up -d
```

Siehe [MCP-Integration](../admin/mcp.md) für OAuth-Einrichtung und Tool-Details.

### Beide gleichzeitig

```bash
docker compose --profile ai --profile mcp up -d
```

## Schritt 5: Direktes HTTPS (optional)

Das gebundelte Edge-Nginx kann TLS selbst terminieren — nützlich, wenn Sie keinen externen Reverse-Proxy haben. In `.env` ergänzen:

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

Legen Sie `cert.pem` und `key.pem` in `./certs/` ab (das Verzeichnis wird schreibgeschützt in den Nginx-Container eingebunden). Das Image leitet `server_name` und das weitergeleitete Schema aus `TURBO_EA_PUBLIC_URL` ab, bedient HTTP und HTTPS und leitet HTTP automatisch auf HTTPS um.

Für Setups hinter einem bestehenden Reverse-Proxy (Caddy, Traefik, Cloudflare Tunnel) lassen Sie `TURBO_EA_TLS_ENABLED=false` und überlassen die TLS-Terminierung dem Proxy.

## Einbetten von Diagrammen erlauben (optional)

Ein [veröffentlichtes Diagramm](../guide/diagrams.md) kann in eine andere Website eingebettet werden — eine Confluence-Seite, ein Intranet-Portal —, aber nur, wenn Sie diese Website zuvor benennen. Standardmäßig darf keine externe Website Turbo EA überhaupt in einen Frame einbetten.

```dotenv
TURBO_EA_EMBED_ALLOWED_ORIGINS=https://ihrunternehmen.atlassian.net
```

Mehrere Ursprünge durch Kommas trennen. Starten Sie den Stack neu, damit die Änderung wirksam wird.

Dies gilt **nur** für die Seiten veröffentlichter Diagramme. Die Anwendung selbst — einschließlich des Diagramm-Editors — bleibt in jedem Fall nicht einbettbar, und veröffentlichte Links funktionieren auch ohne diese Einstellung weiterhin beim direkten Aufruf.

## Eine Version anpinnen

`docker compose pull` zieht standardmäßig `:latest`. Um auf einen bestimmten Release in der Produktion zu pinnen, setzen Sie `TURBO_EA_TAG`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

Veröffentlichte Versionen sind als `:<full-version>`, `:<major>.<minor>`, `:<major>` und `:latest` getaggt. Der Publish-Workflow schließt Vorabversionen (`-rc.N`) von `:latest` und den Kurz-Tags `:X.Y` / `:X` aus. Siehe [Releases](../reference/releases.md) für den vollständigen Tag-Baum und die Pre-Release-Kanal-Richtlinie.

## Vorhandenes PostgreSQL nutzen

Wenn Sie bereits eine verwaltete oder gemeinsam genutzte PostgreSQL-Instanz betreiben, richten Sie das Backend dort aus und verzichten Sie auf den gebundelten `db`-Dienst.

Datenbank und Benutzer auf Ihrem bestehenden Server anlegen:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Verbindungsvariablen in `.env` überschreiben:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Dann wie gewohnt starten: `docker compose up -d`. Der gebundelte `db`-Dienst ist weiterhin in der `docker-compose.yml` definiert; Sie können ihn entweder leerlaufen lassen oder explizit stoppen.

### Verbindungsbudget

Das Backend läuft als einzelner Prozess und öffnet **bis zu `DB_POOL_SIZE + DB_MAX_OVERFLOW` Verbindungen — standardmäßig 30**. Der mitgelieferte `db`-Dienst erlaubt 100, die Standardwerte bereiten dort also nie Probleme. Eine verwaltete Instanz in einem günstigen Tarif begrenzt die Datenbank oft deutlich unter 30, und PostgreSQL antwortet dann:

```
too many connections for database "turboea"
```

Prüfen Sie Ihre Limits, bevor Sie umstellen:

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`-1` bei `datconnlimit` oder `rolconnlimit` bedeutet «keine spezifische Begrenzung»; alles unter 30 erfordert entweder ein höheres Limit oder einen kleineren Pool:

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

Ein kleinerer Pool bedeutet weniger gleichzeitig bediente Anfragen, keine verlorenen Anfragen: Ist der Pool voll, wartet eine Anfrage bis zu `DB_POOL_TIMEOUT` Sekunden auf eine freie Verbindung. Lassen Sie einige Verbindungen für Backups und eigene `psql`-Sitzungen frei.

## Images verifizieren

Ab `1.0.0` ist jedes veröffentlichte Image mit cosign keyless OIDC signiert und enthält eine von buildkit erzeugte SPDX-SBOM. Siehe [Lieferkette](../admin/supply-chain.md) für den Verifizierungsbefehl und wie Sie die SBOM aus der Registry abrufen.

## Aus dem Quellcode entwickeln

Wenn Sie den Stack aus dem Quellcode bauen möchten (Backend- oder Frontend-Code modifizieren), verwenden Sie die Dev-Compose-Override:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

Oder das Convenience-Ziel:

```bash
make up-dev
```

Der vollständige Entwicklerleitfaden — Branch-Benennung, Lint- und Test-Befehle, Pre-Commit-Prüfungen — ist in [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## Schnellreferenz

| Szenario | Befehl |
|----------|--------|
| Erststart (leere Daten) | `docker compose pull && docker compose up -d` |
| Erststart mit Demodaten | `SEED_DEMO=true` in `.env` setzen, dann derselbe Befehl |
| KI-Vorschläge hinzufügen | KI-Variablen ergänzen, dann `docker compose --profile ai up -d` |
| MCP-Server hinzufügen | `docker compose --profile mcp up -d` |
| Eine Version anpinnen | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| Zurücksetzen und neu seeden | `RESET_DB=true` + `SEED_DEMO=true`, neu starten, dann `RESET_DB` entfernen |
| Externes Postgres nutzen | `POSTGRES_*`-Variablen in `.env` überschreiben, dann `docker compose up -d` |
| Aus dem Quellcode bauen | `make up-dev` |

## Nächste Schritte

- Öffnen Sie **http://localhost:8920** (oder Ihren konfigurierten `HOST_PORT`) und melden Sie sich an. Wenn Sie Demodaten geladen haben, verwenden Sie `admin@turboea.demo` / `TurboEA!2025`. Andernfalls registrieren Sie sich — der erste Benutzer wird automatisch zum Admin befördert.
- Erkunden Sie das [Dashboard](../guide/dashboard.md) für einen Überblick über Ihre EA-Landschaft.
- Passen Sie [Kartentypen und Felder](../admin/metamodel.md) an — das Metamodell ist vollständig datengetrieben, keine Codeänderungen erforderlich.
- Für produktive Bereitstellungen lesen Sie [Kompatibilitätsrichtlinie](../reference/compatibility.md) und [Lieferkette](../admin/supply-chain.md).
