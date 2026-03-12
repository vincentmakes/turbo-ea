# Installazione e configurazione

Questa guida illustra come installare Turbo EA con Docker, configurare l'ambiente, caricare i dati dimostrativi e avviare servizi opzionali come l'IA e il server MCP.

## Prerequisiti

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

## Passaggio 1: Clonare e configurare

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Aprite `.env` in un editor di testo e impostate i valori richiesti:

```dotenv
# Credenziali PostgreSQL (utilizzate dal contenitore database integrato)
POSTGRES_PASSWORD=scegliete-una-password-sicura

# Chiave di firma JWT — generatene una con:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=la-vostra-chiave-generata

# Porta su cui l'applicazione sarà disponibile
HOST_PORT=8920
```

## Passaggio 2: Scegliere l'opzione database

### Opzione A: Database integrato (consigliato per iniziare)

Il file `docker-compose.db.yml` avvia un contenitore PostgreSQL insieme al backend e al frontend. Non è necessario un database esterno — i dati vengono persistiti in un volume Docker.

```bash
docker compose -f docker-compose.db.yml up --build -d
```

### Opzione B: PostgreSQL esterno

Se disponete già di un server PostgreSQL (database gestito, contenitore separato o installazione locale), utilizzate il file base `docker-compose.yml` che avvia solo backend e frontend.

Create prima un database e un utente:

```sql
CREATE USER turboea WITH PASSWORD 'la-vostra-password';
CREATE DATABASE turboea OWNER turboea;
```

Quindi configurate il vostro `.env`:

```dotenv
POSTGRES_HOST=il-vostro-host-postgresql
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=la-vostra-password
```

Avviate l'applicazione:

```bash
docker compose up --build -d
```

!!! note
    Il file base `docker-compose.yml` richiede una rete Docker chiamata `guac-net`. Createla con `docker network create guac-net` se non esiste.

## Passaggio 3: Caricare i dati dimostrativi (opzionale)

Turbo EA può avviarsi con un metamodello vuoto (solo i 14 tipi di card integrati e i tipi di relazione) o con un set di dati dimostrativi completo. I dati dimostrativi sono ideali per valutare la piattaforma, condurre sessioni di formazione o esplorare le funzionalità.

### Opzioni di caricamento

Aggiungete queste variabili al vostro `.env` **prima del primo avvio**:

| Variabile | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `SEED_DEMO` | `false` | Carica il set completo di dati NexaTech Industries, inclusi BPM e PPM |
| `SEED_BPM` | `false` | Carica solo i processi dimostrativi BPM (richiede i dati base) |
| `SEED_PPM` | `false` | Carica solo i dati di progetto PPM (richiede i dati base) |
| `RESET_DB` | `false` | Elimina tutte le tabelle e le ricrea all'avvio |

### Demo completa (consigliata per la valutazione)

```dotenv
SEED_DEMO=true
```

Questo carica l'intero set di dati NexaTech Industries con una singola impostazione. **Non** è necessario impostare `SEED_BPM` o `SEED_PPM` separatamente — sono inclusi automaticamente.

### Account amministratore dimostrativo

Quando vengono caricati i dati dimostrativi, viene creato un account amministratore predefinito:

| Campo | Valore |
|-------|--------|
| **E-mail** | `admin@turboea.demo` |
| **Password** | `TurboEA!2025` |
| **Ruolo** | Amministratore |

!!! warning
    L'account amministratore dimostrativo utilizza credenziali note. Cambiate la password o create il vostro account amministratore per qualsiasi ambiente oltre la valutazione locale.

### Cosa includono i dati dimostrativi

Il set di dati NexaTech Industries comprende circa 150 card su tutti i livelli di architettura:

**Dati EA principali** (sempre inclusi con `SEED_DEMO=true`):

- **Organizzazioni** — Gerarchia aziendale: NexaTech Industries con unità di business (Ingegneria, Produzione, Vendite e Marketing), regioni, team e clienti
- **Capacità di business** — Oltre 20 capacità in una gerarchia multilivello
- **Contesti di business** — Processi, flussi di valore, customer journey, prodotti aziendali
- **Applicazioni** — Oltre 15 applicazioni (NexaCore ERP, Piattaforma IoT, Salesforce CRM, ecc.) con dati completi di ciclo di vita e costi
- **Componenti IT** — Oltre 20 elementi infrastrutturali (database, server, middleware, SaaS, modelli IA)
- **Interfacce e oggetti dati** — Definizioni API e flussi di dati tra sistemi
- **Piattaforme** — Piattaforme Cloud e IoT con sottotipi
- **Obiettivi e iniziative** — 6 iniziative strategiche con diversi stati di approvazione
- **Tag** — 5 gruppi: Valore di Business, Stack Tecnologico, Stato del Ciclo di Vita, Livello di Rischio, Ambito Normativo
- **Relazioni** — Oltre 60 relazioni che collegano card tra tutti i livelli
- **Consegna EA** — Registri di decisioni architetturali e documenti di lavoro architetturale

