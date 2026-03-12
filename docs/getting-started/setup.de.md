# Installation und Einrichtung

Diese Anleitung führt Sie durch die Installation von Turbo EA mit Docker, die Konfiguration der Umgebung, das Laden von Demodaten und das Starten optionaler Dienste wie KI und MCP-Server.

## Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

## Schritt 1: Klonen und konfigurieren

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Öffnen Sie `.env` in einem Texteditor und setzen Sie die erforderlichen Werte:

```dotenv
# PostgreSQL-Anmeldedaten (werden vom integrierten Datenbank-Container verwendet)
POSTGRES_PASSWORD=waehlen-sie-ein-starkes-passwort

# JWT-Signaturschlüssel — generieren Sie einen mit:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=ihr-generierter-schluessel

# Port, auf dem die Anwendung erreichbar ist
HOST_PORT=8920
```

## Schritt 2: Datenbankoption wählen

### Option A: Integrierte Datenbank (empfohlen für den Einstieg)

Die Datei `docker-compose.db.yml` startet einen PostgreSQL-Container zusammen mit Backend und Frontend. Es wird keine externe Datenbank benötigt — die Daten werden in einem Docker-Volume persistiert.

```bash
docker compose -f docker-compose.db.yml up --build -d
```

### Option B: Externes PostgreSQL

Wenn Sie bereits einen PostgreSQL-Server haben (verwaltete Datenbank, separater Container oder lokale Installation), verwenden Sie die Basisdatei `docker-compose.yml`, die nur Backend und Frontend startet.

Erstellen Sie zunächst eine Datenbank und einen Benutzer:

```sql
CREATE USER turboea WITH PASSWORD 'ihr-passwort';
CREATE DATABASE turboea OWNER turboea;
```

Konfigurieren Sie dann Ihre `.env`:

```dotenv
POSTGRES_HOST=ihr-postgresql-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=ihr-passwort
```

Starten Sie die Anwendung:

```bash
docker compose up --build -d
```

!!! note
    Die Basisdatei `docker-compose.yml` erwartet ein Docker-Netzwerk namens `guac-net`. Erstellen Sie es mit `docker network create guac-net`, falls es nicht existiert.

## Schritt 3: Demodaten laden (optional)

Turbo EA kann mit einem leeren Metamodell (nur die 14 integrierten Kartentypen und Beziehungstypen) oder mit einem vollständig befüllten Demodatensatz starten. Die Demodaten sind ideal zur Evaluierung der Plattform, für Schulungen oder zum Erkunden der Funktionen.

### Seed-Optionen

Fügen Sie diese Variablen **vor dem ersten Start** zu Ihrer `.env` hinzu:

| Variable | Standard | Beschreibung |
|----------|----------|-------------|
| `SEED_DEMO` | `false` | Lädt den vollständigen NexaTech-Industries-Demodatensatz inklusive BPM und PPM |
| `SEED_BPM` | `false` | Lädt nur BPM-Demoprozesse (Basisdemo muss vorhanden sein) |
| `SEED_PPM` | `false` | Lädt nur PPM-Projektdaten (Basisdemo muss vorhanden sein) |
| `RESET_DB` | `false` | Löscht alle Tabellen und erstellt sie beim Start neu |

### Vollständige Demo (empfohlen zur Evaluierung)

```dotenv
SEED_DEMO=true
```

Dies lädt den gesamten NexaTech-Industries-Datensatz mit einer einzigen Einstellung. Sie müssen `SEED_BPM` oder `SEED_PPM` **nicht** separat setzen — sie sind automatisch enthalten.

### Demo-Administratorkonto

Beim Laden der Demodaten wird ein Standard-Administratorkonto erstellt:

| Feld | Wert |
|------|------|
| **E-Mail** | `admin@turboea.demo` |
| **Passwort** | `TurboEA!2025` |
| **Rolle** | Administrator |

!!! warning
    Das Demo-Administratorkonto verwendet bekannte Anmeldedaten. Ändern Sie das Passwort oder erstellen Sie ein eigenes Administratorkonto für jede Umgebung über die lokale Evaluierung hinaus.

### Was die Demodaten enthalten

Der NexaTech-Industries-Datensatz umfasst etwa 150 Karten über alle Architekturebenen:

**Kern-EA-Daten** (immer enthalten mit `SEED_DEMO=true`):

- **Organisationen** — Unternehmenshierarchie: NexaTech Industries mit Geschäftsbereichen (Engineering, Fertigung, Vertrieb & Marketing), Regionen, Teams und Kunden
- **Geschäftsfähigkeiten** — Über 20 Fähigkeiten in einer mehrstufigen Hierarchie
- **Geschäftskontexte** — Prozesse, Wertströme, Customer Journeys, Geschäftsprodukte
- **Anwendungen** — Über 15 Anwendungen (NexaCore ERP, IoT-Plattform, Salesforce CRM usw.) mit vollständigen Lebenszyklus- und Kostendaten
- **IT-Komponenten** — Über 20 Infrastrukturelemente (Datenbanken, Server, Middleware, SaaS, KI-Modelle)
- **Schnittstellen & Datenobjekte** — API-Definitionen und Datenflüsse zwischen Systemen
- **Plattformen** — Cloud- und IoT-Plattformen mit Untertypen
- **Ziele & Initiativen** — 6 strategische Initiativen mit verschiedenen Genehmigungsstatus
- **Tags** — 5 Tag-Gruppen: Geschäftswert, Technologie-Stack, Lebenszyklusstatus, Risikoniveau, Regulatorischer Geltungsbereich
- **Beziehungen** — Über 60 Beziehungen, die Karten über alle Ebenen verknüpfen
- **EA-Bereitstellung** — Architekturentscheidungsprotokolle und Architekturarbeitsdokumente

