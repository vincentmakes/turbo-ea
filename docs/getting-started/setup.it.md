# Installazione e configurazione

Questa guida vi accompagna nell'installazione di Turbo EA con Docker, nella configurazione dell'ambiente, nel caricamento dei dati dimostrativi e nell'avvio dei servizi opzionali come i suggerimenti IA e il server MCP.

## Prerequisiti

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

Circa 2 GB di spazio libero su disco, qualche minuto di banda per il primo pull delle immagini, e le porte `8920` (HTTP) e opzionalmente `9443` (HTTPS) libere sull'host.

## Passaggio 1: Ottenere la configurazione

Avete bisogno di `docker-compose.yml` e di un file `.env` configurato in una directory di lavoro. Il modo più semplice è clonare il repository:

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Aprite `.env` e impostate i due valori obbligatori:

```dotenv
# Credenziali PostgreSQL (utilizzate dal contenitore database integrato).
# Scegliete una password robusta — persiste nel volume integrato.
POSTGRES_PASSWORD=choose-a-strong-password

# Chiave di firma JWT. Generatene una con:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

Tutto il resto in `.env.example` ha valori predefiniti ragionevoli.

!!! note
    Il backend rifiuta di avviarsi con la `SECRET_KEY` di esempio al di fuori dello sviluppo. Generatene una reale prima di proseguire.

## Passaggio 2: Pull e avvio

Lo stack integrato (Postgres + backend + frontend + nginx perimetrale) viene eseguito da immagini multi-architettura precompilate su GHCR — nessuna build locale necessaria:

```bash
docker compose pull
docker compose up -d
```

Aprite **http://localhost:8920** e registrate il primo utente. Il primo utente registrato viene automaticamente promosso ad **Admin**.

Per cambiare la porta dell'host, impostate `HOST_PORT` in `.env` (predefinito `8920`). La terminazione HTTPS diretta è trattata al [Passaggio 5](#passaggio-5-https-diretto-opzionale).

## Passaggio 3: Caricare i dati dimostrativi (opzionale)

Turbo EA può partire vuoto (solo il metamodello integrato) o con il dataset dimostrativo **NexaTech Industries**, ideale per la valutazione, la formazione e l'esplorazione delle funzionalità.

Impostate il flag di seed in `.env` **prima del primo avvio**:

```dotenv
SEED_DEMO=true
```

Poi `docker compose up -d` (se avete già avviato, consultate «Reimpostare e ri-seminare» più avanti).

### Opzioni di caricamento

| Variabile | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `SEED_DEMO` | `false` | Carica il dataset completo NexaTech Industries, inclusi dati BPM e PPM |
| `SEED_BPM` | `false` | Carica solo i processi BPM dimostrativi (sottoinsieme di `SEED_DEMO`) |
| `SEED_PPM` | `false` | Carica solo i dati di progetto PPM (sottoinsieme di `SEED_DEMO`) |
| `RESET_DB` | `false` | Elimina tutte le tabelle e le ricrea da zero all'avvio |

`SEED_DEMO=true` include già dati BPM e PPM — non è necessario impostare i flag di sottoinsieme separatamente.

!!! note "I dati dimostrativi vengono caricati una sola volta"
    Ogni seeder viene eseguito **una volta per installazione** e lo registra.
    Eliminare un contenuto dimostrativo — un diagramma di esempio, un sondaggio
    dimostrativo — è definitivo: non tornerà al riavvio successivo, anche se
    `SEED_DEMO=true` è ancora impostato. Per riavere il set di dati dimostrativi,
    reimposta il database (vedi *Reimpostare e ricaricare* più avanti).

### Account amministratore dimostrativo

Quando i dati dimostrativi sono caricati, viene creato un account amministratore predefinito:

| Campo | Valore |
|-------|--------|
| **Email** | `admin@turboea.demo` |
| **Password** | `TurboEA!2025` |
| **Ruolo** | Admin |

!!! warning
    L'account amministratore dimostrativo utilizza credenziali note e pubbliche. Cambiate la password — o create il vostro account amministratore e disabilitate questo — per qualsiasi ambiente al di là della valutazione locale.

### Cosa include la demo

Circa 150 cards distribuite sui quattro livelli di architettura, oltre a relazioni, etichette, commenti, attività, diagrammi BPM, dati PPM, ADR e uno Statement of Architecture Work:

- **Core EA** — Organizzazioni, ~20 Capacità Aziendali, Contesti Aziendali, ~15 Applicazioni, ~20 Componenti IT, Interfacce, Oggetti Dati, Piattaforme, Obiettivi, 6 Iniziative, 5 gruppi di etichette, 60+ relazioni.
- **BPM** — ~30 processi aziendali in una gerarchia a 4 livelli con diagrammi BPMN 2.0, collegamenti elemento-card e valutazioni di processo.
- **PPM** — Report di stato, Work Breakdown Structures, ~60 attività, voci di budget e costo, e un registro dei rischi sulle 6 Iniziative dimostrative.
- **EA Delivery** — Architecture Decision Records e Statements of Architecture Work.

### Reimpostare e ri-seminare

Per cancellare il database e ricominciare:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Riavviate lo stack, poi **rimuovete `RESET_DB=true` da `.env`** — lasciarlo impostato reimposta il database a ogni riavvio:

```bash
docker compose up -d
# Verificate che i nuovi dati siano presenti, poi modificate .env per rimuovere RESET_DB
```

## Passaggio 4: Servizi opzionali (profili Compose)

Entrambi i componenti aggiuntivi sono opt-in tramite profili Docker Compose e funzionano accanto allo stack principale senza interferire.

### Suggerimenti descrizione con IA

Generate descrizioni di card con un LLM locale (Ollama integrato) o un fornitore commerciale. Il contenitore Ollama integrato è la via più semplice per le configurazioni self-hosted.

Aggiungete a `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Avviate con il profilo `ai`:

```bash
docker compose --profile ai up -d
```

Il modello viene scaricato automaticamente al primo avvio (qualche minuto, a seconda della connessione). Vedere [Capacità IA](../admin/ai.md) per il riferimento completo della configurazione, incluso come usare OpenAI / Gemini / Claude / DeepSeek invece dell'Ollama integrato.

### Server MCP

Il server MCP consente agli strumenti IA — Claude Desktop, Cursor, GitHub Copilot e altri — di interrogare i vostri dati EA tramite il [Model Context Protocol](https://modelcontextprotocol.io/) con RBAC per utente. Sola lettura.

```bash
docker compose --profile mcp up -d
```

Vedere [Integrazione MCP](../admin/mcp.md) per la configurazione OAuth e i dettagli degli strumenti.

### Entrambi insieme

```bash
docker compose --profile ai --profile mcp up -d
```

## Passaggio 5: HTTPS diretto (opzionale)

Il nginx perimetrale integrato può terminare TLS da solo — utile se non avete un reverse-proxy esterno. Aggiungete a `.env`:

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

Mettete `cert.pem` e `key.pem` in `./certs/` (la directory è montata in sola lettura nel contenitore nginx). L'immagine deriva `server_name` e lo schema inoltrato da `TURBO_EA_PUBLIC_URL`, serve sia HTTP che HTTPS, e reindirizza HTTP a HTTPS automaticamente.

Per le configurazioni dietro a un reverse-proxy esistente (Caddy, Traefik, Cloudflare Tunnel), lasciate `TURBO_EA_TLS_ENABLED=false` e fate gestire TLS al proxy.

## Consentire l'incorporamento dei diagrammi (opzionale)

Un [diagramma pubblicato](../guide/diagrams.md) può essere incorporato in un altro sito — una pagina Confluence, un portale intranet — ma solo se indichi prima quel sito. Per impostazione predefinita nessun sito esterno può inserire Turbo EA in un frame.

```dotenv
TURBO_EA_EMBED_ALLOWED_ORIGINS=https://tuaazienda.atlassian.net
```

Separa più origini con virgole. Riavvia lo stack per applicare la modifica.

Questo vale **solo** per le pagine dei diagrammi pubblicati. L'applicazione stessa — editor di diagrammi incluso — resta comunque non incorporabile, e i collegamenti pubblicati continuano a funzionare se aperti direttamente anche senza questa impostazione.

## Fissare una versione

`docker compose pull` prende `:latest` per impostazione predefinita. Per fissare una versione specifica in produzione, impostate `TURBO_EA_TAG`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

Le versioni rilasciate sono etichettate come `:<full-version>`, `:<major>.<minor>`, `:<major>` e `:latest`. Il workflow di pubblicazione esclude le pre-release (`-rc.N`) da `:latest` e dalle etichette brevi `:X.Y` / `:X`. Vedere [Rilasci](../reference/releases.md) per l'albero completo dei tag e la politica del canale di pre-rilascio.

## Usare un PostgreSQL esistente

Se eseguite già un'istanza PostgreSQL gestita o condivisa, puntate il backend a essa e tralasciate il servizio `db` integrato.

Create il database e l'utente sul vostro server esistente:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Sovrascrivete le variabili di connessione in `.env`:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Poi avviate come al solito: `docker compose up -d`. Il servizio `db` integrato resta definito in `docker-compose.yml`; potete lasciarlo in idle o fermarlo esplicitamente.

### Budget di connessioni

Il backend viene eseguito come processo singolo e apre **fino a `DB_POOL_SIZE + DB_MAX_OVERFLOW` connessioni — 30 per impostazione predefinita**. Il servizio `db` incluso ne consente 100, quindi i valori predefiniti non creano mai problemi. Un'istanza gestita su un piano economico limita spesso il database ben al di sotto di 30 e PostgreSQL risponde allora:

```
too many connections for database "turboea"
```

Verificate i vostri limiti prima di passare:

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`-1` in `datconnlimit` o `rolconnlimit` significa «nessun limite specifico»; qualsiasi valore inferiore a 30 richiede di alzare il tetto o ridurre il pool:

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

Un pool più piccolo significa meno richieste servite contemporaneamente, non richieste perse: quando il pool è pieno, una richiesta attende fino a `DB_POOL_TIMEOUT` secondi che si liberi una connessione. Lasciate qualche connessione libera per i backup e per le vostre sessioni `psql`.

## Verificare le immagini

Da `1.0.0` ogni immagine pubblicata è firmata con cosign keyless OIDC e ha una SBOM SPDX generata da buildkit. Vedere [Catena di approvvigionamento](../admin/supply-chain.md) per il comando di verifica e come recuperare la SBOM dal registro.

## Sviluppo dal codice sorgente

Se volete costruire lo stack dal codice sorgente (modificando codice backend o frontend), usate l'override Compose di sviluppo:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

O il target di comodità:

```bash
make up-dev
```

La guida completa per lo sviluppatore — nomenclatura dei rami, comandi di lint e test, controlli pre-commit — è in [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## Riferimento rapido

| Scenario | Comando |
|----------|---------|
| Primo avvio (dati vuoti) | `docker compose pull && docker compose up -d` |
| Primo avvio con dati dimostrativi | Impostate `SEED_DEMO=true` in `.env`, poi lo stesso comando |
| Aggiungere suggerimenti IA | Aggiungete variabili IA, poi `docker compose --profile ai up -d` |
| Aggiungere server MCP | `docker compose --profile mcp up -d` |
| Fissare una versione | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| Reimpostare e ri-seminare | `RESET_DB=true` + `SEED_DEMO=true`, riavviate, poi rimuovete `RESET_DB` |
| Usare Postgres esterno | Sovrascrivete variabili `POSTGRES_*` in `.env`, poi `docker compose up -d` |
| Costruire dal codice sorgente | `make up-dev` |

## Prossimi passi

- Aprite **http://localhost:8920** (o il vostro `HOST_PORT` configurato) e accedete. Se avete caricato i dati dimostrativi, usate `admin@turboea.demo` / `TurboEA!2025`. Altrimenti, registratevi — il primo utente è automaticamente promosso ad Admin.
- Esplorate la [Dashboard](../guide/dashboard.md) per una panoramica del vostro panorama EA.
- Personalizzate [tipi di card e campi](../admin/metamodel.md) — il metamodello è completamente data-driven, senza modifiche al codice.
- Per i deployment di produzione, consultate [Politica di compatibilità](../reference/compatibility.md) e [Catena di approvvigionamento](../admin/supply-chain.md).