**Dati BPM** (inclusi con `SEED_DEMO=true` o `SEED_BPM=true`):

- ~30 processi aziendali organizzati in una gerarchia a 4 livelli (categorie, gruppi, processi, varianti)
- Diagrammi BPMN 2.0 con elementi di processo estratti (attività, eventi, gateway, corsie)
- Collegamenti elemento-card che connettono attività BPMN ad applicazioni, componenti IT e oggetti dati
- Valutazioni dei processi con punteggi di maturità, efficacia e conformità

**Dati PPM** (inclusi con `SEED_DEMO=true` o `SEED_PPM=true`):

- Report di stato per 6 iniziative che mostrano la salute del progetto nel tempo
- Strutture di scomposizione del lavoro (WBS) con decomposizione gerarchica e milestone
- ~60 attività tra le iniziative con stati, priorità, assegnatari e tag
- Linee di budget (capex/opex per anno fiscale) e linee di costo (spese effettive)
- Registro dei rischi con punteggi di probabilità/impatto e piani di mitigazione

### Reimpostare il database

Per cancellare tutto e ricominciare:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Riavviate i contenitori e poi **rimuovete `RESET_DB` da `.env`** per evitare il reset ad ogni riavvio:

```bash
docker compose -f docker-compose.db.yml up --build -d
# Dopo aver verificato il funzionamento, rimuovete RESET_DB=true da .env
```

## Passaggio 4: Servizi opzionali

### Suggerimenti descrizione con IA

Turbo EA può generare descrizioni delle card utilizzando un LLM locale (Ollama) o fornitori commerciali. Il contenitore Ollama integrato è il modo più semplice per iniziare.

Aggiungete a `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Avviate con il profilo `ai`:

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

Il modello viene scaricato automaticamente al primo avvio (potrebbe richiedere alcuni minuti a seconda della connessione). Consultate [Funzionalità IA](../admin/ai.md) per i dettagli di configurazione.

### Server MCP (integrazione strumenti IA)

Il server MCP consente a strumenti IA come Claude Desktop, Cursor e GitHub Copilot di interrogare i vostri dati EA.

```bash
docker compose -f docker-compose.db.yml --profile mcp up --build -d
```

Consultate [Integrazione MCP](../admin/mcp.md) per i dettagli di configurazione e autenticazione.

### Combinare i profili

Potete abilitare più profili contemporaneamente:

```bash
docker compose -f docker-compose.db.yml --profile ai --profile mcp up --build -d
```

## Riferimento rapido: Comandi di avvio comuni

| Scenario | Comando |
|----------|---------|
| **Avvio minimale** (DB integrato, vuoto) | `docker compose -f docker-compose.db.yml up --build -d` |
| **Demo completa** (DB integrato, tutti i dati) | Impostate `SEED_DEMO=true` in `.env`, poi `docker compose -f docker-compose.db.yml up --build -d` |
| **Demo completa + IA** | Impostate `SEED_DEMO=true` + variabili IA in `.env`, poi `docker compose -f docker-compose.db.yml --profile ai up --build -d` |
| **DB esterno** | Configurate le variabili DB in `.env`, poi `docker compose up --build -d` |
| **Reset e ricaricamento** | Impostate `RESET_DB=true` + `SEED_DEMO=true` in `.env`, riavviate, poi rimuovete `RESET_DB` |

## Passi successivi

- Aprite **http://localhost:8920** (o il vostro `HOST_PORT` configurato) nel browser
- Se avete caricato i dati dimostrativi, accedete con `admin@turboea.demo` / `TurboEA!2025`
- Altrimenti, registrate un nuovo account — il primo utente ottiene automaticamente il ruolo di **Amministratore**
- Esplorate il [Dashboard](../guide/dashboard.md) per una panoramica del vostro panorama EA
- Configurate il [Metamodello](../admin/metamodel.md) per personalizzare tipi di card e campi