**BPM-Daten** (enthalten mit `SEED_DEMO=true` oder `SEED_BPM=true`):

- ~30 Geschäftsprozesse in einer 4-stufigen Hierarchie (Kategorien, Gruppen, Prozesse, Varianten)
- BPMN-2.0-Diagramme mit extrahierten Prozesselementen (Aufgaben, Ereignisse, Gateways, Lanes)
- Element-zu-Karten-Verknüpfungen, die BPMN-Aufgaben mit Anwendungen, IT-Komponenten und Datenobjekten verbinden
- Prozessbewertungen mit Reife-, Effektivitäts- und Compliance-Bewertungen

**PPM-Daten** (enthalten mit `SEED_DEMO=true` oder `SEED_PPM=true`):

- Statusberichte für 6 Initiativen mit Projektzustand über die Zeit
- Projektstrukturpläne (PSP) mit hierarchischer Zerlegung und Meilensteinen
- ~60 Aufgaben über alle Initiativen mit Status, Prioritäten, Zuständigen und Tags
- Budgetzeilen (Capex/Opex nach Geschäftsjahr) und Kostenzeilen (tatsächliche Ausgaben)
- Risikoregister mit Wahrscheinlichkeits-/Auswirkungsbewertungen und Maßnahmenplänen

### Datenbank zurücksetzen

Um alles zu löschen und neu zu starten:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Starten Sie die Container neu und **entfernen Sie dann `RESET_DB` aus `.env`**, um ein Zurücksetzen bei jedem Neustart zu vermeiden:

```bash
docker compose -f docker-compose.db.yml up --build -d
# Nachdem alles funktioniert, entfernen Sie RESET_DB=true aus .env
```

## Schritt 4: Optionale Dienste

### KI-Beschreibungsvorschläge

Turbo EA kann Kartenbeschreibungen mit einem lokalen LLM (Ollama) oder kommerziellen Anbietern generieren. Der integrierte Ollama-Container ist der einfachste Einstieg.

Fügen Sie zu `.env` hinzu:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Starten Sie mit dem `ai`-Profil:

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

Das Modell wird beim ersten Start automatisch heruntergeladen (dies kann je nach Verbindung einige Minuten dauern). Siehe [KI-Funktionen](../admin/ai.md) für Konfigurationsdetails.

### MCP-Server (KI-Tool-Integration)

Der MCP-Server ermöglicht KI-Tools wie Claude Desktop, Cursor und GitHub Copilot den Zugriff auf Ihre EA-Daten.

```bash
docker compose -f docker-compose.db.yml --profile mcp up --build -d
```

Siehe [MCP-Integration](../admin/mcp.md) für Einrichtungs- und Authentifizierungsdetails.

### Profile kombinieren

Sie können mehrere Profile gleichzeitig aktivieren:

```bash
docker compose -f docker-compose.db.yml --profile ai --profile mcp up --build -d
```

## Kurzreferenz: Häufige Startbefehle

| Szenario | Befehl |
|----------|--------|
| **Minimaler Start** (integrierte DB, leer) | `docker compose -f docker-compose.db.yml up --build -d` |
| **Vollständige Demo** (integrierte DB, alle Daten) | Setzen Sie `SEED_DEMO=true` in `.env`, dann `docker compose -f docker-compose.db.yml up --build -d` |
| **Vollständige Demo + KI** | Setzen Sie `SEED_DEMO=true` + KI-Variablen in `.env`, dann `docker compose -f docker-compose.db.yml --profile ai up --build -d` |
| **Externe DB** | Konfigurieren Sie DB-Variablen in `.env`, dann `docker compose up --build -d` |
| **Zurücksetzen und neu befüllen** | Setzen Sie `RESET_DB=true` + `SEED_DEMO=true` in `.env`, Neustart, dann `RESET_DB` entfernen |

## Nächste Schritte

- Öffnen Sie **http://localhost:8920** (oder Ihren konfigurierten `HOST_PORT`) im Browser
- Wenn Sie Demodaten geladen haben, melden Sie sich mit `admin@turboea.demo` / `TurboEA!2025` an
- Andernfalls registrieren Sie ein neues Konto — der erste Benutzer erhält automatisch die **Administrator**-Rolle
- Erkunden Sie das [Dashboard](../guide/dashboard.md) für einen Überblick über Ihre EA-Landschaft
- Konfigurieren Sie das [Metamodell](../admin/metamodel.md), um Kartentypen und Felder anzupassen
